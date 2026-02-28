import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { ToWhereExpr } from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type {
  CallbackSelection,
  ComparisonOperatorExpression,
  CompiledQuery,
  DatabaseConnection,
  DatabaseIntrospector,
  DatabaseMetadata,
  DeleteQueryBuilder,
  DeleteResult,
  Dialect,
  Driver,
  ExpressionOrFactory,
  InsertQueryBuilder,
  InsertResult,
  OperandValueExpressionOrList,
  OrderByExpression,
  OrderByModifiers,
  QueryCompiler,
  ReferenceExpression,
  Selectable,
  SelectCallback,
  SelectExpression,
  Selection,
  SelectQueryBuilder,
  SqlBool,
  TransactionSettings,
  UpdateQueryBuilder,
  UpdateResult,
  ValueExpression,
} from 'kysely';
import { Kysely as KyselyClient, PostgresAdapter, PostgresQueryCompiler } from 'kysely';
import type { KyselifyContract } from './kyselify';
import { buildKyselyPlan, REDACTED_SQL } from './plan';
import { buildKyselyWhereExpr } from './where-expr';

type InferCompiledRow<TCompiled> = TCompiled extends CompiledQuery<infer Row> ? Row : unknown;
type InferBuildRow<TQuery extends { compile(): unknown }> = InferCompiledRow<
  ReturnType<TQuery['compile']>
>;

export interface KyselySelectQueryBuilder<DB, TB extends keyof DB, O> {
  select<SE extends SelectExpression<DB, TB>>(
    selections: ReadonlyArray<SE>,
  ): KyselySelectQueryBuilder<DB, TB, O & Selection<DB, TB, SE>>;
  select<CB extends SelectCallback<DB, TB>>(
    callback: CB,
  ): KyselySelectQueryBuilder<DB, TB, O & CallbackSelection<DB, TB, CB>>;
  select<SE extends SelectExpression<DB, TB>>(
    selection: SE,
  ): KyselySelectQueryBuilder<DB, TB, O & Selection<DB, TB, SE>>;
  selectAll<T extends TB>(
    table: ReadonlyArray<T>,
  ): KyselySelectQueryBuilder<DB, TB, O & Selectable<DB[T]>>;
  selectAll<T extends TB>(table: T): KyselySelectQueryBuilder<DB, TB, O & Selectable<DB[T]>>;
  selectAll(): KyselySelectQueryBuilder<DB, TB, O & Selectable<DB[TB]>>;
  where<
    RE extends ReferenceExpression<DB, TB>,
    VE extends OperandValueExpressionOrList<DB, TB, RE>,
  >(lhs: RE, op: ComparisonOperatorExpression, rhs: VE): KyselySelectQueryBuilder<DB, TB, O>;
  where<E extends ExpressionOrFactory<DB, TB, SqlBool>>(
    expression: E,
  ): KyselySelectQueryBuilder<DB, TB, O>;
  orderBy<OE extends OrderByExpression<DB, TB, O>>(
    expr: OE,
    modifiers?: OrderByModifiers,
  ): KyselySelectQueryBuilder<DB, TB, O>;
  orderBy<OE extends OrderByExpression<DB, TB, O>>(
    exprs: ReadonlyArray<OE>,
  ): KyselySelectQueryBuilder<DB, TB, O>;
  orderBy<OE extends OrderByExpression<DB, TB, O>>(
    expr: OE,
    modifiers: unknown,
  ): KyselySelectQueryBuilder<DB, TB, O>;
  limit(
    limit: ValueExpression<DB, TB, number | bigint | null>,
  ): KyselySelectQueryBuilder<DB, TB, O>;
  compile(): CompiledQuery<SimplifyBuildResult<O>>;
}

