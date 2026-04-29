import type {
  AnnotationBuilder,
  AnnotationValue,
  OperationKind,
} from '@prisma-next/framework-components/runtime';
import {
  assertAnnotationsApplicable,
  createMetaBuilder,
} from '@prisma-next/framework-components/runtime';
import { extractAnnotationValues } from './annotation-callback';
import { DerivedTableSource, type SelectAst } from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type {
  AggregateFunctions,
  BooleanCodecType,
  Expression,
  ExpressionBuilder,
  ExtractScopeFields,
  FieldProxy,
  Functions,
  OrderByOptions,
  OrderByScope,
  WithField,
  WithFields,
} from '../expression';
import type { ResolveRow } from '../resolve';
import type {
  Expand,
  JoinOuterScope,
  JoinSource,
  QueryContext,
  Scope,
  ScopeField,
  // biome-ignore lint/correctness/noUnusedImports: used in `declare` property
  SubqueryMarker,
} from '../scope';
import type { GroupedQuery } from '../types/grouped-query';
import type { SelectQuery } from '../types/select-query';
import {
  BuilderBase,
  type BuilderContext,
  type BuilderState,
  buildPlan,
  buildSelectAst,
  cloneState,
  orderByScopeOf,
  resolveDistinctOn,
  resolveGroupBy,
  resolveOrderBy,
  resolveSelectArgs,
} from './builder-base';
import { createFieldProxy } from './field-proxy';
import { createAggregateFunctions, createFunctions } from './functions';

abstract class QueryBase<
  QC extends QueryContext = QueryContext,
  AvailableScope extends Scope = Scope,
  RowType extends Record<string, ScopeField> = Record<string, ScopeField>,
  Registry = {},
> extends BuilderBase<QC['capabilities']> {
  protected readonly state: BuilderState;

  constructor(state: BuilderState, ctx: BuilderContext) {
    super(ctx);
    this.state = state;
  }

  protected abstract clone(state: BuilderState): this;

  distinctOn = this._gate(
    { postgres: { distinctOn: true } },
    'distinctOn',
    (...args: unknown[]) => {
      const exprs = resolveDistinctOn(args, this.state.scope, this.state.rowFields, this.ctx);
      return this.clone(
        cloneState(this.state, {
          distinctOn: [...(this.state.distinctOn ?? []), ...exprs],
        }),
      );
    },
  );

  limit(count: number): this {
    return this.clone(cloneState(this.state, { limit: count }));
  }

  offset(count: number): this {
    return this.clone(cloneState(this.state, { offset: count }));
  }

  distinct(): this {
    return this.clone(cloneState(this.state, { distinct: true }));
  }

  /**
   * Attach user annotations to this query plan via a registry-driven
   * callback.
   *
   * Read builders (`SelectQueryImpl`, `GroupedQueryImpl`) call this
   * `annotate` method, which constructs a kind-filtered
   * `AnnotationBuilder<'read', …>` from `this.ctx.annotationRegistry`
   * and passes it to the user callback. The callback returns either the
   * chained builder or a `readonly AnnotationValue[]` (the array escape
   * hatch). The framework normalizes the return value, runs
   * `assertAnnotationsApplicable` (the runtime gate that catches
   * cast-bypass), and merges the annotations into
   * `state.userAnnotations`. Duplicate namespaces use last-write-wins;
   * multiple `.annotate(...)` calls compose.
   *
   * The accumulated annotations land in `plan.meta.annotations` at
   * `.build()` time, alongside any framework-internal metadata under
   * reserved namespaces (e.g. `codecs`).
   */
  annotate(
    fn: (
      meta: AnnotationBuilder<'read', Registry>,
    ) => AnnotationBuilder<'read', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): this {
    const meta = createMetaBuilder<'read', Registry>(this.ctx.annotationRegistry, 'read');
    const result = fn(meta);
    const values = extractAnnotationValues(result);
    assertAnnotationsApplicable(values, 'read', 'sql-dsl.annotate');
    if (values.length === 0) {
      return this.clone(this.state);
    }
    const next = new Map(this.state.userAnnotations);
    for (const annotation of values) {
      next.set(annotation.namespace, annotation);
    }
    return this.clone(cloneState(this.state, { userAnnotations: next }));
  }

  groupBy(
    ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
  ): GroupedQuery<QC, AvailableScope, RowType, Registry>;
  groupBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<QC>,
    ) => Expression<ScopeField>,
  ): GroupedQuery<QC, AvailableScope, RowType, Registry>;
  groupBy(...args: unknown[]): unknown {
    const exprs = resolveGroupBy(args, this.state.scope, this.state.rowFields, this.ctx);
    return new GroupedQueryImpl<QC, AvailableScope, RowType, Registry>(
      cloneState(this.state, { groupBy: [...this.state.groupBy, ...exprs] }),
      this.ctx,
    );
  }

  as<Alias extends string>(alias: Alias): JoinSource<RowType, Alias> {
    const ast = buildSelectAst(this.state);
    const derivedSource = DerivedTableSource.as(alias, ast);
    const scope = {
      topLevel: this.state.rowFields as RowType,
      namespaces: { [alias]: this.state.rowFields } as Record<Alias, RowType>,
    };
    return {
      getJoinOuterScope: () => scope,
      buildAst: () => derivedSource,

      // `as unknown` is necessary, because JoinOuterScope is a phantom type-only property that does not exist at runtime
    } satisfies Omit<JoinSource<RowType, Alias>, typeof JoinOuterScope> as unknown as JoinSource<
      RowType,
      Alias
    >;
  }

  getRowFields(): Record<string, ScopeField> {
    return this.state.rowFields;
  }

  buildAst(): SelectAst {
    return buildSelectAst(this.state);
  }

  build(): SqlQueryPlan<ResolveRow<RowType, QC['codecTypes'], QC['resolvedColumnOutputTypes']>> {
    return buildPlan<ResolveRow<RowType, QC['codecTypes'], QC['resolvedColumnOutputTypes']>>(
      this.state,
      this.ctx,
    );
  }
}

