import { fromMajorInput, type Debt } from '@finance/shared';
import type { DbClient } from '../db/pool.js';
import { Errors } from '../domain/errors.js';

function mapRow(row: Record<string, unknown>): Debt {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    currencyCode: row.currency_code as string,
    principalAmount: String(row.principal_amount),
    currentBalance: String(row.current_balance),
    counterparty: (row.counterparty as string | null) ?? null,
    isReceivable: Boolean(row.is_receivable),
    dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    deletedAt: row.deleted_at ? new Date(row.deleted_at as string).toISOString() : null,
  };
}

export async function listDebts(client: DbClient, userId: string): Promise<Debt[]> {
  const res = await client.query(
    'SELECT * FROM debts WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at',
    [userId]
  );
  return res.rows.map(mapRow);
}

export async function createDebt(
  client: DbClient,
  userId: string,
  input: { name: string; currencyCode: string; balanceMajor: string; isReceivable?: boolean }
): Promise<Debt> {
  const minorRes = await client.query<{ minor_unit: number }>('SELECT minor_unit FROM currencies WHERE code = $1', [
    input.currencyCode,
  ]);
  const minorUnit = minorRes.rows[0]?.minor_unit ?? 2;
  const balanceMinor = fromMajorInput(input.balanceMajor, minorUnit);
  const res = await client.query(
    `INSERT INTO debts (user_id, name, currency_code, principal_amount, current_balance, is_receivable)
     VALUES ($1,$2,$3,$4,$4,$5) RETURNING *`,
    [userId, input.name, input.currencyCode, balanceMinor, input.isReceivable ?? false]
  );
  return mapRow(res.rows[0]);
}

export async function updateDebtBalance(client: DbClient, userId: string, id: string, balanceMajor: string): Promise<Debt> {
  const debtRes = await client.query<{ currency_code: string }>(
    'SELECT currency_code FROM debts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [id, userId]
  );
  if (debtRes.rows.length === 0) throw Errors.notFound('debt');
  const minorRes = await client.query<{ minor_unit: number }>('SELECT minor_unit FROM currencies WHERE code = $1', [
    debtRes.rows[0]!.currency_code,
  ]);
  const minorUnit = minorRes.rows[0]?.minor_unit ?? 2;
  const balanceMinor = fromMajorInput(balanceMajor, minorUnit);
  const res = await client.query('UPDATE debts SET current_balance = $1 WHERE id = $2 RETURNING *', [balanceMinor, id]);
  return mapRow(res.rows[0]);
}

export async function archiveDebt(client: DbClient, userId: string, id: string): Promise<void> {
  const res = await client.query('UPDATE debts SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [
    id,
    userId,
  ]);
  if (res.rowCount === 0) throw Errors.notFound('debt');
}
