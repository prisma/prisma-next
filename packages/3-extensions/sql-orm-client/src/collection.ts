import type { Contract } from '@prisma-next/contract/types';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  BinaryExpr,
  ColumnRef,
  isWhereExpr,
  LiteralExpr,
  type OrderByItem,
  type ToWhereExpr,
  type WhereArg,
} from '@prisma-next/sql-relational-core/ast';
import { createAggregateBuilder, isAggregateSelector } from './aggregate-builder';
import { normalizeAggregateResult } from './collection-aggregate-result';
import { mapCursorValuesToColumns, mapFieldsToColumns } from './collection-column-mapping';
import {
  assertReturningCapability,
  getColumnToFieldMap,
  getFieldToColumnMap,
  isToOneCardinality,
  type PolymorphismInfo,
  resolveFieldToColumn,
  resolveIncludeRelation,
  resolveModelTableName,
  resolvePolymorphismInfo,
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
  // biome-ignore lint/correctness/noUnusedImports: used in `declare` property
  RowType,
  WithOrderByState,
  WithVariantState,
  WithWhereState,
} from './collection-internal-types';
import {
  dispatchMutationRows,
  dispatchSplitMutationRows,
  executeMutationReturningSingleRow,
} from './collection-mutation-dispatch';
import {
  augmentSelectionForJoinColumns,
  mapModelDataToStorageRow,
  mapPolymorphicRow,
} from './collection-runtime';
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
  compileInsertCountSplit,
  compileInsertReturning,
  compileInsertReturningSplit,
  compileSelect,
  compileUpdateCount,
  compileUpdateReturning,
  compileUpsertReturning,
} from './query-plan';
import {
  type AggregateBuilder,
  type AggregateResult,
  type AggregateSpec,
  type CollectionContext,
  type CollectionState,
  type CollectionTypeState,
  type DefaultCollectionTypeState,
  type DefaultModelRow,
  emptyState,
  type IncludeCombine,
  type IncludeCombineBranch,
  type IncludeExpr,
  type IncludeScalar,
  type InferRootRow,
  type ModelAccessor,
  type MutationCreateInput,
  type MutationCreateInputWithRelations,
  type MutationUpdateInput,
  type NumericFieldNames,
  type RelatedModelName,
  type RelationNames,
  type ResolvedCreateInput,
  type ShorthandWhereFilter,
  type UniqueConstraintCriterion,
  type VariantModelRow,
  type VariantNames,
} from './types';
import { normalizeWhereArg } from './where-interop';

function applyCreateDefaults(
  ctx: CollectionContext<Contract<SqlStorage>>,
  tableName: string,
  rows: Record<string, unknown>[],
): void {
  for (const row of rows) {
    const applied = ctx.context.applyMutationDefaults({
      op: 'create',
      table: tableName,
      values: row,
    });
    for (const def of applied) {
      row[def.column] = def.value;
    }
  }
}

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

interface MtiCreateContext {
  polyInfo: PolymorphismInfo;
  variant: { modelName: string; value: string; table: string; strategy: 'mti' };
  baseFieldToColumn: Record<string, string>;
  variantFieldToColumn: Record<string, string>;
  pkColumn: string;
}

export class Collection<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Row = InferRootRow<TContract, ModelName>,
  State extends CollectionTypeState = DefaultCollectionTypeState,
