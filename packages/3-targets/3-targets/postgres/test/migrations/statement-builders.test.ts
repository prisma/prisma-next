import { describe, expect, test } from 'vitest';
import {
  buildWriteMarkerStatements,
  ensureMarkerTableStatement,
} from '../../src/core/migrations/statement-builders';

describe('ensureMarkerTableStatement', () => {
  test('declares the invariants column as text[] not null default empty array', () => {
    expect(ensureMarkerTableStatement.sql).toContain("invariants text[] not null default '{}'");
  });
});

describe('buildWriteMarkerStatements', () => {
  const baseInput = {
    storageHash: 'sha256:storage',
    profileHash: 'sha256:profile',
    contractJson: { any: 'value' },
    canonicalVersion: 1,
    appTag: 'app',
    meta: { k: 'v' },
    invariants: ['a', 'b'],
  };

  test('insert statement references the invariants column with a text[] param', () => {
    const { insert } = buildWriteMarkerStatements(baseInput);
    expect(insert.sql).toContain('invariants');
    expect(insert.sql).toContain('::text[]');
    // params: [id, storageHash, profileHash, contractJson, canonicalVersion, appTag, meta, invariants]
    expect(insert.params.at(-1)).toEqual(['a', 'b']);
  });

  test('update statement sets invariants from a text[] param', () => {
    const { update } = buildWriteMarkerStatements(baseInput);
    expect(update.sql).toMatch(/invariants\s*=\s*\$\d+::text\[\]/);
    expect(update.params.at(-1)).toEqual(['a', 'b']);
  });

  test('empty invariants round-trip as an empty array', () => {
    const { insert, update } = buildWriteMarkerStatements({ ...baseInput, invariants: [] });
    expect(insert.params.at(-1)).toEqual([]);
    expect(update.params.at(-1)).toEqual([]);
  });
});
