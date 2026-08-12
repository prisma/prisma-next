import { describe, expect, it } from 'vitest';
import { errorNoInvariantPath, errorUnknownInvariant, MigrationToolsError } from '../src/errors';

describe('errorNoInvariantPath', () => {
  const baseStructural = [
    {
      dirName: '20260424T0900_add_posts_table',
      migrationHash: 'mh:abc',
      from: 'empty',
      to: 'a94b',
      invariants: [],
    },
  ];

  it('builds a MigrationToolsError tagged with MIGRATION.NO_INVARIANT_PATH', () => {
    const err = errorNoInvariantPath({
      required: ['backfill-user-phone'],
      missing: ['backfill-user-phone'],
      structuralPath: baseStructural,
    });
    expect(MigrationToolsError.is(err)).toBe(true);
    expect(err.code).toBe('MIGRATION.NO_INVARIANT_PATH');
    expect(err.category).toBe('MIGRATION');
  });

  it('puts required, missing, and structuralPath on details', () => {
    const err = errorNoInvariantPath({
      required: ['X', 'Y'],
      missing: ['Y'],
      structuralPath: baseStructural,
    });
    expect(err.details).toMatchObject({
      required: ['X', 'Y'],
      missing: ['Y'],
      structuralPath: baseStructural,
    });
  });

  it('includes refName on details when provided', () => {
    const err = errorNoInvariantPath({
      refName: 'prod',
      required: ['X'],
      missing: ['X'],
      structuralPath: baseStructural,
    });
    expect(err.details?.['refName']).toBe('prod');
  });

  it('omits refName from details when not provided', () => {
    const err = errorNoInvariantPath({
      required: ['X'],
      missing: ['X'],
      structuralPath: baseStructural,
    });
    expect(err.details).not.toHaveProperty('refName');
  });

  it('quotes the missing ids in the why message so a typo is readable', () => {
    const err = errorNoInvariantPath({
      required: ['backfill-user-phone'],
      missing: ['backfill-user-phone'],
      structuralPath: baseStructural,
    });
    expect(err.why).toContain('backfill-user-phone');
  });

  it('fix text names a concrete remediation', () => {
    const err = errorNoInvariantPath({
      required: ['X'],
      missing: ['X'],
      structuralPath: baseStructural,
    });
    expect(err.fix).toMatch(/dataTransform/i);
  });

  it('renders required and missing distinctly under partial coverage', () => {
    // Partial coverage: required covers 3, structuralPath only provides 2.
    // The why message must list the full required set and the missing
    // subset separately so an operator can tell at a glance which ones
    // failed.
    const err = errorNoInvariantPath({
      required: ['a', 'b', 'c'],
      missing: ['c'],
      structuralPath: baseStructural,
    });
    expect(err.why).toContain('required=["a", "b", "c"]');
    expect(err.why).toContain('missing=["c"]');
  });

  it('preserves the structuralPath wire shape exactly', () => {
    // The JSON envelope (meta.structuralPath) is part of the public CLI
    // contract — pin the per-edge key set so adding or dropping a field
    // requires an explicit test update.
    const err = errorNoInvariantPath({
      required: ['X'],
      missing: ['X'],
      structuralPath: baseStructural,
    });
    const path = err.details?.['structuralPath'] as readonly Record<string, unknown>[];
    expect(path).toHaveLength(1);
    expect(Object.keys(path[0]!).sort()).toEqual([
      'dirName',
      'from',
      'invariants',
      'migrationHash',
      'to',
    ]);
  });
});

describe('errorUnknownInvariant', () => {
  it('builds a MigrationToolsError tagged with MIGRATION.UNKNOWN_INVARIANT', () => {
    const err = errorUnknownInvariant({
      unknown: ['backfill-user-status'],
      declared: ['backfill-user-phone'],
    });
    expect(MigrationToolsError.is(err)).toBe(true);
    expect(err.code).toBe('MIGRATION.UNKNOWN_INVARIANT');
    expect(err.category).toBe('MIGRATION');
  });

  it('puts unknown and declared on details', () => {
    const err = errorUnknownInvariant({
      unknown: ['typo-id'],
      declared: ['real-id-1', 'real-id-2'],
    });
    expect(err.details).toMatchObject({
      unknown: ['typo-id'],
      declared: ['real-id-1', 'real-id-2'],
    });
  });

  it('includes refName on details when provided', () => {
    const err = errorUnknownInvariant({
      refName: 'prod',
      unknown: ['x'],
      declared: [],
    });
    expect(err.details?.['refName']).toBe('prod');
  });

  it('quotes unknown ids in the why message so a typo is readable', () => {
    const err = errorUnknownInvariant({
      unknown: ['backfill-user-status'],
      declared: ['backfill-user-phone'],
    });
    expect(err.why).toContain('backfill-user-status');
  });

  it('fix text names typo-or-unattested as the two failure modes', () => {
    const err = errorUnknownInvariant({
      unknown: ['x'],
      declared: [],
    });
    expect(err.fix).toMatch(/typo|attest/i);
  });
});
