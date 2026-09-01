import { convertAmount, fromMajorInput, CLAIM_STATUS_ORDER, type ClaimStatus, type CreateTransactionInput, type Transaction } from '@finance/shared';
import type { DbClient } from '../db/pool.js';
import { mapTransactionRow } from '../db/mappers.js';
import { recordCommand, type RowSnapshot } from '../domain/commandStore.js';
import { recordAudit } from '../domain/auditLog.js';
import { applyLedgerEffects, computeLedgerEffects } from '../domain/ledger.js';
import { resolveExchangeRate } from '../domain/exchangeRate.js';
import { Errors } from '../domain/errors.js';

interface Ctx {
  userId: string;
  sessionId: string;
}

async function getCurrencyMinorUnit(client: DbClient, code: string): Promise<number> {
  const res = await client.query<{ minor_unit: number }>('SELECT minor_unit FROM currencies WHERE code = $1', [code]);
  if (res.rows.length === 0) throw Errors.validation(`Unknown currency code: ${code}`);
  return res.rows[0]!.minor_unit;
}

async function getUserBaseCurrency(client: DbClient, userId: string): Promise<string> {
  const res = await client.query<{ base_currency: string }>('SELECT base_currency FROM users WHERE id = $1', [userId]);
  if (res.rows.length === 0) throw Errors.notFound('user');
  return res.rows[0]!.base_currency;
}

function softDeletedVariant(row: Record<string, unknown>, deletedBy: string): Record<string, unknown> {
  return { ...row, deleted_at: new Date().toISOString(), deleted_by: deletedBy };
}

function notDeletedVariant(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, deleted_at: null, deleted_by: null };
}

