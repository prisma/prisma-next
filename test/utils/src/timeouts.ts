const BASE_TIMEOUTS = {
  spinUpPpgDev: 30000,
  typeScriptCompilation: 8000,
  databaseOperation: 5000,
  default: 100,
} as const;

function getMultiplier(): number {
  return Number.parseFloat(process.env['TEST_TIMEOUT_MULTIPLIER'] || '1') || 1.0;
}

/**
 * Centralized test timeout values with environment variable support.
 * Provides semantic timeout values for different test scenarios.
 *
 * Uses a single TEST_TIMEOUT_MULTIPLIER environment variable to scale all timeouts.
 * The multiplier is read dynamically at access time, ensuring it works correctly
 * in CI environments where the environment variable is set at runtime.
 *
 * @example
 * ```typescript
 * import { spinUpPpgDev, typeScriptCompilation } from '@prisma-next/test-utils';
 *
 * describe('my test', { timeout: timeouts.spinUpPpgDev }, () => {
 *   // ...
 * });
 *
 * beforeEach(async () => {
 *   // setup that needs ppg-dev
 * }, timeouts.spinUpPpgDev);
 *
 * it('compiles TypeScript', async () => {
 *   // test that runs tsc
 * }, timeouts.typeScriptCompilation);
 * ```
 *
 * @example
 * ```bash
 * # Double all timeouts (useful for CI)
 * TEST_TIMEOUT_MULTIPLIER=2 pnpm test
 *
 * # Use default timeouts (multiplier = 1)
 * pnpm test
 * ```
 */
export const timeouts = {
  /**
   * Timeout for tests that need to spin up ppg-dev (PostgreSQL dev server).
   * This includes database initialization, connection setup, and server startup.
   */
  get spinUpPpgDev(): number {
    return Math.round(BASE_TIMEOUTS.spinUpPpgDev * getMultiplier());
  },
  /**
   * Timeout for tests that perform TypeScript compilation.
   * This includes running tsc to verify type checking and import resolution.
   */
  get typeScriptCompilation(): number {
    return Math.round(BASE_TIMEOUTS.typeScriptCompilation * getMultiplier());
  },

  /**
   * Timeout for database operations (queries, setup, teardown).
   * This includes table creation, data insertion, and cleanup.
   */
  get databaseOperation(): number {
    return Math.round(BASE_TIMEOUTS.databaseOperation * getMultiplier());
  },

  /**
   * Default timeout for general tests that don't fit into specific categories.
   */
  get default(): number {
    return Math.round(BASE_TIMEOUTS.default * getMultiplier());
  },
} as const;
