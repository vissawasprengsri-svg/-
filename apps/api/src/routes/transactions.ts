import { Router } from 'express';
import { z } from 'zod';
import { CLAIM_STATUS_ORDER } from '@finance/shared';
import { withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { runIdempotent } from '../middleware/idempotencyRunner.js';
import {
  createTransaction,
  listActiveTransactions,
  listUnsortedExpenses,
  softDeleteTransaction,
  updateClaimReceived,
  updateClaimStatus,
  updateTransactionAccount,
  updateTransactionCategory,
  updateTransactionDetails,
} from '../services/transactionService.js';
import { searchTransactions } from '../services/searchService.js';
import { Errors } from '../domain/errors.js';

export const transactionsRouter = Router();

const createTransactionSchema = z.object({
  type: z.enum(['income', 'personal_expense', 'pending_claim', 'investment', 'debt_payment', 'loan_given', 'transfer']),
  amountMajor: z.string().min(1),
  currencyCode: z.string().length(3),
  description: z.string().optional(),
  note: z.string().optional(),
  merchant: z.string().optional(),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  categoryId: z.string().uuid().optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
  toAccountId: z.string().uuid().optional().nullable(),
  debtId: z.string().uuid().optional().nullable(),
  status: z.enum(['awaiting_bill', 'pending', 'claimed', 'received', 'rejected', 'cancelled']).optional().nullable(),
  buyer: z.string().optional().nullable(),
  direction: z.enum(['buy', 'sell', 'dividend', 'fee']).optional().nullable(),
  clientId: z.string().uuid(),
});

transactionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const transactions = await withTransaction((client) => listActiveTransactions(client, req.userId));
    res.json({ transactions });
  })
);

transactionsRouter.get(
  '/unsorted',
  asyncHandler(async (req, res) => {
    const transactions = await withTransaction((client) => listUnsortedExpenses(client, req.userId));
    res.json({ transactions });
  })
);

transactionsRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = req.query;
    const transactions = await withTransaction((client) =>
      searchTransactions(client, req.userId, {
        q: typeof q.q === 'string' ? q.q : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        categoryId: typeof q.categoryId === 'string' ? q.categoryId : undefined,
        type: typeof q.type === 'string' ? (q.type as never) : undefined,
        status: typeof q.status === 'string' ? (q.status as never) : undefined,
        amountMinMajor: typeof q.amountMin === 'string' ? q.amountMin : undefined,
        amountMaxMajor: typeof q.amountMax === 'string' ? q.amountMax : undefined,
      })
    );
    res.json({ transactions });
  })
);

transactionsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createTransactionSchema.parse(req.body);
    await runIdempotent(req, res, 'POST /transactions', async (client) => {
      const result = await createTransaction(client, { userId: req.userId, sessionId: req.sessionId }, input);
      return { status: result.replay ? 200 : 201, body: { transaction: result.transaction, replay: result.replay } };
    });
  })
);

transactionsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await runIdempotent(req, res, 'DELETE /transactions/:id', async (client) => {
      const transaction = await softDeleteTransaction(client, { userId: req.userId, sessionId: req.sessionId }, req.params.id!);
      return { status: 200, body: { transaction } };
    });
  })
);

const claimStatusSchema = z.object({
  status: z.enum(CLAIM_STATUS_ORDER as [string, ...string[]]),
});

transactionsRouter.post(
  '/:id/claim-status',
  asyncHandler(async (req, res) => {
    const { status } = claimStatusSchema.parse(req.body);
    await runIdempotent(req, res, 'POST /transactions/:id/claim-status', async (client) => {
      const transaction = await updateClaimStatus(
        client,
        { userId: req.userId, sessionId: req.sessionId },
        req.params.id!,
        status as (typeof CLAIM_STATUS_ORDER)[number]
      );
      return { status: 200, body: { transaction } };
    });
  })
);

const categorySchema = z.object({ categoryId: z.string().uuid().nullable() });

transactionsRouter.patch(
  '/:id/category',
  asyncHandler(async (req, res) => {
    const { categoryId } = categorySchema.parse(req.body);
    const transaction = await withTransaction((client) =>
      updateTransactionCategory(client, { userId: req.userId, sessionId: req.sessionId }, req.params.id!, categoryId)
    );
    res.json({ transaction });
  })
);

const detailsSchema = z.object({
  amountMajor: z.string().min(1).optional(),
  description: z.string().optional(),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

transactionsRouter.patch(
  '/:id/details',
  asyncHandler(async (req, res) => {
    const input = detailsSchema.parse(req.body);
    const transaction = await withTransaction((client) =>
      updateTransactionDetails(client, { userId: req.userId, sessionId: req.sessionId }, req.params.id!, input)
    );
    res.json({ transaction });
  })
);

const accountSchema = z.object({ accountId: z.string().uuid().nullable() });

transactionsRouter.patch(
  '/:id/account',
  asyncHandler(async (req, res) => {
    const { accountId } = accountSchema.parse(req.body);
    const transaction = await withTransaction((client) =>
      updateTransactionAccount(client, { userId: req.userId, sessionId: req.sessionId }, req.params.id!, accountId)
    );
    res.json({ transaction });
  })
);

const claimReceivedSchema = z.object({ received: z.boolean() });

transactionsRouter.post(
  '/:id/claim-received',
  asyncHandler(async (req, res) => {
    const { received } = claimReceivedSchema.parse(req.body);
    await runIdempotent(req, res, 'POST /transactions/:id/claim-received', async (client) => {
      const transaction = await updateClaimReceived(client, { userId: req.userId, sessionId: req.sessionId }, req.params.id!, received);
      return { status: 200, body: { transaction } };
    });
  })
);

transactionsRouter.param('id', (req, res, next, id) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    next(Errors.validation('Invalid transaction id'));
    return;
  }
  next();
});
