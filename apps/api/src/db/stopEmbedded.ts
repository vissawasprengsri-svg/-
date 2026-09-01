/** `npm run stop:db -w apps/api` — stops the background embedded Postgres started for local dev. */
import { stopEmbeddedPostgres } from './embedded.js';

await stopEmbeddedPostgres();
console.log('stop signal sent to the embedded Postgres instance (if one was running)');
