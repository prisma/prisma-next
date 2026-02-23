import { executeCompiledQuery } from '@prisma-next/integration-kysely';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { WhereExpr } from '@prisma-next/sql-relational-core/ast';
import {
  assertReturningCapability,
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
import {
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
  RelationNames,
  ShorthandWhereFilter,
  UniqueConstraintCriterion,
} from './types';
import { emptyState } from './types';

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
    return dispatchCollectionRows<Row>({
      contract: this.ctx.contract,
      runtime: this.ctx.runtime,
      state: this.state,
      tableName: this.tableName,
    });
  }
}
