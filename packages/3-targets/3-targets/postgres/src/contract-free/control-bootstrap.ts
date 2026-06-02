import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import type { DdlNode } from '@prisma-next/sql-relational-core/ast';
import { col, fn, lit } from '@prisma-next/sql-relational-core/contract-free';
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
  col('origin_core_hash', 'text'),
  col('origin_profile_hash', 'text'),
  col('destination_core_hash', 'text', { notNull: true }),
  col('destination_profile_hash', 'text'),
  col('contract_json_before', 'jsonb'),
  col('contract_json_after', 'jsonb'),
  col('operations', 'jsonb', { notNull: true }),
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

const controlSchema = createSchema({ schema: 'prisma_contract', ifNotExists: true });

export function buildSignMarkerBootstrapQueries(): readonly DdlNode[] {
  return [controlSchema, markerTable];
}

export function buildControlTableBootstrapQueries(): readonly DdlNode[] {
  return [controlSchema, markerTable, ledgerTable];
}
