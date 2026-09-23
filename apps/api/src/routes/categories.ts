import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { runIdempotent } from '../middleware/idempotencyRunner.js';
import { createCategory, deleteCategory, listCategories, renameCategory, reorderCategories, updateCategoryStatusLabel } from '../services/categoryService.js';
import { NO_ACCOUNT_SENTINEL, receiveCategoryClaims } from '../services/transactionService.js';

export const categoriesRouter = Router();

const TX_TYPES = ['income', 'personal_expense', 'pending_claim', 'investment', 'debt_payment', 'loan_given', 'transfer'] as const;

categoriesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const appliesTo = typeof req.query.appliesTo === 'string' ? (req.query.appliesTo as (typeof TX_TYPES)[number]) : undefined;
    const categories = await withTransaction((client) => listCategories(client, req.userId, appliesTo));
    res.json({ categories });
  })
);

const createSchema = z.object({
  name: z.string().min(1),
  appliesTo: z.array(z.enum(TX_TYPES)).min(1),
  statusLabel: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
});

categoriesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const category = await withTransaction((client) => createCategory(client, req.userId, input));
    res.status(201).json({ category });
  })
);

const reorderSchema = z.object({ orderedIds: z.array(z.string().uuid()).min(1) });

// Must be registered before the `/:id` routes below, or Express would match
// the literal path "reorder" as an :id.
categoriesRouter.patch(
  '/reorder',
  asyncHandler(async (req, res) => {
    const { orderedIds } = reorderSchema.parse(req.body);
    await withTransaction((client) => reorderCategories(client, req.userId, orderedIds));
    res.json({ ok: true });
  })
);

const renameSchema = z.object({ name: z.string().min(1) });

categoriesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { name } = renameSchema.parse(req.body);
    const category = await withTransaction((client) => renameCategory(client, req.userId, req.params.id!, name));
    res.json({ category });
  })
);

const statusLabelSchema = z.object({ statusLabel: z.string().optional().nullable() });

categoriesRouter.patch(
  '/:id/status-label',
  asyncHandler(async (req, res) => {
    const { statusLabel } = statusLabelSchema.parse(req.body);
    const category = await withTransaction((client) => updateCategoryStatusLabel(client, req.userId, req.params.id!, statusLabel ?? null));
    res.json({ category });
  })
);

categoriesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await withTransaction((client) => deleteCategory(client, req.userId, req.params.id!));
    res.status(204).end();
  })
);

// A real account credits the reimbursement into it as usual; the sentinel is
// "advance clearing" — settle the bill against a cash advance already held,
// with no account to credit at all. See NO_ACCOUNT_SENTINEL for why this
// isn't just an optional field: omitting targetAccountId means "the original
// paying account", which is a different, already-existing behavior.
const receiveClaimsSchema = z.object({
  targetAccountId: z.union([z.string().uuid(), z.literal(NO_ACCOUNT_SENTINEL)]),
});

categoriesRouter.post(
  '/:id/receive-claims',
  asyncHandler(async (req, res) => {
    const { targetAccountId } = receiveClaimsSchema.parse(req.body);
    await runIdempotent(req, res, 'POST /categories/:id/receive-claims', async (client) => {
      await receiveCategoryClaims(client, { userId: req.userId, sessionId: req.sessionId }, req.params.id!, targetAccountId);
      return { status: 200, body: { ok: true } };
    });
  })
);
