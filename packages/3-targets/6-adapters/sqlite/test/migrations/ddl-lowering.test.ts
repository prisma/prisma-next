import { col, fn, lit } from '@prisma-next/sql-relational-core/contract-free';
import { createTable } from '@prisma-next/target-sqlite/contract-free';
import {
  APP_SPACE_ID,
  ensureLedgerTableStatement,
  ensureMarkerTableStatement,
} from '@prisma-next/target-sqlite/statement-builders';
import { describe, expect, it } from 'vitest';
import { createSqliteAdapter } from '../../src/core/adapter';
import type { SqliteContract } from '../../src/core/types';

const lowererContext = { contract: {} as SqliteContract };

const markerColumns = [
  col('space', 'TEXT', { notNull: true, primaryKey: true, default: lit(APP_SPACE_ID) }),
  col('core_hash', 'TEXT', { notNull: true }),
  col('profile_hash', 'TEXT', { notNull: true }),
  col('contract_json', 'TEXT'),
  col('canonical_version', 'INTEGER'),
  col('updated_at', 'TEXT', { notNull: true, default: fn("datetime('now')") }),
  col('app_tag', 'TEXT'),
  col('meta', 'TEXT', { notNull: true, default: lit('{}') }),
  col('invariants', 'TEXT', { notNull: true, default: lit('[]') }),
] as const;

const ledgerColumns = [
  col('id', 'INTEGER PRIMARY KEY AUTOINCREMENT'),
  col('created_at', 'TEXT', {
    notNull: true,
    default: fn("strftime('%Y-%m-%dT%H:%M:%fZ','now')"),
  }),
  col('space', 'TEXT', { notNull: true }),
  col('migration_name', 'TEXT', { notNull: true }),
  col('migration_hash', 'TEXT', { notNull: true }),
  col('origin_core_hash', 'TEXT'),
  col('origin_profile_hash', 'TEXT'),
  col('destination_core_hash', 'TEXT', { notNull: true }),
  col('destination_profile_hash', 'TEXT'),
  col('contract_json_before', 'TEXT'),
  col('contract_json_after', 'TEXT'),
  col('operations', 'TEXT', { notNull: true }),
] as const;

describe('Sqlite DDL lowering matches statement-builders', () => {
  const adapter = createSqliteAdapter();

  it('matches ensureMarkerTableStatement', () => {
    const ast = createTable({
      table: '_prisma_marker',
      ifNotExists: true,
      columns: markerColumns,
    });
    const lowered = adapter.lower(ast, lowererContext);
    expect(lowered.sql).toBe(ensureMarkerTableStatement.sql);
    expect([...lowered.params]).toEqual([...ensureMarkerTableStatement.params]);
  });

  it('matches ensureLedgerTableStatement', () => {
    const ast = createTable({
      table: '_prisma_ledger',
      ifNotExists: true,
      columns: ledgerColumns,
    });
    const lowered = adapter.lower(ast, lowererContext);
    expect(lowered.sql).toBe(ensureLedgerTableStatement.sql);
    expect([...lowered.params]).toEqual([...ensureLedgerTableStatement.params]);
  });
});
