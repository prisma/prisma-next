import type {
  BinaryExpr,
  Direction,
  ExistsExpr,
  Expression,
  IncludeAst,
  IncludeRef,
  SelectAst,
  TableRef,
} from '@prisma-next/sql-relational-core/ast';
import { isExpressionBuilder } from '@prisma-next/sql-relational-core/guards';
import type { IncludeState } from '../relations/include-plan.ts';
import { createSelectAst, createTableRef } from '../utils/ast.ts';
import { errorInvalidColumn, errorMissingAlias, errorMissingColumn } from '../utils/errors.ts';
import type { ProjectionState } from './projection.ts';

export function buildProjectionItems(
  projectionState: ProjectionState,
  includesForMeta: ReadonlyArray<IncludeState>,
): Array<{ alias: string; expr: Expression | IncludeRef }> {
  const projectEntries: Array<{ alias: string; expr: Expression | IncludeRef }> = [];
  for (let i = 0; i < projectionState.aliases.length; i++) {
    const alias = projectionState.aliases[i];
    if (!alias) {
      errorMissingAlias(i);
    }
    const column = projectionState.columns[i];
    if (!column) {
      errorMissingColumn(alias, i);
    }

    const matchingInclude = includesForMeta.find((inc) => inc.alias === alias);
    if (matchingInclude) {
      projectEntries.push({
        alias,
        expr: { kind: 'includeRef', alias },
      });
    } else if (isExpressionBuilder(column)) {
      // ExpressionBuilder (operation result) - use its expr
      projectEntries.push({
        alias,
        expr: column.expr,
      });
    } else {
      // ColumnBuilder - use toExpr() to get ColumnRef
      const expr = column.toExpr();
      // Validate the expression has valid table and column values
      if (expr.kind === 'col' && (!expr.table || !expr.column)) {
        errorInvalidColumn(alias, i);
      }
      projectEntries.push({
        alias,
        expr,
      });
    }
  }
  return projectEntries;
}

export function buildSelectAst(params: {
  table: TableRef;
  projectEntries: Array<{ alias: string; expr: Expression | IncludeRef }>;
  includesAst?: ReadonlyArray<IncludeAst>;
  whereExpr?: BinaryExpr | ExistsExpr;
  orderByClause?: ReadonlyArray<{
    expr: Expression;
    dir: Direction;
  }>;
  limit?: number;
}): SelectAst {
  const { table, projectEntries, includesAst, whereExpr, orderByClause, limit } = params;
  return createSelectAst({
    from: createTableRef(table.name),
    project: projectEntries,
    ...(includesAst ? { includes: includesAst } : {}),
    ...(whereExpr ? { where: whereExpr } : {}),
    ...(orderByClause ? { orderBy: orderByClause } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });
}
