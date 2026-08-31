import { sub, zero, type CategoryBreakdownItem, type MonthlySummary, type TrendPoint } from '@finance/shared';
import type { DbClient } from '../db/pool.js';

export async function monthlySummary(client: DbClient, userId: string, month: string): Promise<MonthlySummary> {
  const totalsRes = await client.query(
    `SELECT
       COALESCE(SUM(base_amount) FILTER (WHERE type = 'income'), 0) AS income,
       COALESCE(SUM(base_amount) FILTER (WHERE type = 'personal_expense'), 0) AS expense
     FROM transactions
     WHERE user_id = $1 AND deleted_at IS NULL AND to_char(transaction_date, 'YYYY-MM') = $2`,
    [userId, month]
  );
  const income = String(totalsRes.rows[0].income);
  const expense = String(totalsRes.rows[0].expense);

  const byCategoryRes = await client.query(
    `SELECT t.category_id, c.name AS category_name, SUM(t.base_amount) AS total
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id = $1 AND t.deleted_at IS NULL AND t.type = 'personal_expense'
       AND to_char(t.transaction_date, 'YYYY-MM') = $2
     GROUP BY t.category_id, c.name
     ORDER BY total DESC`,
    [userId, month]
  );
  const byCategory: CategoryBreakdownItem[] = byCategoryRes.rows.map((row) => ({
    categoryId: row.category_id,
    categoryName: row.category_name ?? '',
    total: String(row.total),
  }));

  return { month, income, expense, netCashFlow: sub(income, expense), byCategory };
}

export async function trend(client: DbClient, userId: string, months: number): Promise<TrendPoint[]> {
  const res = await client.query(
    `SELECT to_char(transaction_date, 'YYYY-MM') AS month,
            COALESCE(SUM(base_amount) FILTER (WHERE type = 'income'), 0) AS income,
            COALESCE(SUM(base_amount) FILTER (WHERE type = 'personal_expense'), 0) AS expense
     FROM transactions
     WHERE user_id = $1 AND deleted_at IS NULL
       AND transaction_date >= date_trunc('month', CURRENT_DATE) - ($2::int - 1) * INTERVAL '1 month'
     GROUP BY month
     ORDER BY month`,
    [userId, months]
  );
  const byMonth = new Map(res.rows.map((r) => [r.month as string, { income: String(r.income), expense: String(r.expense) }]));

  // Fill in months with zero activity so the trend chart has no gaps.
  const points: TrendPoint[] = [];
  const cursor = new Date();
  cursor.setDate(1);
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  for (const key of keys) {
    const found = byMonth.get(key);
    points.push({ month: key, income: found?.income ?? zero(), expense: found?.expense ?? zero() });
  }
  return points;
}
