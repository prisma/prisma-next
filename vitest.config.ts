import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/**/vitest.config.ts'],
    // Hard-suppress telemetry across every package test suite. The CLI's
    // `program.hook('preAction', …)` would otherwise fork the sender
    // child every time a test invokes the CLI in-process.
    // `PRISMA_NEXT_DISABLE_TELEMETRY=1` is the documented opt-out the CLI
    // honours in production; reusing it in test env keeps a single source
    // of truth instead of adding a test-only env var.
    env: {
      PRISMA_NEXT_DISABLE_TELEMETRY: '1',
    },
  },
});
