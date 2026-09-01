import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { archiveDebt, createDebt, listDebts, updateDebtBalance } from '../services/debtService.js';

export const debtsRouter = Router();

debtsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const debts = await withTransaction((client) => listDebts(client, req.userId));
    res.json({ debts });
  })
);

const createSchema = z.object({
  name: z.string().min(1),
  currencyCode: z.string().length(3),
  balanceMajor: z.string().min(1),
  isReceivable: z.boolean().optional(),
});

debtsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const debt = await withTransaction((client) => createDebt(client, req.userId, input));
    res.status(201).json({ debt });
  })
);

const balanceSchema = z.object({ balanceMajor: z.string().min(1) });

debtsRouter.patch(
  '/:id/balance',
  asyncHandler(async (req, res) => {
    const { balanceMajor } = balanceSchema.parse(req.body);
    const debt = await withTransaction((client) => updateDebtBalance(client, req.userId, req.params.id!, balanceMajor));
    res.json({ debt });
  })
);

debtsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await withTransaction((client) => archiveDebt(client, req.userId, req.params.id!));
    res.status(204).end();
  })
);
