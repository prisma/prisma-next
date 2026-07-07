import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import type { DdlNode } from '@prisma-next/sql-relational-core/ast';
import { col, fn, foreignKey, lit } from '@prisma-next/sql-relational-core/contract-free';
import { createSchema, createTable } from './ddl';

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
  col('space', 'text', { notNull: true }),
  col('migration_name', 'text', { notNull: true }),
  col('migration_hash', 'text', { notNull: true }),
  col('origin_core_hash', 'text'),
  col('origin_profile_hash', 'text'),
  col('destination_core_hash', 'text', { notNull: true }),
  col('destination_profile_hash', 'text'),
  col('operations', 'jsonb', { notNull: true }),
] as const;

// 1:1 companion to `ledger`: the contract IR of the row's destination
// state. The primary key doubles as the relation (at most one snapshot
// per ledger row); a row's *before* state is its predecessor's snapshot,
// so it is never stored twice.
const contractColumns = [
  col('ledger_id', 'int8', { notNull: true, primaryKey: true }),
  col('created_at', 'timestamptz', { notNull: true, default: fn('now()') }),
  col('contract_json', 'jsonb', { notNull: true }),
] as const;

const markerTable = createTable({
  schema: 'prisma_contract',
  table: 'marker',
  ifNotExists: true,
  columns: markerColumns,
});

const ledgerTable = createTable({
  schema: 'prisma_contract',
  table: 'ledger',
  ifNotExists: true,
  columns: ledgerColumns,
});

const contractTable = createTable({
  schema: 'prisma_contract',
  table: 'contract',
  ifNotExists: true,
  columns: contractColumns,
  constraints: [
    foreignKey(['ledger_id'], 'prisma_contract.ledger', ['id'], { onDelete: 'cascade' }),
  ],
});

const controlSchema = createSchema({ schema: 'prisma_contract', ifNotExists: true });

export function buildSignMarkerBootstrapQueries(): readonly DdlNode[] {
  return [controlSchema, markerTable];
}

export function buildControlTableBootstrapQueries(): readonly DdlNode[] {
  return [controlSchema, markerTable, ledgerTable, contractTable];
}
