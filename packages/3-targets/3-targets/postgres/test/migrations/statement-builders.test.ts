import { describe, expect, test } from 'vitest';
import { ensureMarkerTableStatement } from '../../src/core/migrations/statement-builders';

describe('ensureMarkerTableStatement', () => {
  test('declares the invariants column as text[] not null default empty array', () => {
    expect(ensureMarkerTableStatement.sql).toContain("invariants text[] not null default '{}'");
  });

  test('keys the marker by `space text` (PRIMARY KEY) instead of the legacy single-row `id`', () => {
    expect(ensureMarkerTableStatement.sql).toMatch(/space\s+text\s+not null/i);
    // PK can be either inline (`space text ... primary key`) or a
    // table-level constraint (`primary key (space)`); both forms are
    // valid as long as `space` is the only key column.
    expect(ensureMarkerTableStatement.sql).toMatch(
      /space\s+text\s+not null\s+primary key|primary key\s*\(\s*space\s*\)/i,
    );
  });

  test('does not declare a legacy `id smallint` primary-key column', () => {
    expect(ensureMarkerTableStatement.sql).not.toMatch(/id\s+smallint/i);
  });
});
