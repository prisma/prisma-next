import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { parseGlobalFlags } from '../src/utils/global-flags';
import {
  formatMigrationApplyCommandOutput,
  formatMigrationVerifyCommandOutput,
} from '../src/utils/output';

describe('formatMigrationApplyCommandOutput', () => {
  it('formats no-op apply output', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationApplyCommandOutput(
      {
        migrationsApplied: 0,
        markerHash: 'sha256:marker',
        applied: [],
        summary: 'Already up to date',
      },
      flags,
    );

    expect(stripAnsi(output)).toContain('Already up to date');
    expect(stripAnsi(output)).toContain('marker: sha256:marker');
  });

  it('formats applied migrations as a tree', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationApplyCommandOutput(
      {
        migrationsApplied: 2,
        markerHash: 'sha256:marker',
        applied: [
          { dirName: '20260101T1200_first', operationsExecuted: 1 },
          { dirName: '20260102T1200_second', operationsExecuted: 2 },
        ],
        summary: 'Applied 2 migration(s)',
      },
      flags,
    );

    const stripped = stripAnsi(output);
    expect(stripped).toContain('Applied 2 migration(s)');
    expect(stripped).toContain('├─ 20260101T1200_first [1 op(s)]');
    expect(stripped).toContain('└─ 20260102T1200_second [2 op(s)]');
  });

  it('includes total timing in verbose mode', () => {
    const flags = parseGlobalFlags({ verbose: true, 'no-color': true });
    const output = formatMigrationApplyCommandOutput(
      {
        migrationsApplied: 1,
        markerHash: 'sha256:marker',
        applied: [{ dirName: '20260101T1200_first', operationsExecuted: 3 }],
        summary: 'Applied 1 migration(s)',
        timings: { total: 42 },
      },
      flags,
    );

    expect(stripAnsi(output)).toContain('Total time: 42ms');
  });
});

describe('formatMigrationVerifyCommandOutput', () => {
  it('formats verified status output', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationVerifyCommandOutput(
      { status: 'verified', migrationId: 'sha256:edge' },
      flags,
    );

    const stripped = stripAnsi(output);
    expect(stripped).toContain('Migration verified');
    expect(stripped).toContain('migrationId: sha256:edge');
  });

  it('formats attested status output', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationVerifyCommandOutput(
      { status: 'attested', migrationId: 'sha256:edge' },
      flags,
    );

    const stripped = stripAnsi(output);
    expect(stripped).toContain('Draft migration attested');
    expect(stripped).toContain('migrationId: sha256:edge');
  });

  it('returns empty output in quiet mode', () => {
    const flags = parseGlobalFlags({ quiet: true, 'no-color': true });
    expect(
      formatMigrationVerifyCommandOutput({ status: 'verified', migrationId: 'sha256:edge' }, flags),
    ).toBe('');
  });
});
