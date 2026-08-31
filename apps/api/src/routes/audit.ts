import { Router } from 'express';
import { withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { listAuditHistory } from '../domain/auditLog.js';

export const auditRouter = Router();

auditRouter.get(
  '/transactions/:id',
  asyncHandler(async (req, res) => {
    const history = await withTransaction((client) => listAuditHistory(client, 'transaction', req.params.id!));
    res.json({ history });
  })
);
