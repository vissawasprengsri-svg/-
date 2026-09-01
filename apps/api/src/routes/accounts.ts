import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { archiveAccount, createAccount, listAccounts, reorderAccounts, updateAccountBalance, updateCreditLimit } from '../services/accountService.js';

export const accountsRouter = Router();

accountsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const accounts = await withTransaction((client) => listAccounts(client, req.userId));
    res.json({ accounts });
  })
);

const createSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['cash', 'bank', 'ewallet', 'credit_card']),
  currencyCode: z.string().length(3),
  openingBalanceMajor: z.string().optional(),
  creditLimitMajor: z.string().optional(),
  dueDay: z.number().int().min(1).max(31).optional().nullable(),
  statementDay: z.number().int().min(1).max(31).optional().nullable(),
});

accountsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const account = await withTransaction((client) => createAccount(client, req.userId, input));
    res.status(201).json({ account });
  })
);

accountsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await withTransaction((client) => archiveAccount(client, req.userId, req.params.id!));
    res.status(204).end();
  })
);

const limitSchema = z.object({ creditLimitMajor: z.string().min(1) });

accountsRouter.patch(
  '/:id/credit-limit',
  asyncHandler(async (req, res) => {
    const { creditLimitMajor } = limitSchema.parse(req.body);
    await withTransaction((client) => updateCreditLimit(client, req.userId, req.params.id!, creditLimitMajor));
    res.json({ ok: true });
  })
);

const balanceSchema = z.object({ balanceMajor: z.string().min(1) });

accountsRouter.patch(
  '/:id/balance',
  asyncHandler(async (req, res) => {
    const { balanceMajor } = balanceSchema.parse(req.body);
    await withTransaction((client) => updateAccountBalance(client, req.userId, req.params.id!, balanceMajor));
    res.json({ ok: true });
  })
);

const reorderSchema = z.object({ orderedIds: z.array(z.string().uuid()).min(1) });

accountsRouter.patch(
  '/reorder',
  asyncHandler(async (req, res) => {
    const { orderedIds } = reorderSchema.parse(req.body);
    await withTransaction((client) => reorderAccounts(client, req.userId, orderedIds));
    res.json({ ok: true });
  })
);
