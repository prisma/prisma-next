import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type {
  BinaryExpr,
  ColumnRef,
  OperationExpr,
  ParamRef,
} from '@prisma-next/sql-relational-core/ast';
import { augmentDescriptorWithColumnMeta } from '@prisma-next/sql-relational-core/plan';
import type { BinaryBuilder, ParamPlaceholder } from '@prisma-next/sql-relational-core/types';
import { createBinaryExpr, createColumnRef, createParamRef } from '../utils/ast';
import {
  errorFailedToBuildWhereClause,
  errorMissingParameter,
  errorUnknownTable,
} from '../utils/errors';
import {
  extractExpression,
  getColumnInfo,
  getColumnMeta,
  isColumnBuilder,
  isExpressionBuilder,
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

  // Extract expression from ColumnBuilder or ExpressionBuilder
  leftExpr = extractExpression(where.left);

  // If it's a ColumnRef, get codecId from contract
  if (leftExpr.kind === 'col') {
    const contractTable = contract.storage.tables[leftExpr.table];
    if (!contractTable) {
      errorUnknownTable(leftExpr.table);
    }

    const columnMeta: StorageColumn | undefined = contractTable.columns[leftExpr.column];
    // If column not found in contract, still build expression but without codecId
    // This allows flexibility when columnMeta is available on the column builder
    if (columnMeta) {
      codecId = columnMeta.codecId;
    }
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

    // Construct descriptor only if where.left is a ColumnRef (not OperationExpr)
    // OperationExpr doesn't have contract metadata, so we can't create a descriptor
    if (leftExpr.kind === 'col') {
      const contractTable = contract.storage.tables[leftExpr.table];
      const columnMeta = contractTable?.columns[leftExpr.column];
      // Get columnMeta from builder (works for both ColumnBuilder and ExpressionBuilder)
      const builderColumnMeta = isColumnBuilder(where.left)
        ? getColumnMeta(where.left)
        : isExpressionBuilder(where.left)
          ? where.left.columnMeta
          : undefined;

      descriptors.push({
        name: paramName,
        source: 'dsl',
        refs: { table: leftExpr.table, column: leftExpr.column },
        // Only include nullable if builderColumnMeta has it (don't fall back to contract)
        ...(typeof builderColumnMeta?.nullable === 'boolean'
          ? { nullable: builderColumnMeta.nullable }
          : {}),
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
