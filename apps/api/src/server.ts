import 'dotenv/config';

// Every real deployment (Docker, systemd, PM2, Render, etc.) sets NODE_ENV=production
// explicitly — this default only affects a plain `node dist/server.js` run with no env
// configured, so it fails toward the dev auth bypass being *visible* (see context.ts's
// startup warning) rather than toward a silent, unintended bypass in a real deployment.
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'development';

// Belt-and-braces on top of context.ts's own NODE_ENV check: that check already
// makes the flag inert in production, but inert-and-silent is still a footgun —
// someone who sets ENABLE_DEV_AUTH_BYPASS=true on a production host has clearly
// made a mistake somewhere, and finding out from a crashed deploy with this
// exact message is a lot faster than finding out from an incident report.
if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEV_AUTH_BYPASS === 'true') {
  console.error(
    '\nFATAL: ENABLE_DEV_AUTH_BYPASS=true with NODE_ENV=production. Refusing to start.\n' +
      'Remove ENABLE_DEV_AUTH_BYPASS from this environment — it must never be set outside local development.\n'
  );
  process.exit(1);
}

// Browsers silently drop a `SameSite=None` cookie that isn't also `Secure` —
// the session cookie would just never get set, and login would look broken
// with nothing in the response to explain why. Catching the combination here
// turns that into a startup error instead of a support conversation.
if (process.env.CROSS_ORIGIN_COOKIES === 'true' && process.env.COOKIE_SECURE !== 'true') {
  console.error(
    '\nFATAL: CROSS_ORIGIN_COOKIES=true requires COOKIE_SECURE=true (a `SameSite=None` cookie ' +
      'without `Secure` is rejected by every modern browser). Set COOKIE_SECURE=true — this also ' +
      'requires the API actually being served over HTTPS, which every mainstream host does by default.\n'
  );
  process.exit(1);
}

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
