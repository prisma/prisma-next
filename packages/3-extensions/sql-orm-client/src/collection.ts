import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import { executeCompiledQuery } from '@prisma-next/integration-kysely';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { WhereExpr } from '@prisma-next/sql-relational-core/ast';
import { shorthandToWhereExpr } from './filters';
import { type IncludeStrategy, selectIncludeStrategy } from './include-strategy';
import {
  compileDeleteCount,
  compileDeleteReturning,
  compileInsertCount,
  compileInsertReturning,
  compileRelationSelect,
  compileSelect,
  compileUpdateCount,
  compileUpdateReturning,
  compileUpsertReturning,
} from './kysely-compiler';
import { createModelAccessor } from './model-accessor';
import type {
  CollectionContext,
  CollectionState,
  CollectionTypeState,
  CreateInput,
  DefaultCollectionTypeState,
  DefaultModelRow,
  IncludeExpr,
  IncludeRelationValue,
  ModelAccessor,
  OrderByDirective,
  OrderExpr,
  RelatedModelName,
  RelationCardinalityTag,
  RelationNames,
  RuntimeConnection,
  RuntimeScope,
  ShorthandWhereFilter,
  UniqueConstraintCriterion,
} from './types';
import { emptyState } from './types';

interface RowEnvelope {
  readonly raw: Record<string, unknown>;
  readonly mapped: Record<string, unknown>;
}

interface CollectionInit<TContract extends SqlContract<SqlStorage>> {
  readonly tableName?: string | undefined;
  readonly state?: CollectionState | undefined;
  readonly registry?: ReadonlyMap<string, CollectionConstructor<TContract>> | undefined;
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

type IncludeRefinementCollection<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  Row,
  State extends CollectionTypeState,
> = Omit<Collection<TContract, ModelName, Row, State>, 'all' | 'find'>;

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
    IncludedRow = DefaultModelRow<TContract, RelatedName>,
  >(
    relationName: RelName,
    refineFn?: (
      collection: IncludeRefinementCollection<
        TContract,
        RelatedName,
        DefaultModelRow<TContract, RelatedName>,
        DefaultCollectionTypeState
      >,
    ) => IncludeRefinementCollection<TContract, RelatedName, IncludedRow, CollectionTypeState>,
  ): Collection<
    TContract,
    ModelName,
    Row & {
      [K in RelName]: IncludeRelationValue<TContract, ModelName, K, IncludedRow>;
    },
    State
  > {
    const relation = resolveIncludeRelation(
      this.ctx.contract,
      this.modelName,
      relationName as string,
    );

    // Build nested state from refine callback
    let nestedState = emptyState();
    if (refineFn) {
      const nestedCollection = this.#createCollection<
        RelatedName,
        DefaultModelRow<TContract, RelatedName>,
        DefaultCollectionTypeState
      >(relation.relatedModelName as RelatedName, {
        tableName: relation.relatedTableName,
        state: emptyState(),
      });
      const refined = refineFn(nestedCollection);
      nestedState = refined.state;
    }

    const includeExpr: IncludeExpr = {
      relationName: relationName as string,
      relatedModelName: relation.relatedModelName,
      relatedTableName: relation.relatedTableName,
      fkColumn: relation.fkColumn,
      parentPkColumn: relation.parentPkColumn,
      cardinality: relation.cardinality,
      nested: nestedState,
    };

    return this.#cloneWithRow<
      Row & {
        [K in RelName]: IncludeRelationValue<TContract, ModelName, K, IncludedRow>;
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

  async create(data: CreateInput<TContract, ModelName>): Promise<Row> {
    assertReturningCapability(this.ctx.contract, 'create()');
    const rows = await this.createAll([data]).toArray();
    const created = rows[0];
    if (!created) {
      throw new Error(`create() for model "${this.modelName}" did not return a row`);
    }
    return created;
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
    await executeCompiledQuery<Record<string, unknown>>(this.ctx.runtime, this.ctx.contract, compiled, {
      lane: 'orm-client',
    }).toArray();
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
    data: State['hasWhere'] extends true ? Partial<DefaultModelRow<TContract, ModelName>> : never,
  ): Promise<Row | null> {
    assertReturningCapability(this.ctx.contract, 'update()');
    const rows = await this.updateAll(data).toArray();
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
    await executeCompiledQuery<Record<string, unknown>>(this.ctx.runtime, this.ctx.contract, compiled, {
      lane: 'orm-client',
    }).toArray();

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
    await executeCompiledQuery<Record<string, unknown>>(this.ctx.runtime, this.ctx.contract, compiled, {
      lane: 'orm-client',
    }).toArray();

    return matchingRows.length;
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
    }) as unknown as Collection<TContract, ModelNameInner, RowInner, StateInner>;
  }

