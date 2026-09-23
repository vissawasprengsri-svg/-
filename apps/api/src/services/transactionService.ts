import { randomUUID } from 'node:crypto';
import { convertAmount, fromMajorInput, CLAIM_STATUS_ORDER, type ClaimStatus, type CreateTransactionInput, type Transaction } from '@finance/shared';
import type { DbClient } from '../db/pool.js';
import { mapTransactionRow } from '../db/mappers.js';
import { recordCommand, type CommandSnapshot, type DeltaSnapshot, type RowSnapshot } from '../domain/commandStore.js';
import { recordAudit } from '../domain/auditLog.js';
import { applyLedgerEffects, computeLedgerEffects } from '../domain/ledger.js';
import { resolveExchangeRate } from '../domain/exchangeRate.js';
import { Errors } from '../domain/errors.js';
import { clampLimit, decodeCursor, paginateRows, type Page } from '../domain/pagination.js';

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
       description, note, merchant, transaction_date, occurred_at, category_id, account_id, to_account_id,
       debt_id, status, buyer, direction, client_id, created_by, idempotency_key
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$1,$21)
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
      input.occurredAt ?? null,
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
    const existingRow = existing.rows[0];
    // The conflict can also come from a concurrent insert that hasn't committed
    // yet, which this transaction can't see — so there's genuinely nothing to
    // replay. Retrying is the right answer, not a crash on an undefined row.
    if (!existingRow) throw Errors.validation('That entry is already being saved — try again in a moment');
    // Only a *live* row is a truthful replay. If the original was undone or
    // deleted since, replaying it would hand back a row sitting in the trash
    // while reporting it as successfully created — and its ledger effects are
    // reversed too, so the caller's balances wouldn't match what it displays.
    if (existingRow.deleted_at !== null) throw Errors.clientIdReusedAfterDelete();
    return { transaction: mapTransactionRow(existingRow), replay: true };
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

/**
 * Permanently removes one already-trashed transaction — a deliberate, one-way action the
 * user reaches for when they're sure they don't want it back, rather than waiting out the
 * 30-day auto-purge. Not recorded as an undo command (that would defeat the point of
 * "permanent"); the audit log entry is the only trace left behind.
 */
export async function purgeTransaction(client: DbClient, ctx: Ctx, transactionId: string): Promise<void> {
  const beforeRes = await client.query(
    'SELECT * FROM transactions WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL FOR UPDATE',
    [transactionId, ctx.userId]
  );
  const before = beforeRes.rows[0];
  if (!before) throw Errors.notFound('transaction in trash');

  await client.query('DELETE FROM transactions WHERE id = $1', [transactionId]);

  await recordAudit(client, {
    userId: ctx.userId,
    entityType: 'transaction',
    entityId: transactionId,
    action: 'delete',
    before,
    after: null,
    actorId: ctx.userId,
  });
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

  // Whether this step lands on 'received' is decided here and passed as its own
  // boolean rather than re-tested as `$1 = 'received'` inside each CASE: reusing
  // the status parameter in both an enum assignment and a comparison leaves
  // Postgres deducing two different types for it ("inconsistent types deduced
  // for parameter $1") and rejecting the statement outright.
  const isReceived = newStatus === 'received';
  const afterRes = await client.query(
    `UPDATE transactions
     SET status = $1,
         received_at = CASE WHEN $4 THEN now() ELSE received_at END,
         claim_received_account_id = CASE WHEN $4 THEN $3::uuid ELSE claim_received_account_id END
     WHERE id = $2
     RETURNING *`,
    [newStatus, transactionId, before.account_id, isReceived]
  );
  const after = afterRes.rows[0];

  // Reaching 'received' means the money was reimbursed: credit it back to
  // the account that originally paid for it.
  let ledgerSnapshots: DeltaSnapshot[] = [];
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

  // If this bill belongs to a submitted batch, close (or reopen) that batch
  // depending on whether every bill in it has now been reimbursed.
  if (after.claim_batch_id) {
    const { syncBatchStatus } = await import('./claimBatchService.js');
    await syncBatchStatus(client, after.claim_batch_id as string);
  }

  return mapTransactionRow(after);
}

