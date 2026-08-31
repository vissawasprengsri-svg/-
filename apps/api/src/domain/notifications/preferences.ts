import type { DbClient } from '../../db/pool.js';
import type { NotificationPreference, NotificationRuleCode, UserSettings } from '@finance/shared';
import { NOTIFICATION_RULE_CODES } from '@finance/shared';

const DEFAULT_PREFERENCE: Omit<NotificationPreference, 'ruleCode'> = {
  inAppEnabled: true,
  pushEnabled: true,
  emailEnabled: false,
  leadDays: [7, 3, 1],
};

export async function getUserSettings(client: DbClient, userId: string): Promise<UserSettings> {
  const res = await client.query(
    `SELECT claim_overdue_days, card_usage_alert_pct, budget_alert_pcts, daily_reminder_time, quiet_hours_start, quiet_hours_end
     FROM user_settings WHERE user_id = $1`,
    [userId]
  );
  const row = res.rows[0];
  return {
    claimOverdueDays: row ? Number(row.claim_overdue_days) : 14,
    cardUsageAlertPct: row ? Number(row.card_usage_alert_pct) : 85,
    budgetAlertPcts: row ? row.budget_alert_pcts.map(Number) : [80, 100],
    dailyReminderTime: row?.daily_reminder_time ?? null,
    quietHoursStart: row?.quiet_hours_start ?? '22:00',
    quietHoursEnd: row?.quiet_hours_end ?? '07:00',
  };
}

export async function updateUserSettings(client: DbClient, userId: string, patch: Partial<UserSettings>): Promise<UserSettings> {
  const columns: Record<keyof UserSettings, string> = {
    claimOverdueDays: 'claim_overdue_days',
    cardUsageAlertPct: 'card_usage_alert_pct',
    budgetAlertPcts: 'budget_alert_pcts',
    dailyReminderTime: 'daily_reminder_time',
    quietHoursStart: 'quiet_hours_start',
    quietHoursEnd: 'quiet_hours_end',
  };
  const entries = Object.entries(patch) as [keyof UserSettings, unknown][];
  if (entries.length > 0) {
    const setClause = entries.map(([key], i) => `${columns[key]} = $${i + 2}`).join(', ');
    const values = entries.map(([, value]) => value);
    await client.query(`UPDATE user_settings SET ${setClause}, updated_at = now() WHERE user_id = $1`, [userId, ...values]);
  }
  return getUserSettings(client, userId);
}

export async function getPreferences(client: DbClient, userId: string): Promise<Record<NotificationRuleCode, NotificationPreference>> {
  const res = await client.query(
    'SELECT rule_code, in_app_enabled, push_enabled, email_enabled, lead_days FROM notification_preferences WHERE user_id = $1',
    [userId]
  );
  const byCode = new Map(res.rows.map((r) => [r.rule_code, r]));
  const result = {} as Record<NotificationRuleCode, NotificationPreference>;
  for (const code of NOTIFICATION_RULE_CODES) {
    const row = byCode.get(code);
    result[code] = row
      ? {
          ruleCode: code,
          inAppEnabled: row.in_app_enabled,
          pushEnabled: row.push_enabled,
          emailEnabled: row.email_enabled,
          leadDays: (row.lead_days ?? DEFAULT_PREFERENCE.leadDays).map(Number),
        }
      : { ruleCode: code, ...DEFAULT_PREFERENCE };
  }
  return result;
}

export async function updatePreference(
  client: DbClient,
  userId: string,
  ruleCode: NotificationRuleCode,
  patch: Partial<Omit<NotificationPreference, 'ruleCode'>>
): Promise<void> {
  const current = (await getPreferences(client, userId))[ruleCode];
  const merged = { ...current, ...patch };
  await client.query(
    `INSERT INTO notification_preferences (user_id, rule_code, in_app_enabled, push_enabled, email_enabled, lead_days)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, rule_code) DO UPDATE SET
       in_app_enabled = EXCLUDED.in_app_enabled,
       push_enabled = EXCLUDED.push_enabled,
       email_enabled = EXCLUDED.email_enabled,
       lead_days = EXCLUDED.lead_days`,
    [userId, ruleCode, merged.inAppEnabled, merged.pushEnabled, merged.emailEnabled, merged.leadDays]
  );
}
