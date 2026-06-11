import { OperationExpr, ParamRef, type SelectAst } from '@prisma-next/sql-relational-core/ast';
import { CfExpr, exprSelect } from '@prisma-next/sql-relational-core/contract-free';
import { PG_TEXT_CODEC_ID } from '../core/codec-ids';
import { postgresCreateNamespace } from '../core/postgres-schema';

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
  const regclass = new CfExpr(
    new OperationExpr({
      method: 'to_regclass',
      self: ParamRef.of(qualified, { codec: { codecId: PG_TEXT_CODEC_ID } }),
      args: undefined,
      returns: { codecId: PG_TEXT_CODEC_ID, nullable: true },
      lowering: { targetFamily: 'sql', strategy: 'function', template: 'to_regclass({{self}})' },
    }),
  );
  return {
    tableAbsent: () => exprSelect().project('result', regclass.isNull()).build(),
    tablePresent: () => exprSelect().project('result', regclass.isNotNull()).build(),
  };
}
