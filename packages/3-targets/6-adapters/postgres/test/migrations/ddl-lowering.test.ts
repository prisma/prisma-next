import type { DdlColumn } from '@prisma-next/sql-relational-core/ast';
import { PostgresCreateSchema, PostgresCreateTable } from '@prisma-next/target-postgres/ddl';
import {
  APP_SPACE_ID,
  ensureLedgerTableStatement,
  ensureMarkerTableStatement,
  ensurePrismaContractSchemaStatement,
} from '@prisma-next/target-postgres/statement-builders';
import { describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../../src/core/adapter';
import type { PostgresContract } from '../../src/core/types';

const lowererContext = { contract: {} as PostgresContract };

const markerColumns: readonly DdlColumn[] = [
  {
    name: 'space',
    type: 'text',
    notNull: true,
    primaryKey: true,
    default: { kind: 'literal', value: APP_SPACE_ID },
  },
  { name: 'core_hash', type: 'text', notNull: true },
  { name: 'profile_hash', type: 'text', notNull: true },
  { name: 'contract_json', type: 'jsonb' },
  { name: 'canonical_version', type: 'int' },
  {
    name: 'updated_at',
    type: 'timestamptz',
    notNull: true,
    default: { kind: 'function', expression: 'now()' },
  },
  { name: 'app_tag', type: 'text' },
  {
    name: 'meta',
    type: 'jsonb',
    notNull: true,
    default: { kind: 'literal', value: '{}' },
  },
  {
    name: 'invariants',
    type: 'text[]',
    notNull: true,
    default: { kind: 'literal', value: '{}' },
  },
];

const ledgerColumns: readonly DdlColumn[] = [
  { name: 'id', type: 'bigserial', primaryKey: true },
  {
    name: 'created_at',
    type: 'timestamptz',
    notNull: true,
    default: { kind: 'function', expression: 'now()' },
  },
  { name: 'origin_core_hash', type: 'text' },
  { name: 'origin_profile_hash', type: 'text' },
  { name: 'destination_core_hash', type: 'text', notNull: true },
  { name: 'destination_profile_hash', type: 'text' },
  { name: 'contract_json_before', type: 'jsonb' },
  { name: 'contract_json_after', type: 'jsonb' },
  { name: 'operations', type: 'jsonb', notNull: true },
];

describe('Postgres DDL lowering matches statement-builders', () => {
  const adapter = createPostgresAdapter();

  it('matches ensurePrismaContractSchemaStatement', () => {
    const ast = new PostgresCreateSchema({
      schema: 'prisma_contract',
      ifNotExists: true,
    });
    const lowered = adapter.lower(ast, lowererContext);
    expect(lowered.sql).toBe(ensurePrismaContractSchemaStatement.sql);
    expect([...lowered.params]).toEqual([...ensurePrismaContractSchemaStatement.params]);
  });

  it('matches ensureMarkerTableStatement', () => {
    const ast = new PostgresCreateTable({
      schema: 'prisma_contract',
      table: 'marker',
      ifNotExists: true,
      columns: markerColumns,
    });
    const lowered = adapter.lower(ast, lowererContext);
    expect(lowered.sql).toBe(ensureMarkerTableStatement.sql);
    expect([...lowered.params]).toEqual([...ensureMarkerTableStatement.params]);
  });

  it('matches ensureLedgerTableStatement', () => {
    const ast = new PostgresCreateTable({
      schema: 'prisma_contract',
      table: 'ledger',
      ifNotExists: true,
      columns: ledgerColumns,
    });
    const lowered = adapter.lower(ast, lowererContext);
    expect(lowered.sql).toBe(ensureLedgerTableStatement.sql);
    expect([...lowered.params]).toEqual([...ensureLedgerTableStatement.params]);
  });
});
