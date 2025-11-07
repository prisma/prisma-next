const BASE_TIMEOUTS = {
  spinUpPpgDev: 10000,
  typeScriptCompilation: 8000,
  default: 100,
} as const;

const multiplier = Number.parseFloat(process.env['TEST_TIMEOUT_MULTIPLIER'] || '1') || 1;

/**
 * Centralized test timeout values with environment variable support.
 * Provides semantic timeout values for different test scenarios.
 *
 * Uses a single TEST_TIMEOUT_MULTIPLIER environment variable to scale all timeouts.
 *
 * @example
 * ```typescript
 * import { spinUpPpgDev, typeScriptCompilation } from '@prisma-next/test-utils';
 *
 * describe('my test', { timeout: spinUpPpgDev }, () => {
 *   // ...
 * });
 *
 * beforeEach(async () => {
 *   // setup that needs ppg-dev
 * }, spinUpPpgDev);
 *
 * it('compiles TypeScript', async () => {
 *   // test that runs tsc
 * }, typeScriptCompilation);
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
  spinUpPpgDev: Math.round(BASE_TIMEOUTS.spinUpPpgDev * multiplier),
  /**
   * Timeout for tests that perform TypeScript compilation.
   * This includes running tsc to verify type checking and import resolution.
   */
  typeScriptCompilation: Math.round(BASE_TIMEOUTS.typeScriptCompilation * multiplier),

  /**
   * Default timeout for general tests that don't fit into specific categories.
   */
  default: Math.round(BASE_TIMEOUTS.default * multiplier),
} as const;
