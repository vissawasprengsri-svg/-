import { fromMajorInput, type Budget, type RecurrenceFreq } from '@finance/shared';
import type { DbClient } from '../db/pool.js';
import { Errors } from '../domain/errors.js';

export interface CreateBudgetInput {
  categoryId?: string | null;
  name: string;
  amountMajor: string;
  currencyCode: string;
  periodType: RecurrenceFreq;
  periodStart: string;
  periodEnd: string;
  rollover?: boolean;
  alertPcts?: number[];
}

function mapBudgetRow(row: Record<string, unknown>): Budget {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    categoryId: (row.category_id as string | null) ?? null,
    name: row.name as string,
    amount: String(row.amount),
    currencyCode: row.currency_code as string,
    periodType: row.period_type as RecurrenceFreq,
    periodStart: String(row.period_start).slice(0, 10),
    periodEnd: String(row.period_end).slice(0, 10),
    rollover: Boolean(row.rollover),
    alertPcts: ((row.alert_pcts as number[] | null) ?? []).map(Number),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    deletedAt: row.deleted_at ? (row.deleted_at instanceof Date ? row.deleted_at.toISOString() : String(row.deleted_at)) : null,
    spent: String(row.spent ?? '0'),
  };
}

async function getCurrencyMinorUnit(client: DbClient, code: string): Promise<number> {
  const res = await client.query<{ minor_unit: number }>('SELECT minor_unit FROM currencies WHERE code = $1', [code]);
  if (res.rows.length === 0) throw Errors.validation(`Unknown currency code: ${code}`);
  return res.rows[0]!.minor_unit;
}

const SPENT_SUBQUERY = `
  COALESCE((
    SELECT SUM(t.amount) FROM transactions t
    WHERE t.category_id = b.category_id AND t.user_id = b.user_id
      AND t.type = 'personal_expense' AND t.deleted_at IS NULL
      AND t.transaction_date BETWEEN b.period_start AND b.period_end
  ), 0) AS spent
`;

export async function createBudget(client: DbClient, userId: string, input: CreateBudgetInput): Promise<Budget> {
  if (input.periodEnd < input.periodStart) throw Errors.validation('periodEnd must be on or after periodStart');
  const minorUnit = await getCurrencyMinorUnit(client, input.currencyCode);
  const amountMinor = fromMajorInput(input.amountMajor, minorUnit);
  // The spent-so-far figure is computed from other rows (transactions), so
  // it can't come back from a plain RETURNING on this INSERT — insert first,
  // then read the budget back through the same query listBudgets() uses.
  const inserted = await client.query(
    `INSERT INTO budgets (user_id, category_id, name, amount, currency_code, period_type, period_start, period_end, rollover, alert_pcts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      userId,
      input.categoryId ?? null,
      input.name,
      amountMinor,
      input.currencyCode,
      input.periodType,
      input.periodStart,
      input.periodEnd,
      input.rollover ?? false,
      input.alertPcts ?? [80, 100],
    ]
  );
  const budget = await getBudgetById(client, userId, inserted.rows[0].id);
  if (!budget) throw Errors.notFound('budget');
  return budget;
}

export async function getBudgetById(client: DbClient, userId: string, id: string): Promise<Budget | null> {
  const res = await client.query(
    `SELECT b.*, ${SPENT_SUBQUERY}
     FROM budgets b WHERE b.id = $1 AND b.user_id = $2 AND b.deleted_at IS NULL`,
    [id, userId]
  );
  return res.rows[0] ? mapBudgetRow(res.rows[0]) : null;
}

export async function listBudgets(client: DbClient, userId: string): Promise<Budget[]> {
  const res = await client.query(
    `SELECT b.*, ${SPENT_SUBQUERY}
     FROM budgets b
     WHERE b.user_id = $1 AND b.deleted_at IS NULL
     ORDER BY b.is_active DESC, b.period_start DESC`,
    [userId]
  );
  return res.rows.map(mapBudgetRow);
}

export async function archiveBudget(client: DbClient, userId: string, id: string): Promise<void> {
  const res = await client.query(
    'UPDATE budgets SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [id, userId]
  );
  if (res.rowCount === 0) throw Errors.notFound('budget');
}

/**
 * Rolls every ended-but-active budget into its next period. `rollover`
 * budgets carry any unspent amount forward (never negative); others just
 * repeat the same amount. The old period's row is deactivated, not
 * deleted, so it stays visible as history.
 */
export async function rolloverEndedBudgets(client: DbClient, userId: string): Promise<number> {
  const ended = await client.query(
    `SELECT b.*, ${SPENT_SUBQUERY}
     FROM budgets b
     WHERE b.user_id = $1 AND b.is_active = TRUE AND b.deleted_at IS NULL AND b.period_end < CURRENT_DATE`,
    [userId]
  );
  for (const row of ended.rows) {
    const periodLengthDays = await client.query<{ days: number }>(
      'SELECT ($1::date - $2::date) AS days',
      [row.period_end, row.period_start]
    );
    const length = periodLengthDays.rows[0]!.days;
    const nextStartRes = await client.query<{ next_start: string }>('SELECT ($1::date + 1) AS next_start', [row.period_end]);
    const nextStart = nextStartRes.rows[0]!.next_start;
    const nextEndRes = await client.query<{ next_end: string }>('SELECT ($1::date + $2::int) AS next_end', [nextStart, length]);
    const nextEnd = nextEndRes.rows[0]!.next_end;

    const amount = BigInt(row.amount);
    const spent = BigInt(row.spent);
    const leftover = amount - spent;
    const nextAmount = row.rollover && leftover > 0n ? amount + leftover : amount;

    await client.query(
      `INSERT INTO budgets (user_id, category_id, name, amount, currency_code, period_type, period_start, period_end, rollover, alert_pcts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [row.user_id, row.category_id, row.name, nextAmount.toString(), row.currency_code, row.period_type, nextStart, nextEnd, row.rollover, row.alert_pcts]
    );
    await client.query('UPDATE budgets SET is_active = FALSE WHERE id = $1', [row.id]);
  }
  return ended.rows.length;
}
