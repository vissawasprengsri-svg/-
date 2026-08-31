import { Router } from 'express';
import { withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { runIdempotent } from '../middleware/idempotencyRunner.js';
import { listTrash, restoreTransaction } from '../services/transactionService.js';

export const trashRouter = Router();

trashRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const transactions = await withTransaction((client) => listTrash(client, req.userId));
    res.json({ transactions });
  })
);

trashRouter.post(
  '/:id/restore',
  asyncHandler(async (req, res) => {
    await runIdempotent(req, res, 'POST /trash/:id/restore', async (client) => {
      const transaction = await restoreTransaction(client, { userId: req.userId, sessionId: req.sessionId }, req.params.id!);
      return { status: 200, body: { transaction } };
    });
  })
);
