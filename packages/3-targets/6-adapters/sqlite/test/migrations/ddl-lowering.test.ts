import { SqlContractSerializer } from '@prisma-next/family-sql/ir';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import type { AnyQueryAst } from '@prisma-next/sql-relational-core/ast';
import {
  col,
  createSchema,
  createTable,
  emptyCollection,
  lit,
  now,
} from '@prisma-next/sql-relational-core/contract-free';
import {
  ensureLedgerTableStatement,
  ensureMarkerTableStatement,
} from '@prisma-next/target-sqlite/statement-builders';
import { describe, expect, it } from 'vitest';
import { createSqliteAdapter } from '../../src/core/adapter';
import { SqliteControlAdapter } from '../../src/core/control-adapter';
import type { SqliteContract } from '../../src/core/types';

const contract = new SqlContractSerializer().deserializeContract({
  target: 'sqlite',
  targetFamily: 'sql',
  profileHash: 'sha256:test-profile',
  roots: {},
  capabilities: {},
  extensionPacks: {},
  meta: {},
  storage: {
    storageHash: 'sha256:test-core',
    namespaces: {},
  },
  models: {},
}) as SqliteContract;

const runtimeAdapter = createSqliteAdapter();
const controlAdapter = new SqliteControlAdapter();

function lowerSql(ast: AnyQueryAst): string {
  const runtime = runtimeAdapter.lower(ast, { contract });
  const control = controlAdapter.lower(ast, { contract });
  expect(control).toEqual(runtime);
  return runtime.sql;
}

const markerTableAst = createTable(
  '_prisma_marker',
  [
    col('space', 'text', { notNull: true, primaryKey: true, default: lit(`'${APP_SPACE_ID}'`) }),
    col('core_hash', 'text', { notNull: true }),
    col('profile_hash', 'text', { notNull: true }),
    col('contract_json', 'jsonb'),
    col('canonical_version', 'int'),
    col('updated_at', 'timestamptz', { notNull: true, default: now() }),
    col('app_tag', 'text'),
    col('meta', 'jsonb', { notNull: true, default: lit("'{}'") }),
    col('invariants', 'text-array', { notNull: true, default: emptyCollection() }),
  ],
  { ifNotExists: true },
);

const ledgerTableAst = createTable(
  '_prisma_ledger',
  [
    col('id', 'bigserial', { primaryKey: true }),
    col('created_at', 'timestamptz', { notNull: true, default: now() }),
    col('origin_core_hash', 'text'),
    col('origin_profile_hash', 'text'),
    col('destination_core_hash', 'text', { notNull: true }),
    col('destination_profile_hash', 'text'),
    col('contract_json_before', 'jsonb'),
    col('contract_json_after', 'jsonb'),
    col('operations', 'jsonb', { notNull: true }),
  ],
  { ifNotExists: true },
);

describe('SQLite DDL lowering — byte-equality with bootstrap constants', () => {
  it('lowers the marker table equal to the marker bootstrap constant', () => {
    expect(lowerSql(markerTableAst)).toBe(ensureMarkerTableStatement.sql);
  });

  it('lowers the ledger table equal to the ledger bootstrap constant', () => {
    expect(lowerSql(ledgerTableAst)).toBe(ensureLedgerTableStatement.sql);
  });

  it('lowers create-schema to a no-op empty statement', () => {
    const lowered = runtimeAdapter.lower(createSchema('prisma_contract', { ifNotExists: true }), {
      contract,
    });
    expect(lowered.sql).toBe('');
    expect(lowered.params).toEqual([]);
  });

  it('lowers DDL with empty params', () => {
    expect(runtimeAdapter.lower(markerTableAst, { contract }).params).toEqual([]);
    expect(runtimeAdapter.lower(ledgerTableAst, { contract }).params).toEqual([]);
  });
});

describe('SQLite control adapter — ensureControlTableAsts routed bootstrap', () => {
  it('returns marker + ledger nodes with no schema node', () => {
    const asts = controlAdapter.ensureControlTableAsts();
    expect(asts.map((ast) => ast.kind)).toEqual(['create-table', 'create-table']);
  });

  it('lowers the routed bootstrap byte-equal to the existing constants', () => {
    const sql = controlAdapter
      .ensureControlTableAsts()
      .map((ast) => controlAdapter.lower(ast, { contract }).sql);
    expect(sql).toEqual([ensureMarkerTableStatement.sql, ensureLedgerTableStatement.sql]);
  });
});
