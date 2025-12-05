import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type { BinaryExpr, ColumnRef, OperationExpr } from '@prisma-next/sql-relational-core/ast';
import {
  createBinaryExpr,
  createColumnRef,
  createParamRef,
} from '@prisma-next/sql-relational-core/ast';
import { augmentDescriptorWithColumnMeta } from '@prisma-next/sql-relational-core/plan';
import type { BinaryBuilder } from '@prisma-next/sql-relational-core/types';
import {
  errorFailedToBuildWhereClause,
  errorMissingParameter,
  errorUnknownColumn,
  errorUnknownTable,
} from '../utils/errors';
import { getColumnInfo, getOperationExpr, isColumnBuilder } from '../utils/guards';

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
  const placeholder = where.right;
  const paramName = placeholder.name;

  if (!Object.hasOwn(paramsMap, paramName)) {
    errorMissingParameter(paramName);
  }

  const value = paramsMap[paramName];
  const index = values.push(value);

  let leftExpr: ColumnRef | OperationExpr;
  let codecId: string | undefined;

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

    // Construct descriptor directly from validated StorageColumn
    descriptors.push({
      name: paramName,
      source: 'dsl',
      refs: { table, column },
      nullable: columnMeta.nullable,
      codecId: columnMeta.codecId,
      nativeType: columnMeta.nativeType,
    });

    augmentDescriptorWithColumnMeta(descriptors, columnMeta);

    codecId = columnMeta.codecId;
    leftExpr = createColumnRef(table, column);
  } else {
    // where.left is neither OperationExpr nor ColumnBuilder - invalid state
    errorFailedToBuildWhereClause();
  }

  const rightParam = createParamRef(index, paramName);
  return {
    expr: createBinaryExpr('eq', leftExpr, rightParam),
    codecId,
    paramName,
  };
}
