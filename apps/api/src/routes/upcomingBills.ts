import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { runIdempotent } from '../middleware/idempotencyRunner.js';
import { createUpcomingBill, deleteUpcomingBill, listUpcomingBills, markAsPaid, updateUpcomingBill } from '../services/upcomingBillService.js';

export const upcomingBillsRouter = Router();

upcomingBillsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const bills = await withTransaction((client) => listUpcomingBills(client, req.userId));
    res.json({ bills });
  })
);

const createSchema = z.object({
  title: z.string().min(1),
  amountMajor: z.string().min(1),
  currencyCode: z.string().length(3).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().optional().nullable(),
});

upcomingBillsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const bill = await withTransaction((client) => createUpcomingBill(client, req.userId, input));
    res.status(201).json({ bill });
  })
);

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  amountMajor: z.string().min(1).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().optional().nullable(),
});

upcomingBillsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const patch = updateSchema.parse(req.body);
    const bill = await withTransaction((client) => updateUpcomingBill(client, req.userId, req.params.id!, patch));
    res.json({ bill });
  })
);

const paySchema = z.object({ accountId: z.string().uuid() });

upcomingBillsRouter.post(
  '/:id/pay',
  asyncHandler(async (req, res) => {
    const { accountId } = paySchema.parse(req.body);
    await runIdempotent(req, res, 'POST /upcoming-bills/:id/pay', async (client) => {
      const bill = await markAsPaid(client, { userId: req.userId, sessionId: req.sessionId }, req.params.id!, accountId);
      return { status: 200, body: { bill } };
    });
  })
);

upcomingBillsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await withTransaction((client) => deleteUpcomingBill(client, req.userId, req.params.id!));
    res.status(204).end();
  })
);
