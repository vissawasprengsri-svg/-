import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The integration suites share one real Postgres instance and the same
    // seeded dev user/account across files (there's no per-file database
    // sandbox), so running test files in parallel causes them to race on
    // the same account balance. Sequential file execution keeps each
    // suite's before/after state deterministic; the pure unit test files
    // are fast enough that this costs nothing noticeable.
    fileParallelism: false,
    // Runs before the suites import ../src/db/pool.js, which reads
    // DATABASE_URL once at module load — see test/setup.ts.
    setupFiles: ['./test/setup.ts'],
  },
});
