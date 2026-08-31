import { Router } from 'express';
import { withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { monthlySummary, trend } from '../services/reportService.js';
import { Errors } from '../domain/errors.js';

export const reportsRouter = Router();

reportsRouter.get(
  '/monthly',
  asyncHandler(async (req, res) => {
    const month = String(req.query.month ?? '');
    if (!/^\d{4}-\d{2}$/.test(month)) throw Errors.validation('month must be YYYY-MM');
    const summary = await withTransaction((client) => monthlySummary(client, req.userId, month));
    res.json({ summary });
  })
);

reportsRouter.get(
  '/trend',
  asyncHandler(async (req, res) => {
    const months = Math.min(24, Math.max(1, Number(req.query.months ?? 6)));
    const points = await withTransaction((client) => trend(client, req.userId, months));
    res.json({ points });
  })
);
