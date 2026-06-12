import type { SelectAst } from '@prisma-next/sql-relational-core/ast';
import {
  type CfExpr,
  type CfExprSelectQuery,
  cfExpr,
  cfTable,
  exprSelect,
} from '@prisma-next/sql-relational-core/contract-free';
import { PG_TEXT_CODEC_ID } from '../core/codec-ids';
import { postgresCreateNamespace } from '../core/postgres-schema';

/**
 * `to_regclass($1)` with the qualified table name bound as a text parameter.
 * Thin vocabulary wrapper over the core `cfExpr.fn` helper — the target
 * supplies only the template and the codec'd operand.
 */
export function toRegclass(qualifiedName: string): CfExpr {
  return cfExpr.fn({
    method: 'to_regclass',
    template: 'to_regclass({{self}})',
    self: cfExpr.param(qualifiedName, PG_TEXT_CODEC_ID),
    returns: { codecId: PG_TEXT_CODEC_ID, nullable: true },
  });
}

export interface TableExistsCheckBuilder {
  tableAbsent(): SelectAst;
  tablePresent(): SelectAst;
}

/**
 * Typed builder for the migration planner's table-existence checks. Produces
 * FROM-less `SELECT to_regclass($1) IS [NOT] NULL AS "result"` ASTs with the
 * qualified table name bound as a text parameter — never inlined into the SQL.
 *
 * `schema` is a namespace coordinate: the framework `__unbound__` sentinel
 * elides the qualifier (search_path decides at runtime); any other id
 * qualifies as `"schema"."table"`.
 */
export function tableExistsAst(schema: string, table: string): TableExistsCheckBuilder {
  const qualified = postgresCreateNamespace({ id: schema, entries: { table: {} } }).qualifyTable(
    table,
  );
  const regclass = toRegclass(qualified);
  return {
    tableAbsent: () => exprSelect().project('result', regclass.isNull()).build(),
    tablePresent: () => exprSelect().project('result', regclass.isNotNull()).build(),
  };
}

export interface ConstraintExistsCheckBuilder {
  constraintPresent(): SelectAst;
  constraintAbsent(): SelectAst;
}

/**
 * Typed builder for the migration planner's constraint-existence checks.
 * Produces `SELECT [NOT ]EXISTS (SELECT 1 FROM pg_constraint c JOIN
 * pg_namespace n ON n.oid = c.connamespace WHERE c.conname = $1 AND
 * n.nspname = $2 [AND c.conrelid = to_regclass($3)]) AS "result"` with the
 * constraint name, schema name, and qualified table name bound as text
 * parameters.
 *
 * When `table` is omitted the check matches by name + schema across all
 * tables. Pass `table` to scope the check to a single table (prevents false
 * matches on identically-named constraints in different tables). `schema`
 * is a namespace coordinate: the `__unbound__` sentinel compares `nspname`
 * against `current_schema()` instead of a bound parameter.
 */
export function constraintExistsAst(options: {
  readonly constraintName: string;
  readonly schema: string;
  readonly table?: string;
}): ConstraintExistsCheckBuilder {
  const namespace = postgresCreateNamespace({ id: options.schema, entries: { table: {} } });
  const conditions = [
    cfExpr.columnRef('c', 'conname').eqParam(options.constraintName, PG_TEXT_CODEC_ID),
    cfExpr.columnRef('n', 'nspname').eqExpr(namespace.schemaFilterExpression()),
  ];
  if (options.table !== undefined) {
    conditions.push(
      cfExpr.columnRef('c', 'conrelid').eqExpr(toRegclass(namespace.qualifyTable(options.table))),
    );
  }
  const inner = (): CfExprSelectQuery =>
    exprSelect()
      .from(cfTable('pg_constraint', 'c'))
      .join(
        cfTable('pg_namespace', 'n'),
        cfExpr.columnRef('n', 'oid').eqExpr(cfExpr.columnRef('c', 'connamespace')),
      )
      .project('one', cfExpr.lit(1))
      .where(cfExpr.allOf(conditions));
  return {
    constraintPresent: () => exprSelect().project('result', cfExpr.exists(inner())).build(),
    constraintAbsent: () => exprSelect().project('result', cfExpr.notExists(inner())).build(),
  };
}
