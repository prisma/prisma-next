import type { MigrationListEntry, MigrationListResult } from '../../commands/migration-list-types';

export type {
  MigrationListEntry,
  MigrationListResult,
  MigrationSpaceListEntry,
} from '../../commands/migration-list-types';

const HASH_WIDTH = 7;
const EMPTY_SOURCE = '∅';

function abbreviateContractHash(hash: string): string {
  const stripped = hash.startsWith('sha256:') ? hash.slice(7) : hash;
  return stripped.slice(0, HASH_WIDTH);
}

function formatSourceColumn(from: string | null): string {
  if (from === null) {
    return EMPTY_SOURCE.padEnd(HASH_WIDTH, ' ');
  }
  return abbreviateContractHash(from).padEnd(HASH_WIDTH, ' ');
}

function formatDestColumn(from: string | null, to: string): string {
  if (from !== null && from === to) {
    return ' '.repeat(HASH_WIDTH);
  }
  return abbreviateContractHash(to).padEnd(HASH_WIDTH, ' ');
}

function formatArrowGlyph(from: string | null, to: string): string {
  return from !== null && from === to ? '⟲' : '→';
}

const DECORATION_PREFIX = '  ';

function formatDecorations(providedInvariants: readonly string[], refs: readonly string[]): string {
  const blocks: string[] = [];
  if (providedInvariants.length > 0) {
    blocks.push(`{${providedInvariants.join(', ')}}`);
  }
  if (refs.length > 0) {
    blocks.push(`(${refs.join(', ')})`);
  }
  if (blocks.length === 0) return '';
  return `${DECORATION_PREFIX}${blocks.join(' ')}`;
}

function formatMigrationRow(migration: MigrationListEntry, dirNameWidth: number): string {
  const dirName = migration.dirName.padEnd(dirNameWidth, ' ');
  const source = formatSourceColumn(migration.from);
  const arrow = formatArrowGlyph(migration.from, migration.to);
  const dest = formatDestColumn(migration.from, migration.to);
  const decorations = formatDecorations(migration.providedInvariants, migration.refs);
  return `${dirName}${source} ${arrow} ${dest}${decorations}`;
}

function formatEmptyStateLine(spaceId: string): string {
  return `There are no migrations in migrations/${spaceId}/ yet`;
}

function renderSpaceBlock(
  spaceId: string,
  migrations: readonly MigrationListEntry[],
  multiSpace: boolean,
): readonly string[] {
  if (migrations.length === 0) {
    const emptyLine = formatEmptyStateLine(spaceId);
    if (!multiSpace) {
      return [emptyLine];
    }
    return [`${spaceId}:`, `  ${emptyLine}`];
  }

  const dirNameWidth = Math.max(...migrations.map((entry) => entry.dirName.length)) + 2;
  const rows = migrations.map((entry) => formatMigrationRow(entry, dirNameWidth));
  if (!multiSpace) {
    return rows;
  }
  return [`${spaceId}:`, ...rows.map((row) => `  ${row}`)];
}

export function renderMigrationList(result: MigrationListResult): string {
  const multiSpace = result.spaces.length > 1;
  const lines: string[] = [];

  for (let index = 0; index < result.spaces.length; index++) {
    const space = result.spaces[index]!;
    if (index > 0) {
      lines.push('');
    }
    lines.push(...renderSpaceBlock(space.spaceId, space.migrations, multiSpace));
  }

  const totalMigrations = result.spaces.reduce(
    (count, space) => count + space.migrations.length,
    0,
  );
  if (totalMigrations > 0) {
    lines.push('');
    lines.push(result.summary);
  }

  return lines.join('\n');
}
