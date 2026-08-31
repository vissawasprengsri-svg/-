import type { DbClient } from '../db/pool.js';
import type { AuditAction } from '@finance/shared';

function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    const beforeVal = before?.[key];
    const afterVal = after?.[key];
    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      result[key] = { from: beforeVal ?? null, to: afterVal ?? null };
    }
  }
  return result;
}

/**
 * Records one audit trail entry for a money-impacting change. Callers pass
 * the same before/after row snapshots used for the undo command so the
 * work of capturing state only happens once per mutation.
 */
export async function recordAudit(
  client: DbClient,
  params: {
    userId: string;
    entityType: string;
    entityId: string;
    action: AuditAction;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    actorId: string;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (user_id, entity_type, entity_id, action, before_json, after_json, diff_json, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      params.userId,
      params.entityType,
      params.entityId,
      params.action,
      params.before ? JSON.stringify(params.before) : null,
      params.after ? JSON.stringify(params.after) : null,
      JSON.stringify(diff(params.before, params.after)),
      params.actorId,
    ]
  );
}

export async function listAuditHistory(client: DbClient, entityType: string, entityId: string) {
  const res = await client.query(
    `SELECT id, action, before_json, after_json, diff_json, actor_id, created_at
     FROM audit_logs
     WHERE entity_type = $1 AND entity_id = $2
     ORDER BY created_at DESC`,
    [entityType, entityId]
  );
  return res.rows;
}
