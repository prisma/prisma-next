import { buildSignMarkerBootstrapQueries } from '@prisma-next/target-postgres/contract-free';
import type { PostgresDdlNode } from '@prisma-next/target-postgres/ddl';
import { describe, expect, test } from 'vitest';
import { createPostgresAdapter } from '../../src/core/adapter';
import type { PostgresContract } from '../../src/core/types';

describe('Postgres marker table DDL lowering', () => {
  const adapter = createPostgresAdapter();
  const lowererContext = { contract: {} as PostgresContract };

  function markerTableSql(): string {
    const queries = buildSignMarkerBootstrapQueries();
    const markerTable = queries[1];
    if (!markerTable) {
      throw new Error('expected marker table bootstrap query');
    }
    return adapter.lower(markerTable as PostgresDdlNode, lowererContext).sql;
  }

  test('declares the invariants column as text[] not null default empty array', () => {
    expect(markerTableSql()).toContain(`"invariants" text[] NOT NULL DEFAULT '{}'`);
  });

  test('keys the marker by `space text` (PRIMARY KEY) instead of the legacy single-row `id`', () => {
    expect(markerTableSql()).toMatch(/"space"\s+text\s+NOT NULL/);
    expect(markerTableSql()).toMatch(
      /"space"\s+text\s+NOT NULL\s+PRIMARY KEY|PRIMARY KEY\s*\(\s*"space"\s*\)/,
    );
  });

  test('does not declare a legacy `id smallint` primary-key column', () => {
    expect(markerTableSql()).not.toMatch(/id\s+smallint/i);
  });
});
