import type {
  BinaryExpr,
  ColumnRef,
  Direction,
  ExistsExpr,
  IncludeAst,
  IncludeRef,
  OperationExpr,
  SelectAst,
  TableRef,
} from '@prisma-next/sql-relational-core/ast';
import type {
  AnyColumnBuilder,
  AnyExpressionBuilder,
} from '@prisma-next/sql-relational-core/types';
import type { IncludeState } from '../relations/include-plan';
import { createSelectAst, createTableRef } from '../utils/ast';
import { errorInvalidColumn, errorMissingAlias, errorMissingColumn } from '../utils/errors';
import { extractExpression } from '../utils/guards';
import type { ProjectionState } from './projection';

export function buildProjectionItems(
  projectionState: ProjectionState,
  includesForMeta: ReadonlyArray<IncludeState>,
): Array<{ alias: string; expr: ColumnRef | IncludeRef | OperationExpr }> {
  const projectEntries: Array<{ alias: string; expr: ColumnRef | IncludeRef | OperationExpr }> = [];
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
    } else {
      // Extract expression from ColumnBuilder or ExpressionBuilder
      const expr = extractExpression(column as AnyColumnBuilder | AnyExpressionBuilder);
      // Validate that ColumnRef has valid table/column names
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

export function buildSelectAst(
  table: TableRef,
  projectEntries: Array<{ alias: string; expr: ColumnRef | IncludeRef | OperationExpr }>,
  includesAst: ReadonlyArray<IncludeAst> | undefined,
  whereExpr: BinaryExpr | ExistsExpr | undefined,
  orderByClause:
    | ReadonlyArray<{
        expr: ColumnRef | OperationExpr;
        dir: Direction;
      }>
    | undefined,
  limit: number | undefined,
): SelectAst {
  return createSelectAst({
    from: createTableRef(table.name),
    project: projectEntries,
    includes: includesAst,
    where: whereExpr,
    orderBy: orderByClause,
    limit,
  } as {
    from: TableRef;
    project: ReadonlyArray<{ alias: string; expr: ColumnRef | IncludeRef | OperationExpr }>;
    includes?: ReadonlyArray<IncludeAst>;
    where?: BinaryExpr | ExistsExpr;
    orderBy?: ReadonlyArray<{
      expr: ColumnRef | OperationExpr;
      dir: Direction;
    }>;
    limit?: number;
  });
}
