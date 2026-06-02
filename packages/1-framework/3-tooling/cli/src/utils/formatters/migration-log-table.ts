import type { LedgerEntryRecord } from '@prisma-next/contract/types';
import {
  abbreviateContractHash,
  MIGRATION_LIST_EMPTY_SOURCE,
  MIGRATION_LIST_FORWARD_EDGE_GLYPH,
} from './migration-list-data-column';

export type LedgerTimestampMode = 'local' | 'utc' | 'iso';

export interface RenderMigrationLogTableOptions {
  readonly utc?: boolean;
}

export interface SerializedLedgerEntryRecord {
  readonly space: string;
  readonly migrationName: string;
  readonly migrationHash: string;
  readonly from: string | null;
  readonly to: string;
  readonly appliedAt: string;
  readonly operationCount: number;
}

export function sortLedgerEntries(entries: readonly LedgerEntryRecord[]): LedgerEntryRecord[] {
  return [...entries].sort((left, right) => {
    const timeDiff = left.appliedAt.getTime() - right.appliedAt.getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    const spaceDiff = left.space.localeCompare(right.space);
    if (spaceDiff !== 0) {
      return spaceDiff;
    }
    return left.migrationName.localeCompare(right.migrationName);
  });
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatLedgerAppliedAt(date: Date, mode: LedgerTimestampMode): string {
  if (mode === 'iso') {
    return date.toISOString();
  }
  if (mode === 'utc') {
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}Z`;
  }
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = pad2(Math.floor(absoluteOffset / 60));
  const offsetMins = pad2(absoluteOffset % 60);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} ${sign}${offsetHours}:${offsetMins}`;
}

function formatHashEndpoint(hash: string | null): string {
  if (hash === null) {
    return MIGRATION_LIST_EMPTY_SOURCE;
  }
  return abbreviateContractHash(hash);
}

function formatHashTransition(from: string | null, to: string): string {
  return `${formatHashEndpoint(from)} ${MIGRATION_LIST_FORWARD_EDGE_GLYPH} ${abbreviateContractHash(to)}`;
}

function columnWidth(values: readonly string[]): number {
  return values.reduce((max, value) => Math.max(max, value.length), 0);
}

export function renderMigrationLogTable(
  entries: readonly LedgerEntryRecord[],
  options: RenderMigrationLogTableOptions = {},
): string {
  const sorted = sortLedgerEntries(entries);
  if (sorted.length === 0) {
    return '';
  }

  const showSpace = new Set(sorted.map((entry) => entry.space)).size > 1;
  const timestampMode: LedgerTimestampMode = options.utc ? 'utc' : 'local';
  const rows = sorted.map((entry) => ({
    appliedAt: formatLedgerAppliedAt(entry.appliedAt, timestampMode),
    space: entry.space,
    migrationName: entry.migrationName,
    transition: formatHashTransition(entry.from, entry.to),
    ops: `${entry.operationCount} ops`,
  }));

  const appliedAtWidth = columnWidth(rows.map((row) => row.appliedAt));
  const spaceWidth = showSpace ? columnWidth(rows.map((row) => row.space)) : 0;
  const nameWidth = columnWidth(rows.map((row) => row.migrationName));
  const transitionWidth = columnWidth(rows.map((row) => row.transition));
  const opsWidth = columnWidth(rows.map((row) => row.ops));

  return rows
    .map((row) => {
      const parts = [row.appliedAt.padEnd(appliedAtWidth)];
      if (showSpace) {
        parts.push(row.space.padEnd(spaceWidth));
      }
      parts.push(
        row.migrationName.padEnd(nameWidth),
        row.transition.padEnd(transitionWidth),
        row.ops.padStart(opsWidth),
      );
      return parts.join('   ');
    })
    .join('\n');
}

export function serializeLedgerEntriesForJson(
  entries: readonly LedgerEntryRecord[],
): SerializedLedgerEntryRecord[] {
  return sortLedgerEntries(entries).map(({ appliedAt, ...rest }) => ({
    ...rest,
    appliedAt: formatLedgerAppliedAt(appliedAt, 'iso'),
  }));
}

export const MIGRATION_LOG_EMPTY_MESSAGE = 'No migrations have been applied to this database.';
