import type { IntegrityViolation } from '@prisma-next/migration-tools/aggregate';
import { join, relative } from 'pathe';
import type { CheckFailure } from '../commands/json/schemas';

export type { CheckFailure } from '../commands/json/schemas';

function migrationPathRelative(dirPath: string): string {
  return relative(process.cwd(), dirPath);
}

function migrationFileRelative(dirPath: string, fileName: string): string {
  return join(migrationPathRelative(dirPath), fileName);
}

/**
 * Map one {@link IntegrityViolation} onto a `migration check` failure row.
 * Sole catalogue mapping from integrity violations to `PN-MIG-CHECK-*`.
 */
export function integrityViolationToCheckFailure(
  violation: IntegrityViolation,
  migrationsDir: string,
): CheckFailure {
  const spaceRelative = (spaceId: string): string =>
    migrationPathRelative(join(migrationsDir, spaceId));
  const packageRelative = (spaceId: string, dirName: string): string =>
    migrationPathRelative(join(migrationsDir, spaceId, dirName));
  const refRelative = (spaceId: string, refName: string): string =>
    migrationPathRelative(join(migrationsDir, spaceId, 'refs', `${refName}.json`));

  switch (violation.kind) {
    case 'hashMismatch':
      return {
        space: violation.spaceId,
        code: 'PN-MIG-CHECK-001',
        where: migrationFileRelative(
          join(migrationsDir, violation.spaceId, violation.dirName),
          'migration.json',
        ),
        why: `Stored hash ${violation.stored} does not match recomputed hash ${violation.computed}`,
        fix: 'Re-emit the migration package or restore from version control.',
      };
    case 'providedInvariantsMismatch':
      return {
        space: violation.spaceId,
        code: 'PN-MIG-CHECK-002',
        where: packageRelative(violation.spaceId, violation.dirName),
        why: `Migration "${violation.dirName}" providedInvariants in migration.json disagrees with ops.json.`,
        fix: 'Re-emit the migration package so migration.json and ops.json agree.',
      };
    case 'packageUnloadable':
      return {
        space: violation.spaceId,
        code: 'PN-MIG-CHECK-002',
        where: packageRelative(violation.spaceId, violation.dirName),
        why: `Migration "${violation.dirName}" could not be loaded: ${violation.detail}`,
        fix: 'Re-emit the migration package or restore from version control.',
      };
    case 'sameSourceAndTarget':
      return {
        space: violation.spaceId,
        code: 'PN-MIG-CHECK-007',
        where: packageRelative(violation.spaceId, violation.dirName),
        why: `Migration "${violation.dirName}" in space "${violation.spaceId}" has source equal to target (${violation.hash}) with no data invariant — a true no-op self-edge.`,
        fix: 'Add a data operation if this self-edge was meant to carry a data invariant, or delete the migration if it is a true no-op.',
      };
    case 'orphanSpaceDir':
      return {
        space: violation.spaceId,
        code: 'PN-MIG-CHECK-008',
        where: spaceRelative(violation.spaceId),
        why: `Contract-space directory "${violation.spaceId}" exists on disk but no extension declares it.`,
        fix: 'Remove the orphan directory, or declare the extension in `extensionPacks`.',
      };
    case 'declaredButUnmigrated':
      return {
        space: violation.spaceId,
        code: 'PN-MIG-CHECK-009',
        where: spaceRelative(violation.spaceId),
        why: `Extension "${violation.spaceId}" is declared in \`extensionPacks\` but has no on-disk migrations directory.`,
        fix: 'Re-emit the extension contract-space artefacts with `prisma-next contract emit` and migration planning, or remove the extension from `extensionPacks` if it is unused.',
      };
    case 'headRefMissing':
      return {
        space: violation.spaceId,
        code: 'PN-MIG-CHECK-010',
        where: refRelative(violation.spaceId, 'head'),
        why: `Head ref \`refs/head.json\` is missing for contract space "${violation.spaceId}".`,
        fix: 'Re-emit the contract-space migrations and head ref artefacts, or restore `refs/head.json` from version control.',
      };
    case 'headRefNotInGraph':
      return {
        space: violation.spaceId,
        code: 'PN-MIG-CHECK-011',
        where: refRelative(violation.spaceId, 'head'),
        why: `Head ref ${violation.hash} for contract space "${violation.spaceId}" is not present in its migration graph.`,
        fix: 'Re-emit the contract space migrations, or restore the missing migration package.',
      };
    case 'refUnreadable':
      return {
        space: violation.spaceId,
        code: 'PN-MIG-CHECK-012',
        where: refRelative(violation.spaceId, violation.refName),
        why: `Ref "${violation.refName}" for contract space "${violation.spaceId}" is unreadable: ${violation.detail}`,
        fix: 'Repair or remove the corrupt ref file.',
      };
    case 'targetMismatch':
      return {
        space: violation.spaceId,
        code: 'PN-MIG-CHECK-013',
        where: spaceRelative(violation.spaceId),
        why: `Contract space "${violation.spaceId}" targets "${violation.actual}" but the project targets "${violation.expected}".`,
        fix: 'Update the extension to target the configured database, or change the project target.',
      };
    case 'disjointness':
      return {
        space: 'app',
        code: 'PN-MIG-CHECK-014',
        where: migrationPathRelative(migrationsDir),
        why: `Storage element "${violation.element}" is claimed by multiple contract spaces: ${violation.claimedBy.join(', ')}.`,
        fix: 'Update the contracts so each storage element is owned by exactly one contract space.',
      };
    case 'contractUnreadable':
      return {
        space: violation.spaceId,
        code: 'PN-MIG-CHECK-015',
        where: migrationFileRelative(join(migrationsDir, violation.spaceId), 'contract.json'),
        why: `Contract for space "${violation.spaceId}" is unreadable: ${violation.detail}`,
        fix: 'Re-emit the extension contract artefacts, or fix the descriptor producing the invalid contract.',
      };
    case 'duplicateMigrationHash':
      return {
        space: violation.spaceId,
        code: 'PN-MIG-CHECK-016',
        where: spaceRelative(violation.spaceId),
        why: `Multiple migrations in space "${violation.spaceId}" share migrationHash "${violation.migrationHash}" (${violation.dirNames.join(', ')}).`,
        fix: 'Re-emit one of the conflicting packages so each migrationHash is unique.',
      };
    case 'namespaceOwnershipCollision':
      return {
        space: 'app',
        code: 'PN-MIG-CHECK-017',
        where: migrationPathRelative(migrationsDir),
        why: `Namespace primitive "${violation.name}" (kind "${violation.primitiveKind}") in namespace "${violation.namespace}" is claimed by multiple contract spaces: ${violation.contributorSpaceIds.join(', ')}.`,
        fix: 'Update the contracts so each namespace primitive is owned by exactly one contract space.',
      };
  }
}
