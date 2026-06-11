import { FunctionSource, type SelectAst } from '@prisma-next/sql-relational-core/ast';
import { cfExpr, exprSelect } from '@prisma-next/sql-relational-core/contract-free';
import { SQLITE_TEXT_CODEC_ID } from '../core/codec-ids';

export interface ColumnExistsCheckBuilder {
  columnAbsent(): SelectAst;
  columnPresent(): SelectAst;
}

/**
 * Typed builder for the migration planner's column-existence checks. Produces
 * `SELECT COUNT(*) {=|>} 0 AS "result" FROM pragma_table_info(?) WHERE "name" = ?`
 * ASTs with the table and column names bound as text parameters — never
 * inlined into the SQL.
 */
export function columnExistsAst(table: string, column: string): ColumnExistsCheckBuilder {
  const source = FunctionSource.of('pragma_table_info', [
    cfExpr.param(table, SQLITE_TEXT_CODEC_ID).ast,
  ]);
  const where = cfExpr.identifierRef('name').eqParam(column, SQLITE_TEXT_CODEC_ID);
  return {
    columnAbsent: () =>
      exprSelect().from(source).project('result', cfExpr.countStar().eqLit(0)).where(where).build(),
    columnPresent: () =>
      exprSelect().from(source).project('result', cfExpr.countStar().gtLit(0)).where(where).build(),
  };
}
