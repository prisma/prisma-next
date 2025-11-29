import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { BinaryExpr, ColumnRef, OperationExpr } from '@prisma-next/sql-relational-core/ast';
import type { BinaryBuilder } from '@prisma-next/sql-relational-core/types';
import { createBinaryExpr, createColumnRef, createParamRef } from '../utils/ast';
import { errorMissingParameter } from '../utils/errors';

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
    // Use codecId if present, otherwise fallback to deprecated type field
    codecId = columnMeta?.codecId ?? columnMeta?.type;

    leftExpr = createColumnRef(colBuilder.table, colBuilder.column);
  }

  return {
    expr: createBinaryExpr('eq', leftExpr, createParamRef(index, paramName)),
    ...(codecId ? { codecId } : {}),
    paramName,
  };
}
