import { describe, expect, it } from 'vitest';
import type { MigrateResult } from '../src/commands/migrate';
import type { MigrationStatusResult } from '../src/commands/migration-status';

describe('MigrateResult JSON shape (aggregate-walking)', () => {
  it('pins keys for an apply that touched both an extension and the app space', () => {
    const result: MigrateResult = {
      ok: true,
      migrationsApplied: 2,
      migrationsTotal: 2,
      markerHash: 'sha256:app',
      applied: [
        {
          spaceId: 'pgvector',
          dirName: '20250101000000_install_pgvector',
          migrationHash: 'sha256:m-ext',
          from: 'sha256:0000',
          to: 'sha256:ext',
          operationsExecuted: 1,
        },
        {
          spaceId: 'app',
          dirName: '20250101000001_init',
          migrationHash: 'sha256:m-app',
          from: 'sha256:0000',
          to: 'sha256:app',
          operationsExecuted: 3,
        },
      ],
      summary: 'Applied 4 operation(s) across 2 contract space(s)',
      perSpace: [
        {
          spaceId: 'pgvector',
          kind: 'extension',
          operations: [{ id: 'op1', label: 'Install vector ext', operationClass: 'additive' }],
          marker: { storageHash: 'sha256:ext' },
        },
        {
          spaceId: 'app',
          kind: 'app',
          operations: [
            { id: 'op2', label: 'Create user', operationClass: 'additive' },
            { id: 'op3', label: 'Create post', operationClass: 'additive' },
            { id: 'op4', label: 'Add fk', operationClass: 'additive' },
          ],
          marker: { storageHash: 'sha256:app' },
        },
      ],
      timings: { total: 42 },
    };
    expect(Object.keys(result).sort()).toMatchInlineSnapshot(`
      [
        "applied",
        "markerHash",
        "migrationsApplied",
        "migrationsTotal",
        "ok",
        "perSpace",
        "summary",
        "timings",
      ]
    `);
    // Pin the canonical perSpace ordering: extensions alphabetically,
    // then the app. Reordering or accidentally sorting `perSpace` would
    // break consumers that index by position rather than `spaceId`.
    expect(result.perSpace.map((p) => p.spaceId)).toEqual(['pgvector', 'app']);
  });

  it('pins per-space entry shape so per-space markers and ordering survive future refactors', () => {
    const entry: MigrateResult['perSpace'][number] = {
      spaceId: 'pgvector',
      kind: 'extension',
      operations: [{ id: 'op1', label: 'Install vector ext', operationClass: 'additive' }],
      marker: { storageHash: 'sha256:ext' },
    };
    expect(Object.keys(entry).sort()).toEqual(['kind', 'marker', 'operations', 'spaceId']);
    expect(entry.marker).toEqual({ storageHash: 'sha256:ext' });
  });
});

describe('MigrationStatusResult JSON shape', () => {
  it('matches expected keys in offline mode', () => {
    const result: MigrationStatusResult = {
      ok: true,
      mode: 'offline',
      migrations: [],
      targetHash: 'sha256:leaf',
      contractHash: 'sha256:contract',
      summary: '0 migration(s) on disk',
      diagnostics: [],
      requiredInvariants: [],
    };
    expect(Object.keys(result).sort()).toMatchInlineSnapshot(`
      [
        "contractHash",
        "diagnostics",
        "migrations",
        "mode",
        "ok",
        "requiredInvariants",
        "summary",
        "targetHash",
      ]
    `);
  });

  it('matches expected keys in online mode with refs', () => {
    const result: MigrationStatusResult = {
      ok: true,
      mode: 'online',
      migrations: [],
      markerHash: 'sha256:marker',
      targetHash: 'sha256:leaf',
      contractHash: 'sha256:contract',
      refs: [{ name: 'production', hash: 'sha256:ref', active: true }],
      pathDecision: {
        fromHash: 'sha256:marker',
        toHash: 'sha256:ref',
        alternativeCount: 0,
        tieBreakReasons: [],
        refName: 'production',
        requiredInvariants: [],
        satisfiedInvariants: [],
        selectedPath: [],
      },
      summary: 'At ref "production" target',
      diagnostics: [],
      requiredInvariants: [],
      // Invariant-aware-routing fields are present in online mode even when
      // the ref declares no invariants (both arrays empty). Pin them in the
      // wire shape so a regression that drops either marker-derived array
      // fails this assertion.
      appliedInvariants: [],
      missingInvariants: [],
    };
    expect(Object.keys(result).sort()).toMatchInlineSnapshot(`
      [
        "appliedInvariants",
        "contractHash",
        "diagnostics",
        "markerHash",
        "migrations",
        "missingInvariants",
        "mode",
        "ok",
        "pathDecision",
        "refs",
        "requiredInvariants",
        "summary",
        "targetHash",
      ]
    `);
  });

  it('migration entry shape is stable', () => {
    const entry: MigrationStatusResult['migrations'][number] = {
      dirName: '20260101T1200_init',
      from: 'sha256:a',
      to: 'sha256:b',
      migrationHash: 'sha256:mid',
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
        "migrationHash",
        "operationCount",
        "operationSummary",
        "status",
        "to",
      ]
    `);
  });
});
