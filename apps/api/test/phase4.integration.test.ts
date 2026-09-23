/**
 * Real-Postgres integration tests for Phase 4: budgets (+ rollover),
 * recurring rules, search/filter, and reports. Self-skips if DATABASE_URL
 * is unreachable — see transactionService.integration.test.ts for why.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, withTransaction } from '../src/db/pool.js';
import { createTransaction } from '../src/services/transactionService.js';
import { createBudget, listBudgets, rolloverEndedBudgets } from '../src/services/budgetService.js';
import { createRecurringRule, listRecurringRules, runDueRecurringRules } from '../src/services/recurringService.js';
import { searchTransactions } from '../src/services/searchService.js';
import { monthlySummary, trend } from '../src/services/reportService.js';

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

describe.skipIf(!reachable)('Phase 4 (real Postgres): budgets, recurring, search, reports', () => {
  let categoryId: string;

  beforeAll(async () => {
    if (!reachable) return;
    const cat = await pool.query(
      `INSERT INTO categories (user_id, name, applies_to) VALUES ($1, 'ทดสอบงบ-' || gen_random_uuid(), '{personal_expense}') RETURNING id`,
      [USER_ID]
    );
    categoryId = cat.rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('tracks spend-so-far against a budget for the current period', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 8) + '01';
    const budget = await withTransaction((client) =>
      createBudget(client, USER_ID, {
        categoryId,
        name: 'งบทดสอบ',
        amountMajor: '1000.00',
        currencyCode: 'THB',
        periodType: 'monthly',
        periodStart: monthStart,
        periodEnd: today,
        rollover: false,
        alertPcts: [80, 100],
      })
    );
    expect(budget.spent).toBe('0');

    const clientId = randomUUID();
    await withTransaction((client) =>
      createTransaction(
        client,
        { userId: USER_ID, sessionId: randomUUID() },
        {
          type: 'personal_expense',
          amountMajor: '300.00',
          currencyCode: 'THB',
          transactionDate: today,
          accountId: ACCOUNT_ID,
          categoryId,
          clientId,
        }
      )
    );

    const budgets = await withTransaction((client) => listBudgets(client, USER_ID));
    const found = budgets.find((b) => b.id === budget.id)!;
    expect(found.spent).toBe('30000');
  });

  it('rolls over an ended budget, carrying unspent amount forward only when rollover=true', async () => {
    const budget = await withTransaction((client) =>
      createBudget(client, USER_ID, {
        categoryId,
        name: 'งบ rollover',
        amountMajor: '500.00',
        currencyCode: 'THB',
        periodType: 'monthly',
        periodStart: '2020-01-01',
        periodEnd: '2020-01-31', // long in the past -> definitely "ended"
        rollover: true,
        alertPcts: [100],
      })
    );

    const rolledOver = await withTransaction((client) => rolloverEndedBudgets(client, USER_ID));
    expect(rolledOver).toBeGreaterThanOrEqual(1);

    const budgets = await withTransaction((client) => listBudgets(client, USER_ID));
    const old = budgets.find((b) => b.id === budget.id)!;
    expect(old.isActive).toBe(false);

    const next = budgets.find((b) => b.periodStart === '2020-02-01' && b.name === 'งบ rollover');
    expect(next).toBeTruthy();
    // No spend recorded in Jan 2020 -> the entire 500.00 is unspent leftover,
    // added on top of the next period's own 500.00 -> 1000.00 total.
    expect(next!.amount).toBe('100000');
    expect(next!.isActive).toBe(true);
  });

  it('stamps out a due recurring transaction exactly once even if run twice', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await withTransaction((client) =>
      createRecurringRule(client, USER_ID, {
        template: { type: 'income', amountMajor: '50.00', currencyCode: 'THB', description: 'เงินเดือนทดสอบ', accountId: ACCOUNT_ID },
        frequency: 'monthly',
        startDate: today,
        autoCreate: true,
      })
    );

    const sessionId = randomUUID();
    const firstRun = await withTransaction((client) => runDueRecurringRules(client, USER_ID, sessionId));
    expect(firstRun).toBeGreaterThanOrEqual(1);

    const secondRun = await withTransaction((client) => runDueRecurringRules(client, USER_ID, sessionId));
    expect(secondRun).toBe(0); // next_run_date already advanced past today

    const rules = await withTransaction((client) => listRecurringRules(client, USER_ID));
    const rule = rules.find((r) => r.template.description === 'เงินเดือนทดสอบ')!;
    expect(rule.occurrencesCount).toBe(1);
    expect(rule.nextRunDate! > today).toBe(true);
  });

  it('finds a transaction by full-text search on its description', async () => {
    const uniqueWord = `เอกลักษณ์${randomUUID().slice(0, 8)}`;
    await withTransaction((client) =>
      createTransaction(
        client,
        { userId: USER_ID, sessionId: randomUUID() },
        {
          type: 'personal_expense',
          amountMajor: '15.00',
          currencyCode: 'THB',
          description: uniqueWord,
          transactionDate: new Date().toISOString().slice(0, 10),
          accountId: ACCOUNT_ID,
          clientId: randomUUID(),
        }
      )
    );

    // searchTransactions returns a cursor page ({ transactions, nextCursor }),
    // not a bare array.
    const results = await withTransaction((client) => searchTransactions(client, USER_ID, { q: uniqueWord }));
    expect(results.transactions.some((t) => t.description === uniqueWord)).toBe(true);

    const noMatch = await withTransaction((client) => searchTransactions(client, USER_ID, { q: 'คำที่ไม่มีทางเจอแน่นอน' }));
    expect(noMatch.transactions.some((t) => t.description === uniqueWord)).toBe(false);
  });

  it('monthly summary and trend include a freshly created transaction', async () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const clientId = randomUUID();
    await withTransaction((client) =>
      createTransaction(
        client,
        { userId: USER_ID, sessionId: randomUUID() },
        {
          type: 'income',
          amountMajor: '777.00',
          currencyCode: 'THB',
          transactionDate: now.toISOString().slice(0, 10),
          accountId: ACCOUNT_ID,
          clientId,
        }
      )
    );

    const summary = await withTransaction((client) => monthlySummary(client, USER_ID, month));
    expect(BigInt(summary.income)).toBeGreaterThanOrEqual(77700n);

    const points = await withTransaction((client) => trend(client, USER_ID, 3));
    expect(points).toHaveLength(3);
    expect(points[points.length - 1]!.month).toBe(month);
  });
});
