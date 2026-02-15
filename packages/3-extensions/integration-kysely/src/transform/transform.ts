/**
 * Transforms Kysely compiled query AST into Prisma Next SQL QueryAst.
 *
 * Defensive behavior: If ambiguity slips through (e.g. guardrails bypassed or invoked directly),
 * the transformer throws rather than emitting best-effort refs. Specifically:
 * - Unqualified column refs in multi-table scope → UNQUALIFIED_REF_IN_MULTI_TABLE
 * - Ambiguous selectAll in multi-table scope → AMBIGUOUS_SELECT_ALL
 * - Unsupported node kinds → UNSUPPORTED_NODE
 */
import type { ParamDescriptor, PlanRefs } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  BinaryOp,
  ColumnRef,
  DeleteAst,
  Direction,
  Expression,
  IncludeRef,
  InsertAst,
  JoinAst,
  JoinOnExpr,
  ListLiteralExpr,
  LiteralExpr,
  ParamRef,
  QueryAst,
  SelectAst,
  TableRef,
  UpdateAst,
  WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from './errors.js';
import { getColumnName, getTableName, hasKind } from './kysely-ast-types.js';

export interface TransformResult {
  readonly ast: QueryAst;
  readonly metaAdditions: {
    readonly refs: PlanRefs;
    readonly paramDescriptors: ReadonlyArray<ParamDescriptor>;
    readonly projection?: Record<string, string> | ReadonlyArray<string>;
    readonly projectionTypes?: Record<string, string>;
    readonly selectAllIntent?: { table?: string };
  };
}

interface TransformContext {
  contract: SqlContract<SqlStorage>;
  parameters: readonly unknown[];
  paramIndex: number;
  paramDescriptors: ParamDescriptor[];
  refsTables: Set<string>;
  refsColumns: Map<string, { table: string; column: string }>;
  tableAliases: Map<string, string>;
  multiTableScope?: boolean;
}

function createContext(
  contract: SqlContract<SqlStorage>,
  parameters: readonly unknown[],
): TransformContext {
  return {
    contract,
    parameters,
    paramIndex: 0,
    paramDescriptors: [],
    refsTables: new Set(),
    refsColumns: new Map(),
    tableAliases: new Map(),
  };
}

function nextParamIndex(ctx: TransformContext): number {
  return ++ctx.paramIndex;
}

function addParamDescriptor(
  ctx: TransformContext,
  descriptor: Omit<ParamDescriptor, 'index' | 'source'>,
): void {
  ctx.paramDescriptors.push({
    ...descriptor,
    index: ctx.paramIndex,
    source: 'lane',
  });
}

function validateTable(contract: SqlContract<SqlStorage>, table: string): void {
  if (!contract.storage.tables[table]) {
    throw new KyselyTransformError(
      `Unknown table "${table}"`,
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
      { table },
    );
  }
}

