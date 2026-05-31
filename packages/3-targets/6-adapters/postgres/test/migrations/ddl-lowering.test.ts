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
import { ensureSchemaStatement, ensureTableStatement } from '@prisma-next/sql-runtime';
import {
  ensureLedgerTableStatement,
  ensureMarkerTableStatement,
  ensurePrismaContractSchemaStatement,
} from '@prisma-next/target-postgres/statement-builders';
import { describe, expect, it } from 'vitest';
import type { PostgresContract } from '../../src/core/types';
import {
  createComposedPostgresAdapter,
  createComposedPostgresControlAdapter,
} from '../helpers/composed-adapter';

const contract = new SqlContractSerializer().deserializeContract({
  target: 'postgres',
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
}) as PostgresContract;

const runtimeAdapter = createComposedPostgresAdapter({ extensionPacks: [] });
const controlAdapter = createComposedPostgresControlAdapter({ extensionPacks: [] });

function lowerSql(ast: AnyQueryAst): string {
  const runtime = runtimeAdapter.lower(ast, { contract });
  const control = controlAdapter.lower(ast, { contract });
  expect(control).toEqual(runtime);
  return runtime.sql;
}

const markerTableAst = createTable(
  'prisma_contract.marker',
  [
    col('space', 'text', { notNull: true, primaryKey: true, default: lit(`'${APP_SPACE_ID}'`) }),
    col('core_hash', 'text', { notNull: true }),
    col('profile_hash', 'text', { notNull: true }),
    col('contract_json', 'jsonb'),
    col('canonical_version', 'int'),
    col('updated_at', 'timestamptz', { notNull: true, default: now() }),
    col('app_tag', 'text'),
    col('meta', 'jsonb', { notNull: true, default: emptyCollection() }),
    col('invariants', 'text-array', { notNull: true, default: emptyCollection() }),
  ],
  { ifNotExists: true },
);

const ledgerTableAst = createTable(
  'prisma_contract.ledger',
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

describe('Postgres DDL lowering — byte-equality with bootstrap constants', () => {
  it('lowers create-schema equal to the schema bootstrap constant', () => {
    const sql = lowerSql(createSchema('prisma_contract', { ifNotExists: true }));
    expect(sql).toBe(ensurePrismaContractSchemaStatement.sql);
    expect(sql).toBe(ensureSchemaStatement.sql);
  });

  it('lowers the marker table equal to the marker bootstrap constant', () => {
    const sql = lowerSql(markerTableAst);
    expect(sql).toBe(ensureMarkerTableStatement.sql);
    expect(sql).toBe(ensureTableStatement.sql);
  });

  it('lowers the ledger table equal to the ledger bootstrap constant', () => {
    const sql = lowerSql(ledgerTableAst);
    expect(sql).toBe(ensureLedgerTableStatement.sql);
  });

  it('lowers DDL with empty params', () => {
    expect(runtimeAdapter.lower(markerTableAst, { contract }).params).toEqual([]);
    expect(runtimeAdapter.lower(ledgerTableAst, { contract }).params).toEqual([]);
    expect(
      runtimeAdapter.lower(createSchema('prisma_contract', { ifNotExists: true }), { contract })
        .params,
    ).toEqual([]);
  });
});

describe('Postgres control adapter — ensureControlTableAsts routed bootstrap', () => {
  it('returns schema + marker + ledger nodes', () => {
    const asts = controlAdapter.ensureControlTableAsts();
    expect(asts.map((ast) => ast.kind)).toEqual(['create-schema', 'create-table', 'create-table']);
  });

  it('lowers the routed bootstrap byte-equal to the existing constants', () => {
    const sql = controlAdapter
      .ensureControlTableAsts()
      .map((ast) => controlAdapter.lower(ast, { contract }).sql);
    expect(sql).toEqual([
      ensurePrismaContractSchemaStatement.sql,
      ensureMarkerTableStatement.sql,
      ensureLedgerTableStatement.sql,
    ]);
  });
});
