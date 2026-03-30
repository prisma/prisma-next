import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { isWhereExpr, type ToWhereExpr, type WhereArg } from '@prisma-next/sql-relational-core/ast';
import { createAggregateBuilder, isAggregateSelector } from './aggregate-builder';
import { normalizeAggregateResult } from './collection-aggregate-result';
import {
  mapCursorValuesToColumns,
  mapFieldsToColumns,
  mapFieldToColumn,
} from './collection-column-mapping';
import {
  assertReturningCapability,
  isToOneCardinality,
  resolveIncludeRelation,
  resolveModelTableName,
  resolvePrimaryKeyColumn,
  resolveUpsertConflictColumns,
} from './collection-contract';
import { dispatchCollectionRows } from './collection-dispatch';
import type {
  CollectionConstructor,
  CollectionInit,
  IncludedRelationsForRow,
  IncludeRefinementCollection,
  IncludeRefinementResult,
  IncludeRefinementValue,
  IsToManyRelation,
  RowSelection,
  WithOrderByState,
  WithWhereState,
} from './collection-internal-types';
import { RowType } from './collection-internal-types';
import {
  dispatchMutationRows,
  executeMutationReturningSingleRow,
} from './collection-mutation-dispatch';
import { augmentSelectionForJoinColumns, mapModelDataToStorageRow } from './collection-runtime';
import { executeQueryPlan } from './execute-query-plan';
import { shorthandToWhereExpr } from './filters';
import { GroupedCollection } from './grouped-collection';
import {
  createIncludeCombine,
  createIncludeScalar,
  isCollectionStateCarrier,
  isIncludeCombine,
  isIncludeScalar,
} from './include-descriptors';
import { createModelAccessor } from './model-accessor';
import {
  buildPrimaryKeyFilterFromRow,
  executeNestedCreateMutation,
  executeNestedUpdateMutation,
  hasNestedMutationCallbacks,
} from './mutation-executor';
import {
  compileAggregate,
  compileDeleteCount,
  compileDeleteReturning,
  compileInsertCount,
  compileInsertReturning,
  compileSelect,
  compileUpdateCount,
  compileUpdateReturning,
  compileUpsertReturning,
} from './query-plan';
import type {
  AggregateBuilder,
  AggregateResult,
  AggregateSpec,
  CollectionContext,
  CollectionState,
  CollectionTypeState,
  CreateInput,
  DefaultCollectionTypeState,
  DefaultModelRow,
  IncludeCombine,
  IncludeCombineBranch,
  IncludeExpr,
  IncludeScalar,
  ModelAccessor,
  MutationCreateInput,
  MutationCreateInputWithRelations,
  MutationUpdateInput,
  NumericFieldNames,
  OrderByDirective,
  OrderExpr,
  RelatedModelName,
  RelationNames,
  ShorthandWhereFilter,
  UniqueConstraintCriterion,
} from './types';
import { emptyState } from './types';
import { normalizeWhereArg } from './where-interop';

type WhereDirectInput = WhereArg;

function isToWhereExprInput(value: unknown): value is ToWhereExpr {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toWhereExpr' in value &&
    typeof (value as { toWhereExpr?: unknown }).toWhereExpr === 'function'
  );
}

function isWhereDirectInput(value: unknown): value is WhereDirectInput {
  return (
    (isWhereExpr(value) && typeof (value as { accept?: unknown }).accept === 'function') ||
    isToWhereExprInput(value)
  );
}

export class Collection<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  Row = DefaultModelRow<TContract, ModelName>,
  State extends CollectionTypeState = DefaultCollectionTypeState,