function validateColumn(contract: SqlContract<SqlStorage>, table: string, column: string): void {
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

function resolveTable(node: unknown, ctx: TransformContext, defaultTable?: string): string {
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

function resolveColumnRef(node: unknown, ctx: TransformContext, tableOverride?: string): ColumnRef {
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

function transformTableRef(node: unknown, ctx: TransformContext): TableRef {
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

function transformValue(
  node: unknown,
  ctx: TransformContext,
  refs?: { table: string; column: string },
): ParamRef | LiteralExpr {
  const addDescriptorForCurrentParam = (): void => {
    const colDef = refs ? ctx.contract.storage.tables[refs.table]?.columns[refs.column] : undefined;
    const descriptor: Omit<ParamDescriptor, 'index' | 'source'> = {
      ...(refs && { refs }),
      ...(colDef?.codecId !== undefined && colDef.codecId !== '' && { codecId: colDef.codecId }),
      ...(colDef?.nativeType !== undefined &&
        colDef.nativeType !== '' && { nativeType: colDef.nativeType }),
      ...(refs && colDef !== undefined && { nullable: colDef.nullable ?? false }),
    };
    addParamDescriptor(ctx, descriptor);
  };

  if (typeof node !== 'object' || node === null) {
    // Kysely can place primitive values directly in PrimitiveValueListNode entries for INSERT/IN.
    // If they correspond to the next compiled parameter, preserve placeholder semantics.
    const nextCompiledParam = ctx.parameters[ctx.paramIndex];
    if (ctx.paramIndex < ctx.parameters.length && Object.is(nextCompiledParam, node)) {
      const idx = nextParamIndex(ctx);
      addDescriptorForCurrentParam();
      return { kind: 'param', index: idx };
    }
    return { kind: 'literal', value: node };
  }
  const n = node as Record<string, unknown>;
  if (hasKind(node, 'ValueNode')) {
    const idx = nextParamIndex(ctx);
    addDescriptorForCurrentParam();
    return { kind: 'param', index: idx };
  }
  const nodeKind = String((n as { kind?: string })['kind'] ?? 'unknown');
  throw new KyselyTransformError(
    `Unsupported value node: ${nodeKind}`,
    KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
    { nodeKind },
  );
}

function mapOperator(op: string): BinaryOp | undefined {
  const map: Record<string, BinaryOp> = {
    '=': 'eq',
    '==': 'eq',
    '<>': 'neq',
    '!=': 'neq',
    '>': 'gt',
    '<': 'lt',
    '>=': 'gte',
    '<=': 'lte',
    like: 'like',
    ilike: 'ilike',
    in: 'in',
    notIn: 'notIn',
  };
  return map[op?.toLowerCase?.() ?? op];
}

function getOperatorFromNode(node: unknown): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const n = node as Record<string, unknown>;
  if (hasKind(node, 'OperatorNode')) {
    const op = n['operator'];
    if (typeof op === 'string') {
      return op;
    }
    return undefined;
  }
  return undefined;
}

function transformWhereExpr(
  node: unknown,
  ctx: TransformContext,
  defaultTable?: string,
): WhereExpr | undefined {
  if (!node) return undefined;
  if (typeof node !== 'object') return undefined;

  const n = node as Record<string, unknown>;

  const exprsArr = n['exprs'];
  if (hasKind(node, 'AndNode') || (n['kind'] === 'AndNode' && Array.isArray(exprsArr))) {
    const arr = Array.isArray(exprsArr) ? exprsArr : [];
    const exprs = arr
      .map((e: unknown) => transformWhereExpr(e, ctx, defaultTable))
      .filter((e): e is WhereExpr => e !== undefined);
    if (exprs.length === 0) return undefined;
    if (exprs.length === 1) return exprs[0];
    return { kind: 'and', exprs };
  }

  const orExprsArr = n['exprs'];
  if (hasKind(node, 'OrNode') || (n['kind'] === 'OrNode' && Array.isArray(orExprsArr))) {
    const orArr = Array.isArray(orExprsArr) ? orExprsArr : [];
    const exprs = orArr
      .map((e: unknown) => transformWhereExpr(e, ctx, defaultTable))
      .filter((e): e is WhereExpr => e !== undefined);
    if (exprs.length === 0) return undefined;
    if (exprs.length === 1) return exprs[0];
    return { kind: 'or', exprs };
  }

  if (
    hasKind(node, 'BinaryOperationNode') ||
    ((n['kind'] === 'BinaryOperationNode' || hasKind(node, 'BinaryOperationNode')) &&
      n['operator'] &&
      (n['left'] || n['leftOperand']) &&
      (n['right'] || n['rightOperand']))
  ) {
    const leftNode = (n['left'] ?? n['leftOperand']) as unknown;
    const rightNode = (n['right'] ?? n['rightOperand']) as unknown;
    const opNode = n['operator'] as unknown;
    const opStr = getOperatorFromNode(opNode);
    const op = opStr ? mapOperator(opStr) : undefined;
    if (!op) {
      throw new KyselyTransformError(
        `Unsupported operator: ${opStr ?? 'unknown'}`,
        KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
        { nodeKind: 'BinaryOperationNode', operator: opStr },
      );
    }

    let left: ColumnRef | ParamRef | LiteralExpr;
    let right: ColumnRef | ParamRef | LiteralExpr | ListLiteralExpr;

    if (hasKind(leftNode, 'ReferenceNode')) {
      const leftRec = leftNode as Record<string, unknown>;
      const colRef = resolveColumnRef(leftRec['column'] ?? leftNode, ctx, defaultTable);
      left = colRef;
      ctx.refsColumns.set(`${colRef.table}.${colRef.column}`, {
        table: colRef.table,
        column: colRef.column,
      });

      if (hasKind(rightNode, 'ReferenceNode')) {
        const rightRec = rightNode as Record<string, unknown>;
        right = resolveColumnRef(rightRec['column'] ?? rightNode, ctx, defaultTable);
      } else if (hasKind(rightNode, 'ValueNode')) {
        right = transformValue(rightNode, ctx, { table: colRef.table, column: colRef.column });
      } else if (
        hasKind(rightNode, 'PrimitiveValueListNode') ||
        ((rightNode as Record<string, unknown>)['kind'] === 'PrimitiveValueListNode' &&
          Array.isArray((rightNode as Record<string, unknown>)['values']))
      ) {
        const rightRec = rightNode as Record<string, unknown>;
        const values = (rightRec['values'] ?? []) as unknown[];
        const listValues = values.map((v: unknown) =>
          transformValue(v, ctx, { table: colRef.table, column: colRef.column }),
        );
        right = { kind: 'listLiteral', values: listValues };
      } else {
        right = transformValue(rightNode, ctx);
      }
    } else {
      left = transformValue(leftNode, ctx) as ColumnRef | ParamRef | LiteralExpr;
      right = transformValue(rightNode, ctx);
    }

    return {
      kind: 'bin',
      op,
      left: left as ColumnRef,
      right,
    };
  }

  return undefined;
}

function transformOrderByItem(
  node: unknown,
  ctx: TransformContext,
  defaultTable?: string,
): { expr: import('@prisma-next/sql-relational-core/ast').Expression; dir: Direction } | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const n = node as Record<string, unknown>;
  const exprNode = n['column'] ?? n['orderBy'] ?? n;
  const colRef = resolveColumnRef(exprNode, ctx, defaultTable);
  const dir = (n['direction'] === 'desc' ? 'desc' : 'asc') as Direction;
  return { expr: colRef, dir };
}

function transformJoinOn(
  node: unknown,
  ctx: TransformContext,
  _leftTable: string,
  _rightTable: string,
): JoinOnExpr {
  const expr = transformWhereExpr(node, ctx);
  if (!expr) {
    throw new KyselyTransformError(
      'Join ON clause is required',
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
    );
  }
  if (
    expr.kind === 'bin' &&
    expr.op === 'eq' &&
    expr.left.kind === 'col' &&
    expr.right.kind === 'col'
  ) {
    return {
      kind: 'eqCol',
      left: expr.left,
      right: expr.right as ColumnRef,
    };
  }
  return expr;
}

function expandSelectAll(
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

function transformSelections(
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

function transformSelect(node: Record<string, unknown>, ctx: TransformContext): SelectAst {
  ctx.multiTableScope = Array.isArray(node['joins']) && (node['joins'] as unknown[]).length > 0;

  const fromNode = node['from'];
  if (!fromNode) {
    throw new KyselyTransformError(
      'SELECT query requires FROM clause',
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
    );
  }

  const fromNodeRec = fromNode as Record<string, unknown>;
  const froms = fromNodeRec['froms'] as unknown[] | undefined;
  const firstFrom = Array.isArray(froms) ? froms[0] : undefined;
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
  const joinNodes = (node['joins'] ?? []) as unknown[];
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
    const on = transformJoinOn(onNodeRec?.['node'] ?? onNode, ctx, fromTable, table.name);
    joins.push({ kind: 'join', joinType, table, on });
  }

  const hasSelectAll = (node['selections'] as unknown[] | undefined)?.some?.((s) =>
    hasKind(s, 'SelectAllNode'),
  );
  const selectAllIntent = hasSelectAll ? { table: fromTable } : undefined;

  return {
    kind: 'select',
    from: fromRef,
    ...(joins.length > 0 && { joins }),
    project,
    ...(where && { where }),
    ...(orderBy && orderBy.length > 0 && { orderBy }),
    ...(limit !== undefined && { limit }),
    ...(selectAllIntent && { selectAllIntent }),
  } as SelectAst;
}

function transformInsert(node: Record<string, unknown>, ctx: TransformContext): InsertAst {
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

  const insertReturningNode = node['returning'];
  let insertReturning: ColumnRef[] | undefined;
  if (insertReturningNode) {
    const returningRec = insertReturningNode as Record<string, unknown>;
    const items = returningRec['selections'] as unknown[] | undefined;
    if (Array.isArray(items)) {
      const refs: ColumnRef[] = [];
      for (const item of items) {
        const exprNode =
          (item as Record<string, unknown>)?.['selection'] ??
          (item as Record<string, unknown>)?.['column'] ??
          item;
        if (hasKind(exprNode, 'SelectAllNode') || hasKind(item, 'SelectAllNode')) {
          const expanded = expandSelectAll(tableRef.name, ctx.contract);
          for (const { expr } of expanded) {
            if (expr.kind === 'col') refs.push(expr);
          }
        } else {
          const colNode = (item as Record<string, unknown>)?.['column'] ?? exprNode;
          const exprCol = (exprNode as Record<string, unknown>)?.['column'];
          const toResolve = colNode ?? exprCol ?? item;
          const colName = getColumnName(toResolve);
          if (colName) {
            refs.push(resolveColumnRef(toResolve, ctx, tableRef.name));
          } else {
            const expanded = expandSelectAll(tableRef.name, ctx.contract);
            for (const { expr } of expanded) {
              if (expr.kind === 'col') refs.push(expr);
            }
          }
        }
      }
      insertReturning = refs.length > 0 ? refs : undefined;
    }
  }

  return {
    kind: 'insert',
    table: tableRef,
    values: valuesRecord,
    ...(insertReturning && insertReturning.length > 0 && { returning: insertReturning }),
  } as InsertAst;
}

function transformUpdate(node: Record<string, unknown>, ctx: TransformContext): UpdateAst {
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

  const updateReturningNode = node['returning'];
  let updateReturning: ColumnRef[] | undefined;
  if (updateReturningNode) {
    const updateReturningRec = updateReturningNode as Record<string, unknown>;
    const items = updateReturningRec['selections'] as unknown[] | undefined;
    if (Array.isArray(items)) {
      const refs: ColumnRef[] = [];
      for (const item of items) {
        const exprNode =
          (item as Record<string, unknown>)?.['selection'] ??
          (item as Record<string, unknown>)?.['column'] ??
          item;
        if (hasKind(exprNode, 'SelectAllNode') || hasKind(item, 'SelectAllNode')) {
          const expanded = expandSelectAll(tableRef.name, ctx.contract);
          for (const { expr } of expanded) {
            if (expr.kind === 'col') refs.push(expr);
          }
        } else {
          const toResolve =
            (item as Record<string, unknown>)?.['column'] ??
            (exprNode as Record<string, unknown>)?.['column'] ??
            item;
          const colName = getColumnName(toResolve);
          if (colName) {
            refs.push(resolveColumnRef(toResolve, ctx, tableRef.name));
          } else {
            const expanded = expandSelectAll(tableRef.name, ctx.contract);
            for (const { expr } of expanded) {
              if (expr.kind === 'col') refs.push(expr);
            }
          }
        }
      }
      updateReturning = refs.length > 0 ? refs : undefined;
    }
  }

  return {
    kind: 'update',
    table: tableRef,
    set: setRecord,
    ...(where && { where }),
    ...(updateReturning && updateReturning.length > 0 && { returning: updateReturning }),
  } as UpdateAst;
}

function transformDelete(node: Record<string, unknown>, ctx: TransformContext): DeleteAst {
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

  const deleteReturningNode = node['returning'];
  let deleteReturning: ColumnRef[] | undefined;
  if (deleteReturningNode) {
    const deleteReturningRec = deleteReturningNode as Record<string, unknown>;
    const items = deleteReturningRec['selections'] as unknown[] | undefined;
    if (Array.isArray(items)) {
      const refs: ColumnRef[] = [];
      for (const item of items) {
        const exprNode =
          (item as Record<string, unknown>)?.['selection'] ??
          (item as Record<string, unknown>)?.['column'] ??
          item;
        if (hasKind(exprNode, 'SelectAllNode') || hasKind(item, 'SelectAllNode')) {
          const expanded = expandSelectAll(tableRef.name, ctx.contract);
          for (const { expr } of expanded) {
            if (expr.kind === 'col') refs.push(expr);
          }
        } else {
          const toResolve =
            (item as Record<string, unknown>)?.['column'] ??
            (exprNode as Record<string, unknown>)?.['column'] ??
            item;
          const colName = getColumnName(toResolve);
          if (colName) {
            refs.push(resolveColumnRef(toResolve, ctx, tableRef.name));
          } else {
            const expanded = expandSelectAll(tableRef.name, ctx.contract);
            for (const { expr } of expanded) {
              if (expr.kind === 'col') refs.push(expr);
            }
          }
        }
      }
      deleteReturning = refs.length > 0 ? refs : undefined;
    }
  }

  return {
    kind: 'delete',
    table: tableRef,
    ...(where && { where }),
    ...(deleteReturning && deleteReturning.length > 0 && { returning: deleteReturning }),
  } as DeleteAst;
}

function extractRefsFromAst(ast: QueryAst): PlanRefs {
  const tables = new Set<string>();
  const columns: Array<{ table: string; column: string }> = [];

  function visit(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const n = node as Record<string, unknown>;
    const kind = n['kind'];
    const name = n['name'];
    const table = n['table'];
    const column = n['column'];
    if (kind === 'table' && typeof name === 'string') {
      tables.add(name);
      return;
    }
    if (kind === 'col' && typeof table === 'string' && typeof column === 'string') {
      tables.add(table);
      columns.push({ table, column });
      return;
    }
    for (const v of Object.values(n)) {
      visit(v);
    }
  }

  visit(ast);
  return {
    tables: [...tables],
    columns,
  };
}

export function transformKyselyToPnAst(
  contract: SqlContract<SqlStorage>,
  query: unknown,
  parameters: readonly unknown[],
): TransformResult {
  if (!query || typeof query !== 'object') {
    throw new KyselyTransformError(
      'Query must be a non-null object',
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
    );
  }

  const node = query as Record<string, unknown>;
  const kind = node['kind'];

  const ctx = createContext(contract, parameters);

  let ast: QueryAst;

  if (kind === 'SelectQueryNode') {
    ast = transformSelect(node, ctx);
  } else if (kind === 'InsertQueryNode') {
    ast = transformInsert(node, ctx);
  } else if (kind === 'UpdateQueryNode') {
    ast = transformUpdate(node, ctx);
  } else if (kind === 'DeleteQueryNode') {
    ast = transformDelete(node, ctx);
  } else {
    throw new KyselyTransformError(
      `Unsupported query kind: ${kind ?? 'unknown'}`,
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      { nodeKind: String(kind) },
    );
  }

  const refs = extractRefsFromAst(ast);

  const paramDescriptors = ctx.paramDescriptors.map((d, i) => ({
    ...d,
    index: i + 1,
  }));

  let projection: Record<string, string> | undefined;
  let projectionTypes: Record<string, string> | undefined;
  if (ast.kind === 'select') {
    projection = Object.fromEntries(
      ast.project.map((p) => [p.alias, p.expr.kind === 'col' ? p.expr.column : p.alias]),
    );
    projectionTypes = {};
    for (const p of ast.project) {
      if (p.expr.kind === 'col') {
        const col = ctx.contract.storage.tables[p.expr.table]?.columns[p.expr.column];
        if (col) {
          projectionTypes[p.alias] = col.codecId;
        }
      }
    }
  }

  const metaAdditions = {
    refs,
    paramDescriptors,
    ...(projection && { projection }),
    ...(projectionTypes && Object.keys(projectionTypes).length > 0 && { projectionTypes }),
    ...(ast.kind === 'select' && ast.selectAllIntent && { selectAllIntent: ast.selectAllIntent }),
  };
  return { ast, metaAdditions };
}
