import { createContract } from '@prisma-next/contract/testing';
import type { Contract } from '@prisma-next/contract/types';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { computeMigrationId } from '../src/attestation';
import { writeMigrationPackage } from '../src/io';
import type { MigrationBundle, MigrationManifest, MigrationOps } from '../src/types';

export function createTestContract(overrides: Partial<Contract> = {}): Contract {
  return createContract(overrides);
}

/**
 * Build a fully-attested test manifest. By default the `migrationId` is
 * computed over `(manifest, [])` so the bundle is internally consistent
 * for `verifyMigrationBundle`. Pass `ops` when the test cares about
 * matching a specific op list.
 */
export function createTestManifest(
  overrides: Partial<MigrationManifest> = {},
  ops: MigrationOps = [],
): MigrationManifest {
  const toContract = overrides.toContract ?? createTestContract();
  const baseManifest: Omit<MigrationManifest, 'migrationId'> = {
    from: 'sha256:empty',
    to: 'sha256:abc123',
    kind: 'regular',
    fromContract: null,
    toContract,
    hints: {
      used: [],
      applied: ['additive_only'],
      plannerVersion: '0.0.1',
    },
    labels: [],
    createdAt: '2026-02-25T14:30:00.000Z',
    ...overrides,
  };
  return {
    ...baseManifest,
    migrationId: overrides.migrationId ?? computeMigrationId(baseManifest, ops),
  };
}

/**
 * Backwards-compatible alias for tests written before the draft state was
 * collapsed. Manifests are now always attested, so this is the same as
 * `createTestManifest`.
 */
export const createAttestedManifest = createTestManifest;

/**
 * Build an attested test bundle (manifest + ops + dir metadata) with a
 * `migrationId` computed over the supplied ops.
 */
export function createAttestedBundle(
  dirName: string,
  manifestOverrides: Partial<MigrationManifest> = {},
  ops: MigrationOps = createTestOps(),
): MigrationBundle {
  return {
    dirName,
    dirPath: `/tmp/migrations/${dirName}`,
    manifest: createTestManifest(manifestOverrides, ops),
    ops,
  };
}

export function createTestOps(): readonly MigrationPlanOperation[] {
  return [
    {
      id: 'table.users',
      label: 'Create table users',
      operationClass: 'additive',
    },
  ];
}

/**
 * Build and write a fully-attested test package to disk. The `migrationId`
 * is computed over the same `ops` passed to the writer, so the resulting
 * package round-trips through `readMigrationPackage`'s integrity check.
 *
 * Use this for happy-path tests. Tests that deliberately produce a corrupt
 * bundle (tampering tests) should call `createTestManifest` and
 * `writeMigrationPackage` directly so the corruption step is explicit.
 */
export async function writeAttestedTestPackage(
  dir: string,
  manifestOverrides: Partial<MigrationManifest> = {},
  ops: MigrationOps = createTestOps(),
): Promise<{ manifest: MigrationManifest; ops: MigrationOps }> {
  const manifest = createTestManifest(manifestOverrides, ops);
  await writeMigrationPackage(dir, manifest, ops);
  return { manifest, ops };
}
