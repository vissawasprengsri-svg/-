import { randomUUID } from 'node:crypto';
import type { RecurrenceFreq, RecurringRule, RecurringTemplate } from '@finance/shared';
import type { DbClient } from '../db/pool.js';
import { Errors } from '../domain/errors.js';
import { createTransaction } from './transactionService.js';

export interface CreateRecurringRuleInput {
  template: RecurringTemplate;
  frequency: RecurrenceFreq;
  intervalCount?: number;
  dayOfMonth?: number | null;
  dayOfWeek?: number | null;
  startDate: string;
  endDate?: string | null;
  maxOccurrences?: number | null;
  autoCreate?: boolean;
  notifyLeadDays?: number;
}

export interface UpdateRecurringRuleInput {
  template?: Partial<RecurringTemplate>;
  frequency?: RecurrenceFreq;
  intervalCount?: number;
  dayOfMonth?: number | null;
  dayOfWeek?: number | null;
  startDate?: string;
  endDate?: string | null;
  maxOccurrences?: number | null;
  autoCreate?: boolean;
  notifyLeadDays?: number;
}

function mapRow(row: Record<string, unknown>): RecurringRule {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    template: row.template as RecurringTemplate,
    frequency: row.frequency as RecurrenceFreq,
    intervalCount: Number(row.interval_count),
    dayOfMonth: row.day_of_month === null ? null : Number(row.day_of_month),
    dayOfWeek: row.day_of_week === null ? null : Number(row.day_of_week),
    startDate: String(row.start_date).slice(0, 10),
    endDate: row.end_date ? String(row.end_date).slice(0, 10) : null,
    maxOccurrences: row.max_occurrences === null ? null : Number(row.max_occurrences),
    occurrencesCount: Number(row.occurrences_count),
    nextRunDate: row.next_run_date ? String(row.next_run_date).slice(0, 10) : null,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at as string).toISOString() : null,
    autoCreate: Boolean(row.auto_create),
    notifyLeadDays: Number(row.notify_lead_days),
    isActive: Boolean(row.is_active),
    createdAt: new Date(row.created_at as string).toISOString(),
    deletedAt: row.deleted_at ? new Date(row.deleted_at as string).toISOString() : null,
  };
}

/** Advances a date by one occurrence of the given frequency, in exact calendar arithmetic (via Postgres date math, not JS Date). */
async function computeNextRunDate(client: DbClient, from: string, frequency: RecurrenceFreq, intervalCount: number): Promise<string> {
  const interval: Record<RecurrenceFreq, string> = {
    daily: `${intervalCount} days`,
    weekly: `${intervalCount} weeks`,
    biweekly: `${intervalCount * 2} weeks`,
    monthly: `${intervalCount} months`,
    quarterly: `${intervalCount * 3} months`,
    yearly: `${intervalCount} years`,
  };
  const res = await client.query<{ next: string }>('SELECT ($1::date + $2::interval)::date AS next', [from, interval[frequency]]);
  return String(res.rows[0]!.next).slice(0, 10);
}

export async function createRecurringRule(client: DbClient, userId: string, input: CreateRecurringRuleInput): Promise<RecurringRule> {
  const intervalCount = input.intervalCount ?? 1;
  const res = await client.query(
    `INSERT INTO recurring_rules (user_id, template, frequency, interval_count, day_of_month, day_of_week, start_date, end_date, max_occurrences, next_run_date, auto_create, notify_lead_days)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$7,$10,$11)
     RETURNING *`,
    [
      userId,
      JSON.stringify(input.template),
      input.frequency,
      intervalCount,
      input.dayOfMonth ?? null,
      input.dayOfWeek ?? null,
      input.startDate,
      input.endDate ?? null,
      input.maxOccurrences ?? null,
      input.autoCreate ?? true,
      input.notifyLeadDays ?? 3,
    ]
  );
  return mapRow(res.rows[0]);
}

