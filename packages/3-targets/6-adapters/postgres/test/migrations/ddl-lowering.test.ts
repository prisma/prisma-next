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

// Byte-equality regression pins: the exact SQL the retired bootstrap
// constants produced. The lowered DDL must remain identical to these.
const expectedSchemaSql = 'create schema if not exists prisma_contract';
const expectedMarkerSql = `create table if not exists prisma_contract.marker (
    space text not null primary key default '${APP_SPACE_ID}',
    core_hash text not null,
    profile_hash text not null,
    contract_json jsonb,
    canonical_version int,
    updated_at timestamptz not null default now(),
    app_tag text,
    meta jsonb not null default '{}',
    invariants text[] not null default '{}'
  )`;
const expectedLedgerSql = `create table if not exists prisma_contract.ledger (
    id bigserial primary key,
    created_at timestamptz not null default now(),
    origin_core_hash text,
    origin_profile_hash text,
    destination_core_hash text not null,
    destination_profile_hash text,
    contract_json_before jsonb,
    contract_json_after jsonb,
    operations jsonb not null
  )`;

describe('Postgres DDL lowering — byte-equality with bootstrap SQL', () => {
  it('lowers create-schema equal to the schema bootstrap SQL', () => {
    expect(lowerSql(createSchema('prisma_contract', { ifNotExists: true }))).toBe(
      expectedSchemaSql,
    );
  });

  it('lowers the marker table equal to the marker bootstrap SQL', () => {
    expect(lowerSql(markerTableAst)).toBe(expectedMarkerSql);
  });

  it('lowers the ledger table equal to the ledger bootstrap SQL', () => {
    expect(lowerSql(ledgerTableAst)).toBe(expectedLedgerSql);
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
    expect(sql).toEqual([expectedSchemaSql, expectedMarkerSql, expectedLedgerSql]);
  });
});
