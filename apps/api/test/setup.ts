import pg from 'pg';
import { embeddedDatabaseUrl } from '../src/db/embedded.js';

/**
 * Gives the integration suites their own database, created on first run.
 *
 * They must not share the development database. These tests write real
 * transactions, and several of them zero an account balance to get a known
 * starting point — run against the dev data and they leave invented categories
 * and bills sitting in the user's own claims summary and reports, indexed by
 * nothing that marks them as junk. (This is not hypothetical: an earlier run of
 * this suite put 33 fabricated bills into the dev database.)
 *
 * Nor should they self-skip when DATABASE_URL happens to be unset, which is
 * what they did before: the default pointed at a stock localhost:5432 that this
 * project never runs, so `npm test` reported a wall of green unit tests while
 * every test that touches the database quietly sat out. A suite that opts out
 * of the hard parts on a misconfigured machine looks exactly like a passing one.
 *
 * An explicit DATABASE_URL still wins, for CI or a throwaway container.
 */
const TEST_DB = 'finance_tracker_test';

async function ensureTestDatabase(): Promise<string> {
  const adminUrl = new URL(embeddedDatabaseUrl());
  const testUrl = new URL(adminUrl.toString());
  testUrl.pathname = `/${TEST_DB}`;

  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 2000 });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
    if (exists.rowCount === 0) {
      // CREATE DATABASE can't be parameterised or run inside a transaction.
      await admin.query(`CREATE DATABASE "${TEST_DB}"`);
    }
  } finally {
    await admin.end();
  }
  return testUrl.toString();
}

if (!process.env.DATABASE_URL) {
  try {
    process.env.DATABASE_URL = await ensureTestDatabase();
    // Schema + migrations are tracked in schema_migrations, so this is a no-op
    // on every run after the first.
    const { runMigrations } = await import('../src/db/migrate.js');
    const migrationPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await runMigrations(migrationPool);
    } finally {
      await migrationPool.end();
    }
  } catch {
    // No embedded Postgres running: leave DATABASE_URL unset so the suites'
    // own reachability probe skips them, rather than failing the whole run.
  }
}