export async function updateRecurringRule(
  client: DbClient,
  userId: string,
  id: string,
  patch: UpdateRecurringRuleInput
): Promise<RecurringRule> {
  const beforeRes = await client.query('SELECT * FROM recurring_rules WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE', [
    id,
    userId,
  ]);
  const before = beforeRes.rows[0];
  if (!before) throw Errors.notFound('recurring rule');

  const mergedTemplate = patch.template ? { ...(before.template as RecurringTemplate), ...patch.template } : before.template;

  const res = await client.query(
    `UPDATE recurring_rules SET
       template = $3, frequency = $4, interval_count = $5, day_of_month = $6, day_of_week = $7,
       start_date = $8, end_date = $9, max_occurrences = $10, auto_create = $11, notify_lead_days = $12
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [
      id,
      userId,
      JSON.stringify(mergedTemplate),
      patch.frequency ?? before.frequency,
      patch.intervalCount ?? before.interval_count,
      patch.dayOfMonth !== undefined ? patch.dayOfMonth : before.day_of_month,
      patch.dayOfWeek !== undefined ? patch.dayOfWeek : before.day_of_week,
      patch.startDate ?? before.start_date,
      patch.endDate !== undefined ? patch.endDate : before.end_date,
      patch.maxOccurrences !== undefined ? patch.maxOccurrences : before.max_occurrences,
      patch.autoCreate !== undefined ? patch.autoCreate : before.auto_create,
      patch.notifyLeadDays ?? before.notify_lead_days,
    ]
  );
  return mapRow(res.rows[0]);
}

export async function listRecurringRules(client: DbClient, userId: string): Promise<RecurringRule[]> {
  const res = await client.query(
    'SELECT * FROM recurring_rules WHERE user_id = $1 AND deleted_at IS NULL ORDER BY is_active DESC, next_run_date',
    [userId]
  );
  return res.rows.map(mapRow);
}

export async function setRecurringRuleActive(client: DbClient, userId: string, id: string, isActive: boolean): Promise<RecurringRule> {
  const res = await client.query(
    'UPDATE recurring_rules SET is_active = $3 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING *',
    [id, userId, isActive]
  );
  if (res.rows.length === 0) throw Errors.notFound('recurring rule');
  return mapRow(res.rows[0]);
}

export async function deleteRecurringRule(client: DbClient, userId: string, id: string): Promise<void> {
  const res = await client.query(
    'UPDATE recurring_rules SET deleted_at = now(), is_active = FALSE WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [id, userId]
  );
  if (res.rowCount === 0) throw Errors.notFound('recurring rule');
}

/**
 * Stamps out due occurrences for one user's recurring rules. Each generated
 * transaction gets a deterministic clientId (rule id + occurrence number),
 * so re-running this job never double-books even if it's interrupted and
 * retried mid-way.
 */
export async function runDueRecurringRules(client: DbClient, userId: string, sessionId: string): Promise<number> {
  const due = await client.query(
    `SELECT * FROM recurring_rules
     WHERE user_id = $1 AND is_active = TRUE AND auto_create = TRUE AND deleted_at IS NULL
       AND next_run_date <= CURRENT_DATE
       AND (end_date IS NULL OR next_run_date <= end_date)
       AND (max_occurrences IS NULL OR occurrences_count < max_occurrences)`,
    [userId]
  );

  let created = 0;
  for (const row of due.rows) {
    const rule = mapRow(row);
    const occurrenceIndex = rule.occurrencesCount + 1;
    const deterministicClientId = randomUUID(); // real UUID; dedupe key below is what actually protects against re-runs
    const dedupeSeed = `${rule.id}:${occurrenceIndex}`;

    const existing = await client.query('SELECT id FROM transactions WHERE user_id = $1 AND idempotency_key = $2', [
      userId,
      dedupeSeed,
    ]);
    if (existing.rows.length === 0) {
      // idempotencyKey is set atomically in the same INSERT as the rest of
      // the row, so a crash between "insert" and "some follow-up write"
      // can't happen here — a retry's SELECT above will always see it.
      await createTransaction(
        client,
        { userId, sessionId },
        {
          type: rule.template.type,
          amountMajor: rule.template.amountMajor,
          currencyCode: rule.template.currencyCode,
          description: rule.template.description,
          note: rule.template.note,
          categoryId: rule.template.categoryId,
          accountId: rule.template.accountId,
          transactionDate: rule.nextRunDate!,
          clientId: deterministicClientId,
        },
        { idempotencyKey: dedupeSeed }
      );
      created += 1;
    }

    const nextRunDate = await computeNextRunDate(client, rule.nextRunDate!, rule.frequency, rule.intervalCount);
    const reachedEnd = rule.endDate !== null && nextRunDate > rule.endDate;
    const reachedMax = rule.maxOccurrences !== null && occurrenceIndex >= rule.maxOccurrences;
    await client.query(
      `UPDATE recurring_rules
       SET occurrences_count = $2, next_run_date = $3, last_run_at = now(), is_active = $4
       WHERE id = $1`,
      [rule.id, occurrenceIndex, nextRunDate, !(reachedEnd || reachedMax)]
    );
  }
  return created;
}

/**
 * Manual counterpart to runDueRecurringRules for one specific rule — the
 * "I paid this myself, book it now" button for a rule set to notify-only
 * (auto_create = false) rather than auto-book on its due date. Same
 * dedupe-by-idempotency-key and occurrence/next-run advancement as the
 * automatic path, just triggered by a click instead of the daily job.
 */
export async function triggerManualRecurringRule(client: DbClient, userId: string, sessionId: string, ruleId: string): Promise<RecurringRule> {
  const ruleRes = await client.query(
    'SELECT * FROM recurring_rules WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE',
    [ruleId, userId]
  );
  const row = ruleRes.rows[0];
  if (!row) throw Errors.notFound('recurring rule');
  const rule = mapRow(row);
  if (!rule.nextRunDate) throw Errors.validation('รายการนี้ไม่มีกำหนดจ่ายรอบถัดไป');

  const occurrenceIndex = rule.occurrencesCount + 1;
  const dedupeSeed = `${rule.id}:${occurrenceIndex}`;

  const existing = await client.query('SELECT id FROM transactions WHERE user_id = $1 AND idempotency_key = $2', [userId, dedupeSeed]);
  if (existing.rows.length === 0) {
    await createTransaction(
      client,
      { userId, sessionId },
      {
        type: rule.template.type,
        amountMajor: rule.template.amountMajor,
        currencyCode: rule.template.currencyCode,
        description: rule.template.description,
        note: rule.template.note,
        categoryId: rule.template.categoryId,
        accountId: rule.template.accountId,
        transactionDate: rule.nextRunDate,
        clientId: randomUUID(),
      },
      { idempotencyKey: dedupeSeed }
    );
  }

  const nextRunDate = await computeNextRunDate(client, rule.nextRunDate, rule.frequency, rule.intervalCount);
  const reachedEnd = rule.endDate !== null && nextRunDate > rule.endDate;
  const reachedMax = rule.maxOccurrences !== null && occurrenceIndex >= rule.maxOccurrences;
  const res = await client.query(
    `UPDATE recurring_rules
     SET occurrences_count = $2, next_run_date = $3, last_run_at = now(), is_active = $4
     WHERE id = $1
     RETURNING *`,
    [rule.id, occurrenceIndex, nextRunDate, !(reachedEnd || reachedMax)]
  );
  return mapRow(res.rows[0]);
}
