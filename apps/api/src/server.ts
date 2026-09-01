import 'dotenv/config';

async function main(): Promise<void> {
  const { ensureDatabaseUrl } = await import('./db/bootstrap.js');
  await ensureDatabaseUrl();

  const { pool } = await import('./db/pool.js');
  const { runMigrations } = await import('./db/migrate.js');
  await runMigrations(pool);

  const { createApp } = await import('./app.js');
  const port = Number(process.env.PORT ?? 4000);
  createApp().listen(port, () => {
    console.log(`api listening on http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
