/**
 * Real-Postgres integration tests for the notification rule engine.
 * Self-skips if DATABASE_URL is unreachable — see transactionService.integration.test.ts
 * for why pg-mem-style emulators aren't used here.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, withTransaction } from '../src/db/pool.js';
import { runNotificationChecksForUser } from '../src/domain/notifications/runChecks.js';
import { listNotifications, dismiss, markRead, unreadCount } from '../src/services/notificationService.js';

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

describe.skipIf(!reachable)('notification rule engine (real Postgres)', () => {
  afterAll(async () => {
    await pool.end();
  });

  beforeAll(async () => {
    if (!reachable) return;
    await pool.query(`DELETE FROM notifications WHERE user_id = $1`, [USER_ID]);
    // This suite's first test inserts a fresh "ค่ายาเก่า" claim transaction
    // every run without ever cleaning it up — re-running against the same
    // persistent database (there's no per-run disposable container here)
    // would otherwise accumulate one more match every time.
    await pool.query(`DELETE FROM transactions WHERE user_id = $1 AND description = 'ค่ายาเก่า'`, [USER_ID]);
  });

  it('flags a pending claim older than the configured overdue window, and dedupes on re-run', async () => {
    const clientId = randomUUID();
    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, currency_code, exchange_rate, base_amount, base_currency_code,
         description, transaction_date, account_id, status, client_id, created_by)
       VALUES ($1,'pending_claim',30000,'THB',1,30000,'THB','ค่ายาเก่า', CURRENT_DATE - INTERVAL '20 days', $2, 'awaiting_bill', $3, $1)`,
      [USER_ID, ACCOUNT_ID, clientId]
    );

    const first = await withTransaction((client) => runNotificationChecksForUser(client, USER_ID));
    expect(first.created).toBeGreaterThanOrEqual(1);

    const notifications = await withTransaction((client) => listNotifications(client, USER_ID));
    const claimNotif = notifications.find((n) => n.ruleCode === 'CLAIM_OVERDUE' && n.body.includes('ค่ายาเก่า'));
    expect(claimNotif).toBeTruthy();

    // Re-running must not create a second notification for the same overdue item.
    const second = await withTransaction((client) => runNotificationChecksForUser(client, USER_ID));
    const notificationsAfter = await withTransaction((client) => listNotifications(client, USER_ID));
    const claimCount = notificationsAfter.filter((n) => n.ruleCode === 'CLAIM_OVERDUE' && n.body.includes('ค่ายาเก่า')).length;
    expect(claimCount).toBe(1);
    void second;
  });

  it('unread count drops after markRead, and dismiss removes it from the active list', async () => {
    await withTransaction((client) => runNotificationChecksForUser(client, USER_ID));
    const before = await withTransaction((client) => unreadCount(client, USER_ID));
    expect(before).toBeGreaterThan(0);

    const [target] = await withTransaction((client) => listNotifications(client, USER_ID));
    await withTransaction((client) => markRead(client, USER_ID, target!.id));
    const afterRead = await withTransaction((client) => unreadCount(client, USER_ID));
    expect(afterRead).toBe(before - 1);

    await withTransaction((client) => dismiss(client, USER_ID, target!.id));
    const activeList = await withTransaction((client) => listNotifications(client, USER_ID));
    expect(activeList.some((n) => n.id === target!.id)).toBe(false);
  });

  it('a dismissed CLAIM_OVERDUE notification can resurface on the next check run', async () => {
    const notifications = await withTransaction((client) => listNotifications(client, USER_ID));
    const claimNotif = notifications.find((n) => n.ruleCode === 'CLAIM_OVERDUE');
    if (claimNotif) {
      await withTransaction((client) => dismiss(client, USER_ID, claimNotif.id));
    }
    const result = await withTransaction((client) => runNotificationChecksForUser(client, USER_ID));
    expect(result.created).toBeGreaterThanOrEqual(1);
  });
});
