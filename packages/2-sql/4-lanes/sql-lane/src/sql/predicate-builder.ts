import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type {
  AnyExpression,
  AnySqlComparable,
  AnyWhereExpr,
  NullCheckExpr,
} from '@prisma-next/sql-relational-core/ast';
import {
  BinaryExpr,
  NullCheckExpr as NullCheckExprNode,
  ParamRef as ParamRefNode,
} from '@prisma-next/sql-relational-core/ast';
import type {
  BinaryBuilder,
  NullCheckBuilder,
  ParamPlaceholder,
  UnaryBuilder,
} from '@prisma-next/sql-relational-core/types';
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
  expr: AnyWhereExpr;
  codecId: string | undefined;
  paramName: string;
}

/**
 * Type guard to check if a builder is a NullCheckBuilder (unary).
 */
function isNullCheckBuilder(builder: BinaryBuilder | UnaryBuilder): builder is NullCheckBuilder {
  return builder.kind === 'nullCheck';
}

/**
 * Builds a NullCheckExpr from a NullCheckBuilder.
 */
function buildNullCheckExpr(
  contract: SqlContract<SqlStorage>,
  where: NullCheckBuilder,
): NullCheckExpr {
  const expr = where.expr;

  if (expr.kind === 'column-ref') {
    const { table, column } = expr;
    const contractTable = contract.storage.tables[table];
    if (!contractTable) {
      errorUnknownTable(table);
    }

    const columnMeta: StorageColumn | undefined = contractTable.columns[column];
    if (!columnMeta) {
      errorUnknownColumn(column, table);
    }
  }

  return where.isNull ? NullCheckExprNode.isNull(expr) : NullCheckExprNode.isNotNull(expr);
}

export function buildWhereExpr(
  contract: SqlContract<SqlStorage>,
  where: BinaryBuilder | UnaryBuilder,
  paramsMap: Record<string, unknown>,
  descriptors: ParamDescriptor[],
  values: unknown[],
): BuildWhereExprResult {
  // Handle NullCheckBuilder (unary expression)
  if (isNullCheckBuilder(where)) {
    return {
      expr: buildNullCheckExpr(contract, where),
      codecId: undefined,
      paramName: '',
    };
  }

  // Handle BinaryBuilder (binary expression)
  let leftExpr: AnyExpression;
  let codecId: string | undefined;
  let rightExpr: AnySqlComparable;
  let paramName: string;

  leftExpr = where.left;

  if (leftExpr.kind === 'column-ref') {
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

  if (isParamPlaceholder(where.right)) {
    const placeholder: ParamPlaceholder = where.right;
    paramName = placeholder.name;

    if (!Object.hasOwn(paramsMap, paramName)) {
      errorMissingParameter(paramName);
    }

    const value = paramsMap[paramName];
    const index = values.push(value);

    if (leftExpr.kind === 'column-ref') {
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

    rightExpr = ParamRefNode.of(index, paramName);
  } else if (isColumnBuilder(where.right) || isExpressionBuilder(where.right)) {
    rightExpr = where.right.toExpr();

    if (rightExpr.kind === 'column-ref') {
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

    paramName = '';
  } else {
    errorFailedToBuildWhereClause();
  }

  return {
    expr: new BinaryExpr(where.op, leftExpr, rightExpr),
    codecId,
    paramName,
  };
}
