import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { ColumnRef, TableRef } from '@prisma-next/sql-relational-core/ast';
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from './errors';
import { getColumnName, getTableName } from './kysely-ast-types';
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
  if (ctx.multiTableScope && tableOverride !== undefined && getTableName(node) === undefined) {
    throw new KyselyTransformError(
      'Unqualified column reference in multi-table scope; use table.column (e.g. user.id)',
      KYSELY_TRANSFORM_ERROR_CODES.UNQUALIFIED_REF_IN_MULTI_TABLE,
    );
  }
  const table = tableOverride ?? resolveTable(node, ctx);
  let column = getColumnName(node);
  if (!column && typeof node === 'object' && node !== null) {
    const n = node as Record<string, unknown>;
    const col = n['column'];
    if (col && typeof col === 'object') {
      column = getColumnName(col);
    }
  }
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
  const name = getTableName(node);
  if (!name) {
    throw new KyselyTransformError(
      'Could not resolve table from FROM node',
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
    );
  }
  const resolved = ctx.tableAliases.get(name) ?? name;
  validateTable(ctx.contract, resolved);
  ctx.refsTables.add(resolved);
  return { kind: 'table', name: resolved };
}
