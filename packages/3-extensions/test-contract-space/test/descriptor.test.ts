import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEST_BOX_TABLE, TEST_SPACE_ID } from '../src/core/constants';
import testContractSpaceExtensionDescriptor from '../src/exports/control';

/**
 * Reference-model descriptor self-tests.
 *
 * The synthetic `test-contract-space` extension is the canonical example
 * of on-disk-in-package authoring (M3.5 R1). These assertions lock down
 * the wiring: contract value comes from `contract.json`, migrations from
 * `migrations/<space-id>/<dirName>/{migration,ops}.json`, head ref from
 * `refs/head.json`. Hash-level values are sourced from the on-disk
 * artefacts rather than hand-pinned in the test, so the assertions stay
 * honest under re-emission.
 */
describe('test-contract-space descriptor (on-disk-in-package reference model)', () => {
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

  it('publishes one baseline migration sourced from the on-disk emit pipeline', () => {
    const space = testContractSpaceExtensionDescriptor.contractSpace!;
    expect(space.migrations).toHaveLength(1);
    const baseline = space.migrations[0]!;
    expect(baseline.dirName).toBe('20260101T0000_baseline');
    expect(baseline.metadata.from).toBeNull();
    expect(baseline.metadata.to).toBe(space.contractJson.storage.storageHash);
  });

  it("synthesises the migration package's `dirPath` from the descriptor's URL", () => {
    const baseline = testContractSpaceExtensionDescriptor.contractSpace!.migrations[0]!;
    expect(existsSync(baseline.dirPath)).toBe(true);
    expect(existsSync(join(baseline.dirPath, 'migration.json'))).toBe(true);
    expect(existsSync(join(baseline.dirPath, 'ops.json'))).toBe(true);
  });

  it("points the head ref at the latest migration's destination hash", () => {
    const space = testContractSpaceExtensionDescriptor.contractSpace!;
    expect(space.headRef.hash).toBe(space.migrations[0]!.metadata.to);
    expect(space.headRef.invariants).toEqual(space.migrations[0]!.metadata.providedInvariants);
  });
});
