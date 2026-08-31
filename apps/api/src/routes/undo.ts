import { Router } from 'express';
import { withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { redoLast, undoLast } from '../domain/commandStore.js';
import { recordAudit } from '../domain/auditLog.js';
import { mapTransactionRow } from '../db/mappers.js';
import { Errors } from '../domain/errors.js';

export const undoRouter = Router();

undoRouter.post(
  '/undo',
  asyncHandler(async (req, res) => {
    const result = await withTransaction(async (client) => {
      const command = await undoLast(client, req.sessionId);
      if (!command) throw Errors.nothingToUndo();

      const txIds = command.inverse_patch.filter((p) => p.table === 'transactions').map((p) => p.id);
      const transactions = [];
      for (const id of txIds) {
        const row = await client.query('SELECT * FROM transactions WHERE id = $1', [id]);
        if (row.rows[0]) {
          transactions.push(mapTransactionRow(row.rows[0]));
          await recordAudit(client, {
            userId: req.userId,
            entityType: 'transaction',
            entityId: id,
            action: 'update',
            before: null,
            after: row.rows[0],
            actorId: req.userId,
          });
        }
      }
      return { commandType: command.command_type, transactions };
    });
    res.json(result);
  })
);

undoRouter.post(
  '/redo',
  asyncHandler(async (req, res) => {
    const result = await withTransaction(async (client) => {
      const command = await redoLast(client, req.sessionId);
      if (!command) throw Errors.nothingToRedo();

      const txIds = command.forward_patch.filter((p) => p.table === 'transactions').map((p) => p.id);
      const transactions = [];
      for (const id of txIds) {
        const row = await client.query('SELECT * FROM transactions WHERE id = $1', [id]);
        if (row.rows[0]) {
          transactions.push(mapTransactionRow(row.rows[0]));
          await recordAudit(client, {
            userId: req.userId,
            entityType: 'transaction',
            entityId: id,
            action: 'update',
            before: null,
            after: row.rows[0],
            actorId: req.userId,
          });
        }
      }
      return { commandType: command.command_type, transactions };
    });
    res.json(result);
  })
);