export class SelectQueryImpl<
    QC extends QueryContext = QueryContext,
    AvailableScope extends Scope = Scope,
    RowType extends Record<string, ScopeField> = Record<string, ScopeField>,
    Registry = {},
  >
  extends QueryBase<QC, AvailableScope, RowType, Registry>
  implements SelectQuery<QC, AvailableScope, RowType, Registry>
{
  declare readonly [SubqueryMarker]: RowType;

  protected clone(state: BuilderState): this {
    return new SelectQueryImpl<QC, AvailableScope, RowType, Registry>(state, this.ctx) as this;
  }

  select<Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
    ...columns: Columns
  ): SelectQuery<
    QC,
    AvailableScope,
    WithFields<RowType, AvailableScope['topLevel'], Columns>,
    Registry
  >;
  select<Alias extends string, Field extends ScopeField>(
    alias: Alias,
    expr: (fields: FieldProxy<AvailableScope>, fns: AggregateFunctions<QC>) => Expression<Field>,
  ): SelectQuery<QC, AvailableScope, WithField<RowType, Field, Alias>, Registry>;
  select<Result extends Record<string, Expression<ScopeField>>>(
    callback: (fields: FieldProxy<AvailableScope>, fns: AggregateFunctions<QC>) => Result,
  ): SelectQuery<QC, AvailableScope, Expand<RowType & ExtractScopeFields<Result>>, Registry>;
  select(...args: unknown[]): unknown {
    const { projections, newRowFields } = resolveSelectArgs(args, this.state.scope, this.ctx);
    return new SelectQueryImpl(
      cloneState(this.state, {
        projections: [...this.state.projections, ...projections],
        rowFields: { ...this.state.rowFields, ...newRowFields },
      }),
      this.ctx,
    );
  }

  where(
    expr: ExpressionBuilder<AvailableScope, QC>,
  ): SelectQuery<QC, AvailableScope, RowType, Registry> {
    const fieldProxy = createFieldProxy(this.state.scope);
    const fns = createFunctions<QC>(this.ctx.queryOperationTypes);
    const result = (expr as ExpressionBuilder<Scope, QueryContext>)(fieldProxy, fns as never);
    return new SelectQueryImpl<QC, AvailableScope, RowType, Registry>(
      cloneState(this.state, {
        where: [...this.state.where, result.buildAst()],
      }),
      this.ctx,
    );
  }

  orderBy(
    field: (keyof RowType | keyof AvailableScope['topLevel']) & string,
    options?: OrderByOptions,
  ): SelectQuery<QC, AvailableScope, RowType, Registry>;
  orderBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<QC>,
    ) => Expression<ScopeField>,
    options?: OrderByOptions,
  ): SelectQuery<QC, AvailableScope, RowType, Registry>;
  orderBy(arg: unknown, options?: OrderByOptions): unknown {
    const item = resolveOrderBy(
      arg,
      options,
      this.state.scope,
      this.state.rowFields,
      this.ctx,
      false,
    );
    return this.clone(cloneState(this.state, { orderBy: [...this.state.orderBy, item] }));
  }
}

export class GroupedQueryImpl<
    QC extends QueryContext = QueryContext,
    AvailableScope extends Scope = Scope,
    RowType extends Record<string, ScopeField> = Record<string, ScopeField>,
    Registry = {},
  >
  extends QueryBase<QC, AvailableScope, RowType, Registry>
  implements GroupedQuery<QC, AvailableScope, RowType, Registry>
{
  declare readonly [SubqueryMarker]: RowType;

  protected clone(state: BuilderState): this {
    return new GroupedQueryImpl<QC, AvailableScope, RowType, Registry>(state, this.ctx) as this;
  }

  having(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: AggregateFunctions<QC>,
    ) => Expression<BooleanCodecType>,
  ): GroupedQuery<QC, AvailableScope, RowType, Registry> {
    const combined = orderByScopeOf(
      this.state.scope as AvailableScope,
      this.state.rowFields as RowType,
    );
    const fns = createAggregateFunctions(this.ctx.queryOperationTypes);
    const result = expr(createFieldProxy(combined), fns);
    return new GroupedQueryImpl<QC, AvailableScope, RowType, Registry>(
      cloneState(this.state, { having: result.buildAst() }),
      this.ctx,
    );
  }

  orderBy(
    field: (keyof RowType | keyof AvailableScope['topLevel']) & string,
    options?: OrderByOptions,
  ): GroupedQuery<QC, AvailableScope, RowType, Registry>;
  orderBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: AggregateFunctions<QC>,
    ) => Expression<ScopeField>,
    options?: OrderByOptions,
  ): GroupedQuery<QC, AvailableScope, RowType, Registry>;
  orderBy(arg: unknown, options?: OrderByOptions): unknown {
    const item = resolveOrderBy(
      arg,
      options,
      this.state.scope,
      this.state.rowFields,
      this.ctx,
      true,
    );
    return this.clone(cloneState(this.state, { orderBy: [...this.state.orderBy, item] }));
  }
}
