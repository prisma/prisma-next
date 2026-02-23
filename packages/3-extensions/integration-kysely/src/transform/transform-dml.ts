import type {
  ColumnRef,
  DeleteAst,
  InsertAst,
  ParamRef,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { ifDefined } from '@prisma-next/utils/defined';
import {
  type DeleteQueryNode,
  type InsertQueryNode,
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
  isSelectAllReference,
  unwrapAliasNode,
  unwrapSelectionNode,
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

    refs.push(resolveColumnRef(selectionNode, ctx, tableName));
  }

  return refs.length > 0 ? refs : undefined;
}

export function transformInsert(node: InsertQueryNode, ctx: TransformContext): InsertAst {
  if (!node.into) {
    throw new KyselyTransformError(
      'INSERT query requires INTO clause',
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
    );
  }

  const tableRef = transformTableRef(node.into, ctx);

  if (!node.values || !ValuesNode.is(node.values)) {
    throw new KyselyTransformError(
      'INSERT query requires VALUES',
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
    );
  }

  if (node.values.values.length > 1) {
    throw new KyselyTransformError(
      'Multi-row INSERT values are not supported; use single-row INSERT or batch via separate plans',
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      { rowCount: node.values.values.length },
    );
  }

  const valuesRecord: Record<string, ColumnRef | ParamRef> = {};
  const firstRow = node.values.values[0];

  if (firstRow && (!node.columns || node.columns.length === 0)) {
    throw new KyselyTransformError(
      'INSERT query requires column list for VALUES transformation',
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
    );
  }

  if (firstRow && node.columns && node.columns.length > 0) {
    const rowValues = PrimitiveValueListNode.is(firstRow)
      ? firstRow.values
      : ValueListNode.is(firstRow)
        ? firstRow.values
        : undefined;

    if (!rowValues) {
      throw new KyselyTransformError(
        `Unsupported insert row node: ${firstRow.kind}`,
        KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
        { nodeKind: firstRow.kind },
      );
    }

    for (let index = 0; index < node.columns.length; index++) {
      const columnNode = node.columns[index];
      const columnName = getColumnName(columnNode);
      if (!columnName) {
        throw new KyselyTransformError(
          'Could not resolve INSERT column name',
          KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
        );
      }

      const valueNode = rowValues[index];
      if (valueNode === undefined) {
        continue;
      }

      validateColumn(ctx.contract, tableRef.name, columnName);
      ctx.refsTables.add(tableRef.name);
      ctx.refsColumns.set(`${tableRef.name}.${columnName}`, {
        table: tableRef.name,
        column: columnName,
      });

      const transformed = transformValue(valueNode, ctx, {
        table: tableRef.name,
        column: columnName,
      });
      valuesRecord[columnName] = assertParamRef(transformed);
    }
  }

  const insertReturning = transformReturning(node.returning, ctx, tableRef.name);

  return {
    kind: 'insert',
    table: tableRef,
    values: valuesRecord,
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

  const where = transformWhereExpr(node.where?.where, ctx, tableRef.name);
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
  const where = transformWhereExpr(node.where?.where, ctx, tableRef.name);
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
