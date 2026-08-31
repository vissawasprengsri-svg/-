import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { archiveBudget, createBudget, listBudgets, rolloverEndedBudgets } from '../services/budgetService.js';

export const budgetsRouter = Router();

const createSchema = z.object({
  categoryId: z.string().uuid().optional().nullable(),
  name: z.string().min(1),
  amountMajor: z.string().min(1),
  currencyCode: z.string().length(3),
  periodType: z.enum(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rollover: z.boolean().optional(),
  alertPcts: z.array(z.number().int().positive()).optional(),
});

budgetsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const budgets = await withTransaction((client) => listBudgets(client, req.userId));
    res.json({ budgets });
  })
);

budgetsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const budget = await withTransaction((client) => createBudget(client, req.userId, input));
    res.status(201).json({ budget });
  })
);

budgetsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await withTransaction((client) => archiveBudget(client, req.userId, req.params.id!));
    res.status(204).end();
  })
);

/** Manual trigger for testing while there's no scheduler wired up — see apps/api/src/jobs/daily.ts. */
budgetsRouter.post(
  '/rollover-now',
  asyncHandler(async (req, res) => {
    const rolledOver = await withTransaction((client) => rolloverEndedBudgets(client, req.userId));
    res.json({ rolledOver });
  })
);
