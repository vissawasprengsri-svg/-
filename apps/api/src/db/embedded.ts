import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * A real Postgres server, downloaded once as an npm dependency and run as a
 * local child process — no Docker, no separate install. This is the
 * zero-setup path for local development; anything that sets DATABASE_URL
 * explicitly (docker-compose, a real deployment) bypasses this entirely.
 *
 * This does NOT use the `embedded-postgres` package's own start/stop
 * lifecycle: Postgres's Windows binaries fail outright when any path in the
 * invocation — the binary's own path, the data directory, the password file
 * — contains non-ASCII characters (this project's own folder name does). So
 * the binaries get copied once to an ASCII-only cache under the user's home
 * directory, and get spawned from there instead. The `pg`/SQL side of the
 * app is completely unaffected — Unicode works fine everywhere except in
 * arguments handed directly to these native binaries.
 *
 * The server also deliberately outlives this Node process: `npm run dev`
 * restarts the whole script on every file save (tsx watch), and Postgres
 * takes a couple of seconds to start — tying its lifecycle to that watch
 * cycle would mean restarting the DB on every save and racing its own
 * shutdown against its own startup. Instead it's started once (via
 * `pg_ctl`, see `startPostgresViaPgCtl`) and left running for the rest of
 * the dev session; every call here first checks whether it's already up
 * and reuses it. `npm run stop:db -w apps/api` shuts it down explicitly.
 */
const PG_VERSION = '16.14.0-beta.17';
const CACHE_ROOT = join(homedir(), '.finance-tracker-embedded-pg');
const BIN_DIR = join(CACHE_ROOT, `bin-${PG_VERSION}`);
const DATA_DIR = join(CACHE_ROOT, 'data');
const LOG_FILE = join(CACHE_ROOT, 'server.log');
const PORT = 54329;
const DB_NAME = 'finance_tracker';
const PG_USER = 'postgres';
const PG_PASSWORD = 'postgres';

export function embeddedDatabaseUrl(): string {
  return `postgres://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PORT}/${DB_NAME}`;
}

/** Where backup.ts writes snapshot files by default — same cache root as the binaries/data. */
export function defaultBackupDir(): string {
  return join(CACHE_ROOT, 'backups');
}

async function canConnect(database = 'postgres'): Promise<boolean> {
  const client = new pg.Client({
    user: PG_USER,
    password: PG_PASSWORD,
    port: PORT,
    host: '127.0.0.1',
    database,
    connectionTimeoutMillis: 1000,
  });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

async function ensureBinariesCopied(): Promise<{ pgCtl: string; initdb: string }> {
  const postgresExe = join(BIN_DIR, 'bin', 'postgres.exe');
  if (!existsSync(postgresExe)) {
    console.log('[embedded-postgres] first run: copying Postgres binaries to an ASCII-safe cache directory...');
    // Resolve via Node's module resolution rather than a hardcoded relative
    // path, since npm's hoisting depth for this platform package isn't
    // guaranteed — `embedded-postgres` pulls it in as an optional
    // platform-specific dependency (like esbuild/sharp do).
    const entryUrl = import.meta.resolve('@embedded-postgres/windows-x64');
    // Resolves to <package root>/dist/index.js; the binaries live in <package root>/native.
    const sourceDir = join(dirname(fileURLToPath(entryUrl)), '..', 'native');
    await mkdir(BIN_DIR, { recursive: true });
    await cp(sourceDir, BIN_DIR, { recursive: true });
  }
  return { pgCtl: join(BIN_DIR, 'bin', 'pg_ctl.exe'), initdb: join(BIN_DIR, 'bin', 'initdb.exe') };
}

/**
 * Runs a bin/*.exe to completion with no console window, returning its exit
 * code and output.
 *
 * Resolves on `exit` rather than `close` deliberately. `close` waits for the
 * child's stdio streams to close too — but `pg_ctl start` leaves behind a
 * postmaster that inherits those same pipe handles and holds them open for
 * its entire lifetime, so `close` would never fire even though `pg_ctl`
 * itself exited seconds ago. `exit` reflects the process we actually
 * launched, which is what we're waiting on.
 */
function runHidden(exePath: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(exePath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('exit', (code) => {
      // Stop reading the inherited-and-still-open pipes so this Node process
      // isn't held alive by them either.
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({ code, stdout, stderr });
    });
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }));
  });
}

async function runInitdb(initdbPath: string): Promise<void> {
  const passwordFile = join(tmpdir(), `pg-password-${randomBytes(6).toString('hex')}`);
  await writeFile(passwordFile, `${PG_PASSWORD}\n`);

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        initdbPath,
        [
          `--pgdata=${DATA_DIR}`,
          `--auth=password`,
          `--username=${PG_USER}`,
          `--pwfile=${passwordFile}`,
          `--lc-messages=C`,
          // Force UTF8 + the portable "C" locale regardless of the host OS's
          // locale — schema.sql stores Thai text, and initdb otherwise infers
          // an encoding from the Windows locale (e.g. WIN1252 on a Thai
          // Windows install) that can't represent it at all.
          `--encoding=UTF8`,
          `--locale=C`,
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      );

      let stderrOutput = '';
      child.stdout?.on('data', (chunk) => console.log(`[initdb] ${chunk.toString('utf-8').trim()}`));
      child.stderr?.on('data', (chunk) => {
        stderrOutput += chunk.toString('utf-8');
      });
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`initdb failed (code ${code}): ${stderrOutput}`));
      });
    });
  } finally {
    await unlink(passwordFile).catch(() => undefined);
  }
}

