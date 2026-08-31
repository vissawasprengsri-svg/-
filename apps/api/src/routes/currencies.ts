import { Router } from 'express';
import { withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const currenciesRouter = Router();

currenciesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await withTransaction(async (client) => {
      const result = await client.query(
        'SELECT code, name, symbol, minor_unit AS "minorUnit" FROM currencies WHERE is_active = TRUE ORDER BY code'
      );
      return result.rows;
    });
    res.json({ currencies: rows });
  })
);
