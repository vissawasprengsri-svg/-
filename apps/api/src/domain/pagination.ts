import { Errors } from './errors.js';

/**
 * Keyset (a.k.a. cursor) pagination on `(transaction_date, created_at, id)` —
 * all three, since transaction_date alone has many ties (everything booked on
 * the same day) and created_at alone isn't indexed. Chosen over OFFSET
 * because an offset-based page shifts under you the moment a row is
 * inserted/deleted ahead of it (a real risk here: undo/redo and recurring
 * rules create rows continuously), and over raw LIMIT because that's the
 * hardcoded-200 problem this exists to remove — silently dropping anything
 * past the cap instead of making "there's more" a thing the caller can see
 * and page through.
 */
export interface PageCursor {
  date: string;
  createdAt: string;
  id: string;
}

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 200;

export function encodeCursor(row: { transaction_date: unknown; created_at: unknown; id: string }): string {
  const cursor: PageCursor = {
    date: String(row.transaction_date).slice(0, 10),
    createdAt: new Date(row.created_at as string).toISOString(),
    id: row.id,
  };
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** Throws rather than silently restarting from the top — an unreadable cursor almost
 * always means a stale "load more" click racing a client-side navigation, and surfacing
 * that beats quietly re-serving page 1 under a "next page" label. */
export function decodeCursor(raw: string): PageCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed?.date === 'string' && typeof parsed?.createdAt === 'string' && typeof parsed?.id === 'string') {
      return parsed as PageCursor;
    }
  } catch {
    // falls through to the validation error below
  }
  throw Errors.validation('Invalid pagination cursor');
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.trunc(limit), MAX_PAGE_SIZE);
}

export interface Page<T> {
  transactions: T[];
  nextCursor: string | null;
}

/**
 * Runs a query for `limit + 1` rows and splits off the lookahead row — the
 * standard way to know whether a "next page" exists without a second COUNT
 * query. `rows` must already be sorted by (transaction_date, created_at, id)
 * DESC, i.e. exactly the tiebreak order `encodeCursor`/the WHERE clause below
 * assume.
 */
export function paginateRows<Raw extends { id: string; transaction_date: unknown; created_at: unknown }, Mapped>(
  rows: Raw[],
  limit: number,
  map: (row: Raw) => Mapped
): Page<Mapped> {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    transactions: page.map(map),
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null,
  };
}
