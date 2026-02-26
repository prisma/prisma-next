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
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from './errors';
import { getColumnName, hasKind } from './kysely-ast-types';
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
  return cols.map((col) => ({
    alias: col,
    expr: { kind: 'col' as const, table, column: col },
  }));
}

export function transformSelections(
  selections: unknown,
  ctx: TransformContext,
  fromTable: string,
): SelectAst['project'] {
  const project: Array<{ alias: string; expr: Expression | IncludeRef | LiteralExpr }> = [];
  const selectionNodes = Array.isArray(selections) ? selections : [];

  if (selectionNodes.length === 0) {
    return expandSelectAll(fromTable, ctx.contract).map(({ alias, expr }) => ({
      alias,
      expr,
    }));
  }

  for (const sel of selectionNodes) {
    if (typeof sel !== 'object' || sel === null) continue;
    const s = sel as Record<string, unknown>;

    if (hasKind(sel, 'SelectAllNode')) {
      const tableRef = (s['reference'] ?? s['table']) as unknown;
      if (ctx.multiTableScope && !tableRef) {
        throw new KyselyTransformError(
          'Ambiguous selectAll in multi-table scope; qualify with table (e.g. db.selectFrom(u).innerJoin(p).selectAll("user"))',
          KYSELY_TRANSFORM_ERROR_CODES.AMBIGUOUS_SELECT_ALL,
        );
      }
      const table = tableRef ? resolveTable(tableRef, ctx, fromTable) : fromTable;
      const expanded = expandSelectAll(table, ctx.contract);
      for (const { alias, expr } of expanded) {
        project.push({ alias, expr });
      }
      continue;
    }

    if (hasKind(sel, 'SelectionNode')) {
      const exprNode = s['selection'] ?? s['column'] ?? s;
      if (hasKind(exprNode, 'SelectAllNode')) {
        const tableRef =
          (exprNode as Record<string, unknown>)['reference'] ??
          (exprNode as Record<string, unknown>)['table'];
        const table = tableRef ? resolveTable(tableRef, ctx, fromTable) : fromTable;
        const expanded = expandSelectAll(table, ctx.contract);
        for (const { alias: a, expr } of expanded) {
          project.push({ alias: a, expr });
        }
        continue;
      }
      const aliasNode = s['alias'];
      const alias =
        typeof aliasNode === 'object' && aliasNode !== null && 'name' in aliasNode
          ? String((aliasNode as { name: string }).name)
          : (getColumnName(exprNode) ?? `col_${project.length}`);

      if (hasKind(exprNode, 'ReferenceNode')) {
        const exprRec = exprNode as Record<string, unknown>;
        const colRef = resolveColumnRef(exprRec['column'] ?? exprNode, ctx, fromTable);
        project.push({ alias, expr: colRef });
      } else {
        const colRef = resolveColumnRef(exprNode, ctx, fromTable);
        project.push({ alias, expr: colRef });
      }
    }
  }

  return project;
}

