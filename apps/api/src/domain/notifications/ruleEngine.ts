import type { DbClient } from '../../db/pool.js';
import type { NotifSeverity, NotificationRuleCode, UserSettings } from '@finance/shared';
import { currentHHMMInTimezone } from './quietHours.js';

export interface NotificationCandidate {
  ruleCode: NotificationRuleCode;
  severity: NotifSeverity;
  /** Placeholders substituted into notification_rules.title_i18n/body_i18n at insert time (see runChecks.ts). */
  vars: Record<string, string>;
  deepLink: string | null;
  entityType: string | null;
  entityId: string | null;
  dedupeKey: string;
}

/** Clamps a day-of-month (1-31) to a real date in the given month, e.g. 31 in February -> 28/29. */
export function dateForDay(year: number, monthIndex: number, day: number): Date {
  const lastDayOfMonth = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(day, lastDayOfMonth));
}

export function nextDueDate(dueDay: number, today: Date): Date {
  const candidate = dateForDay(today.getFullYear(), today.getMonth(), dueDay);
  if (candidate >= today) return candidate;
  return dateForDay(today.getFullYear(), today.getMonth() + 1, dueDay);
}

export function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

export async function checkClaimOverdue(client: DbClient, userId: string, settings: UserSettings): Promise<NotificationCandidate[]> {
  const res = await client.query(
    `SELECT id, description, (CURRENT_DATE - transaction_date) AS days_outstanding
     FROM transactions
     WHERE user_id = $1 AND deleted_at IS NULL AND type = 'pending_claim'
       AND status IN ('awaiting_bill', 'pending', 'claimed')
       AND (CURRENT_DATE - transaction_date) > $2`,
    [userId, settings.claimOverdueDays]
  );
  return res.rows.map((row) => ({
    ruleCode: 'CLAIM_OVERDUE' as const,
    severity: 'warning' as const,
    vars: { description: row.description || '-', days: String(row.days_outstanding) },
    deepLink: `/transactions/${row.id}`,
    entityType: 'transaction',
    entityId: row.id,
    dedupeKey: `CLAIM_OVERDUE:${row.id}`,
  }));
}

export async function checkCreditCardDueSoon(
  client: DbClient,
  userId: string,
  leadDaysByAccount: (accountId: string) => number[]
): Promise<NotificationCandidate[]> {
  const res = await client.query(
    `SELECT a.id AS account_id, a.name, cc.due_day
     FROM accounts a JOIN credit_cards cc ON cc.account_id = a.id
     WHERE a.user_id = $1 AND a.deleted_at IS NULL AND cc.due_day IS NOT NULL`,
    [userId]
  );
  const today = new Date(new Date().toDateString());
  const candidates: NotificationCandidate[] = [];
  for (const row of res.rows) {
    const due = nextDueDate(Number(row.due_day), today);
    const days = daysBetween(today, due);
    if (leadDaysByAccount(row.account_id).includes(days)) {
      const dueStr = due.toISOString().slice(0, 10);
      candidates.push({
        ruleCode: 'CREDIT_CARD_DUE_SOON',
        severity: 'warning',
        vars: { cardName: row.name, days: String(days), dueDate: dueStr },
        deepLink: `/accounts/${row.account_id}`,
        entityType: 'account',
        entityId: row.account_id,
        dedupeKey: `CREDIT_CARD_DUE_SOON:${row.account_id}:${dueStr}`,
      });
    }
  }
  return candidates;
}

export async function checkRecurringDueSoon(client: DbClient, userId: string): Promise<NotificationCandidate[]> {
  const res = await client.query(
    `SELECT id, template, next_run_date, notify_lead_days FROM recurring_rules
     WHERE user_id = $1 AND is_active = TRUE AND deleted_at IS NULL AND next_run_date IS NOT NULL`,
    [userId]
  );
  const today = new Date(new Date().toDateString());
  const candidates: NotificationCandidate[] = [];
  for (const row of res.rows) {
    const dueDateStr = String(row.next_run_date).slice(0, 10);
    const due = new Date(`${dueDateStr}T00:00:00`);
    const days = daysBetween(today, due);
    // Each rule carries its own lead time (notify_lead_days) rather than the
    // global multi-threshold preference other rules use — a bill someone
    // wants a single heads-up on doesn't need the [7,3,1] cadence.
    if (days === Number(row.notify_lead_days)) {
      const description = row.template?.description || '-';
      candidates.push({
        ruleCode: 'RECURRING_DUE_SOON',
        severity: 'warning',
        vars: { description, days: String(days) },
        deepLink: '/settings',
        entityType: 'recurring_rule',
        entityId: row.id,
        dedupeKey: `RECURRING_DUE_SOON:${row.id}:${dueDateStr}`,
      });
    }
  }
  return candidates;
}

export async function checkUpcomingBillsDue(client: DbClient, userId: string, leadDays: number[]): Promise<NotificationCandidate[]> {
  const res = await client.query(
    `SELECT id, title, due_date, (due_date - CURRENT_DATE) AS days_until
     FROM upcoming_bills
     WHERE user_id = $1 AND is_paid = FALSE AND deleted_at IS NULL`,
    [userId]
  );
  const candidates: NotificationCandidate[] = [];
  for (const row of res.rows) {
    const days = Number(row.days_until);
    if (leadDays.includes(days)) {
      candidates.push({
        ruleCode: 'BILL_DUE_SOON',
        severity: 'warning',
        vars: { title: row.title, days: String(days) },
        deepLink: '/',
        entityType: 'upcoming_bill',
        entityId: row.id,
        dedupeKey: `BILL_DUE_SOON:${row.id}:${String(row.due_date).slice(0, 10)}`,
      });
    }
  }
  return candidates;
}

