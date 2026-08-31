/**
 * Entry point for the daily scheduled job (OS cron / pg_cron / a task
 * scheduler service — nothing here starts its own timer). Run with:
 *   npm run jobs:daily -w apps/api
 * Intended to run once a day: purges expired trash, stamps out due
 * recurring transactions, rolls ended budgets into their next period, runs
 * the notification rule engine for every user, and sends the weekly
 * digest email on Mondays only.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { pool, withTransaction } from '../db/pool.js';
import { purgeExpiredTrash } from '../services/transactionService.js';
import { runDueRecurringRules } from '../services/recurringService.js';
import { rolloverEndedBudgets } from '../services/budgetService.js';
import { runNotificationChecksForUser } from '../domain/notifications/runChecks.js';
import { sendWeeklyDigest } from '../domain/notifications/digest.js';

async function main(): Promise<void> {
  const purged = await withTransaction((client) => purgeExpiredTrash(client));
  console.log(`purged ${purged} trashed transaction(s) older than 30 days`);

  const usersRes = await pool.query('SELECT id FROM users WHERE deleted_at IS NULL');
  const isMonday = new Date().getUTCDay() === 1;

  let totalCreated = 0;
  let totalPushed = 0;
  let totalRecurring = 0;
  let totalRolledOver = 0;
  for (const { id: userId } of usersRes.rows) {
    // A fresh session id per run: these are system-generated mutations, not
    // tied to any interactive browser session, but they still go through
    // the same undoable command stack as everything else.
    const sessionId = randomUUID();
    totalRecurring += await withTransaction((client) => runDueRecurringRules(client, userId, sessionId));
    totalRolledOver += await withTransaction((client) => rolloverEndedBudgets(client, userId));

    const result = await withTransaction((client) => runNotificationChecksForUser(client, userId));
    totalCreated += result.created;
    totalPushed += result.pushed;

    if (isMonday) {
      await withTransaction((client) => sendWeeklyDigest(client, userId));
    }
  }
  console.log(`recurring: ${totalRecurring} transaction(s) created, ${totalRolledOver} budget(s) rolled over`);
  console.log(`notification checks: ${totalCreated} created, ${totalPushed} pushed across ${usersRes.rows.length} user(s)`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