/**
 * Starts Postgres in the background via `pg_ctl`, PostgreSQL's own process
 * manager, and waits for it to accept connections.
 *
 * Using `pg_ctl` rather than spawning `postgres.exe` directly is what makes
 * this window-free on Windows. Spawning the server directly forces an
 * unwinnable choice: the server has to outlive this Node process (`npm run
 * dev` restarts it on every file save), which needs `detached: true` →
 * Win32 `DETACHED_PROCESS`, and Microsoft documents that flag as mutually
 * exclusive with `CREATE_NO_WINDOW` (`windowsHide`) — Node keeps the former
 * and silently drops the latter, so a console window always appears.
 *
 * `pg_ctl` sidesteps the conflict entirely: detaching the server is its own
 * job (it's how Postgres is started as a background service on Windows),
 * and it exits as soon as the server is up. So it can be spawned as an
 * ordinary short-lived child with `windowsHide: true` and no `detached` —
 * no window, and the server it leaves behind still outlives us.
 *
 * It also removes a whole class of failure the manual spawn had: `pg_ctl`
 * refuses to start a second server against a data directory that already
 * has one, instead of racing it and leaving orphaned processes behind.
 */
async function startPostgresViaPgCtl(pgCtlPath: string): Promise<void> {
  const result = await runHidden(pgCtlPath, [
    'start',
    '-D', DATA_DIR,
    '-l', LOG_FILE,
    '-o', `-p ${PORT}`,
    // Wait for startup to actually complete rather than returning
    // optimistically, and cap that wait (recovery from an unclean shutdown
    // is slower than a clean start, so leave real room).
    '-w',
    '-t', '45',
  ]);

  if (result.code !== 0) {
    // "already running" is success for our purposes — some other dev
    // process got there first, which is exactly what we want to reuse.
    const output = `${result.stdout}${result.stderr}`;
    if (!/already running/i.test(output)) {
      throw new Error(`pg_ctl start failed (code ${result.code}): ${output.trim() || `see ${LOG_FILE}`}`);
    }
  }

  // pg_ctl -w reports the postmaster is up; confirm we can actually
  // authenticate and run a query before handing the URL to the app.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await canConnect()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Postgres started but is not accepting connections — check ${LOG_FILE}`);
}

export async function startEmbeddedPostgres(): Promise<string> {
  if (await canConnect()) {
    return embeddedDatabaseUrl();
  }

  await mkdir(CACHE_ROOT, { recursive: true });
  const { pgCtl, initdb } = await ensureBinariesCopied();

  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) {
    console.log('[embedded-postgres] initialising a local Postgres cluster (first run only)...');
    await runInitdb(initdb);
  }

  console.log('[embedded-postgres] starting (runs in the background — safe to leave running across restarts)...');
  await startPostgresViaPgCtl(pgCtl);

  if (!(await canConnect(DB_NAME))) {
    const client = new pg.Client({ user: PG_USER, password: PG_PASSWORD, port: PORT, host: '127.0.0.1', database: 'postgres' });
    await client.connect();
    await client.query(`CREATE DATABASE ${client.escapeIdentifier(DB_NAME)}`);
    await client.end();
  }

  console.log(`[embedded-postgres] ready at ${embeddedDatabaseUrl()}`);
  return embeddedDatabaseUrl();
}

/**
 * Stops the background Postgres instance, if one is running. Not called
 * automatically — the server is meant to outlive individual `npm run dev`
 * restarts — but exposed as `npm run stop:db -w apps/api`.
 *
 * Goes through `pg_ctl stop` rather than killing `postgres.exe` processes:
 * it's a clean shutdown (flushes buffers, removes the lock file) instead of
 * leaving the data directory looking crash-damaged, so the next start
 * doesn't have to run crash recovery. It's also correctly scoped — it stops
 * only the server for *this* data directory, and can't touch an unrelated
 * PostgreSQL install that happens to be on the same machine.
 */
export async function stopEmbeddedPostgres(): Promise<void> {
  if (platform() !== 'win32') return;
  if (!existsSync(join(DATA_DIR, 'postmaster.pid'))) {
    console.log('[embedded-postgres] not running');
    return;
  }
  const { pgCtl } = await ensureBinariesCopied();
  // -m fast: disconnect clients and shut down promptly, but still cleanly
  // (the default "smart" mode waits indefinitely for clients to disconnect).
  const result = await runHidden(pgCtl, ['stop', '-D', DATA_DIR, '-m', 'fast', '-w', '-t', '30']);
  if (result.code !== 0) {
    console.error(`[embedded-postgres] stop failed: ${`${result.stdout}${result.stderr}`.trim()}`);
    return;
  }
  console.log('[embedded-postgres] stopped');
}
