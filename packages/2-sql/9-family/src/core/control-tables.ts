import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import type { CreateTableAst } from '@prisma-next/sql-relational-core/ast';
import {
  col,
  createTable,
  emptyCollection,
  lit,
  now,
} from '@prisma-next/sql-relational-core/contract-free';

/**
 * Builds the canonical contract-marker table AST.
 *
 * The column shape is defined here exactly once so every target's bootstrap
 * routes through a single source of truth instead of hand-writing the "same"
 * DDL in independent places. The descriptor is dialect-neutral; each target's
 * renderer maps it to native SQL. Two columns carry empty-default values that
 * are deliberately NOT constructed the same way:
 *
 * - `meta` is an empty JSON **object**, identical across dialects (`'{}'`), so
 *   it uses the verbatim literal `lit("'{}'")`.
 * - `invariants` is an empty **array**, which genuinely differs per dialect
 *   (Postgres `'{}'` array literal vs SQLite `'[]'` json-array text), so it
 *   uses the neutral `emptyCollection()` kind the renderer resolves natively.
 *
 * @param qualifiedName - Target-specific table name (qualified where the target
 *   uses schemas, e.g. `'prisma_contract.marker'`; bare otherwise).
 */
export function buildMarkerTableAst(qualifiedName: string): CreateTableAst {
  return createTable(
    qualifiedName,
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
}

/**
 * Builds the canonical contract-ledger table AST. See {@link buildMarkerTableAst}
 * for why the column shape is centralized here.
 *
 * @param qualifiedName - Target-specific table name (qualified where the target
 *   uses schemas, e.g. `'prisma_contract.ledger'`; bare otherwise).
 */
export function buildLedgerTableAst(qualifiedName: string): CreateTableAst {
  return createTable(
    qualifiedName,
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
}
