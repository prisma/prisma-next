import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    globalSetup: ['./test/e2e/global-setup.ts'],
    environment: 'node',
    pool: 'threads',
    // Single worker, no isolation, no parallelism: every test file shares
    // a single postgres client connection (via the harness's
    // `ensureConnected` memo) and a single CipherStash SDK encryption
    // client. Pre-emptive serialisation also keeps SDK rate-limits from
    // surfacing under concurrent envelope encrypts across files.
    maxWorkers: 1,
    isolate: false,
    fileParallelism: false,
    // Live SDK round-trips + per-file connect + migration apply (the
    // first run on a cold container) need the long fuse.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