export async function createTransaction(
  client: DbClient,
  ctx: Ctx,
  input: CreateTransactionInput,
  opts: { idempotencyKey?: string } = {}
): Promise<{ transaction: Transaction; replay: boolean }> {
  const minorUnit = await getCurrencyMinorUnit(client, input.currencyCode);
  const baseCurrency = await getUserBaseCurrency(client, ctx.userId);
  const baseMinorUnit = await getCurrencyMinorUnit(client, baseCurrency);
  const amountMinor = fromMajorInput(input.amountMajor, minorUnit);

  // Resolve + lock the FX rate now: this exact rate is what's stored on the
  // row forever, even if `exchange_rates` later gets a correction for this
  // date — booked transactions never get recalculated retroactively.
  const { rate } = await resolveExchangeRate(client, {
    fromCode: input.currencyCode,
    toCode: baseCurrency,
    date: input.transactionDate,
  });
  const baseAmountMinor = convertAmount(amountMinor, minorUnit, baseMinorUnit, rate);

  const insertRes = await client.query(
    `INSERT INTO transactions (
       user_id, type, amount, currency_code, exchange_rate, base_amount, base_currency_code,
       description, note, merchant, transaction_date, category_id, account_id, to_account_id,
       debt_id, status, buyer, direction, client_id, created_by, idempotency_key
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$1,$20)
     ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      ctx.userId,
      input.type,
      amountMinor,
      input.currencyCode,
      rate,
      baseAmountMinor,
      baseCurrency,
      input.description ?? null,
      input.note ?? null,
      input.merchant ?? null,
      input.transactionDate,
      input.categoryId ?? null,
      input.accountId ?? null,
      input.toAccountId ?? null,
      input.debtId ?? null,
      input.status ?? null,
      input.buyer ?? null,
      input.direction ?? null,
      input.clientId,
      opts.idempotencyKey ?? null,
    ]
  );

  if (insertRes.rows.length === 0) {
    // Duplicate submit with the same client-generated id: replay, don't double-book.
    const existing = await client.query('SELECT * FROM transactions WHERE user_id = $1 AND client_id = $2', [
      ctx.userId,
      input.clientId,
    ]);
    return { transaction: mapTransactionRow(existing.rows[0]), replay: true };
  }

  const row = insertRes.rows[0];
  const effects = computeLedgerEffects({
    type: row.type,
    amount: String(row.amount),
    accountId: row.account_id,
    toAccountId: row.to_account_id,
    debtId: row.debt_id,
    direction: row.direction,
  });
  const ledgerSnapshots = await applyLedgerEffects(client, effects, 1);

  const txSnapshot: RowSnapshot = {
    table: 'transactions',
    id: row.id,
    before: softDeletedVariant(row, ctx.userId),
    after: notDeletedVariant(row),
  };

  await recordCommand(client, { ...ctx, commandType: 'CREATE_TRANSACTION' }, [txSnapshot, ...ledgerSnapshots]);
  await recordAudit(client, {
    userId: ctx.userId,
    entityType: 'transaction',
    entityId: row.id,
    action: 'create',
    before: null,
    after: row,
    actorId: ctx.userId,
  });

  return { transaction: mapTransactionRow(row), replay: false };
}

export async function softDeleteTransaction(client: DbClient, ctx: Ctx, transactionId: string): Promise<Transaction> {
  const beforeRes = await client.query(
    'SELECT * FROM transactions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE',
    [transactionId, ctx.userId]
  );
  const before = beforeRes.rows[0];
  if (!before) throw Errors.notFound('transaction');

  const effects = computeLedgerEffects({
    type: before.type,
    amount: String(before.amount),
    accountId: before.account_id,
    toAccountId: before.to_account_id,
    debtId: before.debt_id,
    direction: before.direction,
  });
  const ledgerSnapshots = await applyLedgerEffects(client, effects, -1);

  const afterRes = await client.query(
    'UPDATE transactions SET deleted_at = now(), deleted_by = $2 WHERE id = $1 RETURNING *',
    [transactionId, ctx.userId]
  );
  const after = afterRes.rows[0];

  const txSnapshot: RowSnapshot = { table: 'transactions', id: transactionId, before, after };
  await recordCommand(client, { ...ctx, commandType: 'DELETE_TRANSACTION' }, [txSnapshot, ...ledgerSnapshots]);
  await recordAudit(client, {
    userId: ctx.userId,
    entityType: 'transaction',
    entityId: transactionId,
    action: 'delete',
    before,
    after,
    actorId: ctx.userId,
  });

  return mapTransactionRow(after);
}

export async function restoreTransaction(client: DbClient, ctx: Ctx, transactionId: string): Promise<Transaction> {
  const beforeRes = await client.query(
    'SELECT * FROM transactions WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL FOR UPDATE',
    [transactionId, ctx.userId]
  );
  const before = beforeRes.rows[0];
  if (!before) throw Errors.notFound('transaction in trash');

  const effects = computeLedgerEffects({
    type: before.type,
    amount: String(before.amount),
    accountId: before.account_id,
    toAccountId: before.to_account_id,
    debtId: before.debt_id,
    direction: before.direction,
  });
  const ledgerSnapshots = await applyLedgerEffects(client, effects, 1);

  const afterRes = await client.query('UPDATE transactions SET deleted_at = NULL, deleted_by = NULL WHERE id = $1 RETURNING *', [
    transactionId,
  ]);
  const after = afterRes.rows[0];

  const txSnapshot: RowSnapshot = { table: 'transactions', id: transactionId, before, after };
  await recordCommand(client, { ...ctx, commandType: 'RESTORE_TRANSACTION' }, [txSnapshot, ...ledgerSnapshots]);
  await recordAudit(client, {
    userId: ctx.userId,
    entityType: 'transaction',
    entityId: transactionId,
    action: 'restore',
    before,
    after,
    actorId: ctx.userId,
  });

  return mapTransactionRow(after);
}

export async function updateClaimStatus(
  client: DbClient,
  ctx: Ctx,
  transactionId: string,
  newStatus: ClaimStatus
): Promise<Transaction> {
  const beforeRes = await client.query(
    `SELECT * FROM transactions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND type = 'pending_claim' FOR UPDATE`,
    [transactionId, ctx.userId]
  );
  const before = beforeRes.rows[0];
  if (!before) throw Errors.notFound('pending claim transaction');

  const currentIdx = CLAIM_STATUS_ORDER.indexOf(before.status);
  const nextIdx = CLAIM_STATUS_ORDER.indexOf(newStatus);
  if (nextIdx !== currentIdx + 1) {
    throw Errors.validation(
      `Claim status can only advance one step at a time: ${before.status ?? 'none'} -> ${newStatus}`
    );
  }

  const afterRes = await client.query('UPDATE transactions SET status = $1 WHERE id = $2 RETURNING *', [
    newStatus,
    transactionId,
  ]);
  const after = afterRes.rows[0];

  // Reaching 'received' means the money was reimbursed: credit it back to
  // the account that originally paid for it.
  let ledgerSnapshots: RowSnapshot[] = [];
  if (newStatus === 'received' && before.account_id) {
    ledgerSnapshots = await applyLedgerEffects(
      client,
      [{ kind: 'account', id: before.account_id, delta: String(before.amount) }],
      1
    );
  }

  const txSnapshot: RowSnapshot = { table: 'transactions', id: transactionId, before, after };
  await recordCommand(client, { ...ctx, commandType: 'UPDATE_CLAIM_STATUS' }, [txSnapshot, ...ledgerSnapshots]);
  await recordAudit(client, {
    userId: ctx.userId,
    entityType: 'transaction',
    entityId: transactionId,
    action: 'status_change',
    before,
    after,
    actorId: ctx.userId,
  });

  return mapTransactionRow(after);
}

const WITH_CATEGORY_SELECT = `
  SELECT t.*, c.name AS category_name, c.is_claimable AS category_is_claimable
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
`;

export async function listActiveTransactions(client: DbClient, userId: string): Promise<Transaction[]> {
  const res = await client.query(
    `${WITH_CATEGORY_SELECT} WHERE t.user_id = $1 AND t.deleted_at IS NULL ORDER BY t.transaction_date DESC, t.created_at DESC LIMIT 200`,
    [userId]
  );
  return res.rows.map(mapTransactionRow);
}

export async function listUnsortedExpenses(client: DbClient, userId: string): Promise<Transaction[]> {
  const res = await client.query(
    `${WITH_CATEGORY_SELECT}
     WHERE t.user_id = $1 AND t.deleted_at IS NULL AND t.type = 'personal_expense' AND t.category_id IS NULL
     ORDER BY t.transaction_date DESC, t.created_at DESC`,
    [userId]
  );
  return res.rows.map(mapTransactionRow);
}

export async function listTrash(client: DbClient, userId: string): Promise<Transaction[]> {
  const res = await client.query(
    `${WITH_CATEGORY_SELECT} WHERE t.user_id = $1 AND t.deleted_at IS NOT NULL ORDER BY t.deleted_at DESC`,
    [userId]
  );
  return res.rows.map(mapTransactionRow);
}

export async function updateTransactionCategory(
  client: DbClient,
  ctx: Ctx,
  transactionId: string,
  categoryId: string | null
): Promise<Transaction> {
  const beforeRes = await client.query(
    'SELECT * FROM transactions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE',
    [transactionId, ctx.userId]
  );
  const before = beforeRes.rows[0];
  if (!before) throw Errors.notFound('transaction');

  const afterRes = await client.query('UPDATE transactions SET category_id = $1 WHERE id = $2 RETURNING *', [
    categoryId,
    transactionId,
  ]);
  const after = afterRes.rows[0];

  const txSnapshot: RowSnapshot = { table: 'transactions', id: transactionId, before, after };
  await recordCommand(client, { ...ctx, commandType: 'UPDATE_CLAIM_STATUS' }, [txSnapshot]);
  await recordAudit(client, {
    userId: ctx.userId,
    entityType: 'transaction',
    entityId: transactionId,
    action: 'update',
    before,
    after,
    actorId: ctx.userId,
  });

  const withCategory = await client.query(`${WITH_CATEGORY_SELECT} WHERE t.id = $1`, [transactionId]);
  return mapTransactionRow(withCategory.rows[0]);
}

/**
 * Toggles the reimbursement flag for either a folder-categorized expense (a
 * personal_expense filed under a claimable category) or a loan_given being
 * repaid — both use the same `claim_received` column. Reaching
 * received=true credits the paying/lending account back, mirroring
 * updateClaimStatus's 'received' step.
 */
export async function updateClaimReceived(client: DbClient, ctx: Ctx, transactionId: string, received: boolean): Promise<Transaction> {
  const beforeRes = await client.query(
    `SELECT * FROM transactions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       AND type IN ('personal_expense', 'loan_given') FOR UPDATE`,
    [transactionId, ctx.userId]
  );
  const before = beforeRes.rows[0];
  if (!before) throw Errors.notFound('transaction');
  if (Boolean(before.claim_received) === received) {
    const withCategory = await client.query(`${WITH_CATEGORY_SELECT} WHERE t.id = $1`, [transactionId]);
    return mapTransactionRow(withCategory.rows[0]);
  }

  const afterRes = await client.query('UPDATE transactions SET claim_received = $1 WHERE id = $2 RETURNING *', [
    received,
    transactionId,
  ]);
  const after = afterRes.rows[0];

  let ledgerSnapshots: RowSnapshot[] = [];
  if (before.account_id) {
    const delta = received ? String(before.amount) : `-${before.amount}`;
    ledgerSnapshots = await applyLedgerEffects(client, [{ kind: 'account', id: before.account_id, delta }], 1);
  }

  const txSnapshot: RowSnapshot = { table: 'transactions', id: transactionId, before, after };
  await recordCommand(client, { ...ctx, commandType: 'UPDATE_CLAIM_STATUS' }, [txSnapshot, ...ledgerSnapshots]);
  await recordAudit(client, {
    userId: ctx.userId,
    entityType: 'transaction',
    entityId: transactionId,
    action: 'status_change',
    before,
    after,
    actorId: ctx.userId,
  });

  const withCategory = await client.query(`${WITH_CATEGORY_SELECT} WHERE t.id = $1`, [transactionId]);
  return mapTransactionRow(withCategory.rows[0]);
}

/** Hard-purges trash older than 30 days. Intended to run from a scheduled job, never from a request handler. */
export async function purgeExpiredTrash(client: DbClient): Promise<number> {
  const res = await client.query(
    `DELETE FROM transactions WHERE deleted_at IS NOT NULL AND deleted_at < now() - INTERVAL '30 days'`
  );
  return res.rowCount ?? 0;
}
