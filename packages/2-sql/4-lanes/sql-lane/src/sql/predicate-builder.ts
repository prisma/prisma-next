import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type { BinaryExpr, Expression, ParamRef } from '@prisma-next/sql-relational-core/ast';
import { createBinaryExpr, createParamRef } from '@prisma-next/sql-relational-core/ast';
import type { BinaryBuilder, ParamPlaceholder } from '@prisma-next/sql-relational-core/types';
import {
  isColumnBuilder,
  isExpressionBuilder,
  isParamPlaceholder,
} from '@prisma-next/sql-relational-core/utils/guards';
import {
  errorFailedToBuildWhereClause,
  errorMissingParameter,
  errorUnknownColumn,
  errorUnknownTable,
} from '../utils/errors';

export interface BuildWhereExprResult {
  expr: BinaryExpr;
  codecId: string | undefined;
  paramName: string;
}

export function buildWhereExpr(
  contract: SqlContract<SqlStorage>,
  where: BinaryBuilder,
  paramsMap: Record<string, unknown>,
  descriptors: ParamDescriptor[],
  values: unknown[],
): BuildWhereExprResult {
  let leftExpr: Expression;
  let codecId: string | undefined;
  let rightExpr: Expression | ParamRef;
  let paramName: string;

  // Validate where.left is a valid Expression (col, operation, literal, param)
  const validExpressionKinds = ['col', 'operation', 'literal', 'param'];
  if (
    !where.left ||
    typeof where.left !== 'object' ||
    !validExpressionKinds.includes((where.left as { kind?: string }).kind ?? '')
  ) {
    errorFailedToBuildWhereClause();
  }

  // where.left is an Expression (already converted at builder creation time)
  // It could be a ColumnRef or OperationExpr
  leftExpr = where.left;

  // If the left expression is a column reference, extract codecId for param descriptors
  if (leftExpr.kind === 'col') {
    const { table, column } = leftExpr;
    const contractTable = contract.storage.tables[table];
    if (!contractTable) {
      errorUnknownTable(table);
    }

    const columnMeta: StorageColumn | undefined = contractTable.columns[column];
    if (!columnMeta) {
      errorUnknownColumn(column, table);
    }

    codecId = columnMeta.codecId;
  }

  // Handle where.right - can be ParamPlaceholder or ExpressionSource
  if (isParamPlaceholder(where.right)) {
    // Handle param placeholder (existing logic)
    const placeholder: ParamPlaceholder = where.right;
    paramName = placeholder.name;

    if (!Object.hasOwn(paramsMap, paramName)) {
      errorMissingParameter(paramName);
    }

    const value = paramsMap[paramName];
    const index = values.push(value);

    // Construct descriptor directly from validated StorageColumn if left is a column
    if (leftExpr.kind === 'col') {
      const { table, column } = leftExpr;
      const contractTable = contract.storage.tables[table];
      const columnMeta = contractTable?.columns[column];
      if (columnMeta) {
        descriptors.push({
          name: paramName,
          source: 'dsl',
          refs: { table, column },
          nullable: columnMeta.nullable,
          codecId: columnMeta.codecId,
          nativeType: columnMeta.nativeType,
        });
      }
    }

    rightExpr = createParamRef(index, paramName);
  } else if (isColumnBuilder(where.right) || isExpressionBuilder(where.right)) {
    // Handle ExpressionSource (ColumnBuilder or ExpressionBuilder) on the right
    rightExpr = where.right.toExpr();

    // Validate column exists in contract if it's a ColumnRef
    if (rightExpr.kind === 'col') {
      const { table, column } = rightExpr;
      const contractTable = contract.storage.tables[table];
      if (!contractTable) {
        errorUnknownTable(table);
      }

      const columnMeta: StorageColumn | undefined = contractTable.columns[column];
      if (!columnMeta) {
        errorUnknownColumn(column, table);
      }
    }

    // Use a placeholder paramName for expression references (not used for params)
    paramName = '';
  } else {
    // where.right is neither ParamPlaceholder nor ExpressionSource - invalid state
    errorFailedToBuildWhereClause();
  }

  return {
    expr: createBinaryExpr(where.op, leftExpr, rightExpr),
    codecId,
    paramName,
  };
}