export function transformSelect(node: Record<string, unknown>, ctx: TransformContext): SelectAst {
  const joinsRaw = node['joins'] as unknown[] | undefined;
  const fromNode = node['from'];
  const fromNodeRec = fromNode as Record<string, unknown> | undefined;
  const froms = fromNodeRec?.['froms'] as unknown[] | undefined;
  const multiFrom = Array.isArray(froms) && froms.length > 1;
  ctx.multiTableScope = (Array.isArray(joinsRaw) && joinsRaw.length > 0) || multiFrom;

  if (!fromNode) {
    throw new KyselyTransformError(
      'SELECT query requires FROM clause',
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
    );
  }

  const fromsArr = fromNodeRec?.['froms'] as unknown[] | undefined;
  const firstFrom = Array.isArray(fromsArr) ? fromsArr[0] : undefined;
  if (!firstFrom) {
    throw new KyselyTransformError(
      'FROM clause has no tables',
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
    );
  }

  const fromRef = transformTableRef(firstFrom, ctx);
  const fromTable = fromRef.name;

  const tableNode = firstFrom as Record<string, unknown>;
  const aliasNode = tableNode['alias'];
  if (aliasNode && typeof aliasNode === 'object' && 'name' in aliasNode) {
    ctx.tableAliases.set(String((aliasNode as { name: string }).name), fromTable);
  }

  const joinNodes = (joinsRaw ?? []) as unknown[];
  for (const j of joinNodes) {
    if (typeof j !== 'object' || j === null) continue;
    const jn = j as Record<string, unknown>;
    const joinTable = transformTableRef(jn['table'] ?? jn, ctx);
    const joinTableNode = (jn['table'] ?? jn) as Record<string, unknown>;
    const joinAliasNode = joinTableNode['alias'];
    if (joinAliasNode && typeof joinAliasNode === 'object' && 'name' in joinAliasNode) {
      ctx.tableAliases.set(String((joinAliasNode as { name: string }).name), joinTable.name);
    }
  }

  const project = transformSelections(node['selections'], ctx, fromTable);

  const whereNode = node['where'];
  const where = transformWhereExpr(
    (whereNode as Record<string, unknown> | null)?.['node'] ??
      (whereNode as Record<string, unknown> | null)?.['where'] ??
      whereNode,
    ctx,
    fromTable,
  );

  const orderByRec = node['orderBy'] as Record<string, unknown> | undefined;
  const orderByNodes = orderByRec?.['items'] as unknown[] | undefined;
  const orderBy =
    Array.isArray(orderByNodes) && orderByNodes.length > 0
      ? orderByNodes
          .map((item) => transformOrderByItem(item, ctx, fromTable))
          .filter((x): x is NonNullable<typeof x> => x !== undefined)
      : undefined;

  const limitNode = node['limit'];
  let limit: number | undefined;
  if (limitNode && hasKind(limitNode, 'LimitNode')) {
    const limitVal = (limitNode as Record<string, unknown>)['limit'] as Record<string, unknown>;
    if (hasKind(limitVal, 'ValueNode')) {
      const directVal = limitVal['value'];
      if (typeof directVal === 'number') {
        limit = directVal;
      } else {
        const limitParamIndex = nextParamIndex(ctx);
        addParamDescriptor(ctx, {});
        const val = ctx.parameters[limitParamIndex - 1];
        limit = typeof val === 'number' ? val : undefined;
      }
    }
  }

  const joins: JoinAst[] = [];
  for (const j of joinNodes) {
    if (typeof j !== 'object' || j === null) continue;
    const jn = j as Record<string, unknown>;
    const jnJoinType = jn['joinType'];
    const joinType =
      jnJoinType === 'LeftJoinNode' || jnJoinType === 'left'
        ? 'left'
        : jnJoinType === 'RightJoinNode' || jnJoinType === 'right'
          ? 'right'
          : jnJoinType === 'FullJoinNode' || jnJoinType === 'full'
            ? 'full'
            : 'inner';
    const table = transformTableRef(jn['table'] ?? jn, ctx);
    const onNode = jn['on'];
    const onNodeRec = onNode as Record<string, unknown> | null | undefined;
    const on = transformJoinOn(
      onNodeRec?.['node'] ?? onNodeRec?.['on'] ?? onNode,
      ctx,
      fromTable,
      table.name,
    );
    joins.push({ kind: 'join', joinType, table, on });
  }

  const selectionNodes = (node['selections'] as unknown[] | undefined) ?? [];
  const hasExplicitSelectAll =
    Array.isArray(selectionNodes) && selectionNodes.some((s) => hasKind(s, 'SelectAllNode'));
  let selectAllTable: string | undefined;
  if (selectionNodes.length === 0) {
    selectAllTable = fromTable;
  } else if (hasExplicitSelectAll) {
    const firstSelectAll = selectionNodes.find((s) => hasKind(s, 'SelectAllNode'));
    if (firstSelectAll) {
      const s = firstSelectAll as Record<string, unknown>;
      const tableRef = (s['reference'] ?? s['table']) as unknown;
      selectAllTable = tableRef ? resolveTable(tableRef, ctx, fromTable) : fromTable;
    }
  }
  const selectAllIntent = selectAllTable !== undefined ? { table: selectAllTable } : undefined;

  return {
    kind: 'select',
    from: fromRef,
    ...ifDefined('joins', joins.length > 0 ? joins : undefined),
    project,
    ...ifDefined('where', where ?? undefined),
    ...ifDefined('orderBy', orderBy && orderBy.length > 0 ? orderBy : undefined),
    ...ifDefined('limit', limit),
    ...ifDefined('selectAllIntent', selectAllIntent ?? undefined),
  } as SelectAst;
}
