import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// schema.sql is the fixed spec owned outside this app (apps/api treats it
// as read-only input); everything else here is additive-only.
const SCHEMA_SPEC_PATH = join(__dirname, '..', '..', '..', '..', 'schema.sql');
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function isApplied(name: string): Promise<boolean> {
  const res = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
  return (res.rowCount ?? 0) > 0;
}

async function markApplied(name: string): Promise<void> {
  await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
}

async function applySqlFile(name: string, sql: string): Promise<void> {
  if (await isApplied(name)) {
    console.log(`skip (already applied): ${name}`);
    return;
  }
  console.log(`applying: ${name}`);
  await pool.query(sql);
  await markApplied(name);
}

async function main(): Promise<void> {
  await ensureMigrationsTable();

  const schemaSql = readFileSync(SCHEMA_SPEC_PATH, 'utf8');
  await applySqlFile('0000_schema.sql', schemaSql);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    await applySqlFile(file, sql);
  }

  console.log('migrations up to date');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