const WITH_CATEGORY_SELECT = `
  SELECT t.*, c.name AS category_name, c.is_claimable AS category_is_claimable
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
`;

export async function listActiveTransactions(
  client: DbClient,
  userId: string,
  opts: { limit?: number; cursor?: string } = {}
): Promise<Page<Transaction>> {
  const limit = clampLimit(opts.limit);
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  const res = await client.query(
    `${WITH_CATEGORY_SELECT}
     WHERE t.user_id = $1 AND t.deleted_at IS NULL
       AND ($2::date IS NULL OR (t.transaction_date, t.created_at, t.id) < ($2::date, $3::timestamptz, $4::uuid))
     ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC
     LIMIT $5`,
    [userId, cursor?.date ?? null, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1]
  );
  return paginateRows(res.rows, limit, mapTransactionRow);
}

export async function listUnsortedExpenses(
  client: DbClient,
  userId: string,
  type: CreateTransactionInput['type'] = 'personal_expense',
  excludeReceived = false
): Promise<Transaction[]> {
  const res = await client.query(
    `${WITH_CATEGORY_SELECT}
     WHERE t.user_id = $1 AND t.deleted_at IS NULL AND t.type = $2 AND t.category_id IS NULL
       AND (NOT $3 OR (t.claim_received = FALSE AND (t.status IS NULL OR t.status != 'received')))
     ORDER BY t.transaction_date DESC, t.created_at DESC`,
    [userId, type, excludeReceived]
  );
  return res.rows.map(mapTransactionRow);
}

/**
 * Distinct descriptions the user has actually typed before, for one
 * transaction type, most-recently-used first — feeds the description
 * autocomplete on the add-transaction form so a repeat expense ("กาแฟ",
 * "ค่าน้ำมัน") doesn't need retyping from scratch every time.
 */
