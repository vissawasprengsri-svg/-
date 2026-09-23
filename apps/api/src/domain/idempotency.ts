import { createHash } from 'node:crypto';
import type { DbClient } from '../db/pool.js';

export interface IdempotencyLookup {
  hit: 'none' | 'replay' | 'conflict';
  cachedStatus?: number;
  cachedBody?: unknown;
}

/**
 * Serializes `value` with object keys sorted at every level, so two logically
 * identical request bodies hash the same regardless of what order the client
 * happened to put its keys in. Plain `JSON.stringify` preserves insertion
 * order — a retry that reconstructs the same body from, say, a differently-
 * ordered object literal would hash differently, be treated as a *different*
 * request, and the idempotency check would wave a duplicate mutation through
 * instead of catching it. Array order is left alone: it's meaningful data
 * (e.g. `transactionIds`), not incidental key placement.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(',')}}`;
}

function hashRequest(body: unknown): string {
  return createHash('sha256').update(stableStringify(body ?? {})).digest('hex');
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
