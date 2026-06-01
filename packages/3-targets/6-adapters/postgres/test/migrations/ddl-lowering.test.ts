import { col, fn, lit } from '@prisma-next/sql-relational-core/contract-free';
import { createSchema, createTable } from '@prisma-next/target-postgres/contract-free';
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

const markerColumns = [
  col('space', 'text', { notNull: true, primaryKey: true, default: lit(APP_SPACE_ID) }),
  col('core_hash', 'text', { notNull: true }),
  col('profile_hash', 'text', { notNull: true }),
  col('contract_json', 'jsonb'),
  col('canonical_version', 'int'),
  col('updated_at', 'timestamptz', { notNull: true, default: fn('now()') }),
  col('app_tag', 'text'),
  col('meta', 'jsonb', { notNull: true, default: lit('{}') }),
  col('invariants', 'text[]', { notNull: true, default: lit('{}') }),
] as const;

const ledgerColumns = [
  col('id', 'bigserial', { primaryKey: true }),
  col('created_at', 'timestamptz', { notNull: true, default: fn('now()') }),
  col('origin_core_hash', 'text'),
  col('origin_profile_hash', 'text'),
  col('destination_core_hash', 'text', { notNull: true }),
  col('destination_profile_hash', 'text'),
  col('contract_json_before', 'jsonb'),
  col('contract_json_after', 'jsonb'),
  col('operations', 'jsonb', { notNull: true }),
] as const;

describe('Postgres DDL lowering matches statement-builders', () => {
  const adapter = createPostgresAdapter();

  it('matches ensurePrismaContractSchemaStatement', () => {
    const ast = createSchema({ schema: 'prisma_contract', ifNotExists: true });
    const lowered = adapter.lower(ast, lowererContext);
    expect(lowered.sql).toBe(ensurePrismaContractSchemaStatement.sql);
    expect([...lowered.params]).toEqual([...ensurePrismaContractSchemaStatement.params]);
  });

  it('matches ensureMarkerTableStatement', () => {
    const ast = createTable({
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
    const ast = createTable({
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
