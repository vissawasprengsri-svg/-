import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { runIdempotent } from '../middleware/idempotencyRunner.js';
import { createClaimBatch, deleteClaimBatch, listClaimBatches } from '../services/claimBatchService.js';

export const claimBatchesRouter = Router();

claimBatchesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const batches = await withTransaction((client) => listClaimBatches(client, req.userId));
    res.json({ batches });
  })
);

const createSchema = z.object({
  transactionIds: z.array(z.string().uuid()).min(1),
  title: z.string().max(200).optional(),
});

claimBatchesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    // Idempotent like the other multi-row mutations: a double-tap on "submit
    // batch" must not file the same bills into two batches.
    await runIdempotent(req, res, 'POST /claim-batches', async (client) => {
      const batch = await createClaimBatch(client, { userId: req.userId, sessionId: req.sessionId }, input);
      return { status: 201, body: { batch } };
    });
  })
);

claimBatchesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await withTransaction((client) =>
      deleteClaimBatch(client, { userId: req.userId, sessionId: req.sessionId }, req.params.id!)
    );
    res.json({ ok: true });
  })
);
