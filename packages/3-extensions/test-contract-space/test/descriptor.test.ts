import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import {
  TEST_BASELINE_INVARIANT_ID,
  TEST_BASELINE_MIGRATION_NAME,
  TEST_BOX_TABLE,
  TEST_HEAD_HASH,
  TEST_SPACE_ID,
} from '../src/core/constants';
import testContractSpaceExtensionDescriptor from '../src/exports/control';

describe('test-contract-space descriptor', () => {
  it('identifies as a SQL extension targeted at postgres', () => {
    expect(testContractSpaceExtensionDescriptor).toMatchObject({
      kind: 'extension',
      id: TEST_SPACE_ID,
      familyId: 'sql',
      targetId: 'postgres',
    });
  });

  it('exposes a contractSpace whose contract declares the test_box table', () => {
    const space = testContractSpaceExtensionDescriptor.contractSpace;
    expect(space).toBeDefined();
    expect(Object.keys(space!.contractJson.storage.tables)).toEqual([TEST_BOX_TABLE]);
  });

  it('publishes one baseline migration that establishes the head invariant', () => {
    const space = testContractSpaceExtensionDescriptor.contractSpace!;
    expect(space.migrations).toHaveLength(1);
    const baseline = space.migrations[0]!;
    expect(baseline.dirName).toBe(TEST_BASELINE_MIGRATION_NAME);
    expect(baseline.metadata.providedInvariants).toEqual([TEST_BASELINE_INVARIANT_ID]);
    const opIds = baseline.ops.map((op: MigrationPlanOperation) => op.invariantId);
    expect(opIds).toContain(TEST_BASELINE_INVARIANT_ID);
  });

  it('points the head ref at the baseline-applied state', () => {
    const headRef = testContractSpaceExtensionDescriptor.contractSpace!.headRef;
    expect(headRef).toEqual({
      hash: TEST_HEAD_HASH,
      invariants: [TEST_BASELINE_INVARIANT_ID],
    });
  });
});
