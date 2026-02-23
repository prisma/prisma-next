import { executeCompiledQuery } from '@prisma-next/integration-kysely';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { WhereExpr } from '@prisma-next/sql-relational-core/ast';
import { createAggregateBuilder, isAggregateSelector } from './aggregate-builder';
import {
  assertReturningCapability,
  isToOneCardinality,
  resolveIncludeRelation,
  resolveModelTableName,
  resolvePrimaryKeyColumn,
  resolveUpsertConflictColumns,
} from './collection-contract';
import { dispatchCollectionRows, stitchIncludes } from './collection-dispatch';
import {
  acquireRuntimeScope,
  augmentSelectionForJoinColumns,
  createRowEnvelope,
  mapModelDataToStorageRow,
  mapResultRows,
  mapStorageRowToModelFields,
  stripHiddenMappedFields,
} from './collection-runtime';
import { shorthandToWhereExpr } from './filters';
import { GroupedCollection } from './grouped-collection';
import {
  createIncludeCombine,
  createIncludeScalar,
  isCollectionStateCarrier,
  isIncludeCombine,
  isIncludeScalar,
} from './include-descriptors';
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
} from './kysely-compiler';
import { createModelAccessor } from './model-accessor';
import {
  buildPrimaryKeyFilterFromRow,
  executeNestedCreateMutation,
  executeNestedUpdateMutation,
  hasNestedMutationCallbacks,
} from './mutation-executor';
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
  IncludeRelationValue,
  IncludeScalar,
  ModelAccessor,
  MutationCreateInput,
  MutationCreateInputWithRelations,
  MutationUpdateInput,
  NumericFieldNames,
  OrderByDirective,
  OrderExpr,
  RelatedModelName,
  RelationCardinality,
  RelationNames,
  ShorthandWhereFilter,
  UniqueConstraintCriterion,
} from './types';
import { emptyState } from './types';

interface CollectionInit<TContract extends SqlContract<SqlStorage>> {
  readonly tableName?: string | undefined;
  readonly state?: CollectionState | undefined;
  readonly registry?: ReadonlyMap<string, CollectionConstructor<TContract>> | undefined;
  readonly includeRefinementMode?: boolean | undefined;
}

type CollectionConstructor<TContract extends SqlContract<SqlStorage>> = new (
  ctx: CollectionContext<TContract>,
  modelName: string,
  options?: CollectionInit<TContract>,
) => Collection<TContract, string, unknown, CollectionTypeState>;

type WithWhereState<State extends CollectionTypeState> = Omit<State, 'hasWhere'> & {
  readonly hasWhere: true;
};

type WithOrderByState<State extends CollectionTypeState> = Omit<State, 'hasOrderBy'> & {
  readonly hasOrderBy: true;
};

type IncludedRelationsForRow<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  Row,
> = Omit<Row, keyof DefaultModelRow<TContract, ModelName>>;

type IncludeRefinementTerminals =
  | 'all'
  | 'find'
  | 'aggregate'
  | 'groupBy'
  | 'create'
  | 'createAll'
  | 'createCount'
  | 'update'
  | 'updateAll'
  | 'updateCount'
  | 'delete'
  | 'deleteAll'
  | 'deleteCount'
  | 'upsert';

type IncludeRefinementScalarMethods = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'combine';

type IncludeRefinementCollection<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  Row,
  State extends CollectionTypeState,
  IsToMany extends boolean,
> = Omit<
  Collection<TContract, ModelName, Row, State>,
  IncludeRefinementTerminals | (IsToMany extends true ? never : IncludeRefinementScalarMethods)
>;

type IsToManyRelation<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  RelName extends string,
> = RelationCardinality<TContract, ModelName, RelName> extends '1:N' | 'M:N' ? true : false;

type IncludeRefinementResult<
  TContract extends SqlContract<SqlStorage>,
  RelatedName extends string,
  IsToMany extends boolean,
