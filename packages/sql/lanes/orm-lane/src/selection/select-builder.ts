import type {
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  IncludeAst,
  IncludeRef,
  OperationExpr,
  SelectAst,
  TableRef,
} from '@prisma-next/sql-target';
import type { IncludeState } from '../relations/include-plan';
import { createColumnRef, createSelectAst, createTableRef } from '../utils/ast';
import { errorInvalidColumn, errorMissingAlias, errorMissingColumn } from '../utils/errors';
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
      const operationExpr = (column as { _operationExpr?: OperationExpr })._operationExpr;
      if (operationExpr) {
        projectEntries.push({
          alias,
          expr: operationExpr,
        });
      } else {
        const col = column as { table: string; column: string };
        const tableName = col.table;
        const columnName = col.column;
        if (!tableName || !columnName) {
          errorInvalidColumn(alias, i);
        }
        projectEntries.push({
          alias,
          expr: createColumnRef(tableName, columnName),
        });
      }
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
        dir: import('@prisma-next/sql-target').Direction;
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
      dir: import('@prisma-next/sql-target').Direction;
    }>;
    limit?: number;
  });
}
