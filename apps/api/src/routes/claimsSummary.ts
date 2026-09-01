import { Router } from 'express';
import { withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getClaimsSummary } from '../services/claimsSummaryService.js';

export const claimsSummaryRouter = Router();

claimsSummaryRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const summary = await withTransaction((client) => getClaimsSummary(client, req.userId));
    res.json({ summary });
  })
);
