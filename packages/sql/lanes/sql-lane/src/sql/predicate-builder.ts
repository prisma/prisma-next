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
import { errorMissingParameter, errorUnknownColumn, errorUnknownTable } from '../utils/errors';

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

  const operationExpr = (where.left as { _operationExpr?: OperationExpr })._operationExpr;
  if (operationExpr) {
    leftExpr = operationExpr;
  } else {
    // where.left is ColumnBuilder - TypeScript can't narrow properly
    const colBuilder = where.left as unknown as {
      table: string;
      column: string;
    };

    const contractTable = contract.storage.tables[colBuilder.table];
    if (!contractTable) {
      errorUnknownTable(colBuilder.table);
    }

    const columnMeta: StorageColumn | undefined = contractTable.columns[colBuilder.column];
    if (!columnMeta) {
      errorUnknownColumn(colBuilder.column, colBuilder.table);
    }

    // Construct descriptor directly from validated StorageColumn
    descriptors.push({
      name: paramName,
      source: 'dsl',
      refs: { table: colBuilder.table, column: colBuilder.column },
      nullable: columnMeta.nullable,
      codecId: columnMeta.codecId,
      nativeType: columnMeta.nativeType,
    });

    augmentDescriptorWithColumnMeta(descriptors, columnMeta);

    codecId = columnMeta.codecId;
    leftExpr = createColumnRef(colBuilder.table, colBuilder.column);
  }

  const rightParam = createParamRef(index, paramName);
  return {
    expr: createBinaryExpr('eq', leftExpr, rightParam),
    codecId,
    paramName,
  };
}
