import { ifDefined } from '@prisma-next/utils/defined';
import type {
  ColumnRef,
  Expression,
  FromSource,
  JoinOnExpr,
  ListLiteralExpr,
  LiteralExpr,
  ParamRef,
  SelectAst,
  TableSource,
  WhereExpr,
} from './types';

/**
 * The right-hand side of a BinaryExpr — asymmetric with the left side.
 */
export type SqlComparable = Expression | ParamRef | LiteralExpr | ListLiteralExpr;

/**
 * Leaf-node callbacks for transforming an expression tree.
 * Only override the kinds you care about; defaults are identity.
 */
export interface ExpressionMapCallbacks {
  col?(expr: ColumnRef, recurse: (e: Expression) => Expression): Expression;
  param?(expr: ParamRef): ParamRef | LiteralExpr;
  literal?(expr: LiteralExpr): LiteralExpr;
  listLiteral?(expr: ListLiteralExpr): ListLiteralExpr | LiteralExpr;
  /** If provided, subquery/exists nodes recurse into SelectAst. Otherwise identity. */
  select?(ast: SelectAst): SelectAst;
}

export interface ExpressionMapResult {
  expression: (expr: Expression) => Expression;
  where: (expr: WhereExpr) => WhereExpr;
  comparable: (value: SqlComparable) => SqlComparable;
}

/**
 * Creates expression, where, and comparable mappers from leaf-node callbacks.
 * Structural recursion (operation args, json entries, aggregate, etc.) is automatic.
 */
export function mapExpression(cb: ExpressionMapCallbacks): ExpressionMapResult {
  const mapParam = cb.param ?? identityParam;
  const mapLiteral = cb.literal ?? identityLiteral;
  const mapSelect = cb.select;

  function expr(e: Expression): Expression {
    switch (e.kind) {
      case 'col':
        return cb.col ? cb.col(e, expr) : e;

      case 'operation':
        return {
          ...e,
          self: expr(e.self),
          args: e.args.map((arg) => {
            if (arg.kind === 'param') return mapParam(arg);
            if (arg.kind === 'literal') return mapLiteral(arg);
            return expr(arg);
          }),
        };

      case 'subquery':
        return mapSelect ? { ...e, query: mapSelect(e.query) } : e;

      case 'aggregate':
        return e.expr ? { ...e, expr: expr(e.expr) } : e;

      case 'jsonArrayAgg':
        return {
          ...e,
          expr: expr(e.expr),
          ...(e.orderBy
            ? {
                orderBy: e.orderBy.map((order) => ({
                  ...order,
                  expr: expr(order.expr),
                })),
              }
            : {}),
        };

      case 'jsonObject':
        return {
          ...e,
          entries: e.entries.map((entry) => ({
            ...entry,
            value: entry.value.kind === 'literal' ? mapLiteral(entry.value) : expr(entry.value),
          })),
        };

      default: {
        const never: never = e;
        throw new Error(`Unsupported expression kind: ${String(never)}`);
      }
    }
  }

  function comparable(value: SqlComparable): SqlComparable {
    if (value.kind === 'param') return mapParam(value);
    if (value.kind === 'literal') return mapLiteral(value);
    if (value.kind === 'listLiteral') {
      if (cb.listLiteral) return cb.listLiteral(value);
      return {
        ...value,
        values: value.values.map((v) =>
          v.kind === 'param' ? mapParam(v) : mapLiteral(v),
        ) as ReadonlyArray<ParamRef | LiteralExpr>,
      };
    }
    return expr(value);
  }

  function where(w: WhereExpr): WhereExpr {
    switch (w.kind) {
      case 'bin':
        return { ...w, left: expr(w.left), right: comparable(w.right) };
      case 'nullCheck':
        return { ...w, expr: expr(w.expr) };
      case 'and':
        return { ...w, exprs: w.exprs.map(where) };
      case 'or':
        return { ...w, exprs: w.exprs.map(where) };
      case 'exists':
        return mapSelect ? { ...w, subquery: mapSelect(w.subquery) } : w;
      default: {
        const never: never = w;
        throw new Error(`Unsupported where expression kind: ${String(never)}`);
      }
    }
  }

  return { expression: expr, where, comparable };
}

export interface SelectAstMapOptions {
  expression: (e: Expression) => Expression;
  where: (w: WhereExpr) => WhereExpr;
  joinOnEqCol?: ((on: Extract<JoinOnExpr, { kind: 'eqCol' }>) => JoinOnExpr) | undefined;
  tableSource?: ((source: TableSource) => TableSource) | undefined;
}

