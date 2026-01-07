import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type { BinaryExpr, Expression, ParamRef } from '@prisma-next/sql-relational-core/ast';
import {
  isColumnBuilder,
  isExpressionBuilder,
  isParamPlaceholder,
} from '@prisma-next/sql-relational-core/guards';
import { augmentDescriptorWithColumnMeta } from '@prisma-next/sql-relational-core/plan';
import type { BinaryBuilder, ParamPlaceholder } from '@prisma-next/sql-relational-core/types';
import { createBinaryExpr, createParamRef } from '../utils/ast.ts';
import {
  errorFailedToBuildWhereClause,
  errorMissingParameter,
  errorUnknownTable,
} from '../utils/errors.ts';

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
  let leftExpr: Expression;
  let codecId: string | undefined;
  let rightExpr: Expression | ParamRef;
  let paramName: string;

  // where.left is now an Expression (ColumnRef or OperationExpr)
  leftExpr = where.left;

  // If leftExpr is a ColumnRef, extract codecId from contract
  if (leftExpr.kind === 'col') {
    const { table, column } = leftExpr;

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
  }

  // Handle where.right - can be ParamPlaceholder or AnyExpressionSource
  if (isParamPlaceholder(where.right)) {
    // Handle param placeholder (existing logic)
    const placeholder: ParamPlaceholder = where.right;
    paramName = placeholder.name;

    if (!Object.hasOwn(paramsMap, paramName)) {
      errorMissingParameter(paramName);
    }

    const value = paramsMap[paramName];
    const index = values.push(value);

    // Construct descriptor from where.left Expression
    // For ColumnRef, we can extract table/column directly
    // For OperationExpr, we extract the base column reference
    if (leftExpr.kind === 'col') {
      const { table, column } = leftExpr;
      const contractTable = contract.storage.tables[table];
      const columnMeta = contractTable?.columns[column];

      descriptors.push({
        name: paramName,
        source: 'dsl',
        refs: { table, column },
        ...(columnMeta && typeof columnMeta.nullable === 'boolean'
          ? { nullable: columnMeta.nullable }
          : {}),
      });

      augmentDescriptorWithColumnMeta(descriptors, columnMeta);
    }
    // For OperationExpr, we don't create descriptors since we can't reliably extract column info

    rightExpr = createParamRef(index, paramName);
  } else if (isColumnBuilder(where.right) || isExpressionBuilder(where.right)) {
    // Handle ExpressionSource on the right - use toExpr() to get the Expression
    rightExpr = where.right.toExpr();
    // Use a placeholder paramName for expression references (not used for params)
    paramName = '';
  } else {
    // where.right is neither ParamPlaceholder nor ExpressionSource - invalid state
    errorFailedToBuildWhereClause();
  }

  return {
    expr: createBinaryExpr(where.op, leftExpr, rightExpr),
    ...(codecId ? { codecId } : {}),
    paramName,
  };
}
