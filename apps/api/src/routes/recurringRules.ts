import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  createRecurringRule,
  deleteRecurringRule,
  listRecurringRules,
  runDueRecurringRules,
  setRecurringRuleActive,
} from '../services/recurringService.js';

export const recurringRulesRouter = Router();

const templateSchema = z.object({
  type: z.enum(['income', 'personal_expense', 'pending_claim', 'investment', 'debt_payment', 'loan_given', 'transfer']),
  amountMajor: z.string().min(1),
  currencyCode: z.string().length(3),
  description: z.string().optional(),
  categoryId: z.string().uuid().optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
});

const createSchema = z.object({
  template: templateSchema,
  frequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']),
  intervalCount: z.number().int().positive().optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional().nullable(),
  dayOfWeek: z.number().int().min(0).max(6).optional().nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  maxOccurrences: z.number().int().positive().optional().nullable(),
  autoCreate: z.boolean().optional(),
});

recurringRulesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rules = await withTransaction((client) => listRecurringRules(client, req.userId));
    res.json({ rules });
  })
);

recurringRulesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const rule = await withTransaction((client) => createRecurringRule(client, req.userId, input));
    res.status(201).json({ rule });
  })
);

const patchSchema = z.object({ isActive: z.boolean() });

recurringRulesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { isActive } = patchSchema.parse(req.body);
    const rule = await withTransaction((client) => setRecurringRuleActive(client, req.userId, req.params.id!, isActive));
    res.json({ rule });
  })
);

recurringRulesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await withTransaction((client) => deleteRecurringRule(client, req.userId, req.params.id!));
    res.status(204).end();
  })
);

/** Manual trigger for testing while there's no scheduler wired up — see apps/api/src/jobs/daily.ts. */
recurringRulesRouter.post(
  '/run-now',
  asyncHandler(async (req, res) => {
    const created = await withTransaction((client) => runDueRecurringRules(client, req.userId, req.sessionId));
    res.json({ created });
  })
);
