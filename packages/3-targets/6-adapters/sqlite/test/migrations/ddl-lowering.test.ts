import type { DdlColumn } from '@prisma-next/sql-relational-core/ast';
import { SqliteCreateTable } from '@prisma-next/target-sqlite/ddl';
import {
  APP_SPACE_ID,
  ensureLedgerTableStatement,
  ensureMarkerTableStatement,
} from '@prisma-next/target-sqlite/statement-builders';
import { describe, expect, it } from 'vitest';
import { createSqliteAdapter } from '../../src/core/adapter';
import type { SqliteContract } from '../../src/core/types';

const lowererContext = { contract: {} as SqliteContract };

const markerColumns: readonly DdlColumn[] = [
  {
    name: 'space',
    type: 'TEXT',
    notNull: true,
    primaryKey: true,
    default: { kind: 'literal', value: APP_SPACE_ID },
  },
  { name: 'core_hash', type: 'TEXT', notNull: true },
  { name: 'profile_hash', type: 'TEXT', notNull: true },
  { name: 'contract_json', type: 'TEXT' },
  { name: 'canonical_version', type: 'INTEGER' },
  {
    name: 'updated_at',
    type: 'TEXT',
    notNull: true,
    default: { kind: 'function', expression: "datetime('now')" },
  },
  { name: 'app_tag', type: 'TEXT' },
  {
    name: 'meta',
    type: 'TEXT',
    notNull: true,
    default: { kind: 'literal', value: '{}' },
  },
  {
    name: 'invariants',
    type: 'TEXT',
    notNull: true,
    default: { kind: 'literal', value: '[]' },
  },
];

const ledgerColumns: readonly DdlColumn[] = [
  { name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
  {
    name: 'created_at',
    type: 'TEXT',
    notNull: true,
    default: { kind: 'function', expression: "datetime('now')" },
  },
  { name: 'origin_core_hash', type: 'TEXT' },
  { name: 'origin_profile_hash', type: 'TEXT' },
  { name: 'destination_core_hash', type: 'TEXT', notNull: true },
  { name: 'destination_profile_hash', type: 'TEXT' },
  { name: 'contract_json_before', type: 'TEXT' },
  { name: 'contract_json_after', type: 'TEXT' },
  { name: 'operations', type: 'TEXT', notNull: true },
];

describe('Sqlite DDL lowering matches statement-builders', () => {
  const adapter = createSqliteAdapter();

  it('matches ensureMarkerTableStatement', () => {
    const ast = new SqliteCreateTable({
      table: '_prisma_marker',
      ifNotExists: true,
      columns: markerColumns,
    });
    const lowered = adapter.lower(ast, lowererContext);
    expect(lowered.sql).toBe(ensureMarkerTableStatement.sql);
    expect([...lowered.params]).toEqual([...ensureMarkerTableStatement.params]);
  });

  it('matches ensureLedgerTableStatement', () => {
    const ast = new SqliteCreateTable({
      table: '_prisma_ledger',
      ifNotExists: true,
      columns: ledgerColumns,
    });
    const lowered = adapter.lower(ast, lowererContext);
    expect(lowered.sql).toBe(ensureLedgerTableStatement.sql);
    expect([...lowered.params]).toEqual([...ensureLedgerTableStatement.params]);
  });
});