  #dispatch(): AsyncIterableResult<Row> {
    const { state, tableName, ctx } = this;
    const contract = ctx.contract;
    const runtime = ctx.runtime;

    if (state.includes.length === 0) {
      const compiled = compileSelect(tableName, state);
      const source = executeCompiledQuery<Record<string, unknown>>(runtime, contract, compiled, {
        lane: 'orm-client',
      });
      return mapResultRows(
        source,
        (rawRow) => mapStorageRowToModelFields(contract, tableName, rawRow) as Row,
      );
    }

    const includeStrategy = selectIncludeStrategy(contract);
    return dispatchWithIncludeStrategy<Row>({
      strategy: includeStrategy,
      contract,
      runtime,
      state,
      tableName,
    });
  }
}

function dispatchWithIncludeStrategy<Row>(options: {
  strategy: IncludeStrategy;
  contract: SqlContract<SqlStorage>;
  runtime: CollectionContext<SqlContract<SqlStorage>>['runtime'];
  state: CollectionState;
  tableName: string;
}): AsyncIterableResult<Row> {
  switch (options.strategy) {
    case 'lateral':
    case 'correlated':
      // Single-query include strategies are implemented in follow-up tasks.
      return dispatchWithMultiQueryIncludes<Row>(options);
    case 'multiQuery':
    default:
      return dispatchWithMultiQueryIncludes<Row>(options);
  }
}

