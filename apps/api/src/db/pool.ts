import pg from 'pg';

const { Pool, types } = pg;

// BIGINT (OID 20) is returned as a JS string by default in node-postgres —
// that default is intentional and must stay: money must never pass through
// a JS number/float anywhere in this codebase.

// DATE (OID 1082) defaults to a JS `Date` parsed in the *local* timezone,
// which silently shifts the calendar day by one once you call
// `.toISOString()` on it in any timezone other than UTC — the same class of
// bug fixed in the web app's date pickers, but here on every value read back
// from a date column (transaction_date, period_start/end, due dates, ...).
// None of these are instants; they're pure calendar dates. Keep them as the
// literal "YYYY-MM-DD" string Postgres sends and never construct a Date
// from them at all.
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/finance_tracker',
  max: 10,
});

export type DbClient = pg.PoolClient;

export async function withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
