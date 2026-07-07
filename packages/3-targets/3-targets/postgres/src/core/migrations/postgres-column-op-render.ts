import type { CodecControlHooks } from '@prisma-next/family-sql/control';
import type { StorageColumn, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import type { DdlColumn } from '@prisma-next/sql-relational-core/ast';
import { toDdlColumn } from './issue-planner';
import { buildColumnDefaultSql, buildColumnTypeSql } from './planner-ddl-builders';
import { buildExpectedFormatType } from './planner-sql-checks';

/**
 * The Postgres op-render payload stamped on an expected column node at
 * contract→IR derivation (via the family `renderColumnOps` callback). It
 * carries the ALREADY-COMPUTED results the migration op-builders read: the
 * `CREATE TABLE` / `ADD COLUMN` DDL column, the `ALTER COLUMN … TYPE` operands,
 * and the `SET DEFAULT` SQL. Each is produced by the same builder the
 * pre-`plan(start, end)` op-path called, so reading it back yields
 * byte-identical DDL — the computation is relocated to derivation, never
 * re-run against node fields.
 */
export interface PostgresColumnOpRender {
  readonly ddlColumn: DdlColumn;
  readonly alterType: {
    readonly qualifiedTargetType: string;
    readonly formatTypeExpected: string;
  };
  /** `SET DEFAULT` clause SQL, or `''` when the column declares no default. */
  readonly setDefaultSql: string;
}

/**
 * Computes the {@link PostgresColumnOpRender} for one contract column, binding
 * the codec hooks and storage types the caller holds at derivation time.
 */
export function buildPostgresColumnOpRender(
  name: string,
  column: StorageColumn,
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
  storageTypes: Readonly<Record<string, StorageTypeInstance>>,
): PostgresColumnOpRender {
  const hooksMap = codecHooks as Map<string, CodecControlHooks>;
  const typesMap = storageTypes as Record<string, StorageTypeInstance>;
  return {
    ddlColumn: toDdlColumn(name, column, codecHooks, storageTypes),
    alterType: {
      qualifiedTargetType: buildColumnTypeSql(column, hooksMap, typesMap, false),
      formatTypeExpected: buildExpectedFormatType(column, hooksMap, typesMap),
    },
    setDefaultSql: column.default ? buildColumnDefaultSql(column.default, column) : '',
  };
}
