import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

// schema.sql is the fixed spec owned outside this app (apps/api treats it
// as read-only input); everything else here is additive-only.
const SCHEMA_SPEC_PATH = join(__dirname, '..', '..', '..', '..', 'schema.sql');
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

async function ensureMigrationsTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function isApplied(pool: pg.Pool, name: string): Promise<boolean> {
  const res = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
  return (res.rowCount ?? 0) > 0;
}

async function markApplied(pool: pg.Pool, name: string): Promise<void> {
  await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
}

async function applySqlFile(pool: pg.Pool, name: string, sql: string): Promise<void> {
  if (await isApplied(pool, name)) {
    return;
  }
  console.log(`applying migration: ${name}`);
  await pool.query(sql);
  await markApplied(pool, name);
}

/** Applies schema.sql + every migrations/*.sql file, tracked in schema_migrations. Safe to call every time the app starts — already-applied files are skipped. */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  await ensureMigrationsTable(pool);

  const schemaSql = readFileSync(SCHEMA_SPEC_PATH, 'utf8');
  await applySqlFile(pool, '0000_schema.sql', schemaSql);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    await applySqlFile(pool, file, sql);
  }
}

async function main(): Promise<void> {
  const { ensureDatabaseUrl } = await import('./bootstrap.js');
  await ensureDatabaseUrl();
  const { pool } = await import('./pool.js');

  await runMigrations(pool);
  console.log('migrations up to date');
  await pool.end();
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
