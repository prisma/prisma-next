import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type {
  BinaryExpr,
  ColumnRef,
  OperationExpr,
  ParamRef,
} from '@prisma-next/sql-relational-core/ast';
import {
  createBinaryExpr,
  createColumnRef,
  createParamRef,
} from '@prisma-next/sql-relational-core/ast';
import type { BinaryBuilder, ParamPlaceholder } from '@prisma-next/sql-relational-core/types';
import {
  errorFailedToBuildWhereClause,
  errorMissingParameter,
  errorUnknownColumn,
  errorUnknownTable,
} from '../utils/errors';
import {
  getColumnInfo,
  getOperationExpr,
  isColumnBuilder,
  isParamPlaceholder,
} from '../utils/guards';

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
  let leftExpr: ColumnRef | OperationExpr;
  let codecId: string | undefined;
  let rightExpr: ColumnRef | ParamRef;
  let paramName: string;

  // Check if where.left is an OperationExpr directly (from operation.eq())
  // or a ColumnBuilder with _operationExpr property
  const operationExpr = getOperationExpr(where.left);
  if (operationExpr) {
    leftExpr = operationExpr;
  } else if (isColumnBuilder(where.left)) {
    // where.left is a ColumnBuilder - use proper type narrowing
    const { table, column } = getColumnInfo(where.left);

    const contractTable = contract.storage.tables[table];
    if (!contractTable) {
      errorUnknownTable(table);
    }

    const columnMeta: StorageColumn | undefined = contractTable.columns[column];
    if (!columnMeta) {
      errorUnknownColumn(column, table);
    }

    codecId = columnMeta.codecId;
    leftExpr = createColumnRef(table, column);
  } else {
    // where.left is neither OperationExpr nor ColumnBuilder - invalid state
    errorFailedToBuildWhereClause();
  }

  // Handle where.right - can be ParamPlaceholder or AnyColumnBuilder
  if (isParamPlaceholder(where.right)) {
    // Handle param placeholder (existing logic)
    const placeholder: ParamPlaceholder = where.right;
    paramName = placeholder.name;

    if (!Object.hasOwn(paramsMap, paramName)) {
      errorMissingParameter(paramName);
    }

    const value = paramsMap[paramName];
    const index = values.push(value);

    // Construct descriptor directly from validated StorageColumn
    if (isColumnBuilder(where.left)) {
      const { table, column } = getColumnInfo(where.left);
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
  } else if (isColumnBuilder(where.right)) {
    // Handle column builder on the right
    const { table, column } = getColumnInfo(where.right);

    const contractTable = contract.storage.tables[table];
    if (!contractTable) {
      errorUnknownTable(table);
    }

    const columnMeta: StorageColumn | undefined = contractTable.columns[column];
    if (!columnMeta) {
      errorUnknownColumn(column, table);
    }

    rightExpr = createColumnRef(table, column);
    // Use a placeholder paramName for column references (not used for params)
    paramName = '';
  } else {
    // where.right is neither ParamPlaceholder nor ColumnBuilder - invalid state
    errorFailedToBuildWhereClause();
  }

  return {
    expr: createBinaryExpr(where.op, leftExpr, rightExpr),
    codecId,
    paramName,
  };
}
