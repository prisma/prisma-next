import type {
  ColumnRef,
  DeleteAst,
  InsertAst,
  ParamRef,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { ifDefined } from '@prisma-next/utils/defined';
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from './errors';
import { getColumnName, hasKind } from './kysely-ast-types';
import type { TransformContext } from './transform-context';
import { transformValue, transformWhereExpr } from './transform-expr';
import { expandSelectAll } from './transform-select';
import { resolveColumnRef, transformTableRef, validateColumn } from './transform-validate';

function transformReturning(
  returningNode: unknown,
  ctx: TransformContext,
  tableName: string,
): ColumnRef[] | undefined {
  if (!returningNode) return undefined;
  const returningRec = returningNode as Record<string, unknown>;
  const items = returningRec['selections'] as unknown[] | undefined;
  if (!Array.isArray(items)) return undefined;

  const refs: ColumnRef[] = [];
  for (const item of items) {
    const exprNode =
      (item as Record<string, unknown>)?.['selection'] ??
      (item as Record<string, unknown>)?.['column'] ??
      item;
    if (hasKind(exprNode, 'SelectAllNode') || hasKind(item, 'SelectAllNode')) {
      const expanded = expandSelectAll(tableName, ctx.contract);
      for (const { expr } of expanded) {
        if (expr.kind === 'col') refs.push(expr);
      }
    } else {
      const colNode = (item as Record<string, unknown>)?.['column'] ?? exprNode;
      const exprCol = (exprNode as Record<string, unknown>)?.['column'];
      const toResolve = colNode ?? exprCol ?? item;
      const colName = getColumnName(toResolve);
      if (colName) {
        refs.push(resolveColumnRef(toResolve, ctx, tableName));
      } else {
        const nodeKind =
          typeof toResolve === 'object' && toResolve !== null && 'kind' in toResolve
            ? String((toResolve as { kind?: unknown }).kind ?? 'unknown')
            : 'unknown';
        throw new KyselyTransformError(
          'Unsupported RETURNING expression; only column references and selectAll are supported',
          KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
          { nodeKind },
        );
      }
    }
  }
  return refs.length > 0 ? refs : undefined;
}

export function transformInsert(node: Record<string, unknown>, ctx: TransformContext): InsertAst {
  const intoNode = node['into'] ?? node['table'];
  const tableRef = transformTableRef(intoNode, ctx);

  const valuesNode = node['values'];
  if (!valuesNode) {
    throw new KyselyTransformError(
      'INSERT query requires VALUES',
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
    );
  }

  const valuesRecord: Record<string, ColumnRef | ParamRef> = {};
  const valuesRec = valuesNode as Record<string, unknown>;
  const valueEntries = valuesRec['values'] as unknown[] | undefined;

  const columns = node['columns'] as unknown[] | undefined;
  const firstEntry = Array.isArray(valueEntries) ? valueEntries[0] : undefined;
  const isRowFormat =
    Array.isArray(columns) &&
    columns.length > 0 &&
    firstEntry !== undefined &&
    (hasKind(firstEntry, 'PrimitiveValueListNode') ||
      (Array.isArray(firstEntry) && firstEntry.length > 0));
  if (isRowFormat && Array.isArray(valueEntries) && valueEntries.length > 1) {
    throw new KyselyTransformError(
      'Multi-row INSERT values are not supported; use single-row INSERT or batch via separate plans',
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      { rowCount: valueEntries.length },
    );
  }
  if (
    Array.isArray(columns) &&
    columns.length > 0 &&
    Array.isArray(valueEntries) &&
    valueEntries.length > 0
  ) {
    const firstRow = valueEntries[0];
    const rowValues =
      hasKind(firstRow, 'PrimitiveValueListNode') &&
      Array.isArray((firstRow as Record<string, unknown>)['values'])
        ? ((firstRow as Record<string, unknown>)['values'] as unknown[])
        : [firstRow];
    const tableDef = ctx.contract.storage.tables[tableRef.name];
    const tableCols = tableDef?.columns ? Object.keys(tableDef.columns).sort() : [];
    for (let i = 0; i < rowValues.length; i++) {
      const colName =
        i < columns.length
          ? (getColumnName(columns[i]) ?? (i < tableCols.length ? tableCols[i] : undefined))
          : i < tableCols.length
            ? tableCols[i]
            : undefined;
      if (!colName) continue;
      validateColumn(ctx.contract, tableRef.name, colName);
      ctx.refsTables.add(tableRef.name);
      ctx.refsColumns.set(`${tableRef.name}.${colName}`, { table: tableRef.name, column: colName });
      const val = transformValue(rowValues[i], ctx, {
        table: tableRef.name,
        column: colName,
      });
      valuesRecord[colName] = val as ParamRef;
    }
  } else if (Array.isArray(valueEntries)) {
    for (const entry of valueEntries) {
      if (
        hasKind(entry, 'PrimitiveValueListNode') ||
        (typeof entry === 'object' && entry !== null && !('column' in entry) && !('value' in entry))
      ) {
        continue;
      }
      const colNode = (entry as { column?: unknown; value?: unknown }).column ?? entry;
      const colRef = resolveColumnRef(colNode, ctx, tableRef.name);
      const valueNode = (entry as { column?: unknown; value?: unknown }).value ?? entry;
      const val = transformValue(valueNode, ctx, { table: tableRef.name, column: colRef.column });
      valuesRecord[colRef.column] = val as ParamRef;
    }
  }

  const insertReturning = transformReturning(node['returning'], ctx, tableRef.name);

  return {
    kind: 'insert',
    table: tableRef,
    values: valuesRecord,
    ...ifDefined(
      'returning',
      insertReturning && insertReturning.length > 0 ? insertReturning : undefined,
    ),
  } as InsertAst;
}

export function transformUpdate(node: Record<string, unknown>, ctx: TransformContext): UpdateAst {
  const tableNode = node['table'] ?? node['update'];
  const tableRef = transformTableRef(tableNode, ctx);

  const updates = node['updates'] ?? node['set'];
  const setRecord: Record<string, ColumnRef | ParamRef> = {};
  const updateEntries = Array.isArray(updates) ? updates : [];
  for (const entry of updateEntries) {
    const e = entry as Record<string, unknown>;
    const colNode = e['column'] ?? e['key'] ?? entry;
    const colRef = resolveColumnRef(colNode, ctx, tableRef.name);
    const valueNode = e['value'] ?? entry;
    const val = transformValue(valueNode, ctx, { table: tableRef.name, column: colRef.column });
    setRecord[colRef.column] = val as ParamRef;
  }

  const updateWhereNode = node['where'];
  const where = transformWhereExpr(
    (updateWhereNode as Record<string, unknown> | null)?.['node'] ??
      (updateWhereNode as Record<string, unknown> | null)?.['where'] ??
      updateWhereNode,
    ctx,
    tableRef.name,
  );

  const updateReturning = transformReturning(node['returning'], ctx, tableRef.name);

  return {
    kind: 'update',
    table: tableRef,
    set: setRecord,
    ...ifDefined('where', where ?? undefined),
    ...ifDefined(
      'returning',
      updateReturning && updateReturning.length > 0 ? updateReturning : undefined,
    ),
  } as UpdateAst;
}

export function transformDelete(node: Record<string, unknown>, ctx: TransformContext): DeleteAst {
  const fromNode = node['from'] ?? node['delete'];
  const tableRef = transformTableRef(fromNode, ctx);

  const deleteWhereNode = node['where'];
  const where = transformWhereExpr(
    (deleteWhereNode as Record<string, unknown> | null)?.['node'] ??
      (deleteWhereNode as Record<string, unknown> | null)?.['where'] ??
      deleteWhereNode,
    ctx,
    tableRef.name,
  );

  const deleteReturning = transformReturning(node['returning'], ctx, tableRef.name);

  return {
    kind: 'delete',
    table: tableRef,
    ...ifDefined('where', where ?? undefined),
    ...ifDefined(
      'returning',
      deleteReturning && deleteReturning.length > 0 ? deleteReturning : undefined,
    ),
  } as DeleteAst;
}
