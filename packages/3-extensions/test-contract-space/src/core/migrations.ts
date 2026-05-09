import type { ExtensionContractRef } from '@prisma-next/family-sql/control';
import type { MigrationPackage } from '@prisma-next/migration-tools/package';
import {
  TEST_BASELINE_INVARIANT_ID,
  TEST_BASELINE_MIGRATION_NAME,
  TEST_BOX_TABLE,
} from './constants';
import { TEST_HEAD_HASH, testContractSpaceContract } from './contract';

const baselineMetadata = {
  migrationHash: 'synthetic-test-contract-space-baseline-hash-v1',
  from: null,
  to: TEST_HEAD_HASH,
  fromContract: null,
  toContract: testContractSpaceContract,
  hints: { used: [], applied: [], plannerVersion: '2.0.0' },
  labels: [],
  providedInvariants: [TEST_BASELINE_INVARIANT_ID],
  createdAt: '2026-01-01T00:00:00.000Z',
} as const satisfies MigrationPackage['metadata'];

/**
 * Single baseline migration: creates the `test_box` table from the empty
 * schema. The op carries the same `invariantId` declared in the head ref,
 * so a runner that walks this migration graph from a fresh marker reaches
 * the head ref in one step.
 *
 * NOTE: this in-memory authoring shape is transitional — M3.5 R1 rebuilds
 * the package as the on-disk-in-package reference model. `dirPath` is
 * set to a synthetic relative value so the type unification (M3.5 R1)
 * goes through cleanly while the rebuild lands.
 */
export const testContractSpaceBaselineMigration: MigrationPackage = {
  dirName: TEST_BASELINE_MIGRATION_NAME,
  dirPath: TEST_BASELINE_MIGRATION_NAME,
  metadata: baselineMetadata,
  ops: [
    {
      id: `${TEST_BOX_TABLE}.create`,
      label: `Create table "${TEST_BOX_TABLE}"`,
      operationClass: 'additive',
      invariantId: TEST_BASELINE_INVARIANT_ID,
    },
  ],
};

export const testContractSpaceHeadRef: ExtensionContractRef = {
  hash: TEST_HEAD_HASH,
  invariants: [TEST_BASELINE_INVARIANT_ID],
};
