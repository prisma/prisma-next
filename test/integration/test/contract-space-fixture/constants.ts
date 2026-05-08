/**
 * Constants describing the synthetic test extension's contract space.
 *
 * These values are placeholders authored by hand: in real extensions they
 * would come from running the framework's emit pipeline against the
 * extension's own PSL/TS schema. For a fixture whose only consumer is the
 * framework's contract-space machinery, hand-authored values are sufficient
 * — and surface the smallest possible footprint to the planner / runner /
 * verifier under test.
 *
 * The placeholder hashes use a `synthetic-` prefix so they cannot be
 * confused with content-addressed `sha256:*` hashes computed by the real
 * authoring pipeline. Round-tripping through canonicalisation is exercised
 * by integration tests in later milestones, where these values get
 * replaced by hashes the emit pipeline computes.
 */

export const TEST_SPACE_ID = 'test-contract-space';

export const TEST_BOX_TABLE = 'test_box';

export const TEST_BASELINE_INVARIANT_ID = 'test-contract-space:create-test_box-v1';

export const TEST_HEAD_HASH = 'synthetic-test-contract-space-head-v1';

export const TEST_BASELINE_MIGRATION_NAME = '20260101T0000_create_test_box';
