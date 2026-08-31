import { createHash } from 'node:crypto';
import type { DbClient } from '../db/pool.js';

export interface IdempotencyLookup {
  hit: 'none' | 'replay' | 'conflict';
  cachedStatus?: number;
  cachedBody?: unknown;
}

function hashRequest(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}

/**
 * Looks up an idempotency key for this (user, endpoint) before running the
 * handler. Call `storeResult` after the handler produces its response so a
 * retried request with the same key + payload replays the exact response
 * instead of re-running the mutation (guards against double-tap / retry
 * storms creating duplicate transactions).
 */
export async function checkIdempotency(
  client: DbClient,
  params: { key: string; userId: string; endpoint: string; body: unknown }
): Promise<IdempotencyLookup> {
  const requestHash = hashRequest(params.body);
  const res = await client.query<{ request_hash: string; response_body: unknown; status_code: number }>(
    `SELECT request_hash, response_body, status_code
     FROM idempotency_keys
     WHERE key = $1 AND endpoint = $2 AND expires_at > now()`,
    [params.key, params.endpoint]
  );
  const row = res.rows[0];
  if (!row) return { hit: 'none' };
  if (row.request_hash !== requestHash) return { hit: 'conflict' };
  return { hit: 'replay', cachedStatus: row.status_code, cachedBody: row.response_body };
}

export async function storeIdempotencyResult(
  client: DbClient,
  params: { key: string; userId: string; endpoint: string; body: unknown; statusCode: number; responseBody: unknown }
): Promise<void> {
  const requestHash = hashRequest(params.body);
  await client.query(
    `INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, response_body, status_code)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (key) DO NOTHING`,
    [params.key, params.userId, params.endpoint, requestHash, JSON.stringify(params.responseBody), params.statusCode]
  );
}
