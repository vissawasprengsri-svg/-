import { fromMajorInput, type Transaction, type TransactionSearchFilters } from '@finance/shared';
import type { DbClient } from '../db/pool.js';
import { mapTransactionRow } from '../db/mappers.js';

/**
 * Full-text search (via the schema's own `search_vector`/GIN index) combined
 * with structured filters. Amount bounds are compared against `base_amount`
 * (the user's base currency) so a mixed-currency result set still filters
 * sensibly — "over ฿500" means the same thing regardless of what currency
 * any one transaction was booked in.
 */
export async function searchTransactions(client: DbClient, userId: string, filters: TransactionSearchFilters): Promise<Transaction[]> {
  let amountMinMinor: string | null = null;
  let amountMaxMinor: string | null = null;
  if (filters.amountMinMajor || filters.amountMaxMajor) {
    const baseRes = await client.query<{ base_currency: string }>('SELECT base_currency FROM users WHERE id = $1', [userId]);
    const baseCurrency = baseRes.rows[0]?.base_currency ?? 'THB';
    const minorRes = await client.query<{ minor_unit: number }>('SELECT minor_unit FROM currencies WHERE code = $1', [baseCurrency]);
    const minorUnit = minorRes.rows[0]?.minor_unit ?? 2;
    if (filters.amountMinMajor) amountMinMinor = fromMajorInput(filters.amountMinMajor, minorUnit);
    if (filters.amountMaxMajor) amountMaxMinor = fromMajorInput(filters.amountMaxMajor, minorUnit);
  }

  const res = await client.query(
    `SELECT t.*, c.name AS category_name, c.is_claimable AS category_is_claimable
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id = $1 AND t.deleted_at IS NULL
       AND ($2::text IS NULL OR t.search_vector @@ plainto_tsquery('simple', $2))
       AND ($3::date IS NULL OR t.transaction_date >= $3)
       AND ($4::date IS NULL OR t.transaction_date <= $4)
       AND ($5::uuid IS NULL OR t.category_id = $5)
       AND ($6::transaction_type IS NULL OR t.type = $6)
       AND ($7::claim_status IS NULL OR t.status = $7)
       AND ($8::bigint IS NULL OR t.base_amount >= $8)
       AND ($9::bigint IS NULL OR t.base_amount <= $9)
     ORDER BY t.transaction_date DESC, t.created_at DESC
     LIMIT 200`,
    [
      userId,
      filters.q ?? null,
      filters.dateFrom ?? null,
      filters.dateTo ?? null,
      filters.categoryId ?? null,
      filters.type ?? null,
      filters.status ?? null,
      amountMinMinor,
      amountMaxMinor,
    ]
  );
  return res.rows.map(mapTransactionRow);
}
