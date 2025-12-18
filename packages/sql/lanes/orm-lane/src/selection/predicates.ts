import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type {
  BinaryExpr,
  ColumnRef,
  OperationExpr,
  ParamRef,
} from '@prisma-next/sql-relational-core/ast';
import { augmentDescriptorWithColumnMeta } from '@prisma-next/sql-relational-core/plan';
import type { BinaryBuilder } from '@prisma-next/sql-relational-core/types';
import { createBinaryExpr, createColumnRef, createParamRef } from '../utils/ast';
import {
  errorFailedToBuildWhereClause,
  errorMissingParameter,
  errorUnknownTable,
} from '../utils/errors';
import {
  getColumnInfo,
  getOperationExpr,
  isColumnBuilder,
  isParamPlaceholder,
} from '../utils/guards';

export function buildWhereExpr(
  where: BinaryBuilder,
  contract: SqlContract<SqlStorage>,
  paramsMap: Record<string, unknown>,
  descriptors: ParamDescriptor[],
  values: unknown[],
): {
  expr: BinaryExpr;
  codecId?: string;
  paramName: string;
} {
  let leftExpr: ColumnRef | OperationExpr;
  let codecId: string | undefined;
  let rightExpr: ColumnRef | ParamRef;
  let paramName: string;

  const operationExpr = getOperationExpr(where.left);
  if (operationExpr) {
    leftExpr = operationExpr;
  } else if (isColumnBuilder(where.left)) {
    const { table, column } = getColumnInfo(where.left);

    const contractTable = contract.storage.tables[table];
    if (!contractTable) {
      errorUnknownTable(table);
    }

    const columnMeta: StorageColumn | undefined = contractTable.columns[column];
    // If column not found in contract, still build expression but without codecId
    // This allows flexibility when columnMeta is available on the column builder
    if (columnMeta) {
      codecId = columnMeta.codecId;
    }
    leftExpr = createColumnRef(table, column);
  } else {
    errorFailedToBuildWhereClause();
  }

  // Handle where.right - can be ParamPlaceholder or AnyColumnBuilder
  if (isParamPlaceholder(where.right)) {
    // Handle param placeholder (existing logic)
    const placeholder = where.right;
    paramName = placeholder.name;

    if (!Object.hasOwn(paramsMap, paramName)) {
      errorMissingParameter(paramName);
    }

    const value = paramsMap[paramName];
    const index = values.push(value);

    // Construct descriptor if where.left is a ColumnBuilder
    if (isColumnBuilder(where.left)) {
      const { table, column } = getColumnInfo(where.left);
      const contractTable = contract.storage.tables[table];
      const columnMeta = contractTable?.columns[column];
      const meta =
        (where.left as unknown as { columnMeta?: { codecId?: string; nullable?: boolean } })
          .columnMeta ?? {};

      descriptors.push({
        name: paramName,
        source: 'dsl',
        refs: { table, column },
        ...(typeof meta.nullable === 'boolean' ? { nullable: meta.nullable } : {}),
      });

      augmentDescriptorWithColumnMeta(descriptors, columnMeta);
    }

    rightExpr = createParamRef(index, paramName);
  } else if (isColumnBuilder(where.right)) {
    // Handle column builder on the right
    const { table, column } = getColumnInfo(where.right);

    const contractTable = contract.storage.tables[table];
    if (!contractTable) {
      errorUnknownTable(table);
    }

    // If column not found in contract, still build expression
    // This allows flexibility when columnMeta is available on the column builder
    rightExpr = createColumnRef(table, column);
    // Use a placeholder paramName for column references (not used for params)
    paramName = '';
  } else {
    // where.right is neither ParamPlaceholder nor ColumnBuilder - invalid state
    errorFailedToBuildWhereClause();
  }

  return {
    expr: createBinaryExpr(where.op, leftExpr, rightExpr),
    ...(codecId ? { codecId } : {}),
    paramName,
  };
}
