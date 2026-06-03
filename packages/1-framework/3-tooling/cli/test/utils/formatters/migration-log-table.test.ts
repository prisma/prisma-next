import type { LedgerEntryRecord } from '@prisma-next/contract/types';
import { bold, cyan, cyanBright, dim } from 'colorette';
import { describe, expect, it } from 'vitest';
import {
  MIGRATION_LIST_EMPTY_SOURCE,
  MIGRATION_LIST_FORWARD_EDGE_GLYPH,
} from '../../../src/utils/formatters/migration-list-data-column';
import { createAnsiMigrationListStyler } from '../../../src/utils/formatters/migration-list-styler';
import {
  formatLedgerAppliedAt,
  renderMigrationLogTable,
  serializeLedgerEntriesForJson,
  sortLedgerEntries,
} from '../../../src/utils/formatters/migration-log-table';

function entry(
  overrides: Partial<LedgerEntryRecord> & Pick<LedgerEntryRecord, 'migrationName'>,
): LedgerEntryRecord {
  return {
    space: 'app',
    migrationHash: 'sha256:abc',
    from: null,
    to: 'sha256:dest',
    appliedAt: new Date('2026-06-01T08:00:00.000Z'),
    operationCount: 1,
    ...overrides,
  };
}

describe('sortLedgerEntries', () => {
  it('orders by appliedAt ascending with space and migrationName tie-break', () => {
    const sameTime = new Date('2026-06-01T08:00:00.000Z');
    const sorted = sortLedgerEntries([
      entry({ space: 'audit', migrationName: '002_b', appliedAt: sameTime }),
      entry({ space: 'app', migrationName: '002_b', appliedAt: sameTime }),
      entry({ space: 'app', migrationName: '001_a', appliedAt: sameTime }),
      entry({ migrationName: '003_c', appliedAt: new Date('2026-06-02T08:00:00.000Z') }),
    ]);
    expect(sorted.map((e) => [e.space, e.migrationName])).toEqual([
      ['app', '001_a'],
      ['app', '002_b'],
      ['audit', '002_b'],
      ['app', '003_c'],
    ]);
  });
});

describe('formatLedgerAppliedAt', () => {
  const date = new Date('2026-06-01T08:00:00.000Z');

  it('formats ISO-UTC for machine output', () => {
    expect(formatLedgerAppliedAt(date, 'iso')).toBe('2026-06-01T08:00:00.000Z');
  });

  it('formats UTC human output with Z suffix', () => {
    expect(formatLedgerAppliedAt(date, 'utc')).toBe('2026-06-01 08:00:00Z');
  });

  it('formats local output with numeric offset', () => {
    const formatted = formatLedgerAppliedAt(date, 'local');
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}$/);
  });
});

describe('renderMigrationLogTable', () => {
  it('omits the space column for a single space', () => {
    const table = renderMigrationLogTable([
      entry({
        migrationName: '20260301_init',
        from: null,
        to: 'sha256:ef9de27abc',
        operationCount: 5,
        appliedAt: new Date('2026-06-01T08:00:00.000Z'),
      }),
    ]);
    expect(table).not.toContain('app');
    expect(table).toContain('20260301_init');
    expect(table).toContain('∅ → ef9de27');
    expect(table).toContain('5 ops');
  });

  it('includes the space column when multiple spaces contribute rows', () => {
    const table = renderMigrationLogTable([
      entry({
        space: 'app',
        migrationName: '20260301_init',
        appliedAt: new Date('2026-06-01T08:00:00.000Z'),
      }),
      entry({
        space: 'audit',
        migrationName: '20260301_init',
        appliedAt: new Date('2026-06-01T08:00:00.002Z'),
      }),
    ]);
    expect(table).toContain('app');
    expect(table).toContain('audit');
  });

  it('returns an empty string for no entries', () => {
    expect(renderMigrationLogTable([])).toBe('');
  });

  it('uses UTC timestamps when utc is true', () => {
    const table = renderMigrationLogTable(
      [entry({ migrationName: '20260301_init', appliedAt: new Date('2026-06-01T08:00:00.000Z') })],
      { utc: true },
    );
    expect(table).toContain('2026-06-01 08:00:00Z');
  });
});

describe('renderMigrationLogTable with ANSI styler', () => {
  it('applies the shared migration family palette to each column token', () => {
    const table = renderMigrationLogTable(
      [
        entry({
          migrationName: '20260603T0915_migration',
          from: 'sha256:4cb4256abcdef',
          to: 'sha256:ef9de27abcdef',
          operationCount: 3,
          appliedAt: new Date('2026-06-03T09:15:00.000Z'),
        }),
      ],
      { utc: true, styler: createAnsiMigrationListStyler({ useColor: true }) },
    );
    expect(table).toContain(bold('20260603T0915_migration'));
    expect(table).toContain(dim(cyan('4cb4256')));
    expect(table).toContain(dim(MIGRATION_LIST_FORWARD_EDGE_GLYPH));
    expect(table).toContain(cyanBright('ef9de27'));
    expect(table).toContain(dim('3 ops'));
    expect(table).toContain(dim('2026-06-03 09:15:00Z'));
  });

  it('styles the empty source glyph and space column with summary dim', () => {
    const table = renderMigrationLogTable(
      [
        entry({
          space: 'app',
          migrationName: '20260301_init',
          from: null,
          to: 'sha256:ef9de27abc',
          appliedAt: new Date('2026-06-01T08:00:00.000Z'),
        }),
        entry({
          space: 'audit',
          migrationName: '20260302_audit',
          from: null,
          to: 'sha256:aaaaaaaaaaa',
          appliedAt: new Date('2026-06-01T08:00:00.002Z'),
        }),
      ],
      { utc: true, styler: createAnsiMigrationListStyler({ useColor: true }) },
    );
    expect(table).toContain(dim(MIGRATION_LIST_EMPTY_SOURCE));
    expect(table).toContain(dim('app'));
    expect(table).toContain(dim('audit'));
  });
});

describe('serializeLedgerEntriesForJson', () => {
  it('emits ISO-UTC appliedAt strings sorted ascending', () => {
    const json = serializeLedgerEntriesForJson([
      entry({
        migrationName: '002_later',
        appliedAt: new Date('2026-06-02T08:00:00.000Z'),
      }),
      entry({
        migrationName: '001_first',
        appliedAt: new Date('2026-06-01T08:00:00.000Z'),
      }),
    ]);
    expect(json).toHaveLength(2);
    expect(json[0]!.migrationName).toBe('001_first');
    expect(json[0]!.appliedAt).toBe('2026-06-01T08:00:00.000Z');
    expect(json[1]!.appliedAt).toBe('2026-06-02T08:00:00.000Z');
  });
});
