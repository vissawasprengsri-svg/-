import type { DbClient } from '../db/pool.js';
import type { NotificationItem } from '@finance/shared';
import { mapNotificationRow } from '../db/notificationMapper.js';
import { Errors } from '../domain/errors.js';

export async function listNotifications(client: DbClient, userId: string): Promise<NotificationItem[]> {
  const res = await client.query(
    `SELECT * FROM notifications
     WHERE user_id = $1 AND dismissed_at IS NULL
     ORDER BY read_at IS NOT NULL, created_at DESC
     LIMIT 100`,
    [userId]
  );
  return res.rows.map(mapNotificationRow);
}

export async function unreadCount(client: DbClient, userId: string): Promise<number> {
  const res = await client.query(
    'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL AND dismissed_at IS NULL',
    [userId]
  );
  return Number(res.rows[0].count);
}

export async function markRead(client: DbClient, userId: string, id: string): Promise<NotificationItem> {
  const res = await client.query(
    'UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL RETURNING *',
    [id, userId]
  );
  if (res.rows.length === 0) {
    const existing = await client.query('SELECT * FROM notifications WHERE id = $1 AND user_id = $2', [id, userId]);
    if (existing.rows.length === 0) throw Errors.notFound('notification');
    return mapNotificationRow(existing.rows[0]);
  }
  return mapNotificationRow(res.rows[0]);
}

export async function markAllRead(client: DbClient, userId: string): Promise<number> {
  const res = await client.query(
    'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
    [userId]
  );
  return res.rowCount ?? 0;
}

export async function dismiss(client: DbClient, userId: string, id: string): Promise<NotificationItem> {
  const res = await client.query(
    'UPDATE notifications SET dismissed_at = now() WHERE id = $1 AND user_id = $2 RETURNING *',
    [id, userId]
  );
  if (res.rows.length === 0) throw Errors.notFound('notification');
  return mapNotificationRow(res.rows[0]);
}
