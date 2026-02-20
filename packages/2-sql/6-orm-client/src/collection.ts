import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { WhereExpr } from '@prisma-next/sql-relational-core/ast';
import { shorthandToWhereExpr } from './filters';
import { compileRelationSelect, compileSelect, createExecutionPlan } from './kysely-compiler';
import { createModelAccessor } from './model-accessor';
import type {
  CollectionContext,
  CollectionState,
  CollectionTypeState,
  DefaultCollectionTypeState,
  DefaultModelRow,
  IncludeExpr,
  ModelAccessor,
  OrderByDirective,
  OrderExpr,
  RelatedModelName,
  RelationNames,
  RuntimeConnection,
  RuntimeScope,
  ShorthandWhereFilter,
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
      collection: Collection<
        TContract,
        RelatedName,
        DefaultModelRow<TContract, RelatedName>,
        DefaultCollectionTypeState
      >,
    ) => Collection<TContract, RelatedName, IncludedRow, CollectionTypeState>,
  ): Collection<
    TContract,
    ModelName,
    Row & {
      [K in RelName]: IncludedRow[];
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
      nested: nestedState,
    };

    return this.#cloneWithRow<
      Row & {
        [K in RelName]: IncludedRow[];
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
      const plan = createExecutionPlan<Record<string, unknown>>(compiled, contract);
      const source = runtime.execute(plan);
      return mapResultRows(
        source,
        (rawRow) => mapStorageRowToModelFields(contract, tableName, rawRow) as Row,
      );
    }

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
        const parentPlan = createExecutionPlan<Record<string, unknown>>(parentCompiled, contract);
        const parentRowsRaw = await scope.execute(parentPlan).toArray();
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
        parent.mapped[include.relationName] = [];
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
    const childPlan = createExecutionPlan<Record<string, unknown>>(childCompiled, contract);
    const childRowsRaw = await scope.execute(childPlan).toArray();
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
      parent.mapped[include.relationName] = slicePerParent(relatedRows, include.nested);
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

interface RelationWithOn {
  readonly to: string;
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
    on: {
      parentCols: parentCols as readonly string[],
      childCols: childCols as readonly string[],
    },
  };
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