export interface KyselyInsertQueryBuilder<DB, TB extends keyof DB, O> {
  values(
    insert: Parameters<InsertQueryBuilder<DB, TB, O>['values']>[0],
  ): KyselyInsertQueryBuilder<DB, TB, O>;
  returning<SE extends SelectExpression<DB, TB>>(
    selections: ReadonlyArray<SE>,
  ): KyselyInsertQueryBuilder<DB, TB, O & Selection<DB, TB, SE>>;
  returning<CB extends SelectCallback<DB, TB>>(
    callback: CB,
  ): KyselyInsertQueryBuilder<DB, TB, O & CallbackSelection<DB, TB, CB>>;
  returning<SE extends SelectExpression<DB, TB>>(
    selection: SE,
  ): KyselyInsertQueryBuilder<DB, TB, O & Selection<DB, TB, SE>>;
  returningAll(): KyselyInsertQueryBuilder<DB, TB, Selectable<DB[TB]>>;
  compile(): CompiledQuery<SimplifyBuildResult<O>>;
}

export interface KyselyUpdateQueryBuilder<DB, UT extends keyof DB, TB extends keyof DB, O> {
  set(update: Partial<Selectable<DB[UT]>>): KyselyUpdateQueryBuilder<DB, UT, TB, O>;
  set(key: ReferenceExpression<DB, UT>, value: unknown): KyselyUpdateQueryBuilder<DB, UT, TB, O>;
  where<
    RE extends ReferenceExpression<DB, TB>,
    VE extends OperandValueExpressionOrList<DB, TB, RE>,
  >(lhs: RE, op: ComparisonOperatorExpression, rhs: VE): KyselyUpdateQueryBuilder<DB, UT, TB, O>;
  where<E extends ExpressionOrFactory<DB, TB, SqlBool>>(
    expression: E,
  ): KyselyUpdateQueryBuilder<DB, UT, TB, O>;
  returning<SE extends SelectExpression<DB, TB>>(
    selections: ReadonlyArray<SE>,
  ): KyselyUpdateQueryBuilder<DB, UT, TB, O & Selection<DB, TB, SE>>;
  returning<CB extends SelectCallback<DB, TB>>(
    callback: CB,
  ): KyselyUpdateQueryBuilder<DB, UT, TB, O & CallbackSelection<DB, TB, CB>>;
  returning<SE extends SelectExpression<DB, TB>>(
    selection: SE,
  ): KyselyUpdateQueryBuilder<DB, UT, TB, O & Selection<DB, TB, SE>>;
  returningAll(): KyselyUpdateQueryBuilder<DB, UT, TB, Selectable<DB[TB]>>;
  compile(): CompiledQuery<SimplifyBuildResult<O>>;
}

export interface KyselyDeleteQueryBuilder<DB, TB extends keyof DB, O> {
  where<
    RE extends ReferenceExpression<DB, TB>,
    VE extends OperandValueExpressionOrList<DB, TB, RE>,
  >(lhs: RE, op: ComparisonOperatorExpression, rhs: VE): KyselyDeleteQueryBuilder<DB, TB, O>;
  where<E extends ExpressionOrFactory<DB, TB, SqlBool>>(
    expression: E,
  ): KyselyDeleteQueryBuilder<DB, TB, O>;
  returning<SE extends SelectExpression<DB, TB>>(
    selections: ReadonlyArray<SE>,
  ): KyselyDeleteQueryBuilder<DB, TB, O & Selection<DB, TB, SE>>;
  returning<CB extends SelectCallback<DB, TB>>(
    callback: CB,
  ): KyselyDeleteQueryBuilder<DB, TB, O & CallbackSelection<DB, TB, CB>>;
  returning<SE extends SelectExpression<DB, TB>>(
    selection: SE,
  ): KyselyDeleteQueryBuilder<DB, TB, O & Selection<DB, TB, SE>>;
  returningAll(): KyselyDeleteQueryBuilder<DB, TB, Selectable<DB[TB]>>;
  compile(): CompiledQuery<SimplifyBuildResult<O>>;
}

type LaneDb<TContract extends SqlContract<SqlStorage>> = KyselifyContract<TContract>;