> implements RowSelection<Row>
{
  declare readonly [RowType]: Row;
  /** @internal */
  readonly ctx: CollectionContext<TContract>;
  /** @internal */
  private readonly contract: TContract;
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
    this.contract = ctx.context.contract;
    this.modelName = modelName;
    this.tableName = options.tableName ?? resolveModelTableName(this.contract, modelName);
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
        ? input(createModelAccessor(this.ctx.context, this.modelName))
        : isWhereDirectInput(input)
          ? input
          : shorthandToWhereExpr(this.ctx.context, this.modelName, input);
    const filter = normalizeWhereArg(whereArg, { contract: this.contract });

    if (!filter) {
      return this as Collection<TContract, ModelName, Row, WithWhereState<State>>;
    }

    return this.#clone<WithWhereState<State>>({
      filters: [...this.state.filters, filter],
    });
  }

  variant<V extends VariantNames<TContract, ModelName>>(
    variantName: V,
  ): Collection<
    TContract,
    ModelName,
    VariantModelRow<TContract, ModelName, V>,
    WithVariantState<WithWhereState<State>, V>
  > {
    type ReturnState = WithVariantState<WithWhereState<State>, V>;
    const model = this.contract.models[this.modelName] as Record<string, unknown> | undefined;
    const discriminator = model?.['discriminator'] as { field: string } | undefined;
    const variants = model?.['variants'] as Record<string, { value: string }> | undefined;

    if (!discriminator || !variants) {
      return this as unknown as Collection<
        TContract,
        ModelName,
        VariantModelRow<TContract, ModelName, V>,
        ReturnState
      >;
    }

    const variantEntry = variants[variantName];
    if (!variantEntry) {
      return this as unknown as Collection<
        TContract,
        ModelName,
        VariantModelRow<TContract, ModelName, V>,
        ReturnState
      >;
    }

    const columnName = resolveFieldToColumn(this.contract, this.modelName, discriminator.field);
    const filter = BinaryExpr.eq(
      ColumnRef.of(this.tableName, columnName),
      LiteralExpr.of(variantEntry.value),
    );

    const filtersWithoutPreviousVariant = this.state.variantName
      ? this.state.filters.filter(
          (f) =>
            !(
              f instanceof BinaryExpr &&
              f.left instanceof ColumnRef &&
              f.left.column === columnName &&
              f.left.table === this.tableName
            ),
        )
      : this.state.filters;

    return this.#cloneWithRow<VariantModelRow<TContract, ModelName, V>, ReturnState>({
      filters: [...filtersWithoutPreviousVariant, filter],
      variantName: variantName as string,
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
    const relation = resolveIncludeRelation(this.contract, this.modelName, relationName as string);

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
      targetColumn: relation.targetColumn,
      localColumn: relation.localColumn,
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
    const selectedFields = mapFieldsToColumns(this.contract, this.modelName, fields);

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
      | ((model: ModelAccessor<TContract, ModelName>) => OrderByItem)
      | ReadonlyArray<(model: ModelAccessor<TContract, ModelName>) => OrderByItem>,
  ): Collection<TContract, ModelName, Row, WithOrderByState<State>> {
    const accessor = createModelAccessor(this.ctx.context, this.modelName);
    const selectors = Array.isArray(selection) ? selection : [selection];
    const nextOrders = selectors.map((selector) =>
      selector(accessor as ModelAccessor<TContract, ModelName>),
    );
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
    const groupByColumns = mapFieldsToColumns(this.contract, this.modelName, fields);

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
    const columnName = resolveFieldToColumn(this.contract, this.modelName, field as string);
    return createIncludeScalar<number | null>('sum', this.state, columnName);
  }

  avg<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): IncludeScalar<number | null> {
    this.#assertIncludeRefinementMode('avg()');
    const columnName = resolveFieldToColumn(this.contract, this.modelName, field as string);
    return createIncludeScalar<number | null>('avg', this.state, columnName);
  }

  min<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): IncludeScalar<number | null> {
    this.#assertIncludeRefinementMode('min()');
    const columnName = resolveFieldToColumn(this.contract, this.modelName, field as string);
    return createIncludeScalar<number | null>('min', this.state, columnName);
  }

  max<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): IncludeScalar<number | null> {
    this.#assertIncludeRefinementMode('max()');
    const columnName = resolveFieldToColumn(this.contract, this.modelName, field as string);
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
      this.contract,
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
    const distinctFields = mapFieldsToColumns(this.contract, this.modelName, fields);

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
      this.contract,
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
    const aggregateSpec = fn(createAggregateBuilder(this.contract, this.modelName));
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
      this.contract,
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

  async create(data: ResolvedCreateInput<TContract, ModelName, State['variantName']>): Promise<Row>;
  async create(data: MutationCreateInputWithRelations<TContract, ModelName>): Promise<Row>;
  async create(
    data:
      | ResolvedCreateInput<TContract, ModelName, State['variantName']>
      | MutationCreateInputWithRelations<TContract, ModelName>,
  ): Promise<Row> {
    assertReturningCapability(this.contract, 'create()');

    if (
      hasNestedMutationCallbacks(this.contract, this.modelName, data as Record<string, unknown>)
    ) {
      const createdRow = await executeNestedCreateMutation({
        context: this.ctx.context,
        runtime: this.ctx.runtime,
        modelName: this.modelName,
        data: data as MutationCreateInput<Contract<SqlStorage>, string>,
      });

      const pkCriterion = buildPrimaryKeyFilterFromRow(this.contract, this.modelName, createdRow);
      const reloaded = await this.#reloadMutationRowByPrimaryKey(pkCriterion);
      if (!reloaded) {
        throw new Error(`create() for model "${this.modelName}" did not return a row`);
      }
      return reloaded;
    }

    const rows = await this.createAll([
      data as ResolvedCreateInput<TContract, ModelName, State['variantName']>,
    ]);
    const created = rows[0];
    if (created) {
      return created;
    }

    throw new Error(`create() for model "${this.modelName}" did not return a row`);
  }

  createAll(
    data: readonly ResolvedCreateInput<TContract, ModelName, State['variantName']>[],
  ): AsyncIterableResult<Row> {
    if (data.length === 0) {
      const generator = async function* (): AsyncGenerator<Row, void, unknown> {};
      return new AsyncIterableResult(generator());
    }

    assertReturningCapability(this.contract, 'createAll()');

    const rows = data as readonly Record<string, unknown>[];
    const mtiContext = this.#resolveMtiCreateContext();
    if (mtiContext) {
      return this.#executeMtiCreate(rows, mtiContext);
    }

    const mappedRows = this.#mapCreateRows(rows);
    applyCreateDefaults(this.ctx, this.tableName, mappedRows);
    const parentJoinColumns = this.state.includes.map((include) => include.localColumn);
    const { selectedForQuery: selectedForInsert, hiddenColumns } = augmentSelectionForJoinColumns(
      this.state.selectedFields,
      parentJoinColumns,
    );
    if (this.contract.capabilities?.['sql']?.['defaultInInsert'] !== true) {
      const plans = compileInsertReturningSplit(
        this.contract,
        this.tableName,
        mappedRows,
        selectedForInsert,
      );
      return dispatchSplitMutationRows<Row>({
        contract: this.contract,
        runtime: this.ctx.runtime,
        plans,
        tableName: this.tableName,
        includes: this.state.includes,
        hiddenColumns,
        mapRow: (mapped) => mapped as Row,
      });
    }

    const compiled = compileInsertReturning(
      this.contract,
      this.tableName,
      mappedRows,
      selectedForInsert,
    );
    return dispatchMutationRows<Row>({
      contract: this.contract,
      runtime: this.ctx.runtime,
      compiled,
      tableName: this.tableName,
      modelName: this.modelName,
      includes: this.state.includes,
      hiddenColumns,
      mapRow: (mapped) => mapped as Row,
    });
  }

  #assertNotMtiVariant(method: string): void {
    const mtiCtx = this.#resolveMtiCreateContext();
    if (mtiCtx) {
      throw new Error(
        `${method} is not supported for MTI variant "${this.state.variantName}" on model "${this.modelName}". Use createAll() instead.`,
      );
    }
  }

  #resolveMtiCreateContext(): MtiCreateContext | null {
    const variantName = this.state.variantName;
    if (!variantName) return null;

    const polyInfo = resolvePolymorphismInfo(this.contract, this.modelName);
    if (!polyInfo) return null;

    const variant = polyInfo.variants.get(variantName);
    if (!variant || variant.strategy !== 'mti') return null;

    const baseFieldToColumn = getFieldToColumnMap(this.contract, this.modelName);
    const variantFieldToColumn = getFieldToColumnMap(this.contract, variant.modelName);
    const pkColumn = resolvePrimaryKeyColumn(this.contract, this.tableName);

    return {
      polyInfo,
      variant: variant as typeof variant & { strategy: 'mti' },
      baseFieldToColumn,
      variantFieldToColumn,
      pkColumn,
    };
  }

  #executeMtiCreate(
    data: readonly Record<string, unknown>[],
    mtiCtx: MtiCreateContext,
  ): AsyncIterableResult<Row> {
    const { polyInfo, variant, baseFieldToColumn, variantFieldToColumn, pkColumn } = mtiCtx;
    const contract = this.contract;
    const collectionCtx = this.ctx;
    const runtime = collectionCtx.runtime;
    const tableName = this.tableName;
    const modelName = this.modelName;

    const baseFieldColumns = new Set(Object.values(baseFieldToColumn));
    const variantFieldColumns = new Set(Object.values(variantFieldToColumn));
    const mergedFieldToColumn = { ...baseFieldToColumn, ...variantFieldToColumn };

    const generator = async function* (): AsyncGenerator<Row, void, unknown> {
      for (const row of data) {
        const allMapped: Record<string, unknown> = {};
        for (const [fieldName, value] of Object.entries(row as Record<string, unknown>)) {
          if (value === undefined) continue;
          const columnName = mergedFieldToColumn[fieldName] ?? fieldName;
          allMapped[columnName] = value;
        }
        allMapped[polyInfo.discriminatorColumn] = variant.value;

        const baseRow: Record<string, unknown> = {};
        const variantRow: Record<string, unknown> = {};
        for (const [col, val] of Object.entries(allMapped)) {
          if (baseFieldColumns.has(col) || col === polyInfo.discriminatorColumn) {
            baseRow[col] = val;
          }
          if (variantFieldColumns.has(col)) {
            variantRow[col] = val;
          }
        }

        applyCreateDefaults(collectionCtx, tableName, [baseRow]);
        const baseCompiled = compileInsertReturning(contract, tableName, [baseRow], undefined);
        const baseResult = await executeQueryPlan<Record<string, unknown>>(
          runtime,
          baseCompiled,
        ).toArray();
        const baseCreated = baseResult[0];
        if (!baseCreated) {
          throw new Error(`MTI base INSERT for model "${modelName}" did not return a row`);
        }

        const pkValue = baseCreated[pkColumn];
        variantRow[pkColumn] = pkValue;
        const variantCompiled = compileInsertReturning(
          contract,
          variant.table,
          [variantRow],
          undefined,
        );
        await executeQueryPlan<Record<string, unknown>>(runtime, variantCompiled).toArray();

        const prefixedVariant: Record<string, unknown> = {};
        for (const [col, val] of Object.entries(variantRow)) {
          if (col === pkColumn) continue;
          prefixedVariant[`${variant.table}__${col}`] = val;
        }

        const merged = mapPolymorphicRow(
          contract,
          modelName,
          polyInfo,
          { ...baseCreated, ...prefixedVariant },
          variant.modelName,
        );
        yield merged as Row;
      }
    };

    return new AsyncIterableResult(generator());
  }

  #mapCreateRows(data: readonly Record<string, unknown>[]): Record<string, unknown>[] {
    const variantName = this.state.variantName;
    if (!variantName) {
      return data.map((row) => mapModelDataToStorageRow(this.contract, this.modelName, row));
    }

    const polyInfo = resolvePolymorphismInfo(this.contract, this.modelName);
    if (!polyInfo) {
      return data.map((row) => mapModelDataToStorageRow(this.contract, this.modelName, row));
    }

    const variant = polyInfo.variants.get(variantName);
    if (!variant) {
      return data.map((row) => mapModelDataToStorageRow(this.contract, this.modelName, row));
    }

    const baseFieldToColumn = getFieldToColumnMap(this.contract, this.modelName);
    const variantFieldToColumn = getFieldToColumnMap(this.contract, variant.modelName);
    const mergedFieldToColumn = { ...baseFieldToColumn, ...variantFieldToColumn };

    return data.map((row) => {
      const mapped: Record<string, unknown> = {};
      for (const [fieldName, value] of Object.entries(row as Record<string, unknown>)) {
        if (value === undefined) continue;
        const columnName = mergedFieldToColumn[fieldName] ?? fieldName;
        mapped[columnName] = value;
      }
      mapped[polyInfo.discriminatorColumn] = variant.value;
      return mapped;
    });
  }

  async createCount(
    data: readonly ResolvedCreateInput<TContract, ModelName, State['variantName']>[],
  ): Promise<number> {
    if (data.length === 0) {
      return 0;
    }

    this.#assertNotMtiVariant('createCount()');

    const rows = data as readonly Record<string, unknown>[];
    const mappedRows = this.#mapCreateRows(rows);
    applyCreateDefaults(this.ctx, this.tableName, mappedRows);

    if (this.contract.capabilities?.['sql']?.['defaultInInsert'] !== true) {
      const plans = compileInsertCountSplit(this.contract, this.tableName, mappedRows);
      for (const plan of plans) {
        await executeQueryPlan<Record<string, unknown>>(this.ctx.runtime, plan).toArray();
      }
      return data.length;
    }

    const compiled = compileInsertCount(this.contract, this.tableName, mappedRows);
    await executeQueryPlan<Record<string, unknown>>(this.ctx.runtime, compiled).toArray();
    return data.length;
  }

  /**
   * Passing `update: {}` makes this behave like a conditional create.
   * On conflict, `ON CONFLICT DO NOTHING RETURNING ...` may return zero rows,
   * so this method may issue a follow-up reload query to return the existing row.
   */
  async upsert(input: {
    create: ResolvedCreateInput<TContract, ModelName, State['variantName']>;
    update: Partial<DefaultModelRow<TContract, ModelName>>;
    conflictOn?: UniqueConstraintCriterion<TContract, ModelName>;
  }): Promise<Row> {
    assertReturningCapability(this.contract, 'upsert()');
    this.#assertNotMtiVariant('upsert()');

    const createValues = mapModelDataToStorageRow(this.contract, this.modelName, input.create);
    applyCreateDefaults(this.ctx, this.tableName, [createValues]);
    const updateValues = mapModelDataToStorageRow(this.contract, this.modelName, input.update);
    const hasUpdateValues = Object.keys(updateValues).length > 0;
    const conflictColumns = resolveUpsertConflictColumns(
      this.contract,
      this.modelName,
      input.conflictOn as Record<string, unknown> | undefined,
    );
    if (conflictColumns.length === 0) {
      throw new Error(`upsert() for model "${this.modelName}" requires conflict columns`);
    }

    const parentJoinColumns = this.state.includes.map((include) => include.localColumn);
    const { selectedForQuery: selectedForUpsert, hiddenColumns } = augmentSelectionForJoinColumns(
      this.state.selectedFields,
      parentJoinColumns,
    );
    const compiled = compileUpsertReturning(
      this.contract,
      this.tableName,
      createValues,
      updateValues,
      conflictColumns,
      selectedForUpsert,
    );
    const row = await executeMutationReturningSingleRow<Row>({
      contract: this.contract,
      runtime: this.ctx.runtime,
      compiled,
      tableName: this.tableName,
      modelName: this.modelName,
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
    assertReturningCapability(this.contract, 'update()');

    if (
      hasNestedMutationCallbacks(this.contract, this.modelName, data as Record<string, unknown>)
    ) {
      const updatedRow = await executeNestedUpdateMutation({
        context: this.ctx.context,
        runtime: this.ctx.runtime,
        modelName: this.modelName,
        filters: this.state.filters,
        data: data as MutationUpdateInput<Contract<SqlStorage>, string>,
      });
      if (!updatedRow) {
        return null;
      }

      const pkCriterion = buildPrimaryKeyFilterFromRow(this.contract, this.modelName, updatedRow);
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
    assertReturningCapability(this.contract, 'updateAll()');

    const mappedData = mapModelDataToStorageRow(this.contract, this.modelName, data);
    if (Object.keys(mappedData).length === 0) {
      const generator = async function* (): AsyncGenerator<Row, void, unknown> {};
      return new AsyncIterableResult(generator());
    }

    const parentJoinColumns = this.state.includes.map((include) => include.localColumn);
    const { selectedForQuery: selectedForUpdate, hiddenColumns } = augmentSelectionForJoinColumns(
      this.state.selectedFields,
      parentJoinColumns,
    );
    const compiled = compileUpdateReturning(
      this.contract,
      this.tableName,
      mappedData,
      this.state.filters,
      selectedForUpdate,
    );
    return dispatchMutationRows<Row>({
      contract: this.contract,
      runtime: this.ctx.runtime,
      compiled,
      tableName: this.tableName,
      modelName: this.modelName,
      includes: this.state.includes,
      hiddenColumns,
      mapRow: (mapped) => mapped as Row,
    });
  }

  async updateCount(
    data: State['hasWhere'] extends true ? Partial<DefaultModelRow<TContract, ModelName>> : never,
  ): Promise<number> {
    const mappedData = mapModelDataToStorageRow(this.contract, this.modelName, data);
    if (Object.keys(mappedData).length === 0) {
      return 0;
    }

    const primaryKeyColumn = resolvePrimaryKeyColumn(this.contract, this.tableName);
    const countState: CollectionState = {
      ...emptyState(),
      filters: this.state.filters,
      selectedFields: [primaryKeyColumn],
    };
    const countCompiled = compileSelect(this.contract, this.tableName, countState);
    const matchingRows = await executeQueryPlan<Record<string, unknown>>(
      this.ctx.runtime,
      countCompiled,
    ).toArray();

    const compiled = compileUpdateCount(
      this.contract,
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
    assertReturningCapability(this.contract, 'delete()');
    const rows = await this.deleteAll().toArray();
    return rows[0] ?? null;
  }

  deleteAll(
    this: State['hasWhere'] extends true ? Collection<TContract, ModelName, Row, State> : never,
  ): AsyncIterableResult<Row> {
    assertReturningCapability(this.contract, 'deleteAll()');

    const parentJoinColumns = this.state.includes.map((include) => include.localColumn);
    const { selectedForQuery: selectedForDelete, hiddenColumns } = augmentSelectionForJoinColumns(
      this.state.selectedFields,
      parentJoinColumns,
    );
    const compiled = compileDeleteReturning(
      this.contract,
      this.tableName,
      this.state.filters,
      selectedForDelete,
    );
    return dispatchMutationRows<Row>({
      contract: this.contract,
      runtime: this.ctx.runtime,
      compiled,
      tableName: this.tableName,
      modelName: this.modelName,
      includes: this.state.includes,
      hiddenColumns,
      mapRow: (mapped) => mapped as Row,
    });
  }

  async deleteCount(
    this: State['hasWhere'] extends true ? Collection<TContract, ModelName, Row, State> : never,
  ): Promise<number> {
    const primaryKeyColumn = resolvePrimaryKeyColumn(this.contract, this.tableName);
    const countState: CollectionState = {
      ...emptyState(),
      filters: this.state.filters,
      selectedFields: [primaryKeyColumn],
    };
    const countCompiled = compileSelect(this.contract, this.tableName, countState);
    const matchingRows = await executeQueryPlan<Record<string, unknown>>(
      this.ctx.runtime,
      countCompiled,
    ).toArray();

    const compiled = compileDeleteCount(this.contract, this.tableName, this.state.filters);
    await executeQueryPlan<Record<string, unknown>>(this.ctx.runtime, compiled).toArray();

    return matchingRows.length;
  }

  #buildUpsertConflictCriterion(
    createValues: Record<string, unknown>,
    conflictColumns: readonly string[],
  ): Record<string, unknown> {
    const columnToField = getColumnToFieldMap(this.contract, this.modelName);
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
      this.ctx.context,
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
      contract: this.contract,
      runtime: this.ctx.runtime,
      state: resultState,
      tableName: this.tableName,
      modelName: this.modelName,
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
      contract: this.contract,
      runtime: this.ctx.runtime,
      state: this.state,
      tableName: this.tableName,
      modelName: this.modelName,
    });
  }
}
