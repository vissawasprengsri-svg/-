/**
 * Integration tests against a real Postgres instance (the fixed schema.sql
 * uses enums, triggers, and GIN trgm indexes that in-memory Postgres
 * emulators don't faithfully support, so this suite talks to the real
 * thing). Run `docker compose up -d && npm run migrate -w apps/api` first.
 * The suite skips itself automatically if DATABASE_URL is unreachable.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { withTransaction, pool } from '../src/db/pool.js';
import {
  createTransaction,
  listTrash,
  restoreTransaction,
  softDeleteTransaction,
  updateClaimStatus,
} from '../src/services/transactionService.js';
import { undoLast, redoLast } from '../src/domain/commandStore.js';
import { listAuditHistory } from '../src/domain/auditLog.js';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const ACCOUNT_ID = '00000000-0000-0000-0000-000000000002';

async function dbReachable(): Promise<boolean> {
  try {
    const probe = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/finance_tracker' });
    await probe.connect();
    await probe.query('SELECT 1');
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const reachable = await dbReachable();

describe.skipIf(!reachable)('transactionService (real Postgres, Phase 1 safety mechanics)', () => {
  async function balanceOf(accountId: string): Promise<string> {
    const res = await pool.query('SELECT current_balance FROM accounts WHERE id = $1', [accountId]);
    return String(res.rows[0].current_balance);
  }

  // Each test asserts an *absolute* balance, so every test must start from
  // the same known-zero state rather than accumulating whatever the
  // previous test left behind.
  beforeEach(async () => {
    if (!reachable) return;
    await pool.query('UPDATE accounts SET current_balance = 0 WHERE id = $1', [ACCOUNT_ID]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('create -> soft delete rolls back the account balance, and the row survives as trash', async () => {
    const sessionId = randomUUID();
    const clientId = randomUUID();

    const { transaction } = await withTransaction((client) =>
      createTransaction(
        client,
        { userId: USER_ID, sessionId },
        {
          type: 'personal_expense',
          amountMajor: '250.00',
          currencyCode: 'THB',
          transactionDate: '2026-01-15',
          accountId: ACCOUNT_ID,
          clientId,
        }
      )
    );
    expect(await balanceOf(ACCOUNT_ID)).toBe('-25000');

    await withTransaction((client) => softDeleteTransaction(client, { userId: USER_ID, sessionId }, transaction.id));
    expect(await balanceOf(ACCOUNT_ID)).toBe('0');

    const trash = await withTransaction((client) => listTrash(client, USER_ID));
    expect(trash.some((t) => t.id === transaction.id)).toBe(true);

    const restored = await withTransaction((client) =>
      restoreTransaction(client, { userId: USER_ID, sessionId }, transaction.id)
    );
    expect(restored.deletedAt).toBeNull();
    expect(await balanceOf(ACCOUNT_ID)).toBe('-25000');
  });

  it('duplicate create with the same clientId is a no-op replay (idempotent dedupe)', async () => {
    const sessionId = randomUUID();
    const clientId = randomUUID();
    const input = {
      type: 'personal_expense' as const,
      amountMajor: '10.00',
      currencyCode: 'THB',
      transactionDate: '2026-01-15',
      accountId: ACCOUNT_ID,
      clientId,
    };

    const first = await withTransaction((client) => createTransaction(client, { userId: USER_ID, sessionId }, input));
    const second = await withTransaction((client) => createTransaction(client, { userId: USER_ID, sessionId }, input));

    expect(first.replay).toBe(false);
    expect(second.replay).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);

    // Balance must reflect exactly one -10.00 debit, not two.
    const res = await pool.query('SELECT COUNT(*) FROM transactions WHERE client_id = $1', [clientId]);
    expect(Number(res.rows[0].count)).toBe(1);
  });

  it('re-creating with a clientId whose row was deleted is refused, not replayed as live', async () => {
    const sessionId = randomUUID();
    const clientId = randomUUID();
    const input = {
      type: 'personal_expense' as const,
      amountMajor: '10.00',
      currencyCode: 'THB',
      transactionDate: '2026-01-15',
      accountId: ACCOUNT_ID,
      clientId,
    };

    const { transaction } = await withTransaction((client) =>
      createTransaction(client, { userId: USER_ID, sessionId }, input)
    );
    await withTransaction((client) => softDeleteTransaction(client, { userId: USER_ID, sessionId }, transaction.id));

    // Replaying the trashed row here would report "created" for something
    // sitting in the bin, with its ledger effect already reversed.
    await expect(
      withTransaction((client) => createTransaction(client, { userId: USER_ID, sessionId }, input))
    ).rejects.toMatchObject({ code: 'CLIENT_ID_REUSED_AFTER_DELETE' });

    expect(await balanceOf(ACCOUNT_ID)).toBe('0');
  });

  it('a transaction naming an account that does not exist is refused by the account foreign key', async () => {
    const sessionId = randomUUID();
    const missingAccountId = randomUUID();

    await expect(
      withTransaction((client) =>
        createTransaction(
          client,
          { userId: USER_ID, sessionId },
          {
            type: 'personal_expense',
            amountMajor: '42.00',
            currencyCode: 'THB',
            transactionDate: '2026-01-15',
            accountId: missingAccountId,
            clientId: randomUUID(),
          }
        )
      )
    ).rejects.toThrow();

    const res = await pool.query('SELECT COUNT(*)::int AS n FROM transactions WHERE account_id = $1', [
      missingAccountId,
    ]);
    expect(res.rows[0].n).toBe(0);
  });

  it('Ctrl+Z / Ctrl+Shift+Z undo and redo a create through the generic command stack', async () => {
    const sessionId = randomUUID();
    const clientId = randomUUID();

    const { transaction } = await withTransaction((client) =>
      createTransaction(
        client,
        { userId: USER_ID, sessionId },
        {
          type: 'personal_expense',
          amountMajor: '99.00',
          currencyCode: 'THB',
          transactionDate: '2026-01-15',
          accountId: ACCOUNT_ID,
          clientId,
        }
      )
    );
    expect(await balanceOf(ACCOUNT_ID)).toBe('-9900');

    await withTransaction((client) => undoLast(client, sessionId));
    const afterUndo = await pool.query('SELECT deleted_at FROM transactions WHERE id = $1', [transaction.id]);
    expect(afterUndo.rows[0].deleted_at).not.toBeNull();
    expect(await balanceOf(ACCOUNT_ID)).toBe('0');

    await withTransaction((client) => redoLast(client, sessionId));
    const afterRedo = await pool.query('SELECT deleted_at FROM transactions WHERE id = $1', [transaction.id]);
    expect(afterRedo.rows[0].deleted_at).toBeNull();
    expect(await balanceOf(ACCOUNT_ID)).toBe('-9900');
  });

  it('a pending claim reimbursement (status -> received) credits the account back', async () => {
    const sessionId = randomUUID();
    const clientId = randomUUID();

    const { transaction } = await withTransaction((client) =>
      createTransaction(
        client,
        { userId: USER_ID, sessionId },
        {
          type: 'pending_claim',
          amountMajor: '500.00',
          currencyCode: 'THB',
          transactionDate: '2026-01-15',
          accountId: ACCOUNT_ID,
          status: 'awaiting_bill',
          clientId,
        }
      )
    );
    expect(await balanceOf(ACCOUNT_ID)).toBe('-50000');

    await withTransaction((client) => updateClaimStatus(client, { userId: USER_ID, sessionId }, transaction.id, 'pending'));
    await withTransaction((client) => updateClaimStatus(client, { userId: USER_ID, sessionId }, transaction.id, 'claimed'));
    expect(await balanceOf(ACCOUNT_ID)).toBe('-50000');

    await withTransaction((client) => updateClaimStatus(client, { userId: USER_ID, sessionId }, transaction.id, 'received'));
    expect(await balanceOf(ACCOUNT_ID)).toBe('0');

    const history = await withTransaction((client) => listAuditHistory(client, 'transaction', transaction.id));
    expect(history.some((h) => h.action === 'status_change')).toBe(true);
    expect(history.some((h) => h.action === 'create')).toBe(true);
  });

  it('rejects skipping a claim-status step', async () => {
    const sessionId = randomUUID();
    const clientId = randomUUID();
    const { transaction } = await withTransaction((client) =>
      createTransaction(
        client,
        { userId: USER_ID, sessionId },
        {
          type: 'pending_claim',
          amountMajor: '20.00',
          currencyCode: 'THB',
          transactionDate: '2026-01-15',
          accountId: ACCOUNT_ID,
          status: 'awaiting_bill',
          clientId,
        }
      )
    );

    await expect(
      withTransaction((client) => updateClaimStatus(client, { userId: USER_ID, sessionId }, transaction.id, 'received'))
    ).rejects.toThrow();
  });

  it('locks the exchange rate at booking time: a later rate correction never retroactively changes it', async () => {
    const sessionId = randomUUID();
    const clientId = randomUUID();
    const txDate = '2020-06-01'; // deliberately old, before the 0003 seed migration's CURRENT_DATE rate
    // This test mutates this exact (base, quote, date) row below, so delete
    // any leftover row from a previous run first — otherwise a re-run finds
    // the *previous* run's already-corrected rate instead of inserting 33.
    await pool.query(`DELETE FROM exchange_rates WHERE base_code='USD' AND quote_code='THB' AND rate_date=$1`, [txDate]);
    await pool.query(
      `INSERT INTO exchange_rates (base_code, quote_code, rate, rate_date, source)
       VALUES ('USD','THB',33.00,$1,'manual')`,
      [txDate]
    );

    const { transaction } = await withTransaction((client) =>
      createTransaction(
        client,
        { userId: USER_ID, sessionId },
        { type: 'income', amountMajor: '100.00', currencyCode: 'USD', transactionDate: txDate, accountId: ACCOUNT_ID, clientId }
      )
    );
    expect(transaction.exchangeRate.startsWith('33')).toBe(true);
    expect(transaction.baseAmount).toBe('330000'); // ฿3,300.00 at the locked 33.00 rate
    expect(transaction.baseCurrencyCode).toBe('THB');

    // A correction is added for the same date, after the fact.
    await pool.query(
      `UPDATE exchange_rates SET rate = 34.00 WHERE base_code='USD' AND quote_code='THB' AND rate_date = $1`,
      [txDate]
    );
    const reread = await pool.query('SELECT exchange_rate, base_amount FROM transactions WHERE id = $1', [transaction.id]);
    expect(String(reread.rows[0].exchange_rate).startsWith('33')).toBe(true);
    expect(String(reread.rows[0].base_amount)).toBe('330000');
  });

  it('rejects a currency with no exchange rate on or before the transaction date', async () => {
    const sessionId = randomUUID();
    const clientId = randomUUID();
    await expect(
      withTransaction((client) =>
        createTransaction(
          client,
          { userId: USER_ID, sessionId },
          { type: 'income', amountMajor: '10.00', currencyCode: 'GBP', transactionDate: '1999-01-01', accountId: ACCOUNT_ID, clientId }
        )
      )
    ).rejects.toThrow();
  });
});