export async function checkBudgetThreshold(client: DbClient, userId: string): Promise<NotificationCandidate[]> {
  const res = await client.query(
    `SELECT b.id, b.name, b.amount, b.period_start, b.alert_pcts,
            COALESCE(SUM(t.amount) FILTER (
              WHERE t.type = 'personal_expense' AND t.deleted_at IS NULL
                AND t.transaction_date BETWEEN b.period_start AND b.period_end
            ), 0) AS spent
     FROM budgets b
     LEFT JOIN transactions t ON t.category_id = b.category_id AND t.user_id = b.user_id
     WHERE b.user_id = $1 AND b.is_active AND b.deleted_at IS NULL
       AND CURRENT_DATE BETWEEN b.period_start AND b.period_end
     GROUP BY b.id`,
    [userId]
  );
  const candidates: NotificationCandidate[] = [];
  for (const row of res.rows) {
    const amount = BigInt(row.amount);
    if (amount <= 0n) continue;
    const spent = BigInt(row.spent);
    const pct = Number((spent * 100n) / amount);
    const thresholds: number[] = (row.alert_pcts ?? []).map(Number).sort((a: number, b: number) => a - b);
    for (const threshold of thresholds) {
      if (pct >= threshold) {
        candidates.push({
          ruleCode: 'BUDGET_THRESHOLD',
          severity: threshold >= 100 ? 'critical' : 'warning',
          vars: { budgetName: row.name, pct: String(pct) },
          deepLink: `/budgets/${row.id}`,
          entityType: 'budget',
          entityId: row.id,
          dedupeKey: `BUDGET_THRESHOLD:${row.id}:${threshold}:${row.period_start}`,
        });
      }
    }
  }
  return candidates;
}

export async function checkCreditCardNearLimit(client: DbClient, userId: string, alertPct: number): Promise<NotificationCandidate[]> {
  const res = await client.query(
    `SELECT a.id AS account_id, a.name, cc.credit_limit, a.current_balance
     FROM accounts a JOIN credit_cards cc ON cc.account_id = a.id
     WHERE a.user_id = $1 AND a.deleted_at IS NULL AND cc.credit_limit > 0`,
    [userId]
  );
  const candidates: NotificationCandidate[] = [];
  for (const row of res.rows) {
    const limit = BigInt(row.credit_limit);
    const owed = BigInt(row.current_balance) < 0n ? -BigInt(row.current_balance) : BigInt(row.current_balance);
    const pct = Number((owed * 100n) / limit);
    if (pct >= alertPct) {
      candidates.push({
        ruleCode: 'CREDIT_CARD_NEAR_LIMIT',
        severity: 'critical',
        vars: { cardName: row.name, pct: String(pct) },
        deepLink: `/accounts/${row.account_id}`,
        entityType: 'account',
        entityId: row.account_id,
        dedupeKey: `CREDIT_CARD_NEAR_LIMIT:${row.account_id}`,
      });
    }
  }
  return candidates;
}

export async function checkLoanOverdue(client: DbClient, userId: string): Promise<NotificationCandidate[]> {
  const res = await client.query(
    `SELECT id, description FROM transactions
     WHERE user_id = $1 AND deleted_at IS NULL AND type = 'loan_given' AND claim_received = FALSE
       AND claim_due_date IS NOT NULL AND claim_due_date < CURRENT_DATE`,
    [userId]
  );
  return res.rows.map((row) => ({
    ruleCode: 'LOAN_OVERDUE' as const,
    severity: 'warning' as const,
    vars: { description: row.description || '-' },
    deepLink: `/transactions/${row.id}`,
    entityType: 'transaction',
    entityId: row.id,
    dedupeKey: `LOAN_OVERDUE:${row.id}`,
  }));
}

export async function checkDailyLogReminder(client: DbClient, userId: string, settings: UserSettings, now: Date): Promise<NotificationCandidate[]> {
  if (!settings.dailyReminderTime) return [];
  const userRes = await client.query('SELECT timezone FROM users WHERE id = $1', [userId]);
  const timezone: string = userRes.rows[0]?.timezone ?? 'Asia/Bangkok';
  const nowHHMM = currentHHMMInTimezone(now, timezone);
  if (nowHHMM < settings.dailyReminderTime.slice(0, 5)) return [];

  const todayLocal = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now); // YYYY-MM-DD
  const res = await client.query(
    `SELECT 1 FROM transactions WHERE user_id = $1 AND deleted_at IS NULL AND transaction_date = $2 LIMIT 1`,
    [userId, todayLocal]
  );
  if (res.rows.length > 0) return [];

  return [
    {
      ruleCode: 'DAILY_LOG_REMINDER',
      severity: 'info',
      vars: {},
      deepLink: '/add',
      entityType: null,
      entityId: null,
      dedupeKey: `DAILY_LOG_REMINDER:${todayLocal}`,
    },
  ];
}
