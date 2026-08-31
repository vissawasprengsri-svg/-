import type { DbClient } from '../../db/pool.js';
import { consoleLogEmailChannel, type EmailChannel } from './channels.js';

/**
 * Groups the last 7 days of notifications by rule so a user gets one
 * weekly email with "3 บิลใกล้ครบกำหนด" instead of three separate emails —
 * the digest requirement exists specifically to avoid spamming.
 */
export async function sendWeeklyDigest(
  client: DbClient,
  userId: string,
  opts: { emailChannel?: EmailChannel } = {}
): Promise<{ sent: boolean; groupCount: number }> {
  const emailChannel = opts.emailChannel ?? consoleLogEmailChannel;

  const prefRes = await client.query(
    `SELECT 1 FROM notification_preferences WHERE user_id = $1 AND email_enabled = TRUE LIMIT 1`,
    [userId]
  );
  if (prefRes.rows.length === 0) return { sent: false, groupCount: 0 };

  const userRes = await client.query('SELECT email FROM users WHERE id = $1', [userId]);
  const email = userRes.rows[0]?.email;
  if (!email) return { sent: false, groupCount: 0 };

  const res = await client.query(
    `SELECT rule_code, title, body
     FROM notifications
     WHERE user_id = $1 AND created_at > now() - INTERVAL '7 days' AND rule_code IS NOT NULL
     ORDER BY rule_code, created_at DESC`,
    [userId]
  );

  const groupsByCode = new Map<string, { title: string; items: string[] }>();
  for (const row of res.rows) {
    const existing = groupsByCode.get(row.rule_code) ?? { title: row.title as string, items: [] as string[] };
    existing.items.push(row.body);
    groupsByCode.set(row.rule_code, existing);
  }
  if (groupsByCode.size === 0) return { sent: false, groupCount: 0 };

  const groups = [...groupsByCode.entries()].map(([ruleCode, g]) => ({
    ruleCode,
    title: g.title,
    count: g.items.length,
    items: g.items,
  }));

  const result = await emailChannel.sendWeeklyDigest({
    userId,
    email,
    weekOf: new Date().toISOString().slice(0, 10),
    groups,
  });

  return { sent: result.delivered, groupCount: groups.length };
}