function dispatchWithMultiQueryIncludes<Row>(options: {
  contract: SqlContract<SqlStorage>;
  runtime: CollectionContext<SqlContract<SqlStorage>>['runtime'];
  state: CollectionState;
  tableName: string;
}): AsyncIterableResult<Row> {
  const { contract, runtime, state, tableName } = options;
  const generator = async function* (): AsyncGenerator<Row, void, unknown> {
    const { scope, release } = await acquireRuntimeScope(runtime);
    try {
      const parentJoinColumns = state.includes.map((include) => include.parentPkColumn);
      const { selectedForQuery: parentSelectedForQuery, hiddenColumns: hiddenParentColumns } =
        augmentSelectionForJoinColumns(state.selectedFields, parentJoinColumns);
      const parentCompiled = compileSelect(tableName, {
        ...state,
        includes: [],
        selectedFields: parentSelectedForQuery,
      });
      const parentRowsRaw = await executeCompiledQuery<Record<string, unknown>>(
        scope,
        contract,
        parentCompiled,
        { lane: 'orm-client' },
      ).toArray();
      if (parentRowsRaw.length === 0) {
        return;
      }

      const parentRows = parentRowsRaw.map((row) => createRowEnvelope(contract, tableName, row));
      await stitchIncludes(scope, contract, parentRows, state.includes);

      if (hiddenParentColumns.length > 0) {
        for (const row of parentRows) {
          stripHiddenMappedFields(contract, tableName, row.mapped, hiddenParentColumns);
        }
      }

      for (const row of parentRows) {
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

async function stitchIncludes(
  scope: RuntimeScope,
  contract: SqlContract<SqlStorage>,
  parentRows: RowEnvelope[],
  includes: readonly IncludeExpr[],
): Promise<void> {
  for (const include of includes) {
    const parentJoinValues = uniqueValues(
      parentRows
        .map((row) => row.raw[include.parentPkColumn])
        .filter((value) => value !== undefined),
    );

    if (parentJoinValues.length === 0) {
      for (const parent of parentRows) {
        parent.mapped[include.relationName] = emptyIncludeResult(include.cardinality);
      }
      continue;
    }

    const { selectedForQuery: childSelectedForQuery, hiddenColumns: hiddenChildColumns } =
      augmentSelectionForJoinColumns(include.nested.selectedFields, [include.fkColumn]);

    const childCompiled = compileRelationSelect(
      include.relatedTableName,
      include.fkColumn,
      parentJoinValues,
      {
        ...include.nested,
        selectedFields: childSelectedForQuery,
      },
    );
    const childRowsRaw = await executeCompiledQuery<Record<string, unknown>>(
      scope,
      contract,
      childCompiled,
      { lane: 'orm-client' },
    ).toArray();
    const childRows = childRowsRaw.map((row) =>
      createRowEnvelope(contract, include.relatedTableName, row),
    );

    if (include.nested.includes.length > 0) {
      await stitchIncludes(scope, contract, childRows, include.nested.includes);
    }

    const childByParentJoin = new Map<unknown, Record<string, unknown>[]>();
    for (const child of childRows) {
      const joinValue = child.raw[include.fkColumn];

      if (hiddenChildColumns.length > 0) {
        stripHiddenMappedFields(
          contract,
          include.relatedTableName,
          child.mapped,
          hiddenChildColumns,
        );
      }

      let bucket = childByParentJoin.get(joinValue);
      if (!bucket) {
        bucket = [];
        childByParentJoin.set(joinValue, bucket);
      }
      bucket.push(child.mapped);
    }

    for (const parent of parentRows) {
      const parentJoinValue = parent.raw[include.parentPkColumn];
      const relatedRows = childByParentJoin.get(parentJoinValue) ?? [];
      parent.mapped[include.relationName] = coerceIncludeResult(
        relatedRows,
        include.nested,
        include.cardinality,
      );
    }
  }
}

function augmentSelectionForJoinColumns(
  selectedFields: readonly string[] | undefined,
  requiredColumns: readonly string[],
): {
  selectedForQuery: readonly string[] | undefined;
  hiddenColumns: readonly string[];
} {
  if (!selectedFields) {
    return {
      selectedForQuery: selectedFields,
      hiddenColumns: [],
    };
  }

  const hiddenColumns = requiredColumns.filter((column) => !selectedFields.includes(column));
  if (hiddenColumns.length === 0) {
    return {
      selectedForQuery: selectedFields,
      hiddenColumns: [],
    };
  }

  return {
    selectedForQuery: [...selectedFields, ...hiddenColumns],
    hiddenColumns,
  };
}

function stripHiddenMappedFields(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  mapped: Record<string, unknown>,
  hiddenColumns: readonly string[],
): void {
  if (hiddenColumns.length === 0) {
    return;
  }

  const columnToField = contract.mappings.columnToField?.[tableName] ?? {};
  for (const hiddenColumn of hiddenColumns) {
    const fieldName = columnToField[hiddenColumn] ?? hiddenColumn;
    delete mapped[fieldName];
  }
}

function createRowEnvelope(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  raw: Record<string, unknown>,
): RowEnvelope {
  return {
    raw,
    mapped: mapStorageRowToModelFields(contract, tableName, raw),
  };
}

function mapStorageRowToModelFields(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const columnToField = contract.mappings.columnToField?.[tableName];
  if (!columnToField) {
    return { ...row };
  }

  const mapped: Record<string, unknown> = {};
  for (const [columnName, value] of Object.entries(row)) {
    mapped[columnToField[columnName] ?? columnName] = value;
  }
  return mapped;
}

function mapModelDataToStorageRow(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const fieldToColumn = contract.mappings.fieldToColumn?.[modelName] ?? {};
  const mapped: Record<string, unknown> = {};
  for (const [fieldName, value] of Object.entries(row)) {
    if (value === undefined) {
      continue;
    }
    const columnName = fieldToColumn[fieldName] ?? fieldName;
    mapped[columnName] = value;
  }
  return mapped;
}

function assertReturningCapability(contract: SqlContract<SqlStorage>, action: string): void {
  if (hasContractCapability(contract, 'returning')) {
    return;
  }

  throw new Error(`${action} requires contract capability "returning"`);
}

function hasContractCapability(contract: SqlContract<SqlStorage>, capability: string): boolean {
  const capabilities = contract.capabilities as Record<string, unknown> | undefined;
  const value = capabilities?.[capability];

  if (value === true) {
    return true;
  }

  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return Object.values(value as Record<string, unknown>).some((flag) => flag === true);
}

function mapResultRows<TIn, TOut>(
  result: AsyncIterableResult<TIn>,
  mapper: (value: TIn) => TOut,
): AsyncIterableResult<TOut> {
  const generator = async function* (): AsyncGenerator<TOut, void, unknown> {
    for await (const value of result) {
      yield mapper(value);
    }
  };
  return new AsyncIterableResult(generator());
}

async function acquireRuntimeScope(
  runtime: CollectionContext<SqlContract<SqlStorage>>['runtime'],
): Promise<{
  scope: RuntimeScope;
  release?: () => Promise<void>;
}> {
  if (typeof runtime.connection !== 'function') {
    return { scope: runtime };
  }

  const connection = await runtime.connection();
  if (typeof connection.release === 'function') {
    return {
      scope: connection,
      release: () => (connection as RuntimeConnection).release?.() ?? Promise.resolve(),
    };
  }

  return { scope: connection };
}

function uniqueValues(values: unknown[]): unknown[] {
  return [...new Set(values)];
}

function slicePerParent(
  rows: Record<string, unknown>[],
  state: CollectionState,
): Record<string, unknown>[] {
  const offset = state.offset ?? 0;
  if (state.limit === undefined) {
    return rows.slice(offset);
  }
  return rows.slice(offset, offset + state.limit);
}

function emptyIncludeResult(
  cardinality: RelationCardinalityTag | undefined,
): Record<string, unknown>[] | Record<string, unknown> | null {
  return isToOneCardinality(cardinality) ? null : [];
}

function coerceIncludeResult(
  rows: Record<string, unknown>[],
  state: CollectionState,
  cardinality: RelationCardinalityTag | undefined,
): Record<string, unknown>[] | Record<string, unknown> | null {
  const sliced = slicePerParent(rows, state);
  return isToOneCardinality(cardinality) ? (sliced[0] ?? null) : sliced;
}

function isToOneCardinality(cardinality: RelationCardinalityTag | undefined): boolean {
  return cardinality === '1:1' || cardinality === 'N:1';
}

interface RelationWithOn {
  readonly to: string;
  readonly cardinality: RelationCardinalityTag | undefined;
  readonly on: {
    readonly parentCols: readonly string[];
    readonly childCols: readonly string[];
  };
}

interface LegacyRelation {
  readonly model: string;
  readonly foreignKey: string;
}

interface ResolvedIncludeRelation {
  readonly relatedModelName: string;
  readonly relatedTableName: string;
  readonly fkColumn: string;
  readonly parentPkColumn: string;
  readonly cardinality: RelationCardinalityTag | undefined;
}

function resolveIncludeRelation(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  relationName: string,
): ResolvedIncludeRelation {
  const parentTableName = resolveModelTableName(contract, modelName);
  const relation = resolveContractRelation(contract, parentTableName, relationName);
  if (relation) {
    const relatedTableName = resolveModelTableName(contract, relation.to);
    const parentPkColumn = relation.on.parentCols[0];
    const fkColumn = relation.on.childCols[0];
    if (parentPkColumn && fkColumn) {
      return {
        relatedModelName: relation.to,
        relatedTableName,
        fkColumn,
        parentPkColumn,
        cardinality: relation.cardinality,
      };
    }
  }

  const legacy = resolveLegacyModelRelation(contract, modelName, relationName);
  if (legacy) {
    const parentTable = contract.storage.tables[parentTableName];
    const parentPkColumn = parentTable?.primaryKey?.columns[0] ?? 'id';
    return {
      relatedModelName: legacy.model,
      relatedTableName: resolveModelTableName(contract, legacy.model),
      fkColumn: legacy.foreignKey,
      parentPkColumn,
      cardinality: '1:N',
    };
  }

  throw new Error(`Relation '${relationName}' not found on model '${modelName}'`);
}

function resolveContractRelation(
  contract: SqlContract<SqlStorage>,
  parentTableName: string,
  relationName: string,
): RelationWithOn | undefined {
  const tableRelations = contract.relations as Record<string, Record<string, unknown>>;
  const relation = tableRelations[parentTableName]?.[relationName];
  if (!relation || typeof relation !== 'object') {
    return undefined;
  }

  const relationObj = relation as {
    to?: unknown;
    cardinality?: unknown;
    on?: {
      parentCols?: unknown;
      childCols?: unknown;
    };
  };
  const parentCols = relationObj.on?.parentCols;
  const childCols = relationObj.on?.childCols;

  if (
    typeof relationObj.to !== 'string' ||
    !Array.isArray(parentCols) ||
    !Array.isArray(childCols)
  ) {
    return undefined;
  }

  return {
    to: relationObj.to,
    cardinality: parseRelationCardinality(relationObj.cardinality),
    on: {
      parentCols: parentCols as readonly string[],
      childCols: childCols as readonly string[],
    },
  };
}

function parseRelationCardinality(value: unknown): RelationCardinalityTag | undefined {
  if (value === '1:1' || value === 'N:1' || value === '1:N' || value === 'M:N') {
    return value;
  }
  return undefined;
}

function resolveLegacyModelRelation(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  relationName: string,
): LegacyRelation | undefined {
  const models = contract.models as Record<
    string,
    { relations?: Record<string, { model?: unknown; foreignKey?: unknown }> }
  >;
  const relation = models[modelName]?.relations?.[relationName];
  if (!relation) {
    return undefined;
  }

  if (typeof relation.model !== 'string' || typeof relation.foreignKey !== 'string') {
    return undefined;
  }

  return {
    model: relation.model,
    foreignKey: relation.foreignKey,
  };
}

function resolveUpsertConflictColumns(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  conflictOn: Record<string, unknown> | undefined,
): string[] {
  const fieldToColumn = contract.mappings.fieldToColumn?.[modelName] ?? {};

  if (conflictOn && typeof conflictOn === 'object') {
    const columns = Object.keys(conflictOn).map(
      (fieldName) => fieldToColumn[fieldName] ?? fieldName,
    );
    if (columns.length > 0) {
      return columns;
    }
  }

  const tableName = resolveModelTableName(contract, modelName);
  const primaryKeyColumns = contract.storage.tables[tableName]?.primaryKey?.columns ?? [];
  return [...primaryKeyColumns];
}

function resolveModelTableName(contract: SqlContract<SqlStorage>, modelName: string): string {
  const mappedTable = contract.mappings.modelToTable?.[modelName];
  if (mappedTable) {
    return mappedTable;
  }

  const modelStorage = (contract.models as Record<string, { storage?: { table?: unknown } }>)[
    modelName
  ]?.storage;
  if (modelStorage && typeof modelStorage.table === 'string') {
    return modelStorage.table;
  }

  return modelName.toLowerCase();
}

function resolvePrimaryKeyColumn(contract: SqlContract<SqlStorage>, tableName: string): string {
  return contract.storage.tables[tableName]?.primaryKey?.columns[0] ?? 'id';
}
