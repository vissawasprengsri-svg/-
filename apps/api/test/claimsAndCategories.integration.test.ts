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
import { createTransaction, listUnsortedExpenses, updateClaimReceived, updateTransactionCategory } from '../src/services/transactionService.js';
import { createCategory } from '../src/services/categoryService.js';
import { getClaimsSummary } from '../src/services/claimsSummaryService.js';

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
      createCategory(client, USER_ID, {
        name: `หน้างานทดสอบ-${randomUUID().slice(0, 6)}`,
        appliesTo: ['personal_expense'],
        isClaimable: true,
        defaultClaimStatus: 'pending',
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
});
