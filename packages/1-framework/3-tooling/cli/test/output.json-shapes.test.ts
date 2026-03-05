import { describe, expect, it } from 'vitest';
import type { MigrationApplyResult } from '../src/commands/migration-apply';
import type { MigrationStatusResult } from '../src/commands/migration-status';

describe('MigrationApplyResult JSON shape', () => {
  it('matches expected keys without pathDecision', () => {
    const result: MigrationApplyResult = {
      ok: true,
      migrationsApplied: 1,
      migrationsTotal: 1,
      markerHash: 'sha256:abc',
      applied: [{ dirName: 'm1', from: 'sha256:a', to: 'sha256:b', operationsExecuted: 2 }],
      summary: 'Applied 1 migration(s)',
      timings: { total: 42 },
    };
    expect(Object.keys(result).sort()).toMatchInlineSnapshot(`
      [
        "applied",
        "markerHash",
        "migrationsApplied",
        "migrationsTotal",
        "ok",
        "summary",
        "timings",
      ]
    `);
  });

  it('matches expected keys with pathDecision', () => {
    const result: MigrationApplyResult = {
      ok: true,
      migrationsApplied: 1,
      migrationsTotal: 1,
      markerHash: 'sha256:abc',
      applied: [{ dirName: 'm1', from: 'sha256:a', to: 'sha256:b', operationsExecuted: 2 }],
      summary: 'Applied 1 migration(s)',
      pathDecision: {
        fromHash: 'sha256:a',
        toHash: 'sha256:b',
        alternativeCount: 0,
        tieBreakReasons: [],
      },
      timings: { total: 42 },
    };
    expect(Object.keys(result).sort()).toMatchInlineSnapshot(`
      [
        "applied",
        "markerHash",
        "migrationsApplied",
        "migrationsTotal",
        "ok",
        "pathDecision",
        "summary",
        "timings",
      ]
    `);
    expect(Object.keys(result.pathDecision!).sort()).toMatchInlineSnapshot(`
      [
        "alternativeCount",
        "fromHash",
        "tieBreakReasons",
        "toHash",
      ]
    `);
  });

  it('pathDecision with ref includes refName and refHash', () => {
    const result: MigrationApplyResult = {
      ok: true,
      migrationsApplied: 1,
      migrationsTotal: 1,
      markerHash: 'sha256:abc',
      applied: [],
      summary: 'Applied',
      pathDecision: {
        fromHash: 'sha256:a',
        toHash: 'sha256:b',
        alternativeCount: 1,
        tieBreakReasons: ['at sha256:a: 2 candidates, selected by tie-break'],
        refName: 'production',
        refHash: 'sha256:b',
      },
      timings: { total: 10 },
    };
    expect(Object.keys(result.pathDecision!).sort()).toMatchInlineSnapshot(`
      [
        "alternativeCount",
        "fromHash",
        "refHash",
        "refName",
        "tieBreakReasons",
        "toHash",
      ]
    `);
  });
});

describe('MigrationStatusResult JSON shape', () => {
  it('matches expected keys in offline mode', () => {
    const result: MigrationStatusResult = {
      ok: true,
      mode: 'offline',
      migrations: [],
      leafHash: 'sha256:leaf',
      contractHash: 'sha256:contract',
      summary: '0 migration(s) on disk',
      diagnostics: [],
    };
    expect(Object.keys(result).sort()).toMatchInlineSnapshot(`
      [
        "contractHash",
        "diagnostics",
        "leafHash",
        "migrations",
        "mode",
        "ok",
        "summary",
      ]
    `);
  });

  it('matches expected keys in online mode with ref', () => {
    const result: MigrationStatusResult = {
      ok: true,
      mode: 'online',
      migrations: [],
      markerHash: 'sha256:marker',
      leafHash: 'sha256:leaf',
      contractHash: 'sha256:contract',
      refName: 'production',
      refHash: 'sha256:ref',
      pathDecision: {
        fromHash: 'sha256:marker',
        toHash: 'sha256:ref',
        alternativeCount: 0,
        tieBreakReasons: [],
        refName: 'production',
        refHash: 'sha256:ref',
      },
      summary: 'At ref "production" target',
      diagnostics: [],
    };
    expect(Object.keys(result).sort()).toMatchInlineSnapshot(`
      [
        "contractHash",
        "diagnostics",
        "leafHash",
        "markerHash",
        "migrations",
        "mode",
        "ok",
        "pathDecision",
        "refHash",
        "refName",
        "summary",
      ]
    `);
  });

  it('migration entry shape is stable', () => {
    const entry: MigrationStatusResult['migrations'][number] = {
      dirName: '20260101T1200_init',
      from: 'sha256:a',
      to: 'sha256:b',
      migrationId: 'sha256:mid',
      operationCount: 3,
      operationSummary: '3 ops (all additive)',
      hasDestructive: false,
      status: 'applied',
    };
    expect(Object.keys(entry).sort()).toMatchInlineSnapshot(`
      [
        "dirName",
        "from",
        "hasDestructive",
        "migrationId",
        "operationCount",
        "operationSummary",
        "status",
        "to",
      ]
    `);
  });
});
