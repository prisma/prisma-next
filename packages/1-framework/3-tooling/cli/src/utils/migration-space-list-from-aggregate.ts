import type { ContractSpaceAggregate } from '@prisma-next/migration-tools/aggregate';
import type {
  MigrationListEntry,
  MigrationSpaceListEntry,
} from '@prisma-next/migration-tools/migration-list-types';
import { refsByContractHash } from '@prisma-next/migration-tools/refs';
import {
  APP_SPACE_ID,
  isValidSpaceId,
  listContractSpaceDirectories,
  RESERVED_SPACE_SUBDIR_NAMES,
} from '@prisma-next/migration-tools/spaces';

function compareSpaceIds(a: string, b: string): number {
  if (a === APP_SPACE_ID) return b === APP_SPACE_ID ? 0 : -1;
  if (b === APP_SPACE_ID) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareDirNamesDescending(a: MigrationListEntry, b: MigrationListEntry): number {
  if (a.dirName < b.dirName) return 1;
  if (a.dirName > b.dirName) return -1;
  return 0;
}

async function orderedOnDiskSpaceIds(projectMigrationsDir: string): Promise<readonly string[]> {
  const candidateDirs = await listContractSpaceDirectories(projectMigrationsDir);
  return candidateDirs
    .filter((name) => !RESERVED_SPACE_SUBDIR_NAMES.has(name))
    .filter(isValidSpaceId)
    .sort(compareSpaceIds);
}

/**
 * Maps a loaded {@link ContractSpaceAggregate} to the render-ready
 * {@link MigrationSpaceListEntry} shape `migration list` consumes.
 *
 * Space membership matches the former list enumerator: only on-disk
 * contract-space directories (not the aggregate's always-present app member
 * when `migrations/app/` is absent). Package and ref data come from
 * `aggregate.space(id)`.
 */
export async function migrationSpaceListEntriesFromAggregate(
  aggregate: ContractSpaceAggregate,
  projectMigrationsDir: string,
): Promise<readonly MigrationSpaceListEntry[]> {
  const spaceIds = await orderedOnDiskSpaceIds(projectMigrationsDir);
  const spaces: MigrationSpaceListEntry[] = [];

  for (const spaceId of spaceIds) {
    const member = aggregate.space(spaceId);
    if (member === undefined) {
      continue;
    }
    const refsByHash = refsByContractHash(member.refs);
    const migrations: MigrationListEntry[] = member.packages
      .map((pkg) => ({
        dirName: pkg.dirName,
        from: pkg.metadata.from,
        to: pkg.metadata.to,
        migrationHash: pkg.metadata.migrationHash,
        operationCount: pkg.ops.length,
        createdAt: pkg.metadata.createdAt,
        refs: refsByHash.get(pkg.metadata.to) ?? [],
        providedInvariants: pkg.metadata.providedInvariants,
      }))
      .sort(compareDirNamesDescending);

    spaces.push({ spaceId, migrations });
  }

  return spaces;
}
