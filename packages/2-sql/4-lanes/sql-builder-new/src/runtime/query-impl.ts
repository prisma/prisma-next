import { DerivedTableSource, type SelectAst } from '@prisma-next/sql-relational-core/ast';
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
  JoinSource,
  QueryContext,
  Scope,
  ScopeField,
  // biome-ignore lint/correctness/noUnusedImports: used in `declare` property
  SubqueryMarker,
} from '../scope';
import { JoinOuterScope } from '../scope';
import type { GroupedQuery } from '../types/grouped-query';
import type { SelectQuery } from '../types/select-query';
import {
  BuilderBase,
  type BuilderContext,
  type BuilderState,
  buildPlan,
  buildSelectAst,
  cloneState,
  type ExprCallback,
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

  groupBy(
    ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
  ): GroupedQuery<QC, AvailableScope, RowType>;
  groupBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<QC>,
    ) => Expression<ScopeField>,
  ): GroupedQuery<QC, AvailableScope, RowType>;
  groupBy(...args: unknown[]): unknown {
    const exprs = resolveGroupBy(args, this.state.scope, this.state.rowFields, this.ctx);
    return new GroupedQueryImpl<QC, AvailableScope, RowType>(
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
      [JoinOuterScope]: scope,
      getJoinOuterScope: () => scope,
      buildAst: () => derivedSource,
    };
  }

  getRowFields(): Record<string, ScopeField> {
    return this.state.rowFields;
  }

  buildAst(): SelectAst {
    return buildSelectAst(this.state);
  }

  async first(): Promise<ResolveRow<RowType, QC['codecTypes']> | null> {
    const plan = buildPlan(this.state, this.ctx);
    for await (const row of this.ctx.runtime.execute(plan)) {
      return row as ResolveRow<RowType, QC['codecTypes']>;
    }
    return null;
  }

  async firstOrThrow(): Promise<ResolveRow<RowType, QC['codecTypes']>> {
    const result = await this.first();
    if (result === null) throw new Error('Expected at least one row, but none were returned');
    return result;
  }

  all(): AsyncIterable<ResolveRow<RowType, QC['codecTypes']>> {
    const plan = buildPlan(this.state, this.ctx);
    return this.ctx.runtime.execute(plan) as AsyncIterable<ResolveRow<RowType, QC['codecTypes']>>;
  }
}

export class SelectQueryImpl<
    QC extends QueryContext = QueryContext,
    AvailableScope extends Scope = Scope,
    RowType extends Record<string, ScopeField> = Record<string, ScopeField>,
  >
  extends QueryBase<QC, AvailableScope, RowType>
  implements SelectQuery<QC, AvailableScope, RowType>
{
  declare readonly [SubqueryMarker]: RowType;

  protected clone(state: BuilderState): this {
    return new SelectQueryImpl<QC, AvailableScope, RowType>(state, this.ctx) as this;
  }

  select<Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
    ...columns: Columns
  ): SelectQuery<QC, AvailableScope, WithFields<RowType, AvailableScope['topLevel'], Columns>>;
  select<Alias extends string, Field extends ScopeField>(
    alias: Alias,
    expr: (fields: FieldProxy<AvailableScope>, fns: AggregateFunctions<QC>) => Expression<Field>,
  ): SelectQuery<QC, AvailableScope, WithField<RowType, Field, Alias>>;
  select<Result extends Record<string, Expression<ScopeField>>>(
    callback: (fields: FieldProxy<AvailableScope>, fns: AggregateFunctions<QC>) => Result,
  ): SelectQuery<QC, AvailableScope, Expand<RowType & ExtractScopeFields<Result>>>;
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

  where(expr: ExpressionBuilder<AvailableScope, QC>): SelectQuery<QC, AvailableScope, RowType> {
    const fieldProxy = createFieldProxy(this.state.scope);
    const fns = createFunctions<QC>(this.ctx.queryOperationTypes);
    const result = (expr as ExpressionBuilder<Scope, QueryContext>)(fieldProxy, fns as never);
    return new SelectQueryImpl(
      cloneState(this.state, {
        where: [...this.state.where, result.buildAst()],
      }),
      this.ctx,
    );
  }

  orderBy(
    field: (keyof RowType | keyof AvailableScope['topLevel']) & string,
    options?: OrderByOptions,
  ): SelectQuery<QC, AvailableScope, RowType>;
  orderBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<QC>,
    ) => Expression<ScopeField>,
    options?: OrderByOptions,
  ): SelectQuery<QC, AvailableScope, RowType>;
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
  >
  extends QueryBase<QC, AvailableScope, RowType>
  implements GroupedQuery<QC, AvailableScope, RowType>
{
  declare readonly [SubqueryMarker]: RowType;

  protected clone(state: BuilderState): this {
    return new GroupedQueryImpl<QC, AvailableScope, RowType>(state, this.ctx) as this;
  }

  having(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: AggregateFunctions<QC>,
    ) => Expression<BooleanCodecType>,
  ): GroupedQuery<QC, AvailableScope, RowType> {
    const combined = orderByScopeOf(
      this.state.scope as AvailableScope,
      this.state.rowFields as RowType,
    );
    const fns = createAggregateFunctions(this.ctx.queryOperationTypes);
    const result = expr(createFieldProxy(combined), fns);
    return new GroupedQueryImpl(cloneState(this.state, { having: result.buildAst() }), this.ctx);
  }

  orderBy(
    field: (keyof RowType | keyof AvailableScope['topLevel']) & string,
    options?: OrderByOptions,
  ): GroupedQuery<QC, AvailableScope, RowType>;
  orderBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: AggregateFunctions<QC>,
    ) => Expression<ScopeField>,
    options?: OrderByOptions,
  ): GroupedQuery<QC, AvailableScope, RowType>;
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
