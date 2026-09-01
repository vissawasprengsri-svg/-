/**
 * Resolves DATABASE_URL before anything else in the app touches the DB pool.
 * If it's already set (docker-compose, a real deployment, CI), that wins —
 * this is a no-op. Otherwise, auto-starts the embedded local Postgres so
 * `npm run dev -w apps/api` works with zero manual setup.
 */
export async function ensureDatabaseUrl(): Promise<void> {
  if (process.env.DATABASE_URL) return;
  const { startEmbeddedPostgres } = await import('./embedded.js');
  process.env.DATABASE_URL = await startEmbeddedPostgres();
}
