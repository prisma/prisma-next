import { createContract } from '@prisma-next/contract/testing';
import type { Contract } from '@prisma-next/contract/types';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { computeMigrationHash } from '../src/hash';
import { writeMigrationPackage } from '../src/io';
import type { MigrationMetadata } from '../src/metadata';
import type { MigrationOps, MigrationPackage } from '../src/package';

export function createTestContract(overrides: Partial<Contract> = {}): Contract {
  return createContract(overrides);
}

/**
 * Build fully-attested test metadata. By default the `migrationHash` is
 * computed over `(metadata, [])` so the package is internally consistent
 * for `verifyMigrationHash`. Pass `ops` when the test cares about
 * matching a specific op list.
 */
export function createTestMetadata(
  overrides: Partial<MigrationMetadata> = {},
  ops: MigrationOps = [],
): MigrationMetadata {
  const toContract = overrides.toContract ?? createTestContract();
  const baseMetadata: Omit<MigrationMetadata, 'migrationHash'> = {
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
    ...baseMetadata,
    migrationHash: overrides.migrationHash ?? computeMigrationHash(baseMetadata, ops),
  };
}

/**
 * Build an attested test package (metadata + ops + dir info) with a
 * `migrationHash` computed over the supplied ops.
 */
export function createAttestedPackage(
  dirName: string,
  metadataOverrides: Omit<Partial<MigrationMetadata>, 'migrationHash'> = {},
  ops: MigrationOps = createTestOps(),
): MigrationPackage {
  return {
    dirName,
    dirPath: `/tmp/migrations/${dirName}`,
    metadata: createTestMetadata(metadataOverrides, ops),
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
 * Canonical helper for writing a test migration package to disk. Always
 * produces a *consistent* (attested) package: the `migrationHash` is
 * computed over the exact `ops` passed to the writer, so the resulting
 * package round-trips through `readMigrationPackage`'s integrity check.
 *
 * Tampering tests use this same helper and then surgically overwrite the
 * offending file post-hoc (e.g. `fs.writeFile(join(dir, 'ops.json'), ...)`).
 * That keeps the corruption visible (the test names exactly which file is
 * being corrupted) and makes the package's initial state incontrovertibly
 * consistent — there is no path that produces an inconsistent fixture by
 * accident.
 */
export async function writeTestPackage(
  dir: string,
  metadataOverrides: Omit<Partial<MigrationMetadata>, 'migrationHash'> = {},
  ops: MigrationOps = createTestOps(),
): Promise<{ metadata: MigrationMetadata; ops: MigrationOps }> {
  const metadata = createTestMetadata(metadataOverrides, ops);
  await writeMigrationPackage(dir, metadata, ops);
  return { metadata, ops };
}
