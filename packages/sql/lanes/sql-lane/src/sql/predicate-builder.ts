import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { BinaryExpr, ColumnRef, OperationExpr } from '@prisma-next/sql-relational-core/ast';
import {
  createBinaryExpr,
  createColumnRef,
  createParamRef,
} from '@prisma-next/sql-relational-core/ast';
import type { BinaryBuilder } from '@prisma-next/sql-relational-core/types';
import { errorMissingParameter } from '../utils/errors';

export interface BuildWhereExprResult {
  expr: BinaryExpr;
  codecId?: string;
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

  const operationExpr = (where.left as { _operationExpr?: OperationExpr })._operationExpr;
  if (operationExpr) {
    leftExpr = operationExpr;
  } else {
    // where.left is ColumnBuilder - TypeScript can't narrow properly
    const colBuilder = where.left as unknown as {
      table: string;
      column: string;
      columnMeta?: { codecId: string; nullable?: boolean };
    };
    const meta = (colBuilder.columnMeta ?? {}) as { codecId?: string; nullable?: boolean };

    descriptors.push({
      name: paramName,
      source: 'dsl',
      refs: { table: colBuilder.table, column: colBuilder.column },
      ...(typeof meta.codecId === 'string' ? { type: meta.codecId } : {}),
      ...(typeof meta.nullable === 'boolean' ? { nullable: meta.nullable } : {}),
    });

    const contractTable = contract.storage.tables[colBuilder.table];
    const columnMeta = contractTable?.columns[colBuilder.column];
    codecId = columnMeta?.codecId;

    leftExpr = createColumnRef(colBuilder.table, colBuilder.column);
  }

  const rightParam = createParamRef(index, paramName);
  return {
    expr: createBinaryExpr('eq', leftExpr, rightParam),
    ...(codecId ? { codecId } : {}),
    paramName,
  };
}