> =
  | IncludeRefinementCollection<TContract, RelatedName, unknown, CollectionTypeState, IsToMany>
  | (IsToMany extends true
      ? IncludeScalar<unknown> | IncludeCombine<Record<string, unknown>>
      : never);

type IncludeRefinementValue<
  TContract extends SqlContract<SqlStorage>,
  ParentModelName extends string,
  RelName extends string,
  DefaultIncludedRow,
  RefinedResult,
> = RefinedResult extends IncludeScalar<infer ScalarResult>
  ? ScalarResult
  : RefinedResult extends IncludeCombine<infer CombinedResult>
    ? CombinedResult
    : RefinedResult extends Collection<TContract, string, infer IncludedRow, CollectionTypeState>
      ? IncludeRelationValue<TContract, ParentModelName, RelName, IncludedRow>
      : IncludeRelationValue<TContract, ParentModelName, RelName, DefaultIncludedRow>;

export class Collection<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  Row = DefaultModelRow<TContract, ModelName>,
  State extends CollectionTypeState = DefaultCollectionTypeState,
> {
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
    fn: (model: ModelAccessor<TContract, ModelName>) => WhereExpr,
  ): Collection<TContract, ModelName, Row, WithWhereState<State>>;
  where(
    filters: ShorthandWhereFilter<TContract, ModelName>,
  ): Collection<TContract, ModelName, Row, WithWhereState<State>>;
  where(
    input:
      | ((model: ModelAccessor<TContract, ModelName>) => WhereExpr)
      | ShorthandWhereFilter<TContract, ModelName>,
  ): Collection<TContract, ModelName, Row, WithWhereState<State>> {
    const filter =
      typeof input === 'function'
        ? input(createModelAccessor(this.ctx.contract, this.modelName))
        : shorthandToWhereExpr(this.ctx.contract, this.modelName, input);

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
    const fieldToColumn = this.ctx.contract.mappings.fieldToColumn?.[this.modelName] ?? {};
    const selectedFields = fields.map((fieldName) => fieldToColumn[fieldName] ?? fieldName);

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
    const fieldToColumn = this.ctx.contract.mappings.fieldToColumn?.[this.modelName] ?? {};
    const groupByColumns = fields.map((fieldName) => fieldToColumn[fieldName] ?? fieldName);

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
    const fieldName = field as string;
    const columnName =
      this.ctx.contract.mappings.fieldToColumn?.[this.modelName]?.[fieldName] ?? fieldName;
    return createIncludeScalar<number | null>('sum', this.state, columnName);
  }

  avg<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): IncludeScalar<number | null> {
    this.#assertIncludeRefinementMode('avg()');
    const fieldName = field as string;
    const columnName =
      this.ctx.contract.mappings.fieldToColumn?.[this.modelName]?.[fieldName] ?? fieldName;
    return createIncludeScalar<number | null>('avg', this.state, columnName);
  }

  min<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): IncludeScalar<number | null> {
    this.#assertIncludeRefinementMode('min()');
    const fieldName = field as string;
    const columnName =
      this.ctx.contract.mappings.fieldToColumn?.[this.modelName]?.[fieldName] ?? fieldName;
    return createIncludeScalar<number | null>('min', this.state, columnName);
  }

  max<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): IncludeScalar<number | null> {
    this.#assertIncludeRefinementMode('max()');
    const fieldName = field as string;
    const columnName =
      this.ctx.contract.mappings.fieldToColumn?.[this.modelName]?.[fieldName] ?? fieldName;
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
    const fieldToColumn = this.ctx.contract.mappings.fieldToColumn?.[this.modelName] ?? {};
    const mappedCursor: Record<string, unknown> = {};

    for (const [fieldName, value] of Object.entries(cursorValues as Record<string, unknown>)) {
      if (value === undefined) {
        continue;
      }
      const columnName = fieldToColumn[fieldName] ?? fieldName;
      mappedCursor[columnName] = value;
    }

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
    const fieldToColumn = this.ctx.contract.mappings.fieldToColumn?.[this.modelName] ?? {};
    const distinctFields = fields.map((fieldName) => fieldToColumn[fieldName] ?? fieldName);

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
    const fieldToColumn = this.ctx.contract.mappings.fieldToColumn?.[this.modelName] ?? {};
    const distinctOnFields = (fields as readonly string[]).map(
      (fieldName) => fieldToColumn[fieldName] ?? fieldName,
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

  async find(): Promise<Row | null>;
  async find(
    filter: (model: ModelAccessor<TContract, ModelName>) => WhereExpr,
  ): Promise<Row | null>;
  async find(filter: ShorthandWhereFilter<TContract, ModelName>): Promise<Row | null>;
  async find(
    filter?:
      | ((model: ModelAccessor<TContract, ModelName>) => WhereExpr)
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

    const compiled = compileAggregate(this.tableName, this.state.filters, aggregateSpec);
    const rows = await executeCompiledQuery<Record<string, unknown>>(
      this.ctx.runtime,
      this.ctx.contract,
      compiled,
      { lane: 'orm-client' },
    ).toArray();
    const row = rows[0] ?? {};

    const result: Record<string, unknown> = {};
    for (const [alias, selector] of entries) {
      const value = row[alias];
      if (value === null) {
        result[alias] = null;
        continue;
      }

      if (value === undefined) {
        result[alias] = selector.fn === 'count' ? 0 : null;
        continue;
      }

      if (typeof value === 'number') {
        result[alias] = value;
        continue;
      }

      if (typeof value === 'bigint') {
        result[alias] = Number(value);
        continue;
      }

      if (typeof value === 'string') {
        const numeric = Number(value);
        result[alias] = Number.isNaN(numeric) ? value : numeric;
        continue;
      }

      result[alias] = value;
    }

    return result as AggregateResult<Spec>;
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
    const compiled = compileInsertReturning(this.tableName, mappedRows, selectedForInsert);

    if (this.state.includes.length === 0) {
      const source = executeCompiledQuery<Record<string, unknown>>(
        this.ctx.runtime,
        this.ctx.contract,
        compiled,
        { lane: 'orm-client' },
      );
      return mapResultRows(source, (rawRow) => {
        const mapped = mapStorageRowToModelFields(this.ctx.contract, this.tableName, rawRow);
        if (hiddenColumns.length > 0) {
          stripHiddenMappedFields(this.ctx.contract, this.tableName, mapped, hiddenColumns);
        }
        return mapped as Row;
      });
    }

    const contract = this.ctx.contract;
    const runtime = this.ctx.runtime;
    const state = this.state;
    const tableName = this.tableName;
    const generator = async function* (): AsyncGenerator<Row, void, unknown> {
      const { scope, release } = await acquireRuntimeScope(runtime);
      try {
        const insertedRowsRaw = await executeCompiledQuery<Record<string, unknown>>(
          scope,
          contract,
          compiled,
          { lane: 'orm-client' },
        ).toArray();
        if (insertedRowsRaw.length === 0) {
          return;
        }

        const insertedRows = insertedRowsRaw.map((row) =>
          createRowEnvelope(contract, tableName, row),
        );
        await stitchIncludes(scope, contract, insertedRows, state.includes);

        if (hiddenColumns.length > 0) {
          for (const row of insertedRows) {
            stripHiddenMappedFields(contract, tableName, row.mapped, hiddenColumns);
          }
        }

        for (const row of insertedRows) {
          yield row.mapped as Row;
        }
      } finally {
        if (release) {
          await release();
        }
      }
    };

    return new AsyncIterableResult(generator());
  }

  async createCount(data: readonly CreateInput<TContract, ModelName>[]): Promise<number> {
    if (data.length === 0) {
      return 0;
    }

    const mappedRows = data.map((row) =>
      mapModelDataToStorageRow(this.ctx.contract, this.modelName, row),
    );
    const compiled = compileInsertCount(this.tableName, mappedRows);
    await executeCompiledQuery<Record<string, unknown>>(
      this.ctx.runtime,
      this.ctx.contract,
      compiled,
      {
        lane: 'orm-client',
      },
    ).toArray();
    return data.length;
  }

  async upsert(input: {
    create: CreateInput<TContract, ModelName>;
    update: Partial<DefaultModelRow<TContract, ModelName>>;
    conflictOn?: UniqueConstraintCriterion<TContract, ModelName>;
  }): Promise<Row> {
    assertReturningCapability(this.ctx.contract, 'upsert()');

    const createValues = mapModelDataToStorageRow(this.ctx.contract, this.modelName, input.create);
    const updateValues = mapModelDataToStorageRow(this.ctx.contract, this.modelName, input.update);
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
      this.tableName,
      createValues,
      updateValues,
      conflictColumns,
      selectedForUpsert,
    );

    if (this.state.includes.length === 0) {
      const rows = await executeCompiledQuery<Record<string, unknown>>(
        this.ctx.runtime,
        this.ctx.contract,
        compiled,
        { lane: 'orm-client' },
      ).toArray();
      const first = rows[0];
      if (!first) {
        throw new Error(`upsert() for model "${this.modelName}" did not return a row`);
      }
      const mapped = mapStorageRowToModelFields(this.ctx.contract, this.tableName, first);
      if (hiddenColumns.length > 0) {
        stripHiddenMappedFields(this.ctx.contract, this.tableName, mapped, hiddenColumns);
      }
      return mapped as Row;
    }

    const { scope, release } = await acquireRuntimeScope(this.ctx.runtime);
    try {
      const rows = await executeCompiledQuery<Record<string, unknown>>(
        scope,
        this.ctx.contract,
        compiled,
        { lane: 'orm-client' },
      ).toArray();
      const first = rows[0];
      if (!first) {
        throw new Error(`upsert() for model "${this.modelName}" did not return a row`);
      }

      const wrappedRows = [createRowEnvelope(this.ctx.contract, this.tableName, first)];
      await stitchIncludes(scope, this.ctx.contract, wrappedRows, this.state.includes);

      const result = wrappedRows[0];
      if (!result) {
        throw new Error(`upsert() for model "${this.modelName}" did not return a row`);
      }

      if (hiddenColumns.length > 0) {
        stripHiddenMappedFields(this.ctx.contract, this.tableName, result.mapped, hiddenColumns);
      }
      return result.mapped as Row;
    } finally {
      if (release) {
        await release();
      }
    }
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
      this.tableName,
      mappedData,
      this.state.filters,
      selectedForUpdate,
    );

    if (this.state.includes.length === 0) {
      const source = executeCompiledQuery<Record<string, unknown>>(
        this.ctx.runtime,
        this.ctx.contract,
        compiled,
        { lane: 'orm-client' },
      );
      return mapResultRows(source, (rawRow) => {
        const mapped = mapStorageRowToModelFields(this.ctx.contract, this.tableName, rawRow);
        if (hiddenColumns.length > 0) {
          stripHiddenMappedFields(this.ctx.contract, this.tableName, mapped, hiddenColumns);
        }
        return mapped as Row;
      });
    }

    const contract = this.ctx.contract;
    const runtime = this.ctx.runtime;
    const state = this.state;
    const tableName = this.tableName;
    const generator = async function* (): AsyncGenerator<Row, void, unknown> {
      const { scope, release } = await acquireRuntimeScope(runtime);
      try {
        const updatedRowsRaw = await executeCompiledQuery<Record<string, unknown>>(
          scope,
          contract,
          compiled,
          { lane: 'orm-client' },
        ).toArray();
        if (updatedRowsRaw.length === 0) {
          return;
        }

        const updatedRows = updatedRowsRaw.map((row) =>
          createRowEnvelope(contract, tableName, row),
        );
        await stitchIncludes(scope, contract, updatedRows, state.includes);

        if (hiddenColumns.length > 0) {
          for (const row of updatedRows) {
            stripHiddenMappedFields(contract, tableName, row.mapped, hiddenColumns);
          }
        }

        for (const row of updatedRows) {
          yield row.mapped as Row;
        }
      } finally {
        if (release) {
          await release();
        }
      }
    };

    return new AsyncIterableResult(generator());
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
    const countCompiled = compileSelect(this.tableName, countState);
    const matchingRows = await executeCompiledQuery<Record<string, unknown>>(
      this.ctx.runtime,
      this.ctx.contract,
      countCompiled,
      { lane: 'orm-client' },
    ).toArray();

    const compiled = compileUpdateCount(this.tableName, mappedData, this.state.filters);
    await executeCompiledQuery<Record<string, unknown>>(
      this.ctx.runtime,
      this.ctx.contract,
      compiled,
      {
        lane: 'orm-client',
      },
    ).toArray();

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
    const compiled = compileDeleteReturning(this.tableName, this.state.filters, selectedForDelete);

    if (this.state.includes.length === 0) {
      const source = executeCompiledQuery<Record<string, unknown>>(
        this.ctx.runtime,
        this.ctx.contract,
        compiled,
        { lane: 'orm-client' },
      );
      return mapResultRows(source, (rawRow) => {
        const mapped = mapStorageRowToModelFields(this.ctx.contract, this.tableName, rawRow);
        if (hiddenColumns.length > 0) {
          stripHiddenMappedFields(this.ctx.contract, this.tableName, mapped, hiddenColumns);
        }
        return mapped as Row;
      });
    }

    const contract = this.ctx.contract;
    const runtime = this.ctx.runtime;
    const state = this.state;
    const tableName = this.tableName;
    const generator = async function* (): AsyncGenerator<Row, void, unknown> {
      const { scope, release } = await acquireRuntimeScope(runtime);
      try {
        const deletedRowsRaw = await executeCompiledQuery<Record<string, unknown>>(
          scope,
          contract,
          compiled,
          { lane: 'orm-client' },
        ).toArray();
        if (deletedRowsRaw.length === 0) {
          return;
        }

        const deletedRows = deletedRowsRaw.map((row) =>
          createRowEnvelope(contract, tableName, row),
        );
        await stitchIncludes(scope, contract, deletedRows, state.includes);

        if (hiddenColumns.length > 0) {
          for (const row of deletedRows) {
            stripHiddenMappedFields(contract, tableName, row.mapped, hiddenColumns);
          }
        }

        for (const row of deletedRows) {
          yield row.mapped as Row;
        }
      } finally {
        if (release) {
          await release();
        }
      }
    };

    return new AsyncIterableResult(generator());
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
    const countCompiled = compileSelect(this.tableName, countState);
    const matchingRows = await executeCompiledQuery<Record<string, unknown>>(
      this.ctx.runtime,
      this.ctx.contract,
      countCompiled,
      { lane: 'orm-client' },
    ).toArray();

    const compiled = compileDeleteCount(this.tableName, this.state.filters);
    await executeCompiledQuery<Record<string, unknown>>(
      this.ctx.runtime,
      this.ctx.contract,
      compiled,
      {
        lane: 'orm-client',
      },
    ).toArray();

    return matchingRows.length;
  }

  async #reloadMutationRowByPrimaryKey(criterion: Record<string, unknown>): Promise<Row | null> {
    const whereExpr = shorthandToWhereExpr(
      this.ctx.contract,
      this.modelName,
      criterion as ShorthandWhereFilter<TContract, ModelName>,
    );
    if (!whereExpr) {
      throw new Error(
        `Failed to build primary key filter for mutation result on model "${this.modelName}"`,
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
