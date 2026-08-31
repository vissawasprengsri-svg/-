import type { DbClient } from '../../db/pool.js';
import { getPreferences, getUserSettings } from './preferences.js';
import { isWithinQuietHours, currentHHMMInTimezone } from './quietHours.js';
import { consoleLogPushChannel, type PushChannel } from './channels.js';
import { pickLocaleText, renderTemplate } from './template.js';
import {
  checkBudgetThreshold,
  checkClaimOverdue,
  checkCreditCardDueSoon,
  checkCreditCardNearLimit,
  checkDailyLogReminder,
  checkLoanOverdue,
  type NotificationCandidate,
} from './ruleEngine.js';

interface RuleTemplate {
  titleI18n: Record<string, string>;
  bodyI18n: Record<string, string>;
}

async function loadRuleTemplates(client: DbClient): Promise<Map<string, RuleTemplate>> {
  const res = await client.query('SELECT code, title_i18n, body_i18n FROM notification_rules WHERE is_active = TRUE');
  return new Map(res.rows.map((r) => [r.code, { titleI18n: r.title_i18n, bodyI18n: r.body_i18n }]));
}

/** Inserts a candidate notification, relying on the schema's partial unique
 * index (user_id, dedupe_key) WHERE dismissed_at IS NULL to silently skip
 * anything already active — re-running the checks is always safe. Title
 * and body are rendered from notification_rules' i18n templates in the
 * user's own locale, not hardcoded in any one language. */
async function upsertNotification(
  client: DbClient,
  userId: string,
  c: NotificationCandidate,
  template: RuleTemplate | undefined,
  locale: string
): Promise<string | null> {
  const title = template ? renderTemplate(pickLocaleText(template.titleI18n, locale), c.vars) : c.ruleCode;
  const body = template ? renderTemplate(pickLocaleText(template.bodyI18n, locale), c.vars) : '';

  const res = await client.query<{ id: string }>(
    `INSERT INTO notifications (user_id, rule_code, severity, title, body, deep_link, entity_type, entity_id, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND dismissed_at IS NULL DO NOTHING
     RETURNING id`,
    [userId, c.ruleCode, c.severity, title, body, c.deepLink, c.entityType, c.entityId, c.dedupeKey]
  );
  if (!res.rows[0]) return null;
  return res.rows[0].id;
}

export interface RunChecksResult {
  created: number;
  pushed: number;
}

export async function runNotificationChecksForUser(
  client: DbClient,
  userId: string,
  opts: { now?: Date; pushChannel?: PushChannel } = {}
): Promise<RunChecksResult> {
  const now = opts.now ?? new Date();
  const pushChannel = opts.pushChannel ?? consoleLogPushChannel;

  const settings = await getUserSettings(client, userId);
  const prefs = await getPreferences(client, userId);
  const templates = await loadRuleTemplates(client);

  const userRes = await client.query('SELECT timezone, locale FROM users WHERE id = $1', [userId]);
  const timezone: string = userRes.rows[0]?.timezone ?? 'Asia/Bangkok';
  const locale: string = userRes.rows[0]?.locale ?? 'th-TH';

  const candidates: NotificationCandidate[] = [
    ...(await checkClaimOverdue(client, userId, settings)),
    ...(await checkCreditCardDueSoon(client, userId, () => prefs.CREDIT_CARD_DUE_SOON.leadDays)),
    ...(await checkBudgetThreshold(client, userId)),
    ...(await checkCreditCardNearLimit(client, userId, settings.cardUsageAlertPct)),
    ...(await checkLoanOverdue(client, userId)),
    ...(await checkDailyLogReminder(client, userId, settings, now)),
  ];

  let created = 0;
  let pushed = 0;
  const inQuietHours = isWithinQuietHours(currentHHMMInTimezone(now, timezone), settings.quietHoursStart, settings.quietHoursEnd);

  for (const candidate of candidates) {
    const pref = prefs[candidate.ruleCode];
    if (!pref.inAppEnabled) continue;
    const id = await upsertNotification(client, userId, candidate, templates.get(candidate.ruleCode), locale);
    if (!id) continue; // already active, deduped

    created += 1;
    const row = await client.query<{ title: string; body: string }>('SELECT title, body FROM notifications WHERE id = $1', [id]);
    const { title, body } = row.rows[0]!;

    if (pref.pushEnabled && !inQuietHours) {
      const result = await pushChannel.send({ userId, title, body, severity: candidate.severity, deepLink: candidate.deepLink });
      if (result.delivered) {
        await client.query('UPDATE notifications SET sent_at = now() WHERE id = $1', [id]);
        pushed += 1;
      }
    }
  }

  return { created, pushed };
}