/**
 * Creates a SelectAst mapper that applies expression/where mappers
 * to all expression-bearing fields. Optionally overrides TableSource
 * and eqCol JoinOnExpr handling.
 */
export function mapSelectAst(opts: SelectAstMapOptions): (ast: SelectAst) => SelectAst {
  const { expression: expr, where } = opts;
  const mapTable = opts.tableSource ?? identityTableSource;

  function fromSource(source: FromSource): FromSource {
    if (source.kind === 'table') return mapTable(source);
    return { ...source, query: select(source.query) };
  }

  function joinOn(on: JoinOnExpr): JoinOnExpr {
    if (on.kind === 'eqCol') {
      return opts.joinOnEqCol ? opts.joinOnEqCol(on) : on;
    }
    return where(on);
  }

  function select(ast: SelectAst): SelectAst {
    return {
      kind: ast.kind,
      from: fromSource(ast.from),
      project: ast.project.map((p) =>
        p.expr.kind === 'literal' ? p : { ...p, expr: expr(p.expr) },
      ),
      ...ifDefined(
        'joins',
        ast.joins?.map((j) => ({
          ...j,
          source: fromSource(j.source),
          on: joinOn(j.on),
        })),
      ),
      ...ifDefined('where', ast.where ? where(ast.where) : undefined),
      ...ifDefined('having', ast.having ? where(ast.having) : undefined),
      ...ifDefined(
        'orderBy',
        ast.orderBy?.map((o) => ({ ...o, expr: expr(o.expr) })),
      ),
      ...ifDefined('distinct', ast.distinct),
      ...ifDefined('distinctOn', ast.distinctOn?.map(expr)),
      ...ifDefined('groupBy', ast.groupBy?.map(expr)),
      ...ifDefined('limit', ast.limit),
      ...ifDefined('offset', ast.offset),
      ...ifDefined('selectAllIntent', ast.selectAllIntent),
    };
  }

  return select;
}

export interface DeepMapCallbacks extends Omit<ExpressionMapCallbacks, 'select'> {
  joinOnEqCol?: ((on: Extract<JoinOnExpr, { kind: 'eqCol' }>) => JoinOnExpr) | undefined;
  tableSource?: ((source: TableSource) => TableSource) | undefined;
}

/**
 * Creates expression, where, comparable, and select mappers that
 * mutually recurse. The expression mapper descends into SelectAst
 * via subquery/exists nodes, and the select mapper descends back
 * into expressions.
 */
export function mapExpressionDeep(cb: DeepMapCallbacks): ExpressionMapResult & {
  select: (ast: SelectAst) => SelectAst;
} {
  // Late binding to tie the recursive knot
  let mappers: ExpressionMapResult;

  const selectMapper = mapSelectAst({
    expression: (e) => mappers.expression(e),
    where: (w) => mappers.where(w),
    joinOnEqCol: cb.joinOnEqCol,
    tableSource: cb.tableSource,
  });

  mappers = mapExpression({ ...cb, select: selectMapper });

  return { ...mappers, select: selectMapper };
}

/**
 * Callbacks for folding (reducing) an expression tree to a value.
 */
export interface ExpressionFoldCallbacks<T> {
  /** Identity element for `combine`. */
  empty: T;
  /** Associative combinator. */
  combine(a: T, b: T): T;
  /** Short-circuit: if true, skip remaining siblings. */
  isAbsorbing?(value: T): boolean;
  col?(expr: ColumnRef): T;
  param?(expr: ParamRef): T;
  literal?(expr: LiteralExpr): T;
  listLiteral?(expr: ListLiteralExpr): T;
  /** If provided, subquery/exists nodes recurse into SelectAst. Otherwise returns `empty`. */
  select?(ast: SelectAst): T;
}

export interface ExpressionFoldResult<T> {
  expression: (expr: Expression) => T;
  where: (expr: WhereExpr) => T;
  comparable: (value: SqlComparable) => T;
}

/**
 * Creates expression, where, and comparable folders from per-node callbacks.
 */
