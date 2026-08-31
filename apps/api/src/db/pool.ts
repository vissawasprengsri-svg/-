import pg from 'pg';

const { Pool } = pg;

// BIGINT (OID 20) is returned as a JS string by default in node-postgres —
// that default is intentional and must stay: money must never pass through
// a JS number/float anywhere in this codebase.

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
