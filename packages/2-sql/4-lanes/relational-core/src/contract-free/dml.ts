import type { ParamSpec } from '@prisma-next/operations';
import {
  type AnyExpression,
  ColumnRef,
  InsertAst,
  InsertOnConflict,
  type InsertValue,
  type ProjectionItem,
  RawExpr,
  TableSource,
  UpdateAst,
} from '../ast/types';
import { param } from '../expression';

export {
  CfConflictClause,
  CfExpr,
  CfInsertQuery,
  CfSelectQuery,
  CfUpdateQuery,
  CfUpsertBuilder,
  CfUpsertQuery,
  type ColumnDescriptor,
  type ColumnProxy,
  type ColumnSchema,
  type ExcludedProxy,
  type TableHandle,
  type TableInsertRow,
  type TableSetValues,
  table,
} from './table';
export { param };

/** @deprecated Use `table()` + target column helpers; D9 removes call sites. */
export function tableRef(name: string): TableSource {
  return TableSource.named(name);
}

/** @deprecated Use `table()` + target column helpers; D9 removes call sites. */
export function excludedColumn(column: string): ColumnRef {
  return ColumnRef.of('excluded', column);
}

/** @deprecated Use `table()` + target column helpers; D9 removes call sites. */
export function dbExpr(sql: string, returns: ParamSpec): RawExpr {
  return new RawExpr({ parts: [sql], returns });
}

/** @deprecated Use `table().insert()`; D9 removes call sites. */
export function insert(table: TableSource, row: Readonly<Record<string, InsertValue>>): InsertAst {
  return InsertAst.into(table).withRows([row]);
}

/** @deprecated Use `table().upsert()`; D9 removes call sites. */
export function upsert(options: {
  readonly table: TableSource;
  readonly row: Readonly<Record<string, InsertValue>>;
  readonly conflictColumns: readonly string[];
  readonly set: Readonly<Record<string, AnyExpression>>;
}): InsertAst {
  const conflictRefs = options.conflictColumns.map((column) =>
    ColumnRef.of(options.table.name, column),
  );
  return InsertAst.into(options.table)
    .withRows([options.row])
    .withOnConflict(InsertOnConflict.on(conflictRefs).doUpdateSet(options.set));
}

/** @deprecated Use `table().update()`; D9 removes call sites. */
export function update(options: {
  readonly table: TableSource;
  readonly set: Readonly<Record<string, AnyExpression>>;
  readonly where: AnyExpression;
  readonly returning?: ReadonlyArray<ProjectionItem>;
}): UpdateAst {
  const query = UpdateAst.table(options.table).withSet(options.set).withWhere(options.where);
  return options.returning ? query.withReturning(options.returning) : query;
}
