import { randomUUID } from 'node:crypto';
import type { CreateUpcomingBillInput, UpcomingBill } from '@finance/shared';
import { fromMajorInput, toMajorString } from '@finance/shared';
import type { DbClient } from '../db/pool.js';
import { Errors } from '../domain/errors.js';
import { createTransaction } from './transactionService.js';

interface Ctx {
  userId: string;
  sessionId: string;
}

function mapRow(row: Record<string, unknown>): UpcomingBill {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: row.title as string,
    amount: String(row.amount),
    currencyCode: row.currency_code as string,
    dueDate: String(row.due_date).slice(0, 10),
    note: (row.note as string | null) ?? null,
    isPaid: Boolean(row.is_paid),
    paidAt: row.paid_at ? new Date(row.paid_at as string).toISOString() : null,
    transactionId: (row.transaction_id as string | null) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    deletedAt: row.deleted_at ? new Date(row.deleted_at as string).toISOString() : null,
  };
}

async function getCurrencyMinorUnit(client: DbClient, code: string): Promise<number> {
  const res = await client.query<{ minor_unit: number }>('SELECT minor_unit FROM currencies WHERE code = $1', [code]);
  if (res.rows.length === 0) throw Errors.validation(`Unknown currency code: ${code}`);
  return res.rows[0]!.minor_unit;
}

export async function listUpcomingBills(client: DbClient, userId: string): Promise<UpcomingBill[]> {
  const res = await client.query(
    `SELECT * FROM upcoming_bills WHERE user_id = $1 AND is_paid = FALSE AND deleted_at IS NULL ORDER BY due_date ASC`,
    [userId]
  );
  return res.rows.map(mapRow);
}

export async function createUpcomingBill(client: DbClient, userId: string, input: CreateUpcomingBillInput): Promise<UpcomingBill> {
  const currencyCode = input.currencyCode ?? 'THB';
  const minorUnit = await getCurrencyMinorUnit(client, currencyCode);
  const amountMinor = fromMajorInput(input.amountMajor, minorUnit);

  const res = await client.query(
    `INSERT INTO upcoming_bills (user_id, title, amount, currency_code, due_date, note)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [userId, input.title, amountMinor, currencyCode, input.dueDate, input.note ?? null]
  );
  return mapRow(res.rows[0]);
}

export interface UpdateUpcomingBillInput {
  title?: string;
  amountMajor?: string;
  dueDate?: string;
  note?: string | null;
}

/** Edits a jotted-down bill in place. Paid bills are off limits — their amount
 * and title are already reflected in a booked transaction, so changing them
 * here would silently disagree with the ledger. */
export async function updateUpcomingBill(
  client: DbClient,
  userId: string,
  id: string,
  patch: UpdateUpcomingBillInput
): Promise<UpcomingBill> {
  const beforeRes = await client.query(
    `SELECT * FROM upcoming_bills WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
    [id, userId]
  );
  const before = beforeRes.rows[0];
  if (!before) throw Errors.notFound('upcoming bill');
  if (before.is_paid) throw Errors.validation('บิลนี้จ่ายไปแล้ว แก้ไขไม่ได้');

  const amountMinor =
    patch.amountMajor !== undefined
      ? fromMajorInput(patch.amountMajor, await getCurrencyMinorUnit(client, before.currency_code))
      : String(before.amount);

  const res = await client.query(
    `UPDATE upcoming_bills SET title = $3, amount = $4, due_date = $5, note = $6 WHERE id = $1 AND user_id = $2 RETURNING *`,
    [
      id,
      userId,
      patch.title ?? before.title,
      amountMinor,
      patch.dueDate ?? String(before.due_date).slice(0, 10),
      patch.note !== undefined ? patch.note : before.note,
    ]
  );
  return mapRow(res.rows[0]);
}

/**
 * Marks a bill paid and books the real expense in one step — the whole point
 * of jotting a bill down ahead of time is to convert it, at the moment it's
 * actually paid, into a normal personal_expense that debits the chosen
 * account, without re-typing the title/amount by hand.
 */
export async function markAsPaid(client: DbClient, ctx: Ctx, id: string, accountId: string): Promise<UpcomingBill> {
  const billRes = await client.query(
    `SELECT * FROM upcoming_bills WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
    [id, ctx.userId]
  );
  const bill = billRes.rows[0];
  if (!bill) throw Errors.notFound('upcoming bill');
  if (bill.is_paid) throw Errors.validation('บิลนี้จ่ายไปแล้ว');

  const minorUnit = await getCurrencyMinorUnit(client, bill.currency_code);
  const { transaction } = await createTransaction(client, ctx, {
    type: 'personal_expense',
    amountMajor: toMajorString(String(bill.amount), minorUnit),
    currencyCode: bill.currency_code,
    description: bill.title,
    note: bill.note ?? undefined,
    transactionDate: new Date().toISOString().slice(0, 10),
    accountId,
    clientId: randomUUID(),
  });

  const res = await client.query(
    `UPDATE upcoming_bills SET is_paid = TRUE, paid_at = now(), transaction_id = $1 WHERE id = $2 RETURNING *`,
    [transaction.id, id]
  );
  return mapRow(res.rows[0]);
}

export async function deleteUpcomingBill(client: DbClient, userId: string, id: string): Promise<void> {
  const res = await client.query(
    'UPDATE upcoming_bills SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [id, userId]
  );
  if (res.rowCount === 0) throw Errors.notFound('upcoming bill');
}
