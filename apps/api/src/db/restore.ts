import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

interface BackupFile {
  createdAt: string;
  tables: Record<string, Array<Record<string, unknown>>>;
}

/**
 * Restores a backup written by backup.ts. Deliberately CLI-only, never wired into any UI
 * button or API route — it truncates every table before reloading, so it must only ever
 * run from a deliberate, typed-out command, not a misclick.
 *
 * `session_replication_role = replica` disables FK/trigger enforcement for this session so
 * rows can be reloaded in any order (the backup has no guaranteed dependency order), without
 * needing to compute a topological sort of ~20 tables' foreign keys by hand.
 */
async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npm run restore -w apps/api -- <path-to-backup.json>');
    process.exit(1);
  }

  const raw = await readFile(filePath, 'utf-8');
  const backup = JSON.parse(raw) as BackupFile;
  const tableNames = Object.keys(backup.tables);
  if (tableNames.length === 0) {
    console.error('[restore] backup file has no tables — aborting');
    process.exit(1);
  }

  const { ensureDatabaseUrl } = await import('./bootstrap.js');
  await ensureDatabaseUrl();

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET session_replication_role = replica');
    await client.query(`TRUNCATE TABLE ${tableNames.map((t) => `"${t}"`).join(', ')} CASCADE`);

    let rowCount = 0;
    for (const table of tableNames) {
      for (const row of backup.tables[table]!) {
        const columns = Object.keys(row);
        if (columns.length === 0) continue;
        const columnList = columns.map((c) => `"${c}"`).join(', ');
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(`INSERT INTO "${table}" (${columnList}) VALUES (${placeholders})`, Object.values(row));
        rowCount += 1;
      }
    }

    await client.query('SET session_replication_role = DEFAULT');
    await client.query('COMMIT');
    console.log(`[restore] restored ${tableNames.length} tables (${rowCount} rows) from ${filePath} (backed up ${backup.createdAt})`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isMain) {
  main().catch((err) => {
    console.error('[restore] failed:', err);
    process.exit(1);
  });
}
