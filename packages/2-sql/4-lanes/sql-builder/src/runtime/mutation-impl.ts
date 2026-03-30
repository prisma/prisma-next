import type { StorageTable } from '@prisma-next/sql-contract/types';
import {
  type AnyExpression as AstExpression,
  ColumnRef,
  DeleteAst,
  InsertAst,
  ParamRef,
  TableSource,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { MutationDefaultsOp } from '@prisma-next/sql-relational-core/query-lane-context';
import type { ExpressionBuilder } from '../expression';
import type { ResolveRow } from '../resolve';
import type { QueryContext, Scope, ScopeField } from '../scope';
import type {
  DeleteQuery,
  InsertQuery,
  ReturningCapability,
  UpdateQuery,
} from '../types/mutation-query';
import {
  BuilderBase,
  type BuilderContext,
  buildQueryPlan,
  combineWhereExprs,
} from './builder-base';
import { createFieldProxy } from './field-proxy';
import { createFunctions } from './functions';

type WhereCallback = ExpressionBuilder<Scope, QueryContext>;

function buildParamValues(
  values: Record<string, unknown>,
  table: StorageTable,
  tableName: string,
  op: MutationDefaultsOp,
  ctx: BuilderContext,
): Record<string, ParamRef> {
  const params: Record<string, ParamRef> = {};
  for (const [col, value] of Object.entries(values)) {
    const column = table.columns[col];
    params[col] = ParamRef.of(value, column ? { codecId: column.codecId } : undefined);
  }
  for (const def of ctx.applyMutationDefaults({ op, table: tableName, values })) {
    const column = table.columns[def.column];
    params[def.column] = ParamRef.of(def.value, column ? { codecId: column.codecId } : undefined);
  }
  return params;
}

function buildReturningColumnRefs(tableName: string, columns: string[]): ColumnRef[] {
  return columns.map((col) => ColumnRef.of(tableName, col));
}

function evaluateWhere(
  whereCallback: WhereCallback,
  scope: Scope,
  queryOperationTypes: BuilderContext['queryOperationTypes'],
): AstExpression {
  const fieldProxy = createFieldProxy(scope);
  const fns = createFunctions(queryOperationTypes);
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
  readonly #table: StorageTable;
  readonly #scope: Scope;
  readonly #values: Record<string, unknown>;
  readonly #returningColumns: string[];
  readonly #rowFields: Record<string, ScopeField>;

  constructor(
    tableName: string,
    table: StorageTable,
    scope: Scope,
    values: Record<string, unknown>,
    ctx: BuilderContext,
    returningColumns: string[] = [],
    rowFields: Record<string, ScopeField> = {},
  ) {
    super(ctx);
    this.#tableName = tableName;
    this.#table = table;
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
        this.#table,
        this.#scope,
        this.#values,
        this.ctx,
        columns,
        newRowFields,
      ) as unknown as InsertQuery<QC, AvailableScope, never>;
    },
  );

  #buildPlan(): SqlQueryPlan {
    const paramValues = buildParamValues(
      this.#values,
      this.#table,
      this.#tableName,
      'create',
      this.ctx,
    );

    let ast = InsertAst.into(TableSource.named(this.#tableName)).withValues(paramValues);

    if (this.#returningColumns.length > 0) {
      ast = ast.withReturning(buildReturningColumnRefs(this.#tableName, this.#returningColumns));
    }

    return buildQueryPlan(ast, this.#rowFields, this.ctx);
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
  readonly #table: StorageTable;
  readonly #scope: Scope;
  readonly #setValues: Record<string, unknown>;
  readonly #whereCallbacks: readonly WhereCallback[];
  readonly #returningColumns: string[];
  readonly #rowFields: Record<string, ScopeField>;

  constructor(
    tableName: string,
    table: StorageTable,
    scope: Scope,
    setValues: Record<string, unknown>,
    ctx: BuilderContext,
    whereCallbacks: readonly WhereCallback[] = [],
    returningColumns: string[] = [],
    rowFields: Record<string, ScopeField> = {},
  ) {
    super(ctx);
    this.#tableName = tableName;
    this.#table = table;
    this.#scope = scope;
    this.#setValues = setValues;
    this.#whereCallbacks = whereCallbacks;
    this.#returningColumns = returningColumns;
    this.#rowFields = rowFields;
  }

  where(expr: ExpressionBuilder<AvailableScope, QC>): UpdateQuery<QC, AvailableScope, RowType> {
    return new UpdateQueryImpl(
      this.#tableName,
      this.#table,
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
        this.#table,
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
    const setParams = buildParamValues(
      this.#setValues,
      this.#table,
      this.#tableName,
      'update',
      this.ctx,
    );

    const whereExpr = combineWhereExprs(
      this.#whereCallbacks.map((cb) =>
        evaluateWhere(cb, this.#scope, this.ctx.queryOperationTypes),
      ),
    );

    let ast = UpdateAst.table(TableSource.named(this.#tableName))
      .withSet(setParams)
      .withWhere(whereExpr);

    if (this.#returningColumns.length > 0) {
      ast = ast.withReturning(buildReturningColumnRefs(this.#tableName, this.#returningColumns));
    }

    return buildQueryPlan(ast, this.#rowFields, this.ctx);
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
    const whereExpr = combineWhereExprs(
      this.#whereCallbacks.map((cb) =>
        evaluateWhere(cb, this.#scope, this.ctx.queryOperationTypes),
      ),
    );

    let ast = DeleteAst.from(TableSource.named(this.#tableName)).withWhere(whereExpr);

    if (this.#returningColumns.length > 0) {
      ast = ast.withReturning(buildReturningColumnRefs(this.#tableName, this.#returningColumns));
    }

    return buildQueryPlan(ast, this.#rowFields, this.ctx);
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
