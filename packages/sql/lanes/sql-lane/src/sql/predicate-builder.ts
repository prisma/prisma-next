import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  BinaryExpr,
  ColumnRef,
  LogicalExpr,
  OperationExpr,
} from '@prisma-next/sql-relational-core/ast';
import {
  createBinaryExpr,
  createColumnRef,
  createLogicalExpr,
  createParamRef,
} from '@prisma-next/sql-relational-core/ast';
import type {
  AnyPredicateBuilder,
  BinaryBuilder,
  LogicalBuilder,
} from '@prisma-next/sql-relational-core/types';
import { errorMissingParameter } from '../utils/errors';

export interface BuildWhereExprResult {
  expr: BinaryExpr | LogicalExpr;
  codecId?: string;
  paramName?: string;
}

function buildBinaryExpr(
  contract: SqlContract<SqlStorage>,
  where: BinaryBuilder,
  paramsMap: Record<string, unknown>,
  descriptors: ParamDescriptor[],
  values: unknown[],
): { expr: BinaryExpr; codecId?: string; paramName: string } {
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
      columnMeta?: { type?: string; nullable?: boolean };
    };
    const meta = (colBuilder.columnMeta ?? {}) as { type?: string; nullable?: boolean };

    descriptors.push({
      name: paramName,
      source: 'dsl',
      refs: { table: colBuilder.table, column: colBuilder.column },
      ...(typeof meta.type === 'string' ? { type: meta.type } : {}),
      ...(typeof meta.nullable === 'boolean' ? { nullable: meta.nullable } : {}),
    });

    const contractTable = contract.storage.tables[colBuilder.table];
    const columnMeta = contractTable?.columns[colBuilder.column];
    codecId = columnMeta?.type;

    leftExpr = createColumnRef(colBuilder.table, colBuilder.column);
  }

  const rightParam = createParamRef(index, paramName);
  return {
    expr: createBinaryExpr(where.op, leftExpr, rightParam),
    ...(codecId ? { codecId } : {}),
    paramName,
  };
}

export function buildWhereExpr(
  contract: SqlContract<SqlStorage>,
  where: AnyPredicateBuilder,
  paramsMap: Record<string, unknown>,
  descriptors: ParamDescriptor[],
  values: unknown[],
): BuildWhereExprResult {
  if (where.kind === 'logical') {
    const logical = where as LogicalBuilder;
    // Recursively build left side (can be BinaryBuilder or LogicalBuilder)
    const leftResult = buildWhereExpr(
      contract,
      logical.left as AnyPredicateBuilder,
      paramsMap,
      descriptors,
      values,
    );
    // Right side can be BinaryBuilder or LogicalBuilder (nested logical expressions)
    const rightResult = buildWhereExpr(contract, logical.right, paramsMap, descriptors, values);

    return {
      expr: createLogicalExpr(logical.op, leftResult.expr, rightResult.expr),
      ...(leftResult.codecId || rightResult.codecId
        ? { codecId: leftResult.codecId ?? rightResult.codecId }
        : {}),
    };
  }

  // BinaryBuilder case
  const binary = where as BinaryBuilder;
  return buildBinaryExpr(contract, binary, paramsMap, descriptors, values);
}
