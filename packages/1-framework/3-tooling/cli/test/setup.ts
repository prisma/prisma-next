/**
 * Vitest setup file for CLI package unit tests.
 *
 * Simulates an interactive terminal by setting `process.stdout.isTTY = true`.
 * Without this, vitest's forked worker process has piped stdout (isTTY is undefined),
 * which would trigger auto-JSON detection in `parseGlobalFlags()` and change the
 * behavior of unit tests that call it directly (without `setupCommandMocks`).
 *
 * Integration/journey tests use `setupCommandMocks()` which handles this independently.
 */
process.stdout.isTTY = true;
