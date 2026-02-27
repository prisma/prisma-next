import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  ColumnRef,
  Expression,
  IncludeRef,
  JoinAst,
  LiteralExpr,
  SelectAst,
} from '@prisma-next/sql-relational-core/ast';
import { ifDefined } from '@prisma-next/utils/defined';
import {
  type JoinNode,
  ReferenceNode,
  SelectAllNode,
  type SelectionNode,
  type SelectQueryNode,
  ValueNode,
} from 'kysely';
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from './errors';
import {
  getColumnName,
  isSelectAllReference,
  unwrapAliasNode,
  unwrapSelectionNode,
} from './kysely-ast-types';
import { addParamDescriptor, nextParamIndex, type TransformContext } from './transform-context';
import { transformJoinOn, transformOrderByItem, transformWhereExpr } from './transform-expr';
import { resolveColumnRef, resolveTable, transformTableRef } from './transform-validate';

export function expandSelectAll(
  table: string,
  contract: SqlContract<SqlStorage>,
): Array<{ alias: string; expr: ColumnRef }> {
  const tableDef = contract.storage.tables[table];
  if (!tableDef) return [];
  const cols = Object.keys(tableDef.columns).sort();
  return cols.map((column) => ({
    alias: column,
    expr: { kind: 'col', table, column },
  }));
}

function resolveSelectAllTable(
  node: SelectAllNode | (ReferenceNode & { readonly column: SelectAllNode }),
  ctx: TransformContext,
  fromTable: string,
): string {
  if (SelectAllNode.is(node)) {
    if (ctx.multiTableScope) {
      throw new KyselyTransformError(
        'Ambiguous selectAll in multi-table scope; qualify with table (e.g. db.selectFrom(u).innerJoin(p).selectAll("user"))',
        KYSELY_TRANSFORM_ERROR_CODES.AMBIGUOUS_SELECT_ALL,
      );
    }
    return fromTable;
  }

  if (!node.table) {
    if (ctx.multiTableScope) {
      throw new KyselyTransformError(
        'Ambiguous selectAll in multi-table scope; qualify with table (e.g. db.selectFrom(u).innerJoin(p).selectAll("user"))',
        KYSELY_TRANSFORM_ERROR_CODES.AMBIGUOUS_SELECT_ALL,
      );
    }
    return fromTable;
  }

  return resolveTable(node.table, ctx, fromTable);
}

export function transformSelections(
  selections: ReadonlyArray<SelectionNode> | undefined,
  ctx: TransformContext,
  fromTable: string,
): SelectAst['project'] {
  const project: Array<{ alias: string; expr: Expression | IncludeRef | LiteralExpr }> = [];

  if (!selections || selections.length === 0) {
    return expandSelectAll(fromTable, ctx.contract).map(({ alias, expr }) => ({ alias, expr }));
  }

  for (const selection of selections) {
    const unwrappedSelection = unwrapSelectionNode(selection);
    const { node: selectionNode, alias: explicitAlias } = unwrapAliasNode(unwrappedSelection);

    if (SelectAllNode.is(selectionNode) || isSelectAllReference(selectionNode)) {
      const table = resolveSelectAllTable(selectionNode, ctx, fromTable);
      const expanded = expandSelectAll(table, ctx.contract);
      for (const { alias, expr } of expanded) {
        project.push({ alias, expr });
      }
      continue;
    }

    if (ReferenceNode.is(selectionNode)) {
      const colRef = resolveColumnRef(selectionNode, ctx, fromTable);
      project.push({ alias: explicitAlias ?? colRef.column, expr: colRef });
      continue;
    }

    const colRef = resolveColumnRef(selectionNode, ctx, fromTable);
    project.push({
      alias: explicitAlias ?? getColumnName(selectionNode) ?? `col_${project.length}`,
      expr: colRef,
    });
  }

  return project;
}

function mapJoinType(joinType: JoinNode['joinType']): JoinAst['joinType'] {
  switch (joinType) {
    case 'InnerJoin':
    case 'CrossJoin':
    case 'LateralInnerJoin':
    case 'LateralCrossJoin':
    case 'Using':
    case 'CrossApply':
      return 'inner';
    case 'LeftJoin':
    case 'LateralLeftJoin':
    case 'OuterApply':
      return 'left';
    case 'RightJoin':
      return 'right';
    case 'FullJoin':
      return 'full';
    default:
      throw new KyselyTransformError(
        `Unsupported join type: ${joinType}`,
        KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
        { nodeKind: 'JoinNode', joinType },
      );
  }
}

export function transformSelect(node: SelectQueryNode, ctx: TransformContext): SelectAst {
  if (!node.from || node.from.froms.length === 0) {
    throw new KyselyTransformError(
      'SELECT query requires FROM clause',
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
    );
  }

  const joinsRaw = node.joins ?? [];
  const multiFrom = node.from.froms.length > 1;
  ctx.multiTableScope = joinsRaw.length > 0 || multiFrom;

  const firstFrom = node.from.froms[0];
  const fromRef = transformTableRef(firstFrom, ctx);
  const fromTable = fromRef.name;

  const resolvedJoins = joinsRaw.map((joinNode) => ({
    joinNode,
    tableRef: transformTableRef(joinNode.table, ctx),
  }));

  const project = transformSelections(node.selections, ctx, fromTable);

  const where = transformWhereExpr(node.where?.where, ctx, fromTable);

  const orderBy =
    node.orderBy && node.orderBy.items.length > 0
      ? node.orderBy.items
          .map((item) => transformOrderByItem(item, ctx, fromTable))
          .filter((item): item is NonNullable<typeof item> => item !== undefined)
      : undefined;

  let limit: number | undefined;
  if (node.limit && ValueNode.is(node.limit.limit)) {
    if (typeof node.limit.limit.value === 'number') {
      limit = node.limit.limit.value;
    } else {
      const limitParamIndex = nextParamIndex(ctx);
      addParamDescriptor(ctx, {});
      const value = ctx.parameters[limitParamIndex - 1];
      limit = typeof value === 'number' ? value : undefined;
    }
  }

  const joins: JoinAst[] = [];
  for (const { joinNode, tableRef } of resolvedJoins) {
    const onExpr = transformJoinOn(joinNode.on?.on, ctx, fromTable, tableRef.name);
    joins.push({
      kind: 'join',
      joinType: mapJoinType(joinNode.joinType),
      table: tableRef,
      on: onExpr,
    });
  }

  let selectAllTable: string | undefined;
  if (!node.selections || node.selections.length === 0) {
    selectAllTable = fromTable;
  } else {
    for (const selection of node.selections) {
      const unwrappedSelection = unwrapSelectionNode(selection);
      const { node: selectionNode } = unwrapAliasNode(unwrappedSelection);
      if (SelectAllNode.is(selectionNode) || isSelectAllReference(selectionNode)) {
        selectAllTable = resolveSelectAllTable(selectionNode, ctx, fromTable);
        break;
      }
    }
  }

  return {
    kind: 'select',
    from: fromRef,
    ...ifDefined('joins', joins.length > 0 ? joins : undefined),
    project,
    ...ifDefined('where', where ?? undefined),
    ...ifDefined('orderBy', orderBy && orderBy.length > 0 ? orderBy : undefined),
    ...ifDefined('limit', limit),
    ...ifDefined(
      'selectAllIntent',
      selectAllTable !== undefined ? { table: selectAllTable } : undefined,
    ),
  };
}
