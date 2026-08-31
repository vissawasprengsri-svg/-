import { invertDecimal } from '@finance/shared';
import type { DbClient } from '../db/pool.js';
import { Errors } from './errors.js';

export interface ResolvedRate {
  rate: string; // major-unit rate: 1 unit of `from` = `rate` units of `to`
  source: 'same_currency' | 'direct' | 'inverse';
}

/**
 * Resolves the exchange rate to use for a transaction and locks it: the
 * rate effective on (or most recently before) the transaction date is
 * read once here and then stored permanently on the transaction row —
 * later corrections to `exchange_rates` never retroactively change an
 * already-booked transaction's `base_amount`.
 */
export async function resolveExchangeRate(
  client: DbClient,
  params: { fromCode: string; toCode: string; date: string }
): Promise<ResolvedRate> {
  if (params.fromCode === params.toCode) {
    return { rate: '1', source: 'same_currency' };
  }

  const direct = await client.query<{ rate: string }>(
    `SELECT rate FROM exchange_rates
     WHERE base_code = $1 AND quote_code = $2 AND rate_date <= $3
     ORDER BY rate_date DESC LIMIT 1`,
    [params.fromCode, params.toCode, params.date]
  );
  if (direct.rows.length > 0) {
    return { rate: direct.rows[0]!.rate, source: 'direct' };
  }

  const inverse = await client.query<{ rate: string }>(
    `SELECT rate FROM exchange_rates
     WHERE base_code = $1 AND quote_code = $2 AND rate_date <= $3
     ORDER BY rate_date DESC LIMIT 1`,
    [params.toCode, params.fromCode, params.date]
  );
  if (inverse.rows.length > 0) {
    return { rate: invertDecimal(inverse.rows[0]!.rate, 10), source: 'inverse' };
  }

  throw Errors.validation(
    `No exchange rate available for ${params.fromCode} -> ${params.toCode} on or before ${params.date}. ` +
      `Add one via POST /api/exchange-rates first.`
  );
}
