import 'dotenv/config';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

// Keeps the most recent N backups only — a personal finance DB backed up daily/weekly
// would otherwise grow this folder forever. 60 covers ~2 months of daily backups.
const KEEP_LAST = 60;

/**
 * Logical (row-level) backup rather than a `pg_dump` file: the
 * `@embedded-postgres/windows-x64` package only ships the server binaries
 * (postgres/pg_ctl/initdb), not the client tools (pg_dump/psql), so there's
 * no pg_dump.exe available to shell out to. Reading every table via the same
 * `pg` client the app already uses avoids that dependency entirely, and as a
 * side effect produces a plain, human-readable JSON file.
 */
async function rotateOldBackups(dir: string): Promise<void> {
  const files = (await readdir(dir)).filter((f) => f.startsWith('finance-backup-') && f.endsWith('.json'));
  if (files.length <= KEEP_LAST) return;
  const withStats = await Promise.all(files.map(async (f) => ({ f, mtime: (await stat(join(dir, f))).mtimeMs })));
  withStats.sort((a, b) => b.mtime - a.mtime);
  for (const { f } of withStats.slice(KEEP_LAST)) {
    await unlink(join(dir, f)).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const { ensureDatabaseUrl } = await import('./bootstrap.js');
  await ensureDatabaseUrl();
  const { defaultBackupDir } = await import('./embedded.js');

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let tableCount = 0;
  const tables: Record<string, unknown[]> = {};
  try {
    const tablesRes = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' ORDER BY tablename`
    );
    for (const { tablename } of tablesRes.rows) {
      const res = await client.query(`SELECT * FROM "${tablename}"`);
      tables[tablename] = res.rows;
      tableCount += 1;
    }
  } finally {
    await client.end();
  }

  // FINANCE_BACKUP_DIR lets this be pointed at a synced folder (OneDrive, Google Drive) so
  // backups survive more than a single-disk failure — set it in .env if you want that.
  const backupDir = process.env.FINANCE_BACKUP_DIR || defaultBackupDir();
  await mkdir(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = join(backupDir, `finance-backup-${stamp}.json`);
  await writeFile(outFile, JSON.stringify({ createdAt: new Date().toISOString(), tables }));

  await rotateOldBackups(backupDir);
  console.log(`[backup] wrote ${outFile} (${tableCount} tables)`);
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isMain) {
  main().catch((err) => {
    console.error('[backup] failed:', err);
    process.exit(1);
  });
}