type SimplifyBuildResult<TValue> = TValue extends object
  ? {
      [Key in keyof TValue]: TValue[Key];
    }
  : TValue;

export interface KyselyQueryLane<TContract extends SqlContract<SqlStorage>> {
  selectFrom<T extends keyof LaneDb<TContract> & string>(
    from: T,
  ): KyselySelectQueryBuilder<LaneDb<TContract>, T, Record<string, never>>;
  insertInto<T extends keyof LaneDb<TContract> & string>(
    table: T,
  ): KyselyInsertQueryBuilder<LaneDb<TContract>, T, InsertResult>;
  updateTable<T extends keyof LaneDb<TContract> & string>(
    tables: T,
  ): KyselyUpdateQueryBuilder<LaneDb<TContract>, T, T, UpdateResult>;
  deleteFrom<T extends keyof LaneDb<TContract> & string>(
    from: T,
  ): KyselyDeleteQueryBuilder<LaneDb<TContract>, T, DeleteResult>;
  build<TQuery extends { compile(): unknown }>(query: TQuery): SqlQueryPlan<InferBuildRow<TQuery>>;
  whereExpr<TQuery extends { compile(): unknown }>(query: TQuery): ToWhereExpr;
  readonly redactedSql: string;
}

const BUILD_ONLY_EXECUTION_MESSAGE =
  'Kysely execution is disabled for db.kysely (build-only surface). Build a plan with db.kysely.build(query) and execute it through runtime.';