export async function listDescriptionSuggestions(
  client: DbClient,
  userId: string,
  type: CreateTransactionInput['type']
): Promise<string[]> {
  const res = await client.query(
    `SELECT description, MAX(created_at) AS last_used
     FROM transactions
     WHERE user_id = $1 AND type = $2 AND deleted_at IS NULL AND description IS NOT NULL AND description != ''
     GROUP BY description
     ORDER BY last_used DESC
     LIMIT 20`,
    [userId, type]
  );
  return res.rows.map((r) => r.description as string);
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
 * Re-files a quickly-jotted personal expense as a pending claim, once the
 * user realizes it's reimbursable — lets them note the spend fast in the
 * moment and decide "actually, I should get this back" later, rather than
 * having to know that up front and pick the right type while paying.
 *
 * No ledger change: personal_expense and pending_claim both debit the paying
 * account identically (see ledger.ts), so the money side of the row is
 * already correct — only the bookkeeping fields (type/status/buyer) move.
 * Always lands on 'awaiting_bill' (not 'pending'), since converting doesn't
 * imply a bill is already in hand.
 */
export async function convertExpenseToClaim(client: DbClient, ctx: Ctx, transactionId: string): Promise<Transaction> {
  const beforeRes = await client.query(
    `SELECT * FROM transactions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
    [transactionId, ctx.userId]
  );
  const before = beforeRes.rows[0];
  if (!before) throw Errors.notFound('transaction');
  if (before.type !== 'personal_expense') {
    throw Errors.validation('แปลงเป็นรอเบิกได้เฉพาะรายการประเภท "รายจ่าย" เท่านั้น');
  }

  const afterRes = await client.query(
    `UPDATE transactions SET type = 'pending_claim', status = 'awaiting_bill', buyer = 'self' WHERE id = $1 RETURNING *`,
    [transactionId]
  );
  const after = afterRes.rows[0];

  // The DB trigger trg_claim_history logs every change to `status` and requires
  // to_status NOT NULL. A blind undo restoring status to its true pre-conversion
  // value (NULL) would trip that constraint. Since chk_claim_status only requires
  // status IS NOT NULL while type = 'pending_claim', it's safe for the undo target
  // to keep status at its post-conversion value instead of the true NULL — the
  // column becomes inert once type reverts to personal_expense, and undo's UPDATE
  // ends up a no-op on status, so the trigger sees no change and never fires.
  const undoBefore = { ...before, status: after.status };
  const txSnapshot: RowSnapshot = { table: 'transactions', id: transactionId, before: undoBefore, after };
  await recordCommand(client, { ...ctx, commandType: 'CONVERT_EXPENSE_TO_CLAIM' }, [txSnapshot]);
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
 * Re-files a personal expense as money lent out (loan_given) — same
 * quick-jot-first, decide-the-real-nature-later flow as convertExpenseToClaim.
 * No ledger change: personal_expense and loan_given both debit the paying
 * account identically, so only the bookkeeping fields move.
 */
export async function convertExpenseToLoan(client: DbClient, ctx: Ctx, transactionId: string): Promise<Transaction> {
  const beforeRes = await client.query(
    `SELECT * FROM transactions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
    [transactionId, ctx.userId]
  );
  const before = beforeRes.rows[0];
  if (!before) throw Errors.notFound('transaction');
  if (before.type !== 'personal_expense') {
    throw Errors.validation('แปลงเป็นให้ยืมได้เฉพาะรายการประเภท "รายจ่าย" เท่านั้น');
  }

  // `status` is deliberately left untouched rather than set to NULL here. A fresh
  // personal_expense already has status = NULL, so the end result matches the spec
  // either way — but explicitly writing NULL would risk tripping trg_claim_history
  // (to_status NOT NULL) in the rare case where this row carries a leftover non-null
  // status from an earlier claim conversion that was later undone (see the identical
  // reasoning on convertExpenseToClaim's undo snapshot above).
  const afterRes = await client.query(
    `UPDATE transactions SET type = 'loan_given', buyer = NULL, claim_received = false WHERE id = $1 RETURNING *`,
    [transactionId]
  );
  const after = afterRes.rows[0];

  const txSnapshot: RowSnapshot = { table: 'transactions', id: transactionId, before, after };
  await recordCommand(client, { ...ctx, commandType: 'CONVERT_EXPENSE_TO_LOAN' }, [txSnapshot]);
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
 * Edits the amount, date, and/or description of an already-recorded
 * transaction. The ledger only ever sees the transaction's own-currency
 * `amount` (see ledger.ts — no currency conversion happens there), so a
 * date/rate change never touches account balances; only a changed amount
 * does, via the same reverse-then-apply pattern as delete+create.
 *
 * Changing the date is treated as "this actually happened on a different
 * day", not a correction to an already-booked fact — so unlike a later
 * correction to `exchange_rates` (which never retroactively changes a
 * booked transaction), moving the date DOES re-resolve the exchange rate
 * for the new date and recompute `base_amount` from it.
 */
export async function updateTransactionDetails(
  client: DbClient,
  ctx: Ctx,
  transactionId: string,
  input: { amountMajor?: string; description?: string; note?: string; transactionDate?: string; occurredAt?: string | null }
): Promise<Transaction> {
  const beforeRes = await client.query(
    'SELECT * FROM transactions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE',
    [transactionId, ctx.userId]
  );
  const before = beforeRes.rows[0];
  if (!before) throw Errors.notFound('transaction');

  const minorUnit = await getCurrencyMinorUnit(client, before.currency_code);
  let amountMinor = String(before.amount);
  let exchangeRate = String(before.exchange_rate);
  let transactionDate = String(before.transaction_date).slice(0, 10);

  if (input.amountMajor !== undefined) {
    amountMinor = fromMajorInput(input.amountMajor, minorUnit);
  }

  if (input.transactionDate !== undefined && input.transactionDate !== transactionDate) {
    transactionDate = input.transactionDate;
    const resolved = await resolveExchangeRate(client, {
      fromCode: before.currency_code,
      toCode: before.base_currency_code,
      date: transactionDate,
    });
    exchangeRate = resolved.rate;
  }

  let baseAmountMinor = String(before.base_amount);
  if (amountMinor !== String(before.amount) || exchangeRate !== String(before.exchange_rate)) {
    const baseMinorUnit = await getCurrencyMinorUnit(client, before.base_currency_code);
    baseAmountMinor = convertAmount(amountMinor, minorUnit, baseMinorUnit, exchangeRate);
  }

  let ledgerSnapshots: DeltaSnapshot[] = [];
  if (amountMinor !== String(before.amount)) {
    const txShape = {
      type: before.type,
      accountId: before.account_id,
      toAccountId: before.to_account_id,
      debtId: before.debt_id,
      direction: before.direction,
    };
    const reverseSnapshots = await applyLedgerEffects(
      client,
      computeLedgerEffects({ ...txShape, amount: String(before.amount) }),
      -1
    );
    const applySnapshots = await applyLedgerEffects(client, computeLedgerEffects({ ...txShape, amount: amountMinor }), 1);
    ledgerSnapshots = [...reverseSnapshots, ...applySnapshots];
  }

  const afterRes = await client.query(
    `UPDATE transactions SET amount = $1, base_amount = $2, exchange_rate = $3, transaction_date = $4, description = $5, occurred_at = $6, note = $7 WHERE id = $8 RETURNING *`,
    [
      amountMinor,
      baseAmountMinor,
      exchangeRate,
      transactionDate,
      input.description !== undefined ? input.description : before.description,
      input.occurredAt !== undefined ? input.occurredAt : before.occurred_at,
      input.note !== undefined ? input.note : before.note,
      transactionId,
    ]
  );
  const after = afterRes.rows[0];

  const txSnapshot: RowSnapshot = { table: 'transactions', id: transactionId, before, after };
  await recordCommand(client, { ...ctx, commandType: 'UPDATE_TRANSACTION_DETAILS' }, [txSnapshot, ...ledgerSnapshots]);
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
 * Changes which account a transaction is booked against (the "source of
 * funds"). Reverses the ledger effect against the old account and applies
 * it against the new one, same reverse-then-apply pattern as an amount
 * edit. Only touches `account_id` — `to_account_id`/`debt_id` (transfers,
 * debt payments) are left alone, since this is for the single-account
 * types (income, personal_expense, pending_claim, investment, loan_given).
 */
export async function updateTransactionAccount(
  client: DbClient,
  ctx: Ctx,
  transactionId: string,
  accountId: string | null
): Promise<Transaction> {
  const beforeRes = await client.query(
    'SELECT * FROM transactions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE',
    [transactionId, ctx.userId]
  );
  const before = beforeRes.rows[0];
  if (!before) throw Errors.notFound('transaction');

  if (accountId === before.account_id) {
    const withCategory = await client.query(`${WITH_CATEGORY_SELECT} WHERE t.id = $1`, [transactionId]);
    return mapTransactionRow(withCategory.rows[0]);
  }

  if (accountId) {
    const accountCheck = await client.query('SELECT id FROM accounts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [
      accountId,
      ctx.userId,
    ]);
    if (accountCheck.rows.length === 0) throw Errors.notFound('account');
  }

  const txShape = {
    type: before.type,
    amount: String(before.amount),
    toAccountId: before.to_account_id,
    debtId: before.debt_id,
    direction: before.direction,
  };
  const reverseSnapshots = await applyLedgerEffects(client, computeLedgerEffects({ ...txShape, accountId: before.account_id }), -1);
  const applySnapshots = await applyLedgerEffects(client, computeLedgerEffects({ ...txShape, accountId }), 1);
  const ledgerSnapshots = [...reverseSnapshots, ...applySnapshots];

  const afterRes = await client.query('UPDATE transactions SET account_id = $1 WHERE id = $2 RETURNING *', [accountId, transactionId]);
  const after = afterRes.rows[0];

  const txSnapshot: RowSnapshot = { table: 'transactions', id: transactionId, before, after };
  await recordCommand(client, { ...ctx, commandType: 'UPDATE_TRANSACTION_ACCOUNT' }, [txSnapshot, ...ledgerSnapshots]);
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
 * One row's worth of "mark this reimbursed" work: the mutation and its ledger
 * movement are applied, but the undo entry is *not* written — the caller gets
 * the snapshots back and decides what constitutes a single undoable action.
 *
 * That split exists because marking one bill received by hand and settling a
 * whole category in one payment are the same mutation at different grains. If
 * each row wrote its own undo entry, a bulk receive over ten bills would stack
 * ten commands, and the Ctrl+Z the user reaches for straight afterwards would
 * put back exactly one of them — leaving the other nine reimbursed and the
 * balance nine-tenths moved, with no single action left to undo.
 */
interface ClaimReceiveOutcome {
  transaction: Transaction;
  /** Empty when the row was already in the requested state and nothing moved. */
  snapshots: CommandSnapshot[];
}

/**
 * Sentinel `targetAccountId` for "advance clearing": the bill was paid out of
 * a cash advance the person already holds, so marking it received should
 * clear it off the active list without crediting any account — the money
 * never actually comes back in through the ledger, it was already accounted
 * for when the advance was handed out. A real account id credits it as
 * usual; omitting `targetAccountId` falls back to the original paying
 * account, same as before this existed.
 */
export const NO_ACCOUNT_SENTINEL = 'NONE';

function resolveAccountToCredit(targetAccountId: string | null | undefined, payingAccountId: string | null): string | null {
  if (targetAccountId === NO_ACCOUNT_SENTINEL) return null;
  return targetAccountId || payingAccountId;
}

async function applyClaimReceived(
  client: DbClient,
  ctx: Ctx,
  transactionId: string,
  received: boolean,
  targetAccountId?: string | null
): Promise<ClaimReceiveOutcome> {
  const beforeRes = await client.query(
    `SELECT * FROM transactions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       AND type IN ('personal_expense', 'loan_given') FOR UPDATE`,
    [transactionId, ctx.userId]
  );
  const before = beforeRes.rows[0];
  if (!before) throw Errors.notFound('transaction');
  if (Boolean(before.claim_received) === received) {
    const withCategory = await client.query(`${WITH_CATEGORY_SELECT} WHERE t.id = $1`, [transactionId]);
    return { transaction: mapTransactionRow(withCategory.rows[0]), snapshots: [] };
  }

  // Marking received credits the money back into targetAccountId (e.g. the company
  // reimburses into a different account than the one that originally paid), falling
  // back to the paying account when the caller doesn't specify one, and records
  // that account so history can later say where the money landed. Passing the
  // NO_ACCOUNT_SENTINEL ('advance clearing' — the bill was already covered out of
  // a cash advance, nothing actually comes back through the ledger) resolves to
  // null instead, so the bill clears with no ledger effect at all. Un-receiving
  // reverses against the paying account (undo itself doesn't go through this
  // function; it replays the exact recorded delta) and clears the recorded account.
  const accountToCredit = resolveAccountToCredit(targetAccountId, before.account_id);

  const afterRes = await client.query(
    'UPDATE transactions SET claim_received = $1, received_at = $3, claim_received_account_id = $4 WHERE id = $2 RETURNING *',
    [received, transactionId, received ? new Date().toISOString() : null, received ? accountToCredit : null]
  );
  const after = afterRes.rows[0];

  let ledgerSnapshots: DeltaSnapshot[] = [];
  if (received ? accountToCredit : before.account_id) {
    const delta = received ? String(before.amount) : `-${before.amount}`;
    const accountId = received ? accountToCredit : before.account_id;
    ledgerSnapshots = await applyLedgerEffects(client, [{ kind: 'account', id: accountId, delta }], 1);
  }

  const txSnapshot: RowSnapshot = { table: 'transactions', id: transactionId, before, after };
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
  return { transaction: mapTransactionRow(withCategory.rows[0]), snapshots: [txSnapshot, ...ledgerSnapshots] };
}

/**
 * Toggles the reimbursement flag for either a folder-categorized expense (a
 * personal_expense filed under a claimable category) or a loan_given being
 * repaid — both use the same `claim_received` column. Reaching received=true
 * credits the paying/lending account back, mirroring updateClaimStatus's
 * 'received' step. This is the single-row entry point: one call, one undoable
 * command.
 */
export async function updateClaimReceived(
  client: DbClient,
  ctx: Ctx,
  transactionId: string,
  received: boolean,
  targetAccountId?: string | null
): Promise<Transaction> {
  const outcome = await applyClaimReceived(client, ctx, transactionId, received, targetAccountId);
  if (outcome.snapshots.length > 0) {
    await recordCommand(client, { ...ctx, commandType: 'UPDATE_CLAIM_STATUS' }, outcome.snapshots);
  }
  return outcome.transaction;
}

/**
 * Bulk counterpart to updateClaimStatus's 'received' step for a pending_claim
 * row — jumps straight to 'received' regardless of the current step (the
 * one-step-at-a-time rule in updateClaimStatus is for a person walking a
 * single bill through its lifecycle by hand; a bulk "we got paid" action
 * isn't that), and — unlike updateClaimStatus — can credit a different
 * account than the one that originally paid, matching updateClaimReceived's
 * targetAccountId behavior for personal_expense/loan_given.
 *
 * Like applyClaimReceived, this hands its snapshots back rather than writing
 * its own undo entry, so a batch settles as one undoable action. Returns null
 * when the row no longer qualifies (already received, or deleted meanwhile).
 */
async function applyPendingClaimReceived(
  client: DbClient,
  ctx: Ctx,
  transactionId: string,
  targetAccountId: string | null
): Promise<ClaimReceiveOutcome | null> {
  const beforeRes = await client.query(
    `SELECT * FROM transactions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       AND type = 'pending_claim' AND status != 'received' FOR UPDATE`,
    [transactionId, ctx.userId]
  );
  const before = beforeRes.rows[0];
  if (!before) return null;

  // See resolveAccountToCredit/NO_ACCOUNT_SENTINEL in applyClaimReceived above —
  // same "advance clearing" escape hatch: clear the bill with no ledger effect.
  const accountToCredit = resolveAccountToCredit(targetAccountId, before.account_id);
  const afterRes = await client.query(
    `UPDATE transactions SET status = 'received', received_at = now(), claim_received_account_id = $2 WHERE id = $1 RETURNING *`,
    [transactionId, accountToCredit]
  );
  const after = afterRes.rows[0];

  let ledgerSnapshots: DeltaSnapshot[] = [];
  if (accountToCredit) {
    ledgerSnapshots = await applyLedgerEffects(client, [{ kind: 'account', id: accountToCredit, delta: String(before.amount) }], 1);
  }

  const txSnapshot: RowSnapshot = { table: 'transactions', id: transactionId, before, after };
  await recordAudit(client, {
    userId: ctx.userId,
    entityType: 'transaction',
    entityId: transactionId,
    action: 'status_change',
    before,
    after,
    actorId: ctx.userId,
  });

  if (after.claim_batch_id) {
    const { syncBatchStatus } = await import('./claimBatchService.js');
    await syncBatchStatus(client, after.claim_batch_id as string);
  }

  const withCategory = await client.query(`${WITH_CATEGORY_SELECT} WHERE t.id = $1`, [transactionId]);
  return { transaction: mapTransactionRow(withCategory.rows[0]), snapshots: [txSnapshot, ...ledgerSnapshots] };
}

/**
 * Bulk "receive" for a category's whole outstanding pile at once — the
 * company-reimbursement workflow where one lump payment settles every
 * unclaimed expense/loan/claim filed under a folder in one go, rather than
 * clicking "received" on each row individually. Handles both the
 * claim_received-boolean types (personal_expense/loan_given) and
 * pending_claim's separate status-enum lifecycle, since a "รอเบิก" category
 * holds pending_claim rows while a claimable personal_expense folder holds
 * personal_expense/loan_given rows — the button works the same either way.
 */
export async function receiveCategoryClaims(
  client: DbClient,
  ctx: Ctx,
  categoryId: string,
  targetAccountId: string | null
): Promise<Transaction[]> {
  const expenseRowsRes = await client.query(
    `SELECT id FROM transactions WHERE user_id = $1 AND category_id = $2 AND deleted_at IS NULL
       AND type IN ('personal_expense', 'loan_given') AND claim_received = FALSE`,
    [ctx.userId, categoryId]
  );
  const claimRowsRes = await client.query(
    `SELECT id FROM transactions WHERE user_id = $1 AND category_id = $2 AND deleted_at IS NULL
       AND type = 'pending_claim' AND status != 'received'`,
    [ctx.userId, categoryId]
  );

  // One payment settling a folder is one action to the person who made it, so
  // it gets one undo entry covering every row and every balance it moved —
  // see ClaimReceiveOutcome for why the per-row helpers don't record their own.
  const results: Transaction[] = [];
  const snapshots: CommandSnapshot[] = [];

  for (const row of expenseRowsRes.rows) {
    const outcome = await applyClaimReceived(client, ctx, row.id, true, targetAccountId);
    results.push(outcome.transaction);
    snapshots.push(...outcome.snapshots);
  }
  for (const row of claimRowsRes.rows) {
    const outcome = await applyPendingClaimReceived(client, ctx, row.id, targetAccountId);
    if (!outcome) continue;
    results.push(outcome.transaction);
    snapshots.push(...outcome.snapshots);
  }

  if (snapshots.length > 0) {
    await recordCommand(client, { ...ctx, commandType: 'RECEIVE_CATEGORY_CLAIMS' }, snapshots);
  }
  return results;
}

/** Hard-purges trash older than 30 days. Intended to run from a scheduled job, never from a request handler. */
export interface SplitPart {
  amountMajor: string;
  description?: string;
  note?: string;
}

/**
 * Splits one transaction into 2-3 rows that share its date/account/category/
 * type/status — the "one dinner receipt, three people's shares" case. The
 * original is soft-deleted (so it's recoverable from Trash, and its ledger
 * effect reversed) and the parts are created fresh; because every part keeps
 * the same type+account as the original, the reversal and the N new debits
 * net out to the same total effect on the account, just split into pieces.
 * All of it — the delete, the creates, every ledger delta — is one
 * recordCommand call, so Ctrl+Z undoes the whole split in a single step
 * (same pattern as the bulk Excel import).
 */
export async function splitTransaction(client: DbClient, ctx: Ctx, transactionId: string, parts: SplitPart[]): Promise<Transaction[]> {
  if (parts.length < 2 || parts.length > 3) {
    throw Errors.validation('แยกบิลได้ 2-3 รายการเท่านั้น');
  }

  const beforeRes = await client.query(
    'SELECT * FROM transactions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE',
    [transactionId, ctx.userId]
  );
  const before = beforeRes.rows[0];
  if (!before) throw Errors.notFound('transaction');

  const minorUnit = await getCurrencyMinorUnit(client, before.currency_code);
  const partsMinor = parts.map((p) => fromMajorInput(p.amountMajor, minorUnit));
  if (partsMinor.some((v) => BigInt(v) <= 0n)) {
    throw Errors.validation('แต่ละรายการย่อยต้องมียอดเงินมากกว่า 0');
  }
  const sumMinor = partsMinor.reduce((sum, v) => sum + BigInt(v), 0n);
  if (sumMinor !== BigInt(before.amount)) {
    throw Errors.validation('ยอดรวมรายการย่อยต้องเท่ากับยอดเดิมพอดี');
  }

  const reverseEffects = computeLedgerEffects({
    type: before.type,
    amount: String(before.amount),
    accountId: before.account_id,
    toAccountId: before.to_account_id,
    debtId: before.debt_id,
    direction: before.direction,
  });
  const reverseSnapshots = await applyLedgerEffects(client, reverseEffects, -1);

  const deletedRes = await client.query(
    'UPDATE transactions SET deleted_at = now(), deleted_by = $2 WHERE id = $1 RETURNING *',
    [transactionId, ctx.userId]
  );
  const deleteSnapshot: RowSnapshot = { table: 'transactions', id: transactionId, before, after: deletedRes.rows[0] };

  const baseMinorUnit = await getCurrencyMinorUnit(client, before.base_currency_code);
  const newIds: string[] = [];
  const createSnapshots: RowSnapshot[] = [];
  let applySnapshots: DeltaSnapshot[] = [];
  for (let i = 0; i < parts.length; i++) {
    const amountMinor = partsMinor[i]!;
    const baseAmountMinor = convertAmount(amountMinor, minorUnit, baseMinorUnit, String(before.exchange_rate));
    const insertRes = await client.query(
      `INSERT INTO transactions (
         user_id, type, amount, currency_code, exchange_rate, base_amount, base_currency_code,
         description, note, merchant, transaction_date, occurred_at, category_id, account_id, to_account_id,
         debt_id, status, buyer, direction, client_id, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$1)
       RETURNING *`,
      [
        ctx.userId,
        before.type,
        amountMinor,
        before.currency_code,
        before.exchange_rate,
        baseAmountMinor,
        before.base_currency_code,
        parts[i]!.description ?? before.description,
        parts[i]!.note ?? before.note,
        before.merchant,
        before.transaction_date,
        before.occurred_at,
        before.category_id,
        before.account_id,
        before.to_account_id,
        before.debt_id,
        before.status,
        before.buyer,
        before.direction,
        randomUUID(),
      ]
    );
    const row = insertRes.rows[0];
    newIds.push(row.id);
    const effects = computeLedgerEffects({
      type: row.type,
      amount: String(row.amount),
      accountId: row.account_id,
      toAccountId: row.to_account_id,
      debtId: row.debt_id,
      direction: row.direction,
    });
    applySnapshots = applySnapshots.concat(await applyLedgerEffects(client, effects, 1));
    createSnapshots.push({ table: 'transactions', id: row.id, before: softDeletedVariant(row, ctx.userId), after: notDeletedVariant(row) });
  }

  await recordCommand(client, { ...ctx, commandType: 'SPLIT_TRANSACTION' }, [
    deleteSnapshot,
    ...reverseSnapshots,
    ...createSnapshots,
    ...applySnapshots,
  ]);
  await recordAudit(client, {
    userId: ctx.userId,
    entityType: 'transaction',
    entityId: transactionId,
    action: 'delete',
    before,
    after: { splitInto: newIds },
    actorId: ctx.userId,
  });

  const results = await client.query(`${WITH_CATEGORY_SELECT} WHERE t.id = ANY($1) ORDER BY t.created_at`, [newIds]);
  return results.rows.map(mapTransactionRow);
}

export async function purgeExpiredTrash(client: DbClient): Promise<number> {
  const res = await client.query(
    `DELETE FROM transactions WHERE deleted_at IS NOT NULL AND deleted_at < now() - INTERVAL '30 days'`
  );
  return res.rowCount ?? 0;
}
