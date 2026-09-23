/**
 * Real-Postgres integration tests for the "จัดหมวด" (categorize) +
 * "สรุปค้าง" (claims summary) flow added after the UI rebuild: assigning a
 * claimable category to an unsorted expense should make it show up as
 * outstanding, and marking it received should credit the account back.
 * Self-skips without a reachable Postgres — see transactionService test.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { pool, withTransaction } from '../src/db/pool.js';
import {
  createTransaction,
  listUnsortedExpenses,
  NO_ACCOUNT_SENTINEL,
  receiveCategoryClaims,
  updateClaimReceived,
  updateTransactionCategory,
} from '../src/services/transactionService.js';
import { createCategory } from '../src/services/categoryService.js';
import { getClaimsSummary } from '../src/services/claimsSummaryService.js';
import { undoLast } from '../src/domain/commandStore.js';

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

describe.skipIf(!reachable)('categorize + claims summary (real Postgres)', () => {
  afterAll(async () => {
    await pool.end();
  });

  async function balanceOf(accountId: string): Promise<string> {
    const res = await pool.query('SELECT current_balance FROM accounts WHERE id = $1', [accountId]);
    return String(res.rows[0].current_balance);
  }

  it('an unsorted expense assigned to a claimable category shows up in the claims summary, and clearing it credits the account back', async () => {
    const sessionId = randomUUID();
    const clientId = randomUUID();
    await pool.query('UPDATE accounts SET current_balance = 0 WHERE id = $1', [ACCOUNT_ID]);

    const category = await withTransaction((client) =>
      // A category becomes claimable by carrying a status label — that free-text
      // label is what drives is_claimable now, rather than a separate flag.
      createCategory(client, USER_ID, {
        name: `หน้างานทดสอบ-${randomUUID().slice(0, 6)}`,
        appliesTo: ['personal_expense'],
        statusLabel: 'รอเบิก',
      })
    );

    const { transaction } = await withTransaction((client) =>
      createTransaction(
        client,
        { userId: USER_ID, sessionId },
        {
          type: 'personal_expense',
          amountMajor: '640.00',
          currencyCode: 'THB',
          transactionDate: new Date().toISOString().slice(0, 10),
          accountId: ACCOUNT_ID,
          clientId,
        }
      )
    );
    expect(await balanceOf(ACCOUNT_ID)).toBe('-64000');

    const unsortedBefore = await withTransaction((client) => listUnsortedExpenses(client, USER_ID));
    expect(unsortedBefore.some((t) => t.id === transaction.id)).toBe(true);

    await withTransaction((client) => updateTransactionCategory(client, { userId: USER_ID, sessionId }, transaction.id, category.id));

    const unsortedAfter = await withTransaction((client) => listUnsortedExpenses(client, USER_ID));
    expect(unsortedAfter.some((t) => t.id === transaction.id)).toBe(false);

    const summary = await withTransaction((client) => getClaimsSummary(client, USER_ID));
    const group = summary.folderGroups.find((g) => g.categoryId === category.id);
    expect(group).toBeTruthy();
    expect(group!.items.some((t) => t.id === transaction.id)).toBe(true);
    expect(group!.total).toBe('64000');

    await withTransaction((client) => updateClaimReceived(client, { userId: USER_ID, sessionId }, transaction.id, true));
    expect(await balanceOf(ACCOUNT_ID)).toBe('0');

    const summaryAfter = await withTransaction((client) => getClaimsSummary(client, USER_ID));
    expect(summaryAfter.folderGroups.some((g) => g.items.some((t) => t.id === transaction.id))).toBe(false);
  });

  it('advance clearing settles a bill with no ledger effect and no account recorded', async () => {
    const sessionId = randomUUID();
    await pool.query('UPDATE accounts SET current_balance = 0 WHERE id = $1', [ACCOUNT_ID]);

    const category = await withTransaction((client) =>
      createCategory(client, USER_ID, {
        name: `เบิกล่วงหน้า-${randomUUID().slice(0, 6)}`,
        appliesTo: ['personal_expense'],
        statusLabel: 'รอเบิก',
      })
    );
    const { transaction } = await withTransaction((client) =>
      createTransaction(
        client,
        { userId: USER_ID, sessionId },
        {
          type: 'personal_expense',
          amountMajor: '300.00',
          currencyCode: 'THB',
          transactionDate: new Date().toISOString().slice(0, 10),
          accountId: ACCOUNT_ID,
          categoryId: category.id,
          clientId: randomUUID(),
        }
      )
    );
    expect(await balanceOf(ACCOUNT_ID)).toBe('-30000');

    // The bill was already covered by a cash advance — settling it should clear
    // the bill off the active list without crediting any account back.
    await withTransaction((client) =>
      receiveCategoryClaims(client, { userId: USER_ID, sessionId }, category.id, NO_ACCOUNT_SENTINEL)
    );

    // No money moved: the paying account stays exactly where the original
    // expense left it, not credited back like a normal reimbursement would.
    expect(await balanceOf(ACCOUNT_ID)).toBe('-30000');

    const row = await pool.query('SELECT claim_received, claim_received_account_id FROM transactions WHERE id = $1', [
      transaction.id,
    ]);
    expect(row.rows[0].claim_received).toBe(true);
    expect(row.rows[0].claim_received_account_id).toBeNull();

    const summary = await withTransaction((client) => getClaimsSummary(client, USER_ID));
    expect(summary.folderGroups.some((g) => g.items.some((t) => t.id === transaction.id))).toBe(false);
    const completed = summary.completedGroups.flatMap((g) => g.items).find((t) => t.id === transaction.id);
    expect(completed).toBeTruthy();
    expect(completed!.claimReceivedAccountName).toBeNull();
  });

  it('settling into an account that does not exist fails instead of clearing the bills for free', async () => {
    const sessionId = randomUUID();
    await pool.query('UPDATE accounts SET current_balance = 0 WHERE id = $1', [ACCOUNT_ID]);

    const category = await withTransaction((client) =>
      createCategory(client, USER_ID, {
        name: `บัญชีหาย-${randomUUID().slice(0, 6)}`,
        appliesTo: ['personal_expense'],
        statusLabel: 'รอเบิก',
      })
    );
    const { transaction } = await withTransaction((client) =>
      createTransaction(
        client,
        { userId: USER_ID, sessionId },
        {
          type: 'personal_expense',
          amountMajor: '500.00',
          currencyCode: 'THB',
          transactionDate: new Date().toISOString().slice(0, 10),
          accountId: ACCOUNT_ID,
          categoryId: category.id,
          clientId: randomUUID(),
        }
      )
    );

    // targetAccountId is only checked for UUID *shape* by the route schema;
    // what actually rejects a made-up one is the claim_received_account_id
    // foreign key. Worth pinning down, because the settlement marks the bills
    // reimbursed before it credits anything — so if that reference ever stops
    // being enforced, the failure mode is bills cleared with no money moved.
    await expect(
      withTransaction((client) =>
        receiveCategoryClaims(client, { userId: USER_ID, sessionId }, category.id, randomUUID())
      )
    ).rejects.toThrow();

    const after = await pool.query('SELECT claim_received FROM transactions WHERE id = $1', [transaction.id]);
    expect(after.rows[0].claim_received).toBe(false);
    expect(await balanceOf(ACCOUNT_ID)).toBe('-50000');
  });

  it('settling a whole category is one undoable action, not one per bill', async () => {
    const sessionId = randomUUID();
    await pool.query('UPDATE accounts SET current_balance = 0 WHERE id = $1', [ACCOUNT_ID]);

    const category = await withTransaction((client) =>
      createCategory(client, USER_ID, {
        name: `ล็อตทดสอบ-${randomUUID().slice(0, 6)}`,
        appliesTo: ['personal_expense'],
        statusLabel: 'รอเบิก',
      })
    );

    const amounts = ['100.00', '250.00', '75.50'];
    const ids: string[] = [];
    for (const amountMajor of amounts) {
      const { transaction } = await withTransaction((client) =>
        createTransaction(
          client,
          { userId: USER_ID, sessionId },
          {
            type: 'personal_expense',
            amountMajor,
            currencyCode: 'THB',
            transactionDate: new Date().toISOString().slice(0, 10),
            accountId: ACCOUNT_ID,
            categoryId: category.id,
            clientId: randomUUID(),
          }
        )
      );
      ids.push(transaction.id);
    }
    // Three expenses paid out of the account: -100.00 -250.00 -75.50.
    expect(await balanceOf(ACCOUNT_ID)).toBe('-42550');

    await withTransaction((client) =>
      receiveCategoryClaims(client, { userId: USER_ID, sessionId }, category.id, ACCOUNT_ID)
    );
    expect(await balanceOf(ACCOUNT_ID)).toBe('0');

    // A single Ctrl+Z has to put all three bills back, along with every
    // balance the settlement moved — not just the last bill in the batch.
    await withTransaction((client) => undoLast(client, sessionId));

    expect(await balanceOf(ACCOUNT_ID)).toBe('-42550');
    const received = await pool.query(
      'SELECT COUNT(*)::int AS n FROM transactions WHERE id = ANY($1::uuid[]) AND claim_received = TRUE',
      [ids]
    );
    expect(received.rows[0].n).toBe(0);
  });
});