class BuildOnlyKyselyDriver implements Driver {
  async init(): Promise<void> {}
  async destroy(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> {
    throw new Error(BUILD_ONLY_EXECUTION_MESSAGE);
  }
  async beginTransaction(
    _connection: DatabaseConnection,
    _settings: TransactionSettings,
  ): Promise<void> {
    throw new Error(BUILD_ONLY_EXECUTION_MESSAGE);
  }
  async commitTransaction(_connection: DatabaseConnection): Promise<void> {
    throw new Error(BUILD_ONLY_EXECUTION_MESSAGE);
  }
  async rollbackTransaction(_connection: DatabaseConnection): Promise<void> {
    throw new Error(BUILD_ONLY_EXECUTION_MESSAGE);
  }
  async releaseConnection(_connection: DatabaseConnection): Promise<void> {}
}

class RedactingPostgresQueryCompiler implements QueryCompiler {
  readonly #compiler = new PostgresQueryCompiler();
  compileQuery(
    ...args: Parameters<PostgresQueryCompiler['compileQuery']>
  ): ReturnType<PostgresQueryCompiler['compileQuery']> {
    const [node, queryId] = args;
    const compiled = this.#compiler.compileQuery(node, queryId);
    return {
      ...compiled,
      sql: REDACTED_SQL,
    };
  }
}

class BuildOnlyPostgresDialect implements Dialect {
  createAdapter = () => new PostgresAdapter();
  createDriver = () => new BuildOnlyKyselyDriver();
  createIntrospector = (): DatabaseIntrospector => {
    const msg =
      'Introspection is not supported on the build-only Kysely dialect. Use the runtime schema API instead.';
    return {
      getSchemas: async () => {
        throw new Error(msg);
      },
      getTables: async () => {
        throw new Error(msg);
      },
      getMetadata: async (): Promise<DatabaseMetadata> => {
        throw new Error(msg);
      },
    };
  };
  createQueryCompiler = () => new RedactingPostgresQueryCompiler();
}

class BuildOnlySelectQueryBuilderWrapper<DB, TB extends keyof DB, O>
  implements KyselySelectQueryBuilder<DB, TB, O>
{
  readonly #builder: SelectQueryBuilder<DB, TB, O>;

  constructor(builder: SelectQueryBuilder<DB, TB, O>) {
    this.#builder = builder;
  }

  select<SE extends SelectExpression<DB, TB>>(
    selections: ReadonlyArray<SE>,
  ): KyselySelectQueryBuilder<DB, TB, O & Selection<DB, TB, SE>>;
  select<CB extends SelectCallback<DB, TB>>(
    callback: CB,
  ): KyselySelectQueryBuilder<DB, TB, O & CallbackSelection<DB, TB, CB>>;
  select<SE extends SelectExpression<DB, TB>>(
    selection: SE,
  ): KyselySelectQueryBuilder<DB, TB, O & Selection<DB, TB, SE>>;
  select(selectionOrSelectionsOrCallback: unknown): KyselySelectQueryBuilder<DB, TB, O> {
    return wrapSelectBuilder(
      callBuilderMethod<
        SelectQueryBuilder<DB, TB, O>,
        SelectQueryBuilder<DB, TB, O & Selection<DB, TB, never>>
      >(this.#builder, 'select', selectionOrSelectionsOrCallback),
    );
  }

  selectAll<T extends TB>(
    table: ReadonlyArray<T>,
  ): KyselySelectQueryBuilder<DB, TB, O & Selectable<DB[T]>>;
  selectAll<T extends TB>(table: T): KyselySelectQueryBuilder<DB, TB, O & Selectable<DB[T]>>;
  selectAll(): KyselySelectQueryBuilder<DB, TB, O & Selectable<DB[TB]>>;
  selectAll(table?: unknown): KyselySelectQueryBuilder<DB, TB, O> {
    return table === undefined
      ? wrapSelectBuilder(
          callBuilderMethod<SelectQueryBuilder<DB, TB, O>, SelectQueryBuilder<DB, TB, O>>(
            this.#builder,
            'selectAll',
          ),
        )
      : wrapSelectBuilder(
          callBuilderMethod<SelectQueryBuilder<DB, TB, O>, SelectQueryBuilder<DB, TB, O>>(
            this.#builder,
            'selectAll',
            table,
          ),
        );
  }

  where<
    RE extends ReferenceExpression<DB, TB>,
    VE extends OperandValueExpressionOrList<DB, TB, RE>,
  >(lhs: RE, op: ComparisonOperatorExpression, rhs: VE): KyselySelectQueryBuilder<DB, TB, O>;
  where<E extends ExpressionOrFactory<DB, TB, SqlBool>>(
    expression: E,
  ): KyselySelectQueryBuilder<DB, TB, O>;
  where(...args: unknown[]): KyselySelectQueryBuilder<DB, TB, O> {
    return wrapSelectBuilder(
      callBuilderMethod<SelectQueryBuilder<DB, TB, O>, SelectQueryBuilder<DB, TB, O>>(
        this.#builder,
        'where',
        ...args,
      ),
    );
  }

  orderBy<OE extends OrderByExpression<DB, TB, O>>(
    expr: OE,
    modifiers?: OrderByModifiers,
  ): KyselySelectQueryBuilder<DB, TB, O>;
  orderBy<OE extends OrderByExpression<DB, TB, O>>(
    exprs: ReadonlyArray<OE>,
  ): KyselySelectQueryBuilder<DB, TB, O>;
  orderBy<OE extends OrderByExpression<DB, TB, O>>(
    expr: OE,
    modifiers: unknown,
  ): KyselySelectQueryBuilder<DB, TB, O>;
  orderBy(...args: unknown[]): KyselySelectQueryBuilder<DB, TB, O> {
    return wrapSelectBuilder(
      callBuilderMethod<SelectQueryBuilder<DB, TB, O>, SelectQueryBuilder<DB, TB, O>>(
        this.#builder,
        'orderBy',
        ...args,
      ),
    );
  }

  limit(
    limit: ValueExpression<DB, TB, number | bigint | null>,
  ): KyselySelectQueryBuilder<DB, TB, O> {
    return wrapSelectBuilder(this.#builder.limit(limit));
  }

  compile(): CompiledQuery<SimplifyBuildResult<O>> {
    return this.#builder.compile() as CompiledQuery<SimplifyBuildResult<O>>;
  }
}

class BuildOnlyInsertQueryBuilderWrapper<DB, TB extends keyof DB, O>
  implements KyselyInsertQueryBuilder<DB, TB, O>
{
  readonly #builder: InsertQueryBuilder<DB, TB, O>;

  constructor(builder: InsertQueryBuilder<DB, TB, O>) {
    this.#builder = builder;
  }

  values(
    insert: Parameters<InsertQueryBuilder<DB, TB, O>['values']>[0],
  ): KyselyInsertQueryBuilder<DB, TB, O> {
    return wrapInsertBuilder(this.#builder.values(insert));
  }

  returning<SE extends SelectExpression<DB, TB>>(
    selections: ReadonlyArray<SE>,
  ): KyselyInsertQueryBuilder<DB, TB, O & Selection<DB, TB, SE>>;
  returning<CB extends SelectCallback<DB, TB>>(
    callback: CB,
  ): KyselyInsertQueryBuilder<DB, TB, O & CallbackSelection<DB, TB, CB>>;
  returning<SE extends SelectExpression<DB, TB>>(
    selection: SE,
  ): KyselyInsertQueryBuilder<DB, TB, O & Selection<DB, TB, SE>>;
  returning(selectionOrSelectionsOrCallback: unknown): KyselyInsertQueryBuilder<DB, TB, O> {
    return wrapInsertBuilder(
      callBuilderMethod<InsertQueryBuilder<DB, TB, O>, InsertQueryBuilder<DB, TB, O>>(
        this.#builder,
        'returning',
        selectionOrSelectionsOrCallback,
      ),
    );
  }

  returningAll(): KyselyInsertQueryBuilder<DB, TB, Selectable<DB[TB]>> {
    return wrapInsertBuilder(this.#builder.returningAll());
  }

  compile(): CompiledQuery<SimplifyBuildResult<O>> {
    return this.#builder.compile() as CompiledQuery<SimplifyBuildResult<O>>;
  }
}

class BuildOnlyUpdateQueryBuilderWrapper<DB, UT extends keyof DB, TB extends keyof DB, O>
  implements KyselyUpdateQueryBuilder<DB, UT, TB, O>
{
  readonly #builder: UpdateQueryBuilder<DB, UT, TB, O>;

  constructor(builder: UpdateQueryBuilder<DB, UT, TB, O>) {
    this.#builder = builder;
  }

  set(update: Partial<Selectable<DB[UT]>>): KyselyUpdateQueryBuilder<DB, UT, TB, O>;
  set(key: ReferenceExpression<DB, UT>, value: unknown): KyselyUpdateQueryBuilder<DB, UT, TB, O>;
  set(...args: unknown[]): KyselyUpdateQueryBuilder<DB, UT, TB, O> {
    return wrapUpdateBuilder(
      callBuilderMethod<UpdateQueryBuilder<DB, UT, TB, O>, UpdateQueryBuilder<DB, UT, TB, O>>(
        this.#builder,
        'set',
        ...args,
      ),
    );
  }

  where<
    RE extends ReferenceExpression<DB, TB>,
    VE extends OperandValueExpressionOrList<DB, TB, RE>,
  >(lhs: RE, op: ComparisonOperatorExpression, rhs: VE): KyselyUpdateQueryBuilder<DB, UT, TB, O>;
  where<E extends ExpressionOrFactory<DB, TB, SqlBool>>(
    expression: E,
  ): KyselyUpdateQueryBuilder<DB, UT, TB, O>;
  where(...args: unknown[]): KyselyUpdateQueryBuilder<DB, UT, TB, O> {
    return wrapUpdateBuilder(
      callBuilderMethod<UpdateQueryBuilder<DB, UT, TB, O>, UpdateQueryBuilder<DB, UT, TB, O>>(
        this.#builder,
        'where',
        ...args,
      ),
    );
  }

  returning<SE extends SelectExpression<DB, TB>>(
    selections: ReadonlyArray<SE>,
  ): KyselyUpdateQueryBuilder<DB, UT, TB, O & Selection<DB, TB, SE>>;
  returning<CB extends SelectCallback<DB, TB>>(
    callback: CB,
  ): KyselyUpdateQueryBuilder<DB, UT, TB, O & CallbackSelection<DB, TB, CB>>;
  returning<SE extends SelectExpression<DB, TB>>(
    selection: SE,
  ): KyselyUpdateQueryBuilder<DB, UT, TB, O & Selection<DB, TB, SE>>;
  returning(selectionOrSelectionsOrCallback: unknown): KyselyUpdateQueryBuilder<DB, UT, TB, O> {
    return wrapUpdateBuilder(
      callBuilderMethod<UpdateQueryBuilder<DB, UT, TB, O>, UpdateQueryBuilder<DB, UT, TB, O>>(
        this.#builder,
        'returning',
        selectionOrSelectionsOrCallback,
      ),
    );
  }

  returningAll(): KyselyUpdateQueryBuilder<DB, UT, TB, Selectable<DB[TB]>> {
    return wrapUpdateBuilder(this.#builder.returningAll());
  }

  compile(): CompiledQuery<SimplifyBuildResult<O>> {
    return this.#builder.compile() as CompiledQuery<SimplifyBuildResult<O>>;
  }
}

class BuildOnlyDeleteQueryBuilderWrapper<DB, TB extends keyof DB, O>
  implements KyselyDeleteQueryBuilder<DB, TB, O>
{
  readonly #builder: DeleteQueryBuilder<DB, TB, O>;

  constructor(builder: DeleteQueryBuilder<DB, TB, O>) {
    this.#builder = builder;
  }

  where<
    RE extends ReferenceExpression<DB, TB>,
    VE extends OperandValueExpressionOrList<DB, TB, RE>,
  >(lhs: RE, op: ComparisonOperatorExpression, rhs: VE): KyselyDeleteQueryBuilder<DB, TB, O>;
  where<E extends ExpressionOrFactory<DB, TB, SqlBool>>(
    expression: E,
  ): KyselyDeleteQueryBuilder<DB, TB, O>;
  where(...args: unknown[]): KyselyDeleteQueryBuilder<DB, TB, O> {
    return wrapDeleteBuilder(
      callBuilderMethod<DeleteQueryBuilder<DB, TB, O>, DeleteQueryBuilder<DB, TB, O>>(
        this.#builder,
        'where',
        ...args,
      ),
    );
  }

  returning<SE extends SelectExpression<DB, TB>>(
    selections: ReadonlyArray<SE>,
  ): KyselyDeleteQueryBuilder<DB, TB, O & Selection<DB, TB, SE>>;
  returning<CB extends SelectCallback<DB, TB>>(
    callback: CB,
  ): KyselyDeleteQueryBuilder<DB, TB, O & CallbackSelection<DB, TB, CB>>;
  returning<SE extends SelectExpression<DB, TB>>(
    selection: SE,
  ): KyselyDeleteQueryBuilder<DB, TB, O & Selection<DB, TB, SE>>;
  returning(selectionOrSelectionsOrCallback: unknown): KyselyDeleteQueryBuilder<DB, TB, O> {
    return wrapDeleteBuilder(
      callBuilderMethod<DeleteQueryBuilder<DB, TB, O>, DeleteQueryBuilder<DB, TB, O>>(
        this.#builder,
        'returning',
        selectionOrSelectionsOrCallback,
      ),
    );
  }

  returningAll(): KyselyDeleteQueryBuilder<DB, TB, Selectable<DB[TB]>> {
    return wrapDeleteBuilder(this.#builder.returningAll());
  }

  compile(): CompiledQuery<SimplifyBuildResult<O>> {
    return this.#builder.compile() as CompiledQuery<SimplifyBuildResult<O>>;
  }
}

function wrapSelectBuilder<DB, TB extends keyof DB, O>(
  builder: SelectQueryBuilder<DB, TB, O>,
): KyselySelectQueryBuilder<DB, TB, O> {
  return new BuildOnlySelectQueryBuilderWrapper(builder);
}

function wrapInsertBuilder<DB, TB extends keyof DB, O>(
  builder: InsertQueryBuilder<DB, TB, O>,
): KyselyInsertQueryBuilder<DB, TB, O> {
  return new BuildOnlyInsertQueryBuilderWrapper(builder);
}

function wrapUpdateBuilder<DB, UT extends keyof DB, TB extends keyof DB, O>(
  builder: UpdateQueryBuilder<DB, UT, TB, O>,
): KyselyUpdateQueryBuilder<DB, UT, TB, O> {
  return new BuildOnlyUpdateQueryBuilderWrapper(builder);
}

function wrapDeleteBuilder<DB, TB extends keyof DB, O>(
  builder: DeleteQueryBuilder<DB, TB, O>,
): KyselyDeleteQueryBuilder<DB, TB, O> {
  return new BuildOnlyDeleteQueryBuilderWrapper(builder);
}

function callBuilderMethod<TBuilder extends object, TResult>(
  builder: TBuilder,
  methodName: string,
  ...args: unknown[]
): TResult {
  const maybeMethod = Reflect.get(builder, methodName);
  if (typeof maybeMethod !== 'function') {
    throw new Error(`Expected ${methodName} to be a function on Kysely builder`);
  }
  return (maybeMethod as (...methodArgs: unknown[]) => TResult).apply(builder, args);
}

export function createBuildOnlyKyselyLane<TContract extends SqlContract<SqlStorage>>(
  contract: TContract,
): KyselyQueryLane<TContract> {
  const base = new KyselyClient<KyselifyContract<TContract>>({
    dialect: new BuildOnlyPostgresDialect(),
  });

  const lane: KyselyQueryLane<TContract> = {
    selectFrom: ((from: unknown) =>
      wrapSelectBuilder(
        callBuilderMethod<
          KyselyClient<KyselifyContract<TContract>>,
          SelectQueryBuilder<LaneDb<TContract>, never, never>
        >(base, 'selectFrom', from),
      )) as KyselyQueryLane<TContract>['selectFrom'],
    insertInto: ((table: string) =>
      wrapInsertBuilder(
        callBuilderMethod<
          KyselyClient<KyselifyContract<TContract>>,
          InsertQueryBuilder<LaneDb<TContract>, never, never>
        >(base, 'insertInto', table),
      )) as KyselyQueryLane<TContract>['insertInto'],
    updateTable: ((tables: unknown) =>
      wrapUpdateBuilder(
        callBuilderMethod<
          KyselyClient<KyselifyContract<TContract>>,
          UpdateQueryBuilder<LaneDb<TContract>, never, never, never>
        >(base, 'updateTable', tables),
      )) as KyselyQueryLane<TContract>['updateTable'],
    deleteFrom: ((from: unknown) =>
      wrapDeleteBuilder(
        callBuilderMethod<
          KyselyClient<KyselifyContract<TContract>>,
          DeleteQueryBuilder<LaneDb<TContract>, never, never>
        >(base, 'deleteFrom', from),
      )) as KyselyQueryLane<TContract>['deleteFrom'],
    build<TQuery extends { compile(): unknown }>(
      query: TQuery,
    ): SqlQueryPlan<InferBuildRow<TQuery>> {
      return buildKyselyPlan(contract, query.compile() as CompiledQuery<InferBuildRow<TQuery>>, {
        lane: 'kysely',
      });
    },
    whereExpr<TQuery extends { compile(): unknown }>(query: TQuery): ToWhereExpr {
      return buildKyselyWhereExpr(
        contract,
        query.compile() as CompiledQuery<InferBuildRow<TQuery>>,
        {
          lane: 'kysely',
        },
      );
    },
    redactedSql: REDACTED_SQL,
  };

  return lane;
}
