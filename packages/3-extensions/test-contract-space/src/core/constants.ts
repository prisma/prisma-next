/**
 * Static names used by the synthetic test extension's contract space.
 *
 * Kept as a small public constants module so consuming tests
 * (`packages/3-extensions/test-contract-space/test/descriptor.test.ts`,
 * the SQLite per-space CLI test, and any future fixtures referencing
 * the synthetic space) can import the canonical id without depending
 * on the descriptor's full module graph.
 */

export const TEST_SPACE_ID = 'test-contract-space';

export const TEST_BOX_TABLE = 'test_box';
