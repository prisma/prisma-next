import type { PlanMeta } from '@prisma-next/contract/types';
import type { StorageTable } from '@prisma-next/sql-contract/types';
import {
  AndExpr,
  type AnyExpression as AstExpression,
  IdentifierRef,
  OrderByItem,
  ProjectionItem,
  SelectAst,
  type TableSource,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { QueryOperationEntry } from '@prisma-next/sql-relational-core/query-operations';
import type { Runtime } from '@prisma-next/sql-runtime';
import type { AggregateFunctions, Expression, FieldProxy, OrderByOptions } from '../expression';
import type {
  GatedMethod,
  MergeScopes,
  NullableScope,
  QueryContext,
  Scope,
  ScopeField,
  ScopeTable,
} from '../scope';
import type { ExpressionImpl } from './expression-impl';
import { createFieldProxy } from './field-proxy';
import { createAggregateFunctions, createFunctions } from './functions';
import { ParamCollector } from './param-collector';

export type ExprCallback = (fields: FieldProxy<Scope>, fns: unknown) => Expression<ScopeField>;

export class BuilderBase<Capabilities = unknown> {
  protected readonly ctx: BuilderContext;

  constructor(ctx: BuilderContext) {
    this.ctx = ctx;
  }

  protected _gate<Req extends Record<string, Record<string, boolean>>, Args extends unknown[], R>(
    required: Req,
    methodName: string,
    method: (...args: Args) => R,
  ): GatedMethod<Capabilities, Req, (...args: Args) => R> {
    return ((...args: Args): R => {
      assertCapability(this.ctx, required, methodName);
      return method(...args);
    }) as GatedMethod<Capabilities, Req, (...args: Args) => R>;
  }
}

export interface BuilderState {
  readonly from: TableSource;
  readonly joins: readonly import('@prisma-next/sql-relational-core/ast').JoinAst[];
  readonly projections: readonly ProjectionItem[];
  readonly where: readonly AstExpression[];
  readonly orderBy: readonly OrderByItem[];
  readonly groupBy: readonly AstExpression[];
  readonly having: AstExpression | undefined;
  readonly limit: number | undefined;
  readonly offset: number | undefined;
  readonly distinct: true | undefined;
  readonly distinctOn: readonly AstExpression[] | undefined;
  readonly scope: Scope;
  readonly rowFields: Record<string, ScopeField>;
  readonly paramCollector: ParamCollector;
}

export interface BuilderContext {
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly queryOperationTypes: Readonly<Record<string, QueryOperationEntry>>;
  readonly runtime: Runtime;
  readonly target: string;
  readonly storageHash: string;
}

export function emptyState(from: TableSource, scope: Scope): BuilderState {
  return {
    from,
    joins: [],
    projections: [],
    where: [],
    orderBy: [],
    groupBy: [],
    having: undefined,
    limit: undefined,
    offset: undefined,
    distinct: undefined,
    distinctOn: undefined,
    scope,
    rowFields: {},
    paramCollector: new ParamCollector(),
  };
}

export function cloneState(state: BuilderState, overrides: Partial<BuilderState>): BuilderState {
  return { ...state, ...overrides };
}

export function combineWhereExprs(exprs: readonly AstExpression[]): AstExpression | undefined {
  if (exprs.length === 0) return undefined;
  if (exprs.length === 1) return exprs[0];
  return AndExpr.of(exprs);
}

export function buildSelectAst(state: BuilderState): SelectAst {
  const where = combineWhereExprs(state.where);
  return new SelectAst({
    from: state.from,
    joins: state.joins.length > 0 ? state.joins : undefined,
    projection: state.projections,
    where,
    orderBy: state.orderBy.length > 0 ? state.orderBy : undefined,
    distinct: state.distinct,
    distinctOn: state.distinctOn && state.distinctOn.length > 0 ? state.distinctOn : undefined,
    groupBy: state.groupBy.length > 0 ? state.groupBy : undefined,
    having: state.having,
    limit: state.limit,
    offset: state.offset,
    selectAllIntent: undefined,
  });
}

export function buildPlan(state: BuilderState, ctx: BuilderContext): SqlQueryPlan {
  const ast = buildSelectAst(state);

  const projectionTypes: Record<string, string> = {};
  const codecs: Record<string, string> = {};
  for (const [alias, field] of Object.entries(state.rowFields)) {
    projectionTypes[alias] = field.codecId;
    codecs[alias] = field.codecId;
  }

  const paramValues = state.paramCollector.getValues();
  const paramMetas = state.paramCollector.getMetas();
  const paramDescriptors = paramValues.map((_, i) => ({
    index: i + 1,
    source: 'dsl' as const,
    ...(paramMetas[i]?.codecId ? { codecId: paramMetas[i].codecId } : {}),
  }));

  for (const [i, meta] of paramMetas.entries()) {
    if (meta.codecId) codecs[`$${i + 1}`] = meta.codecId;
  }

  const hasProjectionTypes = Object.keys(projectionTypes).length > 0;
  const hasCodecs = Object.keys(codecs).length > 0;

  const meta: PlanMeta = Object.freeze({
    target: ctx.target,
    storageHash: ctx.storageHash,
    lane: 'dsl',
    paramDescriptors,
    ...(hasProjectionTypes ? { projectionTypes } : {}),
    ...(hasCodecs ? { annotations: Object.freeze({ codecs: Object.freeze(codecs) }) } : {}),
  });

  return Object.freeze({ ast, params: paramValues, meta });
}

export function tableToScope(name: string, table: StorageTable): Scope {
  const fields: ScopeTable = {};
  for (const [colName, col] of Object.entries(table.columns)) {
    fields[colName] = { codecId: col.codecId, nullable: col.nullable };
  }
  return { topLevel: { ...fields }, namespaces: { [name]: fields } };
}

export function mergeScopes<A extends Scope, B extends Scope>(a: A, b: B): MergeScopes<A, B> {
  const topLevel: ScopeTable = {};
  for (const [k, v] of Object.entries(a.topLevel)) {
    if (!(k in b.topLevel)) topLevel[k] = v;
  }
  for (const [k, v] of Object.entries(b.topLevel)) {
    if (!(k in a.topLevel)) topLevel[k] = v;
  }
  return {
    topLevel,
    namespaces: { ...a.namespaces, ...b.namespaces },
  } as MergeScopes<A, B>;
}

export function nullableScope<S extends Scope>(scope: S): NullableScope<S> {
  const mkNullable = (tbl: ScopeTable): ScopeTable => {
    const result: ScopeTable = {};
    for (const [k, v] of Object.entries(tbl)) {
      result[k] = { codecId: v.codecId, nullable: true };
    }
    return result;
  };
  const namespaces: Record<string, ScopeTable> = {};
  for (const [k, v] of Object.entries(scope.namespaces)) {
    namespaces[k] = mkNullable(v);
  }
  return { topLevel: mkNullable(scope.topLevel), namespaces } as NullableScope<S>;
}

export function orderByScopeOf(scope: Scope, rowFields: Record<string, ScopeField>): Scope {
  return {
    topLevel: { ...scope.topLevel, ...rowFields },
    namespaces: scope.namespaces,
  };
}

export function assertCapability(
  ctx: BuilderContext,
  required: Record<string, Record<string, boolean>>,
  methodName: string,
): void {
  for (const [ns, keys] of Object.entries(required)) {
    for (const key of Object.keys(keys)) {
      if (!ctx.capabilities[ns]?.[key]) {
        throw new Error(`${methodName}() requires capability ${ns}.${key}`);
      }
    }
  }
}

export function resolveSelectArgs(
  args: unknown[],
  scope: Scope,
  paramCollector: ParamCollector,
  ctx: BuilderContext,
): { projections: ProjectionItem[]; newRowFields: Record<string, ScopeField> } {
  const projections: ProjectionItem[] = [];
  const newRowFields: Record<string, ScopeField> = {};

  if (args.length === 0) return { projections, newRowFields };

  if (typeof args[0] === 'string' && (args.length === 1 || typeof args[1] !== 'function')) {
    for (const colName of args as string[]) {
      const field = scope.topLevel[colName];
      if (!field) throw new Error(`Column "${colName}" not found in scope`);
      projections.push(ProjectionItem.of(colName, IdentifierRef.of(colName)));
      newRowFields[colName] = field;
    }
    return { projections, newRowFields };
  }

  if (typeof args[0] === 'string' && typeof args[1] === 'function') {
    const alias = args[0] as string;
    const exprFn = args[1] as (
      f: FieldProxy<Scope>,
      fns: AggregateFunctions<QueryContext>,
    ) => Expression<ScopeField>;
    const fns = createAggregateFunctions(paramCollector, ctx.queryOperationTypes);
    const result = exprFn(createFieldProxy(scope), fns);
    projections.push(ProjectionItem.of(alias, result.buildAst()));
    newRowFields[alias] = (result as ExpressionImpl).field;
    return { projections, newRowFields };
  }

  if (typeof args[0] === 'function') {
    const callbackFn = args[0] as (
      f: FieldProxy<Scope>,
      fns: AggregateFunctions<QueryContext>,
    ) => Record<string, Expression<ScopeField>>;
    const fns = createAggregateFunctions(paramCollector, ctx.queryOperationTypes);
    const record = callbackFn(createFieldProxy(scope), fns);
    for (const [key, expr] of Object.entries(record)) {
      projections.push(ProjectionItem.of(key, expr.buildAst()));
      newRowFields[key] = (expr as ExpressionImpl).field;
    }
    return { projections, newRowFields };
  }

  throw new Error('Invalid .select() arguments');
}

export function resolveOrderBy(
  arg: unknown,
  options: OrderByOptions | undefined,
  scope: Scope,
  rowFields: Record<string, ScopeField>,
  paramCollector: ParamCollector,
  ctx: BuilderContext,
  useAggregateFns: boolean,
): OrderByItem {
  const dir = options?.direction ?? 'asc';

  if (typeof arg === 'string') {
    const combined = orderByScopeOf(scope, rowFields);
    if (!(arg in combined.topLevel))
      throw new Error(`Column "${arg}" not found in scope for orderBy`);
    const expr = IdentifierRef.of(arg);
    return dir === 'asc' ? OrderByItem.asc(expr) : OrderByItem.desc(expr);
  }

  if (typeof arg === 'function') {
    const combined = orderByScopeOf(scope, rowFields);
    const fns = useAggregateFns
      ? createAggregateFunctions(paramCollector, ctx.queryOperationTypes)
      : createFunctions(paramCollector, ctx.queryOperationTypes);
    const result = (arg as ExprCallback)(createFieldProxy(combined), fns);
    return dir === 'asc' ? OrderByItem.asc(result.buildAst()) : OrderByItem.desc(result.buildAst());
  }

  throw new Error('Invalid orderBy argument');
}

export function resolveGroupBy(
  args: unknown[],
  scope: Scope,
  rowFields: Record<string, ScopeField>,
  paramCollector: ParamCollector,
  ctx: BuilderContext,
): AstExpression[] {
  if (typeof args[0] === 'string') {
    const combined = orderByScopeOf(scope, rowFields);
    return (args as string[]).map((colName) => {
      if (!(colName in combined.topLevel))
        throw new Error(`Column "${colName}" not found in scope for groupBy`);
      return IdentifierRef.of(colName);
    });
  }

  if (typeof args[0] === 'function') {
    const combined = orderByScopeOf(scope, rowFields);
    const fns = createFunctions(paramCollector, ctx.queryOperationTypes);
    const result = (args[0] as ExprCallback)(createFieldProxy(combined), fns);
    return [result.buildAst()];
  }

  throw new Error('Invalid groupBy arguments');
}

export function resolveDistinctOn(
  args: unknown[],
  scope: Scope,
  rowFields: Record<string, ScopeField>,
  paramCollector: ParamCollector,
  ctx: BuilderContext,
): AstExpression[] {
  if (args.length === 1 && typeof args[0] === 'function') {
    const combined = orderByScopeOf(scope, rowFields);
    const fns = createFunctions(paramCollector, ctx.queryOperationTypes);
    const result = (args[0] as ExprCallback)(createFieldProxy(combined), fns);
    return [result.buildAst()];
  }
  const combined = orderByScopeOf(scope, rowFields);
  return (args as string[]).map((colName) => {
    if (!(colName in combined.topLevel))
      throw new Error(`Column "${colName}" not found in scope for distinctOn`);
    return IdentifierRef.of(colName);
  });
}