export function foldExpression<T>(cb: ExpressionFoldCallbacks<T>): ExpressionFoldResult<T> {
  const { empty, combine, isAbsorbing } = cb;
  const foldCol = cb.col ?? returnEmpty;
  const foldParam = cb.param ?? returnEmpty;
  const foldLiteral = cb.literal ?? returnEmpty;
  const foldSelect = cb.select;

  function returnEmpty(): T {
    return empty;
  }

  function combineAll(thunks: Array<() => T>): T {
    let result = empty;
    for (const thunk of thunks) {
      if (isAbsorbing?.(result)) return result;
      result = combine(result, thunk());
    }
    return result;
  }

  function expr(e: Expression): T {
    switch (e.kind) {
      case 'col':
        return foldCol(e);

      case 'operation':
        return combineAll([
          () => expr(e.self),
          ...e.args.map((arg) => () => {
            if (arg.kind === 'param') return foldParam(arg);
            if (arg.kind === 'literal') return foldLiteral(arg);
            return expr(arg);
          }),
        ]);

      case 'subquery':
        return foldSelect ? foldSelect(e.query) : empty;

      case 'aggregate':
        return e.expr ? expr(e.expr) : empty;

      case 'jsonArrayAgg':
        return combineAll([
          () => expr(e.expr),
          ...(e.orderBy ?? []).map((order) => () => expr(order.expr)),
        ]);

      case 'jsonObject':
        return combineAll(
          e.entries.map(
            (entry) => () =>
              entry.value.kind === 'literal' ? foldLiteral(entry.value) : expr(entry.value),
          ),
        );

      default: {
        const never: never = e;
        throw new Error(`Unsupported expression kind: ${String(never)}`);
      }
    }
  }

  function comparable(value: SqlComparable): T {
    if (value.kind === 'param') return foldParam(value);
    if (value.kind === 'literal') return foldLiteral(value);
    if (value.kind === 'listLiteral') {
      if (cb.listLiteral) return cb.listLiteral(value);
      return combineAll(
        value.values.map((v) => () => (v.kind === 'param' ? foldParam(v) : foldLiteral(v))),
      );
    }
    return expr(value);
  }

  function where(w: WhereExpr): T {
    switch (w.kind) {
      case 'bin':
        return combineAll([() => expr(w.left), () => comparable(w.right)]);
      case 'nullCheck':
        return expr(w.expr);
      case 'and':
      case 'or':
        return combineAll(w.exprs.map((child) => () => where(child)));
      case 'exists':
        return foldSelect ? foldSelect(w.subquery) : empty;
      default: {
        const never: never = w;
        throw new Error(`Unsupported where expression kind: ${String(never)}`);
      }
    }
  }

  return { expression: expr, where, comparable };
}

/**
 * Creates expression, where, comparable, and select folders that
 * mutually recurse into SelectAst.
 */
export function foldExpressionDeep<T>(
  cb: Omit<ExpressionFoldCallbacks<T>, 'select'>,
): ExpressionFoldResult<T> & {
  select: (ast: SelectAst) => T;
} {
  const { empty, combine, isAbsorbing } = cb;
  let folders: ExpressionFoldResult<T>;

  function foldFromSource(source: FromSource): T {
    if (source.kind === 'table') return empty;
    return selectFold(source.query);
  }

  function foldJoinOn(on: JoinOnExpr): T {
    if (on.kind === 'eqCol') return empty;
    return folders.where(on);
  }

  function selectFold(ast: SelectAst): T {
    const parts: Array<() => T> = [];

    parts.push(() => foldFromSource(ast.from));
    for (const p of ast.project) {
      if (p.expr.kind !== 'literal') {
        const e = p.expr;
        parts.push(() => folders.expression(e));
      }
    }
    const { where, having } = ast;
    if (where) parts.push(() => folders.where(where));
    if (having) parts.push(() => folders.where(having));
    for (const o of ast.orderBy ?? []) {
      parts.push(() => folders.expression(o.expr));
    }
    for (const d of ast.distinctOn ?? []) {
      parts.push(() => folders.expression(d));
    }
    for (const g of ast.groupBy ?? []) {
      parts.push(() => folders.expression(g));
    }
    for (const j of ast.joins ?? []) {
      parts.push(() => foldFromSource(j.source));
      parts.push(() => foldJoinOn(j.on));
    }

    let result = empty;
    for (const thunk of parts) {
      if (isAbsorbing?.(result)) return result;
      result = combine(result, thunk());
    }
    return result;
  }

  folders = foldExpression({ ...cb, select: selectFold });

  return { ...folders, select: selectFold };
}

function identityParam(p: ParamRef): ParamRef {
  return p;
}

function identityLiteral(l: LiteralExpr): LiteralExpr {
  return l;
}

function identityTableSource(s: TableSource): TableSource {
  return s;
}
