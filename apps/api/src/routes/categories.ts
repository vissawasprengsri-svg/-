import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { createCategory, deleteCategory, listCategories, renameCategory, reorderCategories, updateCategoryClaimSettings } from '../services/categoryService.js';

export const categoriesRouter = Router();

const TX_TYPES = ['income', 'personal_expense', 'pending_claim', 'investment', 'debt_payment', 'loan_given', 'transfer'] as const;
const CLAIM_STATUSES = ['awaiting_bill', 'pending', 'claimed', 'received', 'rejected', 'cancelled'] as const;

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
  isClaimable: z.boolean().optional(),
  defaultClaimStatus: z.enum(CLAIM_STATUSES).optional().nullable(),
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

const claimSettingsSchema = z.object({
  isClaimable: z.boolean(),
  defaultClaimStatus: z.enum(CLAIM_STATUSES).optional().nullable(),
});

categoriesRouter.patch(
  '/:id/claim-settings',
  asyncHandler(async (req, res) => {
    const patch = claimSettingsSchema.parse(req.body);
    const category = await withTransaction((client) =>
      updateCategoryClaimSettings(client, req.userId, req.params.id!, { isClaimable: patch.isClaimable, defaultClaimStatus: patch.defaultClaimStatus ?? null })
    );
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
