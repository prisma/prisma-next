import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { ColumnRef, TableRef } from '@prisma-next/sql-relational-core/ast';
import { ReferenceNode, SelectAllNode } from 'kysely';
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from './errors';
import {
  getColumnName,
  getTableName,
  getTableReferenceInfo,
  isOperationNode,
} from './kysely-ast-types';
import type { TransformContext } from './transform-context';

export function validateTable(contract: SqlContract<SqlStorage>, table: string): void {
  if (!contract.storage.tables[table]) {
    throw new KyselyTransformError(
      `Unknown table "${table}"`,
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
      { table },
    );
  }
}

export function validateColumn(
  contract: SqlContract<SqlStorage>,
  table: string,
  column: string,
): void {
  validateTable(contract, table);
  const tableDef = contract.storage.tables[table];
  if (!tableDef?.columns[column]) {
    throw new KyselyTransformError(
      `Unknown column "${table}.${column}"`,
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
      { table, column },
    );
  }
}

export function resolveTable(node: unknown, ctx: TransformContext, defaultTable?: string): string {
  const explicitTable = getTableName(node);

  if (ctx.multiTableScope && explicitTable === undefined && defaultTable !== undefined) {
    throw new KyselyTransformError(
      'Unqualified column reference in multi-table scope; use table.column (e.g. user.id)',
      KYSELY_TRANSFORM_ERROR_CODES.UNQUALIFIED_REF_IN_MULTI_TABLE,
    );
  }

  const table = explicitTable ?? defaultTable;
  if (!table) {
    throw new KyselyTransformError(
      'Could not resolve table for column reference',
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
    );
  }

  const resolved = ctx.tableAliases.get(table) ?? table;
  validateTable(ctx.contract, resolved);
  return resolved;
}

export function resolveColumnRef(
  node: unknown,
  ctx: TransformContext,
  tableOverride?: string,
): ColumnRef {
  const operationNode = isOperationNode(node) ? node : undefined;

  if (operationNode && ReferenceNode.is(operationNode) && SelectAllNode.is(operationNode.column)) {
    throw new KyselyTransformError(
      'selectAll references cannot be used as scalar column expressions',
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
    );
  }

  const table = resolveTable(node, ctx, tableOverride);
  const column = getColumnName(node);

  if (!column) {
    throw new KyselyTransformError(
      'Could not resolve column reference',
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
    );
  }

  validateColumn(ctx.contract, table, column);
  ctx.refsTables.add(table);
  ctx.refsColumns.set(`${table}.${column}`, { table, column });

  return { kind: 'col', table, column };
}

export function transformTableRef(node: unknown, ctx: TransformContext): TableRef {
  const info = getTableReferenceInfo(node);
  if (!info) {
    throw new KyselyTransformError(
      'Could not resolve table from FROM node',
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
    );
  }

  const resolved = ctx.tableAliases.get(info.table) ?? info.table;
  validateTable(ctx.contract, resolved);

  if (info.alias) {
    ctx.tableAliases.set(info.alias, resolved);
  }

  ctx.refsTables.add(resolved);
  return { kind: 'table', name: resolved };
}
