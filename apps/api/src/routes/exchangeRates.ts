import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const exchangeRatesRouter = Router();

const upsertSchema = z.object({
  baseCode: z.string().length(3),
  quoteCode: z.string().length(3),
  rate: z.string().regex(/^\d+(\.\d+)?$/),
  rateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Manual rate entry. A real deployment would also run a scheduled job
 * pulling from a rate provider (needs an API key this environment doesn't
 * have) and writing into the same table with `source` set accordingly —
 * this endpoint and that job would share the same table, just a different
 * `source` value.
 */
exchangeRatesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = upsertSchema.parse(req.body);
    const row = await withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO exchange_rates (base_code, quote_code, rate, rate_date, source)
         VALUES ($1, $2, $3, $4, 'manual')
         ON CONFLICT (base_code, quote_code, rate_date) DO UPDATE SET rate = EXCLUDED.rate
         RETURNING *`,
        [input.baseCode, input.quoteCode, input.rate, input.rateDate]
      );
      return result.rows[0];
    });
    res.status(201).json({ exchangeRate: row });
  })
);

exchangeRatesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const base = req.query.base as string | undefined;
    const quote = req.query.quote as string | undefined;
    const rows = await withTransaction(async (client) => {
      const result = await client.query(
        `SELECT * FROM exchange_rates
         WHERE ($1::text IS NULL OR base_code = $1) AND ($2::text IS NULL OR quote_code = $2)
         ORDER BY rate_date DESC LIMIT 100`,
        [base ?? null, quote ?? null]
      );
      return result.rows;
    });
    res.json({ exchangeRates: rows });
  })
);
