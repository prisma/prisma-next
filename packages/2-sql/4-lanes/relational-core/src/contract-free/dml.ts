import type { ParamSpec } from '@prisma-next/operations';
import type { AnyExpression, InsertValue, ProjectionItem } from '../ast/types';
import {
  ColumnRef,
  InsertAst,
  InsertOnConflict,
  RawExpr,
  TableSource,
  UpdateAst,
} from '../ast/types';
import { param } from '../expression';

/**
 * Contract-free DML builder — the write-side counterpart to the `col` / `lit`
 * / `fn` / `createTable` DDL constructors. Assembles `InsertAst` / `UpdateAst`
 * query nodes for fixed control-plane tables (marker / ledger) without a
 * contract: tables are addressed by literal name (+ optional `schema`), values
 * carry their codec at the value site via {@link param}, and DB-side
 * expressions (e.g. `now()`) are expressed via {@link dbExpr}.
 */

export { param };

/**
 * A table addressed by literal name, optionally schema-qualified. Used for
 * control-plane tables that have no contract namespace coordinate
 * (`prisma_contract.marker`, `_prisma_ledger`).
 */
export function tableRef(name: string, options?: { readonly schema?: string }): TableSource {
  return TableSource.named(name, undefined, undefined, options?.schema);
}

/**
 * A reference to the `excluded` pseudo-table's column, valid only inside an
 * `ON CONFLICT … DO UPDATE SET` action where it denotes the value proposed for
 * insertion. Lets an upsert copy the proposed row into the conflict-update
 * branch without re-binding the same parameters twice.
 */
export function excludedColumn(column: string): ColumnRef {
  return ColumnRef.of('excluded', column);
}

/**
 * A verbatim DB-side expression in value position (e.g. `now()` /
 * `datetime('now')`). The `returns` spec declares the codec/nullability the
 * expression yields; it carries no bound parameters.
 */
export function dbExpr(sql: string, returns: ParamSpec): RawExpr {
  return new RawExpr({ parts: [sql], returns });
}

/** A single-row `INSERT INTO <table> (…) VALUES (…)`. */
export function insert(table: TableSource, row: Readonly<Record<string, InsertValue>>): InsertAst {
  return InsertAst.into(table).withRows([row]);
}

/**
 * A single-row upsert: `INSERT INTO <table> (…) VALUES (…) ON CONFLICT
 * (<conflictColumns>) DO UPDATE SET <set>`. The conflict columns identify the
 * row; the `set` map (typically built from {@link excludedColumn} references
 * plus a {@link dbExpr} timestamp) defines the conflict-update branch.
 */
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

/**
 * An `UPDATE <table> SET <set> WHERE <where>`, optionally with a `RETURNING`
 * projection. The control plane uses `returning` to detect compare-and-swap
 * success: a CAS `UPDATE … WHERE space = … AND core_hash = expectedFrom`
 * returns one row when the swap matched and zero rows when another process
 * advanced the marker first (the {@link import('@prisma-next/framework-components/control').ControlDriverInstance}
 * query surface exposes `rows` but not an affected-row count).
 */
export function update(options: {
  readonly table: TableSource;
  readonly set: Readonly<Record<string, AnyExpression>>;
  readonly where: AnyExpression;
  readonly returning?: ReadonlyArray<ProjectionItem>;
}): UpdateAst {
  const query = UpdateAst.table(options.table).withSet(options.set).withWhere(options.where);
  return options.returning ? query.withReturning(options.returning) : query;
}