> implements RowSelection<Row>
{
  declare readonly [RowType]: Row;
  /** @internal */
  readonly ctx: CollectionContext<TContract>;
  /** @internal */
  readonly modelName: ModelName;
  /** @internal */
  readonly tableName: string;
  /** @internal */
  readonly state: CollectionState;
  /** @internal */
  readonly registry: ReadonlyMap<string, CollectionConstructor<TContract>>;
  /** @internal */
  readonly includeRefinementMode: boolean;

  constructor(
    ctx: CollectionContext<TContract>,
    modelName: ModelName,
    options: CollectionInit<TContract> = {},
  ) {
    this.ctx = ctx;
    this.modelName = modelName;
    this.tableName = options.tableName ?? resolveModelTableName(ctx.contract, modelName);
    this.state = options.state ?? emptyState();
    this.registry = options.registry ?? new Map<string, CollectionConstructor<TContract>>();
    this.includeRefinementMode = options.includeRefinementMode ?? false;
  }

  where(
    fn: (model: ModelAccessor<TContract, ModelName>) => WhereDirectInput,
  ): Collection<TContract, ModelName, Row, WithWhereState<State>>;
  where(input: WhereDirectInput): Collection<TContract, ModelName, Row, WithWhereState<State>>;
  where(
    fn: (model: ModelAccessor<TContract, ModelName>) => WhereArg,
  ): Collection<TContract, ModelName, Row, WithWhereState<State>>;
  where(
    filters: ShorthandWhereFilter<TContract, ModelName>,
  ): Collection<TContract, ModelName, Row, WithWhereState<State>>;
  where(
    input:
      | WhereDirectInput
      | ((model: ModelAccessor<TContract, ModelName>) => WhereDirectInput)
      | ((model: ModelAccessor<TContract, ModelName>) => WhereArg)
      | ShorthandWhereFilter<TContract, ModelName>,
  ): Collection<TContract, ModelName, Row, WithWhereState<State>> {
    const whereArg =
      typeof input === 'function'
        ? input(createModelAccessor(this.ctx.contract, this.modelName))
        : isWhereDirectInput(input)
          ? input
          : shorthandToWhereExpr(this.ctx.contract, this.modelName, input);
    const filter = normalizeWhereArg(whereArg, { contract: this.ctx.contract });

    if (!filter) {
      return this as Collection<TContract, ModelName, Row, WithWhereState<State>>;
    }

    return this.#clone<WithWhereState<State>>({
      filters: [...this.state.filters, filter],
    });
  }

  include<
    RelName extends RelationNames<TContract, ModelName>,
    RelatedName extends RelatedModelName<TContract, ModelName, RelName> & string = RelatedModelName<
      TContract,
      ModelName,
      RelName
    > &
      string,
    IsToMany extends boolean = IsToManyRelation<TContract, ModelName, RelName>,
    RefinedResult extends IncludeRefinementResult<
      TContract,
      RelatedName,
      IsToMany
    > = IncludeRefinementCollection<
      TContract,
      RelatedName,
      DefaultModelRow<TContract, RelatedName>,
      CollectionTypeState,
      IsToMany
    >,
  >(
    relationName: RelName,
    refineFn?: (
      collection: IncludeRefinementCollection<
        TContract,
        RelatedName,
        DefaultModelRow<TContract, RelatedName>,
        DefaultCollectionTypeState,
        IsToMany
      >,
    ) => RefinedResult,
  ): Collection<
    TContract,
    ModelName,
    Row & {
      [K in RelName]: IncludeRefinementValue<
        TContract,
        ModelName,
        K,
        DefaultModelRow<TContract, RelatedName>,
        RefinedResult
      >;
    },
    State
  > {
    const relation = resolveIncludeRelation(
      this.ctx.contract,
      this.modelName,
      relationName as string,
    );

    let nestedState = emptyState();
    let scalarSelector: IncludeScalar<unknown> | undefined;
    let combineBranches: Readonly<Record<string, IncludeCombineBranch>> | undefined;

    if (refineFn) {
      const nestedCollection = this.#createCollection<
        RelatedName,
        DefaultModelRow<TContract, RelatedName>,
        DefaultCollectionTypeState
      >(relation.relatedModelName as RelatedName, {
        tableName: relation.relatedTableName,
        state: emptyState(),
        includeRefinementMode: true,
      });
      const refined = refineFn(
        nestedCollection as unknown as IncludeRefinementCollection<
          TContract,
          RelatedName,
          DefaultModelRow<TContract, RelatedName>,
          DefaultCollectionTypeState,
          IsToMany
        >,
      );

      if (isIncludeScalar(refined)) {
        if (isToOneCardinality(relation.cardinality)) {
          throw new Error(
            `include('${relationName as string}') scalar aggregations are only supported for to-many relations`,
          );
        }
        scalarSelector = refined;
        nestedState = refined.state;
      } else if (isIncludeCombine(refined)) {
        if (isToOneCardinality(relation.cardinality)) {
          throw new Error(
            `include('${relationName as string}') combine() is only supported for to-many relations`,
          );
        }
        combineBranches = refined.branches;
      } else if (isCollectionStateCarrier(refined)) {
        nestedState = refined.state;
      } else {
        throw new Error(
          `include('${relationName as string}') refinement must return a collection, include scalar selector, or combine() descriptor`,
        );
      }
    }

    const includeExpr: IncludeExpr = {
      relationName: relationName as string,
      relatedModelName: relation.relatedModelName,
      relatedTableName: relation.relatedTableName,
      fkColumn: relation.fkColumn,
      parentPkColumn: relation.parentPkColumn,
      cardinality: relation.cardinality,
      nested: nestedState,
      scalar: scalarSelector,
      combine: combineBranches,
    };

    return this.#cloneWithRow<
      Row & {
        [K in RelName]: IncludeRefinementValue<
          TContract,
          ModelName,
          K,
          DefaultModelRow<TContract, RelatedName>,
          RefinedResult
        >;
      },
      State
    >({
      includes: [...this.state.includes, includeExpr],
    });
  }

  select<
    Fields extends readonly [
      keyof DefaultModelRow<TContract, ModelName> & string,
      ...(keyof DefaultModelRow<TContract, ModelName> & string)[],
    ],
  >(
    ...fields: Fields
  ): Collection<
    TContract,
    ModelName,
    Pick<DefaultModelRow<TContract, ModelName>, Fields[number]> &
      IncludedRelationsForRow<TContract, ModelName, Row>,
    State
  > {
    const selectedFields = mapFieldsToColumns(this.ctx.contract, this.modelName, fields);

    return this.#cloneWithRow<
      Pick<DefaultModelRow<TContract, ModelName>, Fields[number]> &
        IncludedRelationsForRow<TContract, ModelName, Row>,
      State
    >({
      selectedFields,
    });
  }

  orderBy(
    selection:
      | ((model: ModelAccessor<TContract, ModelName>) => OrderByDirective)
      | ReadonlyArray<(model: ModelAccessor<TContract, ModelName>) => OrderByDirective>,
  ): Collection<TContract, ModelName, Row, WithOrderByState<State>> {
    const accessor = createModelAccessor(this.ctx.contract, this.modelName);
    const selectors = Array.isArray(selection) ? selection : [selection];
    const nextOrders: OrderExpr[] = selectors.map((selector) => {
      const order = selector(accessor as ModelAccessor<TContract, ModelName>);
      return {
        column: order.column,
        direction: order.direction,
      };
    });
    const existing = this.state.orderBy ?? [];
    return this.#clone<WithOrderByState<State>>({
      orderBy: [...existing, ...nextOrders],
    });
  }

  groupBy<
    Fields extends readonly [
      keyof DefaultModelRow<TContract, ModelName> & string,
      ...(keyof DefaultModelRow<TContract, ModelName> & string)[],
    ],
  >(...fields: Fields): GroupedCollection<TContract, ModelName, Fields> {
    const groupByColumns = mapFieldsToColumns(this.ctx.contract, this.modelName, fields);

    return new GroupedCollection(this.ctx, this.modelName, {
      tableName: this.tableName,
      baseFilters: this.state.filters,
      groupByFields: [...fields],
      groupByColumns,
      havingFilters: [],
    });
  }

  count(): IncludeScalar<number> {
    this.#assertIncludeRefinementMode('count()');
    return createIncludeScalar<number>('count', this.state);
  }

  sum<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): IncludeScalar<number | null> {
    this.#assertIncludeRefinementMode('sum()');
    const columnName = mapFieldToColumn(this.ctx.contract, this.modelName, field as string);
    return createIncludeScalar<number | null>('sum', this.state, columnName);
  }

  avg<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): IncludeScalar<number | null> {
    this.#assertIncludeRefinementMode('avg()');
    const columnName = mapFieldToColumn(this.ctx.contract, this.modelName, field as string);
    return createIncludeScalar<number | null>('avg', this.state, columnName);
  }

  min<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): IncludeScalar<number | null> {
    this.#assertIncludeRefinementMode('min()');
    const columnName = mapFieldToColumn(this.ctx.contract, this.modelName, field as string);
    return createIncludeScalar<number | null>('min', this.state, columnName);
  }

  max<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): IncludeScalar<number | null> {
    this.#assertIncludeRefinementMode('max()');
    const columnName = mapFieldToColumn(this.ctx.contract, this.modelName, field as string);
    return createIncludeScalar<number | null>('max', this.state, columnName);
  }

  combine<
    Spec extends Record<
      string,
      Collection<TContract, ModelName, unknown, CollectionTypeState> | IncludeScalar<unknown>
    >,
  >(
    spec: Spec,
  ): IncludeCombine<{
    [K in keyof Spec]: Spec[K] extends IncludeScalar<infer ScalarResult>
      ? ScalarResult
      : Spec[K] extends Collection<TContract, ModelName, infer BranchRow, CollectionTypeState>
        ? BranchRow[]
        : never;
  }> {
    this.#assertIncludeRefinementMode('combine()');

    const branches: Record<string, IncludeCombineBranch> = {};
    for (const [name, value] of Object.entries(spec)) {
      if (isIncludeScalar(value)) {
        branches[name] = {
          kind: 'scalar',
          selector: value,
        };
        continue;
      }

      if (isCollectionStateCarrier(value)) {
        branches[name] = {
          kind: 'rows',
          state: value.state,
        };
        continue;
      }

      throw new Error(`include().combine() branch "${name}" is invalid`);
    }

    return createIncludeCombine(branches) as IncludeCombine<{
      [K in keyof Spec]: Spec[K] extends IncludeScalar<infer ScalarResult>
        ? ScalarResult
        : Spec[K] extends Collection<TContract, ModelName, infer BranchRow, CollectionTypeState>
          ? BranchRow[]
          : never;
    }>;
  }

  cursor(
    cursorValues: State['hasOrderBy'] extends true
      ? Partial<Record<keyof DefaultModelRow<TContract, ModelName> & string, unknown>>
      : never,
  ): Collection<TContract, ModelName, Row, State> {
    const mappedCursor = mapCursorValuesToColumns(
      this.ctx.contract,
      this.modelName,
      cursorValues as Readonly<Record<string, unknown>>,
    );

    if (Object.keys(mappedCursor).length === 0) {
      return this;
    }

    return this.#clone({
      cursor: mappedCursor,
    });
  }

  distinct<
    Fields extends readonly [
      keyof DefaultModelRow<TContract, ModelName> & string,
      ...(keyof DefaultModelRow<TContract, ModelName> & string)[],
    ],
  >(...fields: Fields): Collection<TContract, ModelName, Row, State> {
    const distinctFields = mapFieldsToColumns(this.ctx.contract, this.modelName, fields);

    return this.#clone({
      distinct: distinctFields,
      distinctOn: undefined,
    });
  }

  distinctOn<
    Fields extends readonly [
      keyof DefaultModelRow<TContract, ModelName> & string,
      ...(keyof DefaultModelRow<TContract, ModelName> & string)[],
    ],
  >(
    ...fields: State['hasOrderBy'] extends true ? Fields : never
  ): Collection<TContract, ModelName, Row, State> {
    const distinctOnFields = mapFieldsToColumns(
      this.ctx.contract,
      this.modelName,
      fields as readonly string[],
    );

    return this.#clone({
      distinct: undefined,
      distinctOn: distinctOnFields,
    });
  }

  take(n: number): Collection<TContract, ModelName, Row, State> {
    return this.#clone({ limit: n });
  }

  skip(n: number): Collection<TContract, ModelName, Row, State> {
    return this.#clone({ offset: n });
  }

  all(): AsyncIterableResult<Row> {
    return this.#dispatch();
  }

  async first(): Promise<Row | null>;
  async first(
    filter: (model: ModelAccessor<TContract, ModelName>) => WhereArg,
  ): Promise<Row | null>;
  async first(filter: ShorthandWhereFilter<TContract, ModelName>): Promise<Row | null>;
  async first(
    filter?:
      | ((model: ModelAccessor<TContract, ModelName>) => WhereArg)
      | ShorthandWhereFilter<TContract, ModelName>,
  ): Promise<Row | null> {
    const scoped =
      filter === undefined
        ? this
        : typeof filter === 'function'
          ? this.where(filter)
          : this.where(filter);
    const limited = scoped.take(1);
    const rows = await limited.#dispatch().toArray();
    return rows[0] ?? null;
  }

  async aggregate<Spec extends AggregateSpec>(
    fn: (aggregate: AggregateBuilder<TContract, ModelName>) => Spec,
  ): Promise<AggregateResult<Spec>> {
    const aggregateSpec = fn(createAggregateBuilder(this.ctx.contract, this.modelName));
    const entries = Object.entries(aggregateSpec);
    if (entries.length === 0) {
      throw new Error('aggregate() requires at least one aggregation selector');
    }

    for (const [alias, selector] of entries) {
      if (!isAggregateSelector(selector)) {
        throw new Error(`aggregate() selector "${alias}" is invalid`);
      }
    }

    const compiled = compileAggregate(
      this.ctx.contract,
      this.tableName,
      this.state.filters,
      aggregateSpec,
    );
    const rows = await executeQueryPlan<Record<string, unknown>>(
      this.ctx.runtime,
      compiled,
    ).toArray();
    return normalizeAggregateResult(aggregateSpec, rows[0] ?? {});
  }

  async create(data: CreateInput<TContract, ModelName>): Promise<Row>;
  async create(data: MutationCreateInputWithRelations<TContract, ModelName>): Promise<Row>;
  async create(
    data:
      | CreateInput<TContract, ModelName>
      | MutationCreateInputWithRelations<TContract, ModelName>,
  ): Promise<Row> {
    assertReturningCapability(this.ctx.contract, 'create()');

    if (
      hasNestedMutationCallbacks(this.ctx.contract, this.modelName, data as Record<string, unknown>)
    ) {
      const createdRow = await executeNestedCreateMutation({
        contract: this.ctx.contract,
        runtime: this.ctx.runtime,
        modelName: this.modelName,
        data: data as MutationCreateInput<SqlContract<SqlStorage>, string>,
      });

      const pkCriterion = buildPrimaryKeyFilterFromRow(
        this.ctx.contract,
        this.modelName,
        createdRow,
      );
      const reloaded = await this.#reloadMutationRowByPrimaryKey(pkCriterion);
      if (!reloaded) {
        throw new Error(`create() for model "${this.modelName}" did not return a row`);
      }
      return reloaded;
    }

    const rows = await this.createAll([data as CreateInput<TContract, ModelName>]);
    const created = rows[0];
    if (created) {
      return created;
    }

    throw new Error(`create() for model "${this.modelName}" did not return a row`);
  }

  createAll(data: readonly CreateInput<TContract, ModelName>[]): AsyncIterableResult<Row> {
    if (data.length === 0) {
      const generator = async function* (): AsyncGenerator<Row, void, unknown> {};
      return new AsyncIterableResult(generator());
    }

    assertReturningCapability(this.ctx.contract, 'createAll()');

    const mappedRows = data.map((row) =>
      mapModelDataToStorageRow(this.ctx.contract, this.modelName, row),
    );
    const parentJoinColumns = this.state.includes.map((include) => include.parentPkColumn);
    const { selectedForQuery: selectedForInsert, hiddenColumns } = augmentSelectionForJoinColumns(
      this.state.selectedFields,
      parentJoinColumns,
    );
    const compiled = compileInsertReturning(
      this.ctx.contract,
      this.tableName,
      mappedRows,
      selectedForInsert,
    );
    return dispatchMutationRows<Row>({
      contract: this.ctx.contract,
      runtime: this.ctx.runtime,
      compiled,
      tableName: this.tableName,
      includes: this.state.includes,
      hiddenColumns,
      mapRow: (mapped) => mapped as Row,
    });
  }

  async createCount(data: readonly CreateInput<TContract, ModelName>[]): Promise<number> {
    if (data.length === 0) {
      return 0;
    }

    const mappedRows = data.map((row) =>
      mapModelDataToStorageRow(this.ctx.contract, this.modelName, row),
    );
    const compiled = compileInsertCount(this.ctx.contract, this.tableName, mappedRows);
    await executeQueryPlan<Record<string, unknown>>(this.ctx.runtime, compiled).toArray();
    return data.length;
  }

  /**
   * Passing `update: {}` makes this behave like a conditional create.
   * On conflict, `ON CONFLICT DO NOTHING RETURNING ...` may return zero rows,
   * so this method may issue a follow-up reload query to return the existing row.
   */
  async upsert(input: {
    create: CreateInput<TContract, ModelName>;
    update: Partial<DefaultModelRow<TContract, ModelName>>;
    conflictOn?: UniqueConstraintCriterion<TContract, ModelName>;
  }): Promise<Row> {
    assertReturningCapability(this.ctx.contract, 'upsert()');

    const createValues = mapModelDataToStorageRow(this.ctx.contract, this.modelName, input.create);
    const updateValues = mapModelDataToStorageRow(this.ctx.contract, this.modelName, input.update);
    const hasUpdateValues = Object.keys(updateValues).length > 0;
    const conflictColumns = resolveUpsertConflictColumns(
      this.ctx.contract,
      this.modelName,
      input.conflictOn as Record<string, unknown> | undefined,
    );
    if (conflictColumns.length === 0) {
      throw new Error(`upsert() for model "${this.modelName}" requires conflict columns`);
    }

    const parentJoinColumns = this.state.includes.map((include) => include.parentPkColumn);
    const { selectedForQuery: selectedForUpsert, hiddenColumns } = augmentSelectionForJoinColumns(
      this.state.selectedFields,
      parentJoinColumns,
    );
    const compiled = compileUpsertReturning(
      this.ctx.contract,
      this.tableName,
      createValues,
      updateValues,
      conflictColumns,
      selectedForUpsert,
    );
    const row = await executeMutationReturningSingleRow<Row>({
      contract: this.ctx.contract,
      runtime: this.ctx.runtime,
      compiled,
      tableName: this.tableName,
      includes: this.state.includes,
      hiddenColumns,
      mapRow: (mapped) => mapped as Row,
      onMissingRowMessage: `upsert() for model "${this.modelName}" did not return a row`,
    });
    if (row) {
      return row;
    }

    if (!hasUpdateValues) {
      const conflictCriterion = this.#buildUpsertConflictCriterion(createValues, conflictColumns);
      const existing = await this.#reloadMutationRowByCriterion(
        conflictCriterion,
        'upsert conflict',
      );
      if (existing) {
        return existing;
      }
    }

    throw new Error(`upsert() for model "${this.modelName}" did not return a row`);
  }

  async update(
    data: State['hasWhere'] extends true ? MutationUpdateInput<TContract, ModelName> : never,
  ): Promise<Row | null> {
    assertReturningCapability(this.ctx.contract, 'update()');

    if (
      hasNestedMutationCallbacks(this.ctx.contract, this.modelName, data as Record<string, unknown>)
    ) {
      const updatedRow = await executeNestedUpdateMutation({
        contract: this.ctx.contract,
        runtime: this.ctx.runtime,
        modelName: this.modelName,
        filters: this.state.filters,
        data: data as MutationUpdateInput<SqlContract<SqlStorage>, string>,
      });
      if (!updatedRow) {
        return null;
      }

      const pkCriterion = buildPrimaryKeyFilterFromRow(
        this.ctx.contract,
        this.modelName,
        updatedRow,
      );
      return this.#reloadMutationRowByPrimaryKey(pkCriterion);
    }

    const rows = await this.updateAll(
      data as State['hasWhere'] extends true
        ? Partial<DefaultModelRow<TContract, ModelName>>
        : never,
    );
    return rows[0] ?? null;
  }

  updateAll(
    data: State['hasWhere'] extends true ? Partial<DefaultModelRow<TContract, ModelName>> : never,
  ): AsyncIterableResult<Row> {
    assertReturningCapability(this.ctx.contract, 'updateAll()');

    const mappedData = mapModelDataToStorageRow(this.ctx.contract, this.modelName, data);
    if (Object.keys(mappedData).length === 0) {
      const generator = async function* (): AsyncGenerator<Row, void, unknown> {};
      return new AsyncIterableResult(generator());
    }

    const parentJoinColumns = this.state.includes.map((include) => include.parentPkColumn);
    const { selectedForQuery: selectedForUpdate, hiddenColumns } = augmentSelectionForJoinColumns(
      this.state.selectedFields,
      parentJoinColumns,
    );
    const compiled = compileUpdateReturning(
      this.ctx.contract,
      this.tableName,
      mappedData,
      this.state.filters,
      selectedForUpdate,
    );
    return dispatchMutationRows<Row>({
      contract: this.ctx.contract,
      runtime: this.ctx.runtime,
      compiled,
      tableName: this.tableName,
      includes: this.state.includes,
      hiddenColumns,
      mapRow: (mapped) => mapped as Row,
    });
  }

  async updateCount(
    data: State['hasWhere'] extends true ? Partial<DefaultModelRow<TContract, ModelName>> : never,
  ): Promise<number> {
    const mappedData = mapModelDataToStorageRow(this.ctx.contract, this.modelName, data);
    if (Object.keys(mappedData).length === 0) {
      return 0;
    }

    const primaryKeyColumn = resolvePrimaryKeyColumn(this.ctx.contract, this.tableName);
    const countState: CollectionState = {
      ...emptyState(),
      filters: this.state.filters,
      selectedFields: [primaryKeyColumn],
    };
    const countCompiled = compileSelect(this.ctx.contract, this.tableName, countState);
    const matchingRows = await executeQueryPlan<Record<string, unknown>>(
      this.ctx.runtime,
      countCompiled,
    ).toArray();

    const compiled = compileUpdateCount(
      this.ctx.contract,
      this.tableName,
      mappedData,
      this.state.filters,
    );
    await executeQueryPlan<Record<string, unknown>>(this.ctx.runtime, compiled).toArray();

    return matchingRows.length;
  }

  async delete(
    this: State['hasWhere'] extends true ? Collection<TContract, ModelName, Row, State> : never,
  ): Promise<Row | null> {
    assertReturningCapability(this.ctx.contract, 'delete()');
    const rows = await this.deleteAll().toArray();
    return rows[0] ?? null;
  }

  deleteAll(
    this: State['hasWhere'] extends true ? Collection<TContract, ModelName, Row, State> : never,
  ): AsyncIterableResult<Row> {
    assertReturningCapability(this.ctx.contract, 'deleteAll()');

    const parentJoinColumns = this.state.includes.map((include) => include.parentPkColumn);
    const { selectedForQuery: selectedForDelete, hiddenColumns } = augmentSelectionForJoinColumns(
      this.state.selectedFields,
      parentJoinColumns,
    );
    const compiled = compileDeleteReturning(
      this.ctx.contract,
      this.tableName,
      this.state.filters,
      selectedForDelete,
    );
    return dispatchMutationRows<Row>({
      contract: this.ctx.contract,
      runtime: this.ctx.runtime,
      compiled,
      tableName: this.tableName,
      includes: this.state.includes,
      hiddenColumns,
      mapRow: (mapped) => mapped as Row,
    });
  }

  async deleteCount(
    this: State['hasWhere'] extends true ? Collection<TContract, ModelName, Row, State> : never,
  ): Promise<number> {
    const primaryKeyColumn = resolvePrimaryKeyColumn(this.ctx.contract, this.tableName);
    const countState: CollectionState = {
      ...emptyState(),
      filters: this.state.filters,
      selectedFields: [primaryKeyColumn],
    };
    const countCompiled = compileSelect(this.ctx.contract, this.tableName, countState);
    const matchingRows = await executeQueryPlan<Record<string, unknown>>(
      this.ctx.runtime,
      countCompiled,
    ).toArray();

    const compiled = compileDeleteCount(this.ctx.contract, this.tableName, this.state.filters);
    await executeQueryPlan<Record<string, unknown>>(this.ctx.runtime, compiled).toArray();

    return matchingRows.length;
  }

  #buildUpsertConflictCriterion(
    createValues: Record<string, unknown>,
    conflictColumns: readonly string[],
  ): Record<string, unknown> {
    const columnToField = this.ctx.contract.mappings.columnToField?.[this.tableName] ?? {};
    const criterion: Record<string, unknown> = {};

    for (const columnName of conflictColumns) {
      if (!(columnName in createValues)) {
        throw new Error(
          `upsert() for model "${this.modelName}" requires create value for conflict column "${columnName}"`,
        );
      }

      const fieldName = columnToField[columnName] ?? columnName;
      criterion[fieldName] = createValues[columnName];
    }

    return criterion;
  }

  async #reloadMutationRowByPrimaryKey(criterion: Record<string, unknown>): Promise<Row | null> {
    return this.#reloadMutationRowByCriterion(criterion, 'primary key');
  }

  async #reloadMutationRowByCriterion(
    criterion: Record<string, unknown>,
    criterionLabel: string,
  ): Promise<Row | null> {
    const whereExpr = shorthandToWhereExpr(
      this.ctx.contract,
      this.modelName,
      criterion as ShorthandWhereFilter<TContract, ModelName>,
    );
    if (!whereExpr) {
      throw new Error(
        `Failed to build ${criterionLabel} filter for mutation result on model "${this.modelName}"`,
      );
    }

    const resultState: CollectionState = {
      ...emptyState(),
      filters: [whereExpr],
      includes: this.state.includes,
      selectedFields: this.state.selectedFields,
      limit: 1,
    };

    const rows = await dispatchCollectionRows<Row>({
      contract: this.ctx.contract,
      runtime: this.ctx.runtime,
      state: resultState,
      tableName: this.tableName,
    });
    return rows[0] ?? null;
  }

  #assertIncludeRefinementMode(action: string): void {
    if (this.includeRefinementMode) {
      return;
    }

    throw new Error(`${action} is only available inside include() refinement callbacks`);
  }

  #clone<NextState extends CollectionTypeState = State>(
    overrides: Partial<CollectionState>,
  ): Collection<TContract, ModelName, Row, NextState> {
    return this.#createSelf<Row, NextState>({
      ...this.state,
      ...overrides,
    });
  }

  #cloneWithRow<NextRow, NextState extends CollectionTypeState = State>(
    overrides: Partial<CollectionState>,
  ): Collection<TContract, ModelName, NextRow, NextState> {
    return this.#createSelf<NextRow, NextState>({
      ...this.state,
      ...overrides,
    });
  }

  #createSelf<NextRow, NextState extends CollectionTypeState>(
    state: CollectionState,
  ): Collection<TContract, ModelName, NextRow, NextState> {
    const Ctor = this.constructor as CollectionConstructor<TContract>;
    return new Ctor(this.ctx, this.modelName, {
      tableName: this.tableName,
      state,
      registry: this.registry,
      includeRefinementMode: this.includeRefinementMode,
    }) as unknown as Collection<TContract, ModelName, NextRow, NextState>;
  }

  #createCollection<
    ModelNameInner extends string,
    RowInner,
    StateInner extends CollectionTypeState,
  >(
    modelName: ModelNameInner,
    options: CollectionInit<TContract>,
  ): Collection<TContract, ModelNameInner, RowInner, StateInner> {
    const Ctor =
      (this.registry.get(modelName) as CollectionConstructor<TContract> | undefined) ??
      (Collection as unknown as CollectionConstructor<TContract>);
    return new Ctor(this.ctx, modelName, {
      tableName: options.tableName,
      state: options.state,
      registry:
        options.registry ??
        (this.registry as ReadonlyMap<string, CollectionConstructor<TContract>>),
      includeRefinementMode: options.includeRefinementMode ?? this.includeRefinementMode,
    }) as unknown as Collection<TContract, ModelNameInner, RowInner, StateInner>;
  }

  #dispatch(): AsyncIterableResult<Row> {
    return dispatchCollectionRows<Row>({
      contract: this.ctx.contract,
      runtime: this.ctx.runtime,
      state: this.state,
      tableName: this.tableName,
    });
  }
}
