import { describe, expect, test } from 'vitest';
import { ensureMarkerTableStatement } from '../../src/core/migrations/statement-builders';

describe('ensureMarkerTableStatement', () => {
  test('declares the invariants column as text[] not null default empty array', () => {
    expect(ensureMarkerTableStatement.sql).toContain("invariants text[] not null default '{}'");
  });
});
