import type { PlanMeta } from '@prisma-next/contract/types';
import {
  type AnyExpression as AstExpression,
  ColumnRef,
  DeleteAst,
  InsertAst,
  TableSource,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { ExpressionBuilder } from '../expression';
import type { ResolveRow } from '../resolve';
import type { QueryContext, Scope, ScopeField } from '../scope';
import type {
  DeleteQuery,
  InsertQuery,
  ReturningCapability,
  UpdateQuery,
} from '../types/mutation-query';
import { BuilderBase, type BuilderContext, combineWhereExprs } from './builder-base';
import { createFieldProxy } from './field-proxy';
import { createFunctions } from './functions';
import { ParamCollector } from './param-collector';

type WhereCallback = ExpressionBuilder<Scope, QueryContext>;

function buildMutationPlan(
  ast: InsertAst | UpdateAst | DeleteAst,
  paramCollector: ParamCollector,
  rowFields: Record<string, ScopeField>,
  ctx: BuilderContext,
): SqlQueryPlan {
  const projectionTypes: Record<string, string> = {};
  const codecs: Record<string, string> = {};
  for (const [alias, field] of Object.entries(rowFields)) {
    projectionTypes[alias] = field.codecId;
    codecs[alias] = field.codecId;
  }

  const paramValues = paramCollector.getValues();
  const paramMetas = paramCollector.getMetas();
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

function buildReturningColumnRefs(tableName: string, columns: string[]): ColumnRef[] {
  return columns.map((col) => ColumnRef.of(tableName, col));
}

function evaluateWhere(
  whereCallback: WhereCallback,
  scope: Scope,
  paramCollector: ParamCollector,
  queryOperationTypes: BuilderContext['queryOperationTypes'],
): AstExpression {
  const fieldProxy = createFieldProxy(scope);
  const fns = createFunctions(paramCollector, queryOperationTypes);
  const result = whereCallback(fieldProxy, fns as never);
  return result.buildAst();
}

export class InsertQueryImpl<
    QC extends QueryContext = QueryContext,
    AvailableScope extends Scope = Scope,
    RowType extends Record<string, ScopeField> = Record<string, ScopeField>,
  >
  extends BuilderBase<QC['capabilities']>
  implements InsertQuery<QC, AvailableScope, RowType>
{
  readonly #tableName: string;
  readonly #scope: Scope;
  readonly #values: Record<string, unknown>;
  readonly #returningColumns: string[];
  readonly #rowFields: Record<string, ScopeField>;

  constructor(
    tableName: string,
    scope: Scope,
    values: Record<string, unknown>,
    ctx: BuilderContext,
    returningColumns: string[] = [],
    rowFields: Record<string, ScopeField> = {},
  ) {
    super(ctx);
    this.#tableName = tableName;
    this.#scope = scope;
    this.#values = values;
    this.#returningColumns = returningColumns;
    this.#rowFields = rowFields;
  }

  returning = this._gate<ReturningCapability, string[], InsertQuery<QC, AvailableScope, never>>(
    { sql: { returning: true } },
    'returning',
    (...columns: string[]) => {
      const newRowFields: Record<string, ScopeField> = {};
      for (const col of columns) {
        const field = this.#scope.topLevel[col];
        if (!field) throw new Error(`Column "${col}" not found in scope`);
        newRowFields[col] = field;
      }
      return new InsertQueryImpl(
        this.#tableName,
        this.#scope,
        this.#values,
        this.ctx,
        columns,
        newRowFields,
      ) as unknown as InsertQuery<QC, AvailableScope, never>;
    },
  );

  #buildPlan(): SqlQueryPlan {
    const paramCollector = new ParamCollector();
    const paramValues: Record<string, import('@prisma-next/sql-relational-core/ast').ParamRef> = {};
    for (const [col, value] of Object.entries(this.#values)) {
      const field = this.#scope.topLevel[col];
      paramValues[col] = paramCollector.add(value, field ? { codecId: field.codecId } : {});
    }

    let ast = InsertAst.into(TableSource.named(this.#tableName)).withValues(paramValues);

    if (this.#returningColumns.length > 0) {
      ast = ast.withReturning(buildReturningColumnRefs(this.#tableName, this.#returningColumns));
    }

    return buildMutationPlan(ast, paramCollector, this.#rowFields, this.ctx);
  }

  async first(): Promise<ResolveRow<RowType, QC['codecTypes']> | null> {
    const plan = this.#buildPlan();
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
    const plan = this.#buildPlan();
    return this.ctx.runtime.execute(plan) as AsyncIterable<ResolveRow<RowType, QC['codecTypes']>>;
  }
}

export class UpdateQueryImpl<
    QC extends QueryContext = QueryContext,
    AvailableScope extends Scope = Scope,
    RowType extends Record<string, ScopeField> = Record<string, ScopeField>,
  >
  extends BuilderBase<QC['capabilities']>
  implements UpdateQuery<QC, AvailableScope, RowType>
{
  readonly #tableName: string;
  readonly #scope: Scope;
  readonly #setValues: Record<string, unknown>;
  readonly #whereCallbacks: readonly WhereCallback[];
  readonly #returningColumns: string[];
  readonly #rowFields: Record<string, ScopeField>;

  constructor(
    tableName: string,
    scope: Scope,
    setValues: Record<string, unknown>,
    ctx: BuilderContext,
    whereCallbacks: readonly WhereCallback[] = [],
    returningColumns: string[] = [],
    rowFields: Record<string, ScopeField> = {},
  ) {
    super(ctx);
    this.#tableName = tableName;
    this.#scope = scope;
    this.#setValues = setValues;
    this.#whereCallbacks = whereCallbacks;
    this.#returningColumns = returningColumns;
    this.#rowFields = rowFields;
  }

  where(expr: ExpressionBuilder<AvailableScope, QC>): UpdateQuery<QC, AvailableScope, RowType> {
    return new UpdateQueryImpl(
      this.#tableName,
      this.#scope,
      this.#setValues,
      this.ctx,
      [...this.#whereCallbacks, expr as unknown as WhereCallback],
      this.#returningColumns,
      this.#rowFields,
    );
  }

  returning = this._gate<ReturningCapability, string[], UpdateQuery<QC, AvailableScope, never>>(
    { sql: { returning: true } },
    'returning',
    (...columns: string[]) => {
      const newRowFields: Record<string, ScopeField> = {};
      for (const col of columns) {
        const field = this.#scope.topLevel[col];
        if (!field) throw new Error(`Column "${col}" not found in scope`);
        newRowFields[col] = field;
      }
      return new UpdateQueryImpl(
        this.#tableName,
        this.#scope,
        this.#setValues,
        this.ctx,
        this.#whereCallbacks,
        columns,
        newRowFields,
      ) as unknown as UpdateQuery<QC, AvailableScope, never>;
    },
  );

  #buildPlan(): SqlQueryPlan {
    const paramCollector = new ParamCollector();
    const setParams: Record<string, import('@prisma-next/sql-relational-core/ast').ParamRef> = {};
    for (const [col, value] of Object.entries(this.#setValues)) {
      const field = this.#scope.topLevel[col];
      setParams[col] = paramCollector.add(value, field ? { codecId: field.codecId } : {});
    }

    const whereExpr = combineWhereExprs(
      this.#whereCallbacks.map((cb) =>
        evaluateWhere(cb, this.#scope, paramCollector, this.ctx.queryOperationTypes),
      ),
    );

    let ast = UpdateAst.table(TableSource.named(this.#tableName))
      .withSet(setParams)
      .withWhere(whereExpr);

    if (this.#returningColumns.length > 0) {
      ast = ast.withReturning(buildReturningColumnRefs(this.#tableName, this.#returningColumns));
    }

    return buildMutationPlan(ast, paramCollector, this.#rowFields, this.ctx);
  }

  async first(): Promise<ResolveRow<RowType, QC['codecTypes']> | null> {
    const plan = this.#buildPlan();
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
    const plan = this.#buildPlan();
    return this.ctx.runtime.execute(plan) as AsyncIterable<ResolveRow<RowType, QC['codecTypes']>>;
  }
}

export class DeleteQueryImpl<
    QC extends QueryContext = QueryContext,
    AvailableScope extends Scope = Scope,
    RowType extends Record<string, ScopeField> = Record<string, ScopeField>,
  >
  extends BuilderBase<QC['capabilities']>
  implements DeleteQuery<QC, AvailableScope, RowType>
{
  readonly #tableName: string;
  readonly #scope: Scope;
  readonly #whereCallbacks: readonly WhereCallback[];
  readonly #returningColumns: string[];
  readonly #rowFields: Record<string, ScopeField>;

  constructor(
    tableName: string,
    scope: Scope,
    ctx: BuilderContext,
    whereCallbacks: readonly WhereCallback[] = [],
    returningColumns: string[] = [],
    rowFields: Record<string, ScopeField> = {},
  ) {
    super(ctx);
    this.#tableName = tableName;
    this.#scope = scope;
    this.#whereCallbacks = whereCallbacks;
    this.#returningColumns = returningColumns;
    this.#rowFields = rowFields;
  }

  where(expr: ExpressionBuilder<AvailableScope, QC>): DeleteQuery<QC, AvailableScope, RowType> {
    return new DeleteQueryImpl(
      this.#tableName,
      this.#scope,
      this.ctx,
      [...this.#whereCallbacks, expr as unknown as WhereCallback],
      this.#returningColumns,
      this.#rowFields,
    );
  }

  returning = this._gate<ReturningCapability, string[], DeleteQuery<QC, AvailableScope, never>>(
    { sql: { returning: true } },
    'returning',
    (...columns: string[]) => {
      const newRowFields: Record<string, ScopeField> = {};
      for (const col of columns) {
        const field = this.#scope.topLevel[col];
        if (!field) throw new Error(`Column "${col}" not found in scope`);
        newRowFields[col] = field;
      }
      return new DeleteQueryImpl(
        this.#tableName,
        this.#scope,
        this.ctx,
        this.#whereCallbacks,
        columns,
        newRowFields,
      ) as unknown as DeleteQuery<QC, AvailableScope, never>;
    },
  );

  #buildPlan(): SqlQueryPlan {
    const paramCollector = new ParamCollector();

    const whereExpr = combineWhereExprs(
      this.#whereCallbacks.map((cb) =>
        evaluateWhere(cb, this.#scope, paramCollector, this.ctx.queryOperationTypes),
      ),
    );

    let ast = DeleteAst.from(TableSource.named(this.#tableName)).withWhere(whereExpr);

    if (this.#returningColumns.length > 0) {
      ast = ast.withReturning(buildReturningColumnRefs(this.#tableName, this.#returningColumns));
    }

    return buildMutationPlan(ast, paramCollector, this.#rowFields, this.ctx);
  }

  async first(): Promise<ResolveRow<RowType, QC['codecTypes']> | null> {
    const plan = this.#buildPlan();
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
    const plan = this.#buildPlan();
    return this.ctx.runtime.execute(plan) as AsyncIterable<ResolveRow<RowType, QC['codecTypes']>>;
  }
}
