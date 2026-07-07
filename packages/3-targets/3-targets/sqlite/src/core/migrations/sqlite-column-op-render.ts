import type {
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import type { DdlColumn } from '@prisma-next/sql-relational-core/ast';
import { blindCast } from '@prisma-next/utils/casts';
import { tableToDdlParts, toColumnSpec } from './issue-planner';
import type { SqliteColumnSpec } from './operations/shared';
import { isInlineAutoincrementPrimaryKey } from './planner-ddl-builders';

/**
 * The SQLite op-render payload stamped on an expected column node at
 * contract→IR derivation (via the family `renderColumnOps` callback), mirroring
 * the Postgres opaque-payload discipline. It carries the ALREADY-COMPUTED
 * forms the SQLite op-builders read: the `SqliteColumnSpec` (recreate-table /
 * add-column path) and the structured `DdlColumn` (create-table path). Both
 * come from the same helpers the pre-`plan(start, end)` op-path called, so the
 * planner emits byte-identical DDL by reading the relocated result — including
 * the table-dependent sole-column `AUTOINCREMENT` inline, which is why the
 * owning table is in scope here.
 */
export interface SqliteColumnOpRender {
  readonly columnSpec: SqliteColumnSpec;
  readonly ddlColumn: DdlColumn;
}

export function buildSqliteColumnOpRender(
  name: string,
  column: StorageColumn,
  table: StorageTable,
  storageTypes: Readonly<Record<string, StorageTypeInstance>>,
): SqliteColumnOpRender {
  const typesMap = blindCast<
    Record<string, StorageTypeInstance>,
    'the SQLite DDL builders declare a mutable storageTypes Record but never mutate it; the readonly→mutable narrowing is sound'
  >(storageTypes);
  const inline = isInlineAutoincrementPrimaryKey(table, name);
  const columnSpec = toColumnSpec(name, column, storageTypes, inline);
  // Reuse the exact whole-table builder and pick this column's DdlColumn, so
  // the create-table output is byte-identical to the pre-reshape path.
  const ddlColumn = tableToDdlParts(table, typesMap).columns.find((c) => c.name === name);
  if (ddlColumn === undefined) {
    throw new Error(`buildSqliteColumnOpRender: column "${name}" not found in table parts`);
  }
  return { columnSpec, ddlColumn };
}
