import type { Request, Response } from 'express';
import { withTransaction, type DbClient } from '../db/pool.js';
import { checkIdempotency, storeIdempotencyResult } from '../domain/idempotency.js';
import { Errors } from '../domain/errors.js';

/**
 * Runs a mutating handler inside one DB transaction alongside its
 * idempotency bookkeeping, so "the mutation happened" and "the result was
 * cached under this key" always commit or roll back together. A retried
 * request with the same `Idempotency-Key` + body replays the cached
 * response instead of re-running the mutation.
 */
export async function runIdempotent(
  req: Request,
  res: Response,
  endpoint: string,
  handler: (client: DbClient) => Promise<{ status: number; body: unknown }>
): Promise<void> {
  const key = req.header('idempotency-key');
  if (!key) {
    throw Errors.validation('Idempotency-Key header is required for this request');
  }

  const result = await withTransaction(async (client) => {
    const lookup = await checkIdempotency(client, { key, userId: req.userId, endpoint, body: req.body });
    if (lookup.hit === 'conflict') throw Errors.idempotencyConflict();
    if (lookup.hit === 'replay') {
      return { status: lookup.cachedStatus!, body: lookup.cachedBody };
    }
    const outcome = await handler(client);
    await storeIdempotencyResult(client, {
      key,
      userId: req.userId,
      endpoint,
      body: req.body,
      statusCode: outcome.status,
      responseBody: outcome.body,
    });
    return outcome;
  });

  res.status(result.status).json(result.body);
}
