import type {
  ColumnRef,
  DeleteAst,
  InsertAst,
  InsertOnConflictAst,
  InsertValue,
  ParamRef,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { createDefaultValueExpr } from '@prisma-next/sql-relational-core/ast';
import { ifDefined } from '@prisma-next/utils/defined';
import {
  DefaultInsertValueNode,
  type DeleteQueryNode,
  type InsertQueryNode,
  type OnConflictNode,
  PrimitiveValueListNode,
  ReferenceNode,
  type ReturningNode,
  SelectAllNode,
  type UpdateQueryNode,
  ValueListNode,
  ValuesNode,
} from 'kysely';
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from './errors';
import {
  getColumnName,
  getTableName,
  isOperationNode,
  isSelectAllReference,
  unwrapAliasNode,
  unwrapSelectionNode,
  unwrapWhereNode,
} from './kysely-ast-types';
import type { TransformContext } from './transform-context';
import { transformValue, transformWhereExpr } from './transform-expr';
import { expandSelectAll } from './transform-select';
import { resolveColumnRef, transformTableRef, validateColumn } from './transform-validate';

function assertParamRef(value: ReturnType<typeof transformValue>): ParamRef {
  if (value.kind !== 'param') {
    throw new KyselyTransformError(
      'Only parameterized VALUES are supported in Kysely transform lane',
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
    );
  }
  return value;
}

function transformReturning(
  returningNode: ReturningNode | undefined,
  ctx: TransformContext,
  tableName: string,
): ColumnRef[] | undefined {
  if (!returningNode) {
    return undefined;
  }

  const refs: ColumnRef[] = [];
  for (const selection of returningNode.selections) {
    const unwrappedSelection = unwrapSelectionNode(selection);
    const { node: selectionNode } = unwrapAliasNode(unwrappedSelection);

    if (SelectAllNode.is(selectionNode) || isSelectAllReference(selectionNode)) {
      const expanded = expandSelectAll(tableName, ctx.contract);
      for (const { expr } of expanded) {
        refs.push(expr);
      }
      continue;
    }

    if (ReferenceNode.is(selectionNode)) {
      refs.push(resolveColumnRef(selectionNode, ctx, tableName));
      continue;
    }

    throw new KyselyTransformError(
      `Unsupported returning selection node: ${selectionNode.kind}`,
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      { nodeKind: selectionNode.kind },
    );
  }

  return refs.length > 0 ? refs : undefined;
}

function transformOnConflictUpdateValue(
  node: unknown,
  ctx: TransformContext,
  tableName: string,
  columnName: string,
): ColumnRef | ParamRef {
  if (isOperationNode(node) && ReferenceNode.is(node)) {
    const refTable = getTableName(node);
    const refColumn = getColumnName(node);

    if (refTable === 'excluded') {
      if (!refColumn) {
        throw new KyselyTransformError(
          'Could not resolve EXCLUDED column name',
          KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
        );
      }

      validateColumn(ctx.contract, tableName, refColumn);
      return { kind: 'col', table: 'excluded', column: refColumn };
    }

    return resolveColumnRef(node, ctx, tableName);
  }

  return assertParamRef(
    transformValue(node, ctx, {
      table: tableName,
      column: columnName,
    }),
  );
}

function transformOnConflict(
  node: OnConflictNode | undefined,
  ctx: TransformContext,
  tableName: string,
): InsertOnConflictAst | undefined {
  if (!node) {
    return undefined;
  }

  if (node.constraint || node.indexExpression || node.indexWhere || node.updateWhere) {
    throw new KyselyTransformError(
      'Only column-based ON CONFLICT clauses are supported in Kysely transform lane',
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      { nodeKind: node.kind },
    );
  }

  const columns = (node.columns ?? []).map((columnNode) =>
    resolveColumnRef(columnNode, ctx, tableName),
  );
  if (columns.length === 0) {
    throw new KyselyTransformError(
      'ON CONFLICT requires at least one conflict column',
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      { nodeKind: node.kind },
    );
  }

  if (node.doNothing === true) {
    return {
      columns,
      action: { kind: 'doNothing' },
    };
  }

  if (node.updates && node.updates.length > 0) {
    const set: Record<string, ColumnRef | ParamRef> = {};

    for (const updateNode of node.updates) {
      const columnName = getColumnName(updateNode.column);
      if (!columnName) {
        throw new KyselyTransformError(
          'Could not resolve ON CONFLICT update column name',
          KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
        );
      }

      validateColumn(ctx.contract, tableName, columnName);
      set[columnName] = transformOnConflictUpdateValue(
        updateNode.value,
        ctx,
        tableName,
        columnName,
      );
    }

    return {
      columns,
      action: {
        kind: 'doUpdateSet',
        set,
      },
    };
  }

  throw new KyselyTransformError(
    'Unsupported ON CONFLICT action',
    KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
    { nodeKind: node.kind },
  );
}

export function transformInsert(node: InsertQueryNode, ctx: TransformContext): InsertAst {
  if (!node.into) {
    throw new KyselyTransformError(
      'INSERT query requires INTO clause',
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
    );
  }

  const tableRef = transformTableRef(node.into, ctx);
  const insertOnConflict = transformOnConflict(node.onConflict, ctx, tableRef.name);

  if (!node.values || !ValuesNode.is(node.values)) {
    if (node.defaultValues === true) {
      const insertReturning = transformReturning(node.returning, ctx, tableRef.name);

      return {
        kind: 'insert',
        table: tableRef,
        rows: [{}],
        ...ifDefined('onConflict', insertOnConflict),
        ...ifDefined(
          'returning',
          insertReturning && insertReturning.length > 0 ? insertReturning : undefined,
        ),
      };
    }

    throw new KyselyTransformError(
      'INSERT query requires VALUES',
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
    );
  }

  const rows: Array<Record<string, InsertValue>> = [];

  if (node.values.values[0] && (!node.columns || node.columns.length === 0)) {
    throw new KyselyTransformError(
      'INSERT query requires column list for VALUES transformation',
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
    );
  }

  if (node.columns && node.columns.length > 0) {
    for (const rowNode of node.values.values) {
      const rowValues = PrimitiveValueListNode.is(rowNode)
        ? rowNode.values
        : ValueListNode.is(rowNode)
          ? rowNode.values
          : undefined;

      if (!rowValues) {
        throw new KyselyTransformError(
          `Unsupported insert row node: ${rowNode.kind}`,
          KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
          { nodeKind: rowNode.kind },
        );
      }

      const valuesRecord: Record<string, InsertValue> = {};

      for (let index = 0; index < node.columns.length; index++) {
        const columnNode = node.columns[index];
        const columnName = getColumnName(columnNode);
        if (!columnName) {
          throw new KyselyTransformError(
            'Could not resolve INSERT column name',
            KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
          );
        }

        validateColumn(ctx.contract, tableRef.name, columnName);
        ctx.refsTables.add(tableRef.name);
        ctx.refsColumns.set(`${tableRef.name}.${columnName}`, {
          table: tableRef.name,
          column: columnName,
        });

        const valueNode = rowValues[index];
        if (valueNode === undefined) {
          valuesRecord[columnName] = createDefaultValueExpr();
          continue;
        }

        if (isOperationNode(valueNode) && DefaultInsertValueNode.is(valueNode)) {
          valuesRecord[columnName] = createDefaultValueExpr();
          continue;
        }

        const transformed = transformValue(valueNode, ctx, {
          table: tableRef.name,
          column: columnName,
        });
        valuesRecord[columnName] = assertParamRef(transformed);
      }

      rows.push(valuesRecord);
    }
  }

  const insertReturning = transformReturning(node.returning, ctx, tableRef.name);

  return {
    kind: 'insert',
    table: tableRef,
    rows,
    ...ifDefined('onConflict', insertOnConflict),
    ...ifDefined(
      'returning',
      insertReturning && insertReturning.length > 0 ? insertReturning : undefined,
    ),
  };
}

export function transformUpdate(node: UpdateQueryNode, ctx: TransformContext): UpdateAst {
  if (!node.table) {
    throw new KyselyTransformError(
      'UPDATE query requires table clause',
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
    );
  }

  const tableRef = transformTableRef(node.table, ctx);

  const setRecord: Record<string, ColumnRef | ParamRef> = {};
  for (const update of node.updates ?? []) {
    const colRef = resolveColumnRef(update.column, ctx, tableRef.name);
    const transformed = transformValue(update.value, ctx, {
      table: tableRef.name,
      column: colRef.column,
    });
    setRecord[colRef.column] = assertParamRef(transformed);
  }

  const where = transformWhereExpr(unwrapWhereNode(node.where), ctx, tableRef.name);
  const updateReturning = transformReturning(node.returning, ctx, tableRef.name);

  return {
    kind: 'update',
    table: tableRef,
    set: setRecord,
    ...ifDefined('where', where ?? undefined),
    ...ifDefined(
      'returning',
      updateReturning && updateReturning.length > 0 ? updateReturning : undefined,
    ),
  };
}

export function transformDelete(node: DeleteQueryNode, ctx: TransformContext): DeleteAst {
  const tableRef = transformTableRef(node.from, ctx);
  const where = transformWhereExpr(unwrapWhereNode(node.where), ctx, tableRef.name);
  const deleteReturning = transformReturning(node.returning, ctx, tableRef.name);

  return {
    kind: 'delete',
    table: tableRef,
    ...ifDefined('where', where ?? undefined),
    ...ifDefined(
      'returning',
      deleteReturning && deleteReturning.length > 0 ? deleteReturning : undefined,
    ),
  };
}
