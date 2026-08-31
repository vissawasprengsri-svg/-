import type { NotificationItem } from '@finance/shared';

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export function mapNotificationRow(row: Record<string, unknown>): NotificationItem {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    ruleCode: (row.rule_code as NotificationItem['ruleCode']) ?? null,
    severity: row.severity as NotificationItem['severity'],
    title: row.title as string,
    body: row.body as string,
    deepLink: (row.deep_link as string | null) ?? null,
    entityType: (row.entity_type as string | null) ?? null,
    entityId: (row.entity_id as string | null) ?? null,
    scheduledAt: iso(row.scheduled_at)!,
    sentAt: iso(row.sent_at),
    readAt: iso(row.read_at),
    dismissedAt: iso(row.dismissed_at),
    createdAt: iso(row.created_at)!,
  };
}
