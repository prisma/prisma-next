import type { Contract } from '@prisma-next/contract/types';
import type {
  AnnotationBuilder,
  AnnotationValue,
  OperationKind,
} from '@prisma-next/framework-components/runtime';
import {
  ANNOTATION_BUILDER,
  AsyncIterableResult,
  assertAnnotationsApplicable,
  createAnnotationRegistry,
  createMetaBuilder,
} from '@prisma-next/framework-components/runtime';
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
import type { SimplifyDeep } from '@prisma-next/utils/simplify-deep';
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
  withMutationScope,
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
  mergeUserAnnotations,
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
  Row = SimplifyDeep<InferRootRow<TContract, ModelName>>,
  State extends CollectionTypeState = DefaultCollectionTypeState,
  Registry = {},
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
  ): Collection<TContract, ModelName, Row, WithWhereState<State>, Registry>;
  where(
    input: WhereDirectInput,
  ): Collection<TContract, ModelName, Row, WithWhereState<State>, Registry>;
  where(
    fn: (model: ModelAccessor<TContract, ModelName>) => WhereArg,
  ): Collection<TContract, ModelName, Row, WithWhereState<State>, Registry>;
  where(
    filters: ShorthandWhereFilter<TContract, ModelName>,
  ): Collection<TContract, ModelName, Row, WithWhereState<State>, Registry>;
  where(
    input:
      | WhereDirectInput
      | ((model: ModelAccessor<TContract, ModelName>) => WhereDirectInput)
      | ((model: ModelAccessor<TContract, ModelName>) => WhereArg)
      | ShorthandWhereFilter<TContract, ModelName>,
  ): Collection<TContract, ModelName, Row, WithWhereState<State>, Registry> {
    const whereArg =
      typeof input === 'function'
        ? input(createModelAccessor(this.ctx.context, this.modelName))
        : isWhereDirectInput(input)
          ? input
          : shorthandToWhereExpr(this.ctx.context, this.modelName, input);
    const filter = normalizeWhereArg(whereArg, { contract: this.contract });

    if (!filter) {
      return this as Collection<TContract, ModelName, Row, WithWhereState<State>, Registry>;
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
    WithVariantState<WithWhereState<State>, V>,
    Registry
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
        ReturnState,
        Registry
      >;
    }

    const variantEntry = variants[variantName];
    if (!variantEntry) {
      return this as unknown as Collection<
        TContract,
        ModelName,
        VariantModelRow<TContract, ModelName, V>,
        ReturnState,
        Registry
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
    SimplifyDeep<
      Row & {
        [K in RelName]: IncludeRefinementValue<
          TContract,
          ModelName,
          K,
          DefaultModelRow<TContract, RelatedName>,
          RefinedResult
        >;
      }
    >,
    State,
    Registry
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
      SimplifyDeep<
        Row & {
          [K in RelName]: IncludeRefinementValue<
            TContract,
            ModelName,
            K,
            DefaultModelRow<TContract, RelatedName>,
            RefinedResult
          >;
        }
      >,
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
    SimplifyDeep<
      Pick<DefaultModelRow<TContract, ModelName>, Fields[number]> &
        IncludedRelationsForRow<TContract, ModelName, Row>
    >,
    State,
    Registry
  > {
    const selectedFields = mapFieldsToColumns(this.contract, this.modelName, fields);

    return this.#cloneWithRow<
      SimplifyDeep<
        Pick<DefaultModelRow<TContract, ModelName>, Fields[number]> &
          IncludedRelationsForRow<TContract, ModelName, Row>
      >,
      State
    >({
      selectedFields,
    });
  }

  orderBy(
    selection:
      | ((model: ModelAccessor<TContract, ModelName>) => OrderByItem)
      | ReadonlyArray<(model: ModelAccessor<TContract, ModelName>) => OrderByItem>,
  ): Collection<TContract, ModelName, Row, WithOrderByState<State>, Registry> {
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
      | Collection<TContract, ModelName, unknown, CollectionTypeState, Registry>
      | IncludeScalar<unknown>
    >,
  >(
    spec: Spec,
  ): IncludeCombine<{
    [K in keyof Spec]: Spec[K] extends IncludeScalar<infer ScalarResult>
      ? ScalarResult
      : Spec[K] extends Collection<
            TContract,
            ModelName,
            infer BranchRow,
            CollectionTypeState,
            Registry
          >
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
        : Spec[K] extends Collection<
              TContract,
              ModelName,
              infer BranchRow,
              CollectionTypeState,
              Registry
            >
          ? BranchRow[]
          : never;
    }>;
  }

  cursor(
    cursorValues: State['hasOrderBy'] extends true
      ? Partial<Record<keyof DefaultModelRow<TContract, ModelName> & string, unknown>>
      : never,
  ): Collection<TContract, ModelName, Row, State, Registry> {
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
  >(...fields: Fields): Collection<TContract, ModelName, Row, State, Registry> {
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
  ): Collection<TContract, ModelName, Row, State, Registry> {
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

  take(n: number): Collection<TContract, ModelName, Row, State, Registry> {
    return this.#clone({ limit: n });
  }

  skip(n: number): Collection<TContract, ModelName, Row, State, Registry> {
    return this.#clone({ offset: n });
  }

  /**
   * Read terminal: stream all rows matching the current state.
   *
   * Accepts an optional trailing `annotateFn` callback that receives a
   * registry-derived `AnnotationBuilder<'read', Registry>` and returns
   * either the chained builder or a `readonly AnnotationValue[]` (the
   * array escape hatch for externally-imported handles). The framework
   * normalizes the return value, runs `assertAnnotationsApplicable`
   * (the runtime gate that catches cast-bypass), and merges the
   * resulting annotations into `state.userAnnotations` so they land in
   * `plan.meta.annotations` at compile time.
   */
  all(
    annotateFn?: (
      meta: AnnotationBuilder<'read', Registry>,
    ) => AnnotationBuilder<'read', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): AsyncIterableResult<Row> {
    return this.#resolveAnnotationsToState(annotateFn, 'read', 'all').#dispatch();
  }

  /**
   * Read terminal: return the first matching row, or `null`.
   *
   * Accepts an optional `filter` (function or shorthand) and an
   * optional trailing `annotateFn` callback. To attach annotations
   * without a filter, pass `undefined` for the first argument:
   * `db.User.first(undefined, meta => meta.cache({ ttl: 60 }))`.
   *
   * See `all()` for the annotation callback semantics.
   */
  async first(
    filter?:
      | ((model: ModelAccessor<TContract, ModelName>) => WhereArg)
      | ShorthandWhereFilter<TContract, ModelName>,
    annotateFn?: (
      meta: AnnotationBuilder<'read', Registry>,
    ) => AnnotationBuilder<'read', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): Promise<Row | null> {
    // Narrow the union before calling `where()` — each `where` overload
    // takes one shape, and TypeScript can't pick an overload from the
    // union directly.
    const scoped =
      filter === undefined
        ? this
        : typeof filter === 'function'
          ? this.where(filter)
          : this.where(filter);
    const limited = scoped.take(1).#resolveAnnotationsToState(annotateFn, 'read', 'first');
    const rows = await limited.#dispatch().toArray();
    return rows[0] ?? null;
  }

  /**
   * Read terminal: run an aggregate query (count, sum, avg, min, max)
   * built via the `AggregateBuilder` callback.
   *
   * Accepts an optional trailing `annotateFn` callback after the
   * builder callback. See `all()` for the annotation callback
   * semantics. Annotations are merged into the compiled plan's
   * `meta.annotations` via `mergeUserAnnotations` because
   * `compileAggregate` doesn't take `state`.
   */
  async aggregate<Spec extends AggregateSpec>(
    fn: (aggregate: AggregateBuilder<TContract, ModelName>) => Spec,
    annotateFn?: (
      meta: AnnotationBuilder<'read', Registry>,
    ) => AnnotationBuilder<'read', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
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

    const annotationsMap = this.#resolveAnnotationsToMap(annotateFn, 'read', 'aggregate');

    const compiled = mergeUserAnnotations(
      compileAggregate(this.contract, this.tableName, this.state.filters, aggregateSpec),
      annotationsMap,
    );
    const rows = await executeQueryPlan<Record<string, unknown>>(
      this.ctx.runtime,
      compiled,
    ).toArray();
    return normalizeAggregateResult(aggregateSpec, rows[0] ?? {});
  }

  /**
   * Write terminal: insert one row and return it.
   *
   * Accepts an optional trailing `annotateFn` callback that receives a
   * registry-derived `AnnotationBuilder<'write', Registry>` and returns
   * either the chained builder or a `readonly AnnotationValue[]` (the
   * array escape hatch). See `all()` for the annotation callback
   * semantics. Annotations are merged into the compiled mutation
   * plan's `meta.annotations` via `mergeUserAnnotations`.
   *
   * Note: when the input contains nested-mutation callbacks, the
   * operation is executed as a graph of internal queries via
   * `withMutationScope`. In that path, annotations apply to the
   * logical `create()` call but do not currently flow into each
   * constituent SQL statement — see `projects/middleware-intercept-and-cache/follow-ups.md`.
   */
  async create(
    data:
      | ResolvedCreateInput<TContract, ModelName, State['variantName']>
      | MutationCreateInputWithRelations<TContract, ModelName>,
    annotateFn?: (
      meta: AnnotationBuilder<'write', Registry>,
    ) => AnnotationBuilder<'write', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): Promise<Row> {
    assertReturningCapability(this.contract, 'create()');
    const annotationsMap = this.#resolveAnnotationsToMap(annotateFn, 'write', 'create');

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

    const rows = await this.#createAllWithAnnotations(
      [data as ResolvedCreateInput<TContract, ModelName, State['variantName']>],
      annotationsMap,
    );
    const created = rows[0];
    if (created) {
      return created;
    }

    throw new Error(`create() for model "${this.modelName}" did not return a row`);
  }

  createAll(
    data: readonly ResolvedCreateInput<TContract, ModelName, State['variantName']>[],
    annotateFn?: (
      meta: AnnotationBuilder<'write', Registry>,
    ) => AnnotationBuilder<'write', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): AsyncIterableResult<Row> {
    return this.#createAllWithAnnotations(
      data,
      this.#resolveAnnotationsToMap(annotateFn, 'write', 'createAll'),
    );
  }

  #createAllWithAnnotations(
    data: readonly ResolvedCreateInput<TContract, ModelName, State['variantName']>[],
    annotationsMap: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined,
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
      ).map((plan) => mergeUserAnnotations(plan, annotationsMap));
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

    const compiled = mergeUserAnnotations(
      compileInsertReturning(this.contract, this.tableName, mappedRows, selectedForInsert),
      annotationsMap,
    );
    return dispatchMutationRows<Row>({
      contract: this.contract,
      runtime: this.ctx.runtime,
      compiled,
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

        const merged = await withMutationScope(runtime, async (scope) => {
          applyCreateDefaults(collectionCtx, tableName, [baseRow]);
          const baseCompiled = compileInsertReturning(contract, tableName, [baseRow], undefined);
          const baseResult = await executeQueryPlan<Record<string, unknown>>(
            scope,
            baseCompiled,
          ).toArray();
          const baseCreated = baseResult[0];
          if (!baseCreated) {
            throw new Error(`MTI base INSERT for model "${modelName}" did not return a row`);
          }

          const pkValue = baseCreated[pkColumn];
          variantRow[pkColumn] = pkValue;
          applyCreateDefaults(collectionCtx, variant.table, [variantRow]);
          const variantCompiled = compileInsertReturning(
            contract,
            variant.table,
            [variantRow],
            undefined,
          );
          const variantResult = await executeQueryPlan<Record<string, unknown>>(
            scope,
            variantCompiled,
          ).toArray();
          const variantCreated = variantResult[0];
          if (!variantCreated) {
            throw new Error(
              `MTI variant INSERT for model "${modelName}" into "${variant.table}" did not return a row`,
            );
          }

          const prefixedVariant: Record<string, unknown> = {};
          for (const [col, val] of Object.entries(variantCreated)) {
            if (col === pkColumn) continue;
            prefixedVariant[`${variant.table}__${col}`] = val;
          }

          return mapPolymorphicRow(
            contract,
            modelName,
            polyInfo,
            { ...baseCreated, ...prefixedVariant },
            variant.modelName,
          );
        });

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
    annotateFn?: (
      meta: AnnotationBuilder<'write', Registry>,
    ) => AnnotationBuilder<'write', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): Promise<number> {
    if (data.length === 0) {
      return 0;
    }

    this.#assertNotMtiVariant('createCount()');
    const annotationsMap = this.#resolveAnnotationsToMap(annotateFn, 'write', 'createCount');

    const rows = data as readonly Record<string, unknown>[];
    const mappedRows = this.#mapCreateRows(rows);
    applyCreateDefaults(this.ctx, this.tableName, mappedRows);

    if (this.contract.capabilities?.['sql']?.['defaultInInsert'] !== true) {
      const plans = compileInsertCountSplit(this.contract, this.tableName, mappedRows).map((plan) =>
        mergeUserAnnotations(plan, annotationsMap),
      );
      for (const plan of plans) {
        await executeQueryPlan<Record<string, unknown>>(this.ctx.runtime, plan).toArray();
      }
      return data.length;
    }

    const compiled = mergeUserAnnotations(
      compileInsertCount(this.contract, this.tableName, mappedRows),
      annotationsMap,
    );
    await executeQueryPlan<Record<string, unknown>>(this.ctx.runtime, compiled).toArray();
    return data.length;
  }

  /**
   * Passing `update: {}` makes this behave like a conditional create.
   * On conflict, `ON CONFLICT DO NOTHING RETURNING ...` may return zero rows,
   * so this method may issue a follow-up reload query to return the existing row.
   */
  async upsert(
    input: {
      create: ResolvedCreateInput<TContract, ModelName, State['variantName']>;
      update: Partial<DefaultModelRow<TContract, ModelName>>;
      conflictOn?: UniqueConstraintCriterion<TContract, ModelName>;
    },
    annotateFn?: (
      meta: AnnotationBuilder<'write', Registry>,
    ) => AnnotationBuilder<'write', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): Promise<Row> {
    assertReturningCapability(this.contract, 'upsert()');
    this.#assertNotMtiVariant('upsert()');
    const annotationsMap = this.#resolveAnnotationsToMap(annotateFn, 'write', 'upsert');

    const mappedCreateRows = this.#mapCreateRows([input.create as Record<string, unknown>]);
    const createValues = mappedCreateRows[0] ?? {};
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
    const compiled = mergeUserAnnotations(
      compileUpsertReturning(
        this.contract,
        this.tableName,
        createValues,
        updateValues,
        conflictColumns,
        selectedForUpsert,
      ),
      annotationsMap,
    );
    const row = await executeMutationReturningSingleRow<Row>({
      contract: this.contract,
      runtime: this.ctx.runtime,
      compiled,
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

  /**
   * Write terminal: update matching rows and return the first one (or
   * null when no row matched).
   *
   * Accepts an optional trailing `annotateFn` callback after the
   * input. See `all()` for the annotation callback semantics.
   *
   * Note: when the input contains nested-mutation callbacks, the
   * operation is executed as a graph of internal queries via
   * `withMutationScope`. In that path, annotations apply to the logical
   * `update()` call but do not currently flow into each constituent SQL
   * statement — see `projects/middleware-intercept-and-cache/follow-ups.md`.
   */
  async update(
    data: State['hasWhere'] extends true ? MutationUpdateInput<TContract, ModelName> : never,
    annotateFn?: (
      meta: AnnotationBuilder<'write', Registry>,
    ) => AnnotationBuilder<'write', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): Promise<Row | null> {
    assertReturningCapability(this.contract, 'update()');
    const annotationsMap = this.#resolveAnnotationsToMap(annotateFn, 'write', 'update');

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

    const rows = await this.#updateAllWithAnnotations(
      data as State['hasWhere'] extends true
        ? Partial<DefaultModelRow<TContract, ModelName>>
        : never,
      annotationsMap,
    );
    return rows[0] ?? null;
  }

  updateAll(
    data: State['hasWhere'] extends true ? Partial<DefaultModelRow<TContract, ModelName>> : never,
    annotateFn?: (
      meta: AnnotationBuilder<'write', Registry>,
    ) => AnnotationBuilder<'write', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): AsyncIterableResult<Row> {
    return this.#updateAllWithAnnotations(
      data,
      this.#resolveAnnotationsToMap(annotateFn, 'write', 'updateAll'),
    );
  }

  #updateAllWithAnnotations(
    data: State['hasWhere'] extends true ? Partial<DefaultModelRow<TContract, ModelName>> : never,
    annotationsMap: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined,
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
    const compiled = mergeUserAnnotations(
      compileUpdateReturning(
        this.contract,
        this.tableName,
        mappedData,
        this.state.filters,
        selectedForUpdate,
      ),
      annotationsMap,
    );
    return dispatchMutationRows<Row>({
      contract: this.contract,
      runtime: this.ctx.runtime,
      compiled,
      modelName: this.modelName,
      includes: this.state.includes,
      hiddenColumns,
      mapRow: (mapped) => mapped as Row,
    });
  }

  async updateCount(
    data: State['hasWhere'] extends true ? Partial<DefaultModelRow<TContract, ModelName>> : never,
    annotateFn?: (
      meta: AnnotationBuilder<'write', Registry>,
    ) => AnnotationBuilder<'write', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): Promise<number> {
    const mappedData = mapModelDataToStorageRow(this.contract, this.modelName, data);
    if (Object.keys(mappedData).length === 0) {
      return 0;
    }

    // Annotations attach to the write, not the matching read.
    const annotationsMap = this.#resolveAnnotationsToMap(annotateFn, 'write', 'updateCount');

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

    const compiled = mergeUserAnnotations(
      compileUpdateCount(this.contract, this.tableName, mappedData, this.state.filters),
      annotationsMap,
    );
    await executeQueryPlan<Record<string, unknown>>(this.ctx.runtime, compiled).toArray();

    return matchingRows.length;
  }

  /**
   * Write terminal: delete matching rows and return the first one (or
   * null when no row matched).
   *
   * Accepts an optional trailing `annotateFn` callback. See `all()`
   * for the annotation callback semantics.
   */
  async delete(
    this: State['hasWhere'] extends true
      ? Collection<TContract, ModelName, Row, State, Registry>
      : never,
    annotateFn?: (
      meta: AnnotationBuilder<'write', Registry>,
    ) => AnnotationBuilder<'write', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): Promise<Row | null> {
    assertReturningCapability(this.contract, 'delete()');
    // The `this`-typed receiver narrows when the `where()` gate is
    // satisfied, so we can call `deleteAll()` on it directly.
    const rows = await (this as Collection<TContract, ModelName, Row, State, Registry>)
      .#deleteAllWithAnnotations(this.#resolveAnnotationsToMap(annotateFn, 'write', 'delete'))
      .toArray();
    return rows[0] ?? null;
  }

  deleteAll(
    this: State['hasWhere'] extends true
      ? Collection<TContract, ModelName, Row, State, Registry>
      : never,
    annotateFn?: (
      meta: AnnotationBuilder<'write', Registry>,
    ) => AnnotationBuilder<'write', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): AsyncIterableResult<Row> {
    return (
      this as Collection<TContract, ModelName, Row, State, Registry>
    ).#deleteAllWithAnnotations(this.#resolveAnnotationsToMap(annotateFn, 'write', 'deleteAll'));
  }

  #deleteAllWithAnnotations(
    annotationsMap: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined,
  ): AsyncIterableResult<Row> {
    assertReturningCapability(this.contract, 'deleteAll()');

    const parentJoinColumns = this.state.includes.map((include) => include.localColumn);
    const { selectedForQuery: selectedForDelete, hiddenColumns } = augmentSelectionForJoinColumns(
      this.state.selectedFields,
      parentJoinColumns,
    );
    const compiled = mergeUserAnnotations(
      compileDeleteReturning(this.contract, this.tableName, this.state.filters, selectedForDelete),
      annotationsMap,
    );
    return dispatchMutationRows<Row>({
      contract: this.contract,
      runtime: this.ctx.runtime,
      compiled,
      modelName: this.modelName,
      includes: this.state.includes,
      hiddenColumns,
      mapRow: (mapped) => mapped as Row,
    });
  }

  async deleteCount(
    this: State['hasWhere'] extends true
      ? Collection<TContract, ModelName, Row, State, Registry>
      : never,
    annotateFn?: (
      meta: AnnotationBuilder<'write', Registry>,
    ) => AnnotationBuilder<'write', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): Promise<number> {
    // Annotations attach to the write, not the matching read.
    const annotationsMap = this.#resolveAnnotationsToMap(annotateFn, 'write', 'deleteCount');

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

    const compiled = mergeUserAnnotations(
      compileDeleteCount(this.contract, this.tableName, this.state.filters),
      annotationsMap,
    );
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
  ): Collection<TContract, ModelName, Row, NextState, Registry> {
    return this.#createSelf<Row, NextState>({
      ...this.state,
      ...overrides,
    });
  }

  #cloneWithRow<NextRow, NextState extends CollectionTypeState = State>(
    overrides: Partial<CollectionState>,
  ): Collection<TContract, ModelName, NextRow, NextState, Registry> {
    return this.#createSelf<NextRow, NextState>({
      ...this.state,
      ...overrides,
    });
  }

  #createSelf<NextRow, NextState extends CollectionTypeState>(
    state: CollectionState,
  ): Collection<TContract, ModelName, NextRow, NextState, Registry> {
    const Ctor = this.constructor as CollectionConstructor<TContract>;
    return new Ctor(this.ctx, this.modelName, {
      tableName: this.tableName,
      state,
      registry: this.registry,
      includeRefinementMode: this.includeRefinementMode,
    }) as unknown as Collection<TContract, ModelName, NextRow, NextState, Registry>;
  }

  #createCollection<
    ModelNameInner extends string,
    RowInner,
    StateInner extends CollectionTypeState,
  >(
    modelName: ModelNameInner,
    options: CollectionInit<TContract>,
  ): Collection<TContract, ModelNameInner, RowInner, StateInner, Registry> {
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
    }) as unknown as Collection<TContract, ModelNameInner, RowInner, StateInner, Registry>;
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

  /**
   * Resolves a terminal's `annotateFn` callback into a clone of the
   * receiver whose `state.userAnnotations` carries the merged values.
   * Used by read terminals (`all`, `first`) that flow annotations
   * through `state` into the compiled plan via `compileSelect`.
   *
   * - When `annotateFn === undefined`, returns the receiver unchanged.
   * - Constructs the kind-filtered `AnnotationBuilder` from
   *   `this.ctx.annotationRegistry` (or an empty registry when omitted
   *   — the array escape hatch with externally-imported handles still
   *   works), invokes the callback, normalizes the return value
   *   (branded builder or readonly array via
   *   `#extractAnnotationValues`), and runs
   *   `assertAnnotationsApplicable` (the runtime gate that catches
   *   cast-bypass).
   * - Last-write-wins on duplicate namespaces.
   */
  #resolveAnnotationsToState<K extends OperationKind>(
    annotateFn:
      | ((
          meta: AnnotationBuilder<K, Registry>,
        ) => AnnotationBuilder<K, Registry> | readonly AnnotationValue<unknown, OperationKind>[])
      | undefined,
    kind: K,
    terminalName: string,
  ): this {
    if (annotateFn === undefined) {
      return this;
    }
    const meta = createMetaBuilder<K, Registry>(
      this.ctx.annotationRegistry ?? createAnnotationRegistry(),
      kind,
    );
    const result = annotateFn(meta);
    const values = this.#extractAnnotationValues(result);
    assertAnnotationsApplicable(values, kind, terminalName);
    if (values.length === 0) {
      return this;
    }
    const next = new Map(this.state.userAnnotations);
    for (const annotation of values) {
      next.set(annotation.namespace, annotation);
    }
    return this.#clone({ userAnnotations: next }) as this;
  }

  /**
   * Resolves a terminal's `annotateFn` callback into a
   * `Map<namespace, AnnotationValue>` ready to be passed to
   * `mergeUserAnnotations`. Returns `undefined` when the callback is
   * omitted or yields zero values so callers can skip the rewrap
   * entirely.
   *
   * Used by terminals where annotations don't flow through `state` —
   * the compiled plan is post-wrapped with the annotations map
   * instead. (Read terminals `all` and `first` instead populate
   * `state.userAnnotations` via `#resolveAnnotationsToState`;
   * aggregate and every write terminal use this post-wrap path because
   * their compile functions don't take `state`.) Same normalization
   * and runtime gate as `#resolveAnnotationsToState`.
   */
  #resolveAnnotationsToMap<K extends OperationKind>(
    annotateFn:
      | ((
          meta: AnnotationBuilder<K, Registry>,
        ) => AnnotationBuilder<K, Registry> | readonly AnnotationValue<unknown, OperationKind>[])
      | undefined,
    kind: K,
    terminalName: string,
  ): ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined {
    if (annotateFn === undefined) {
      return undefined;
    }
    const meta = createMetaBuilder<K, Registry>(
      this.ctx.annotationRegistry ?? createAnnotationRegistry(),
      kind,
    );
    const result = annotateFn(meta);
    const values = this.#extractAnnotationValues(result);
    assertAnnotationsApplicable(values, kind, terminalName);
    if (values.length === 0) {
      return undefined;
    }
    const next = new Map<string, AnnotationValue<unknown, OperationKind>>();
    for (const annotation of values) {
      next.set(annotation.namespace, annotation);
    }
    return next;
  }

  /**
   * Normalizes the return value of a terminal's `annotateFn`. Two
   * shapes are accepted:
   *
   * 1. A branded `AnnotationBuilder` (carries the
   *    `[ANNOTATION_BUILDER]: true` symbol) — the framework reads its
   *    `values` array.
   * 2. A `readonly AnnotationValue[]` — the array escape hatch for
   *    callers that imported a handle directly and invoked it outside
   *    the registry-driven builder.
   *
   * Anything else throws (defensive — the type system rejects it
   * already, so this only fires on cast-bypass or dynamic invocation).
   * Mirrors `extractAnnotationValues` in
   * `@prisma-next/sql-builder/runtime`.
   */
  #extractAnnotationValues(
    result:
      | AnnotationBuilder<OperationKind, Registry>
      | readonly AnnotationValue<unknown, OperationKind>[],
  ): readonly AnnotationValue<unknown, OperationKind>[] {
    if (Array.isArray(result)) {
      return result;
    }
    if (
      typeof result === 'object' &&
      result !== null &&
      (result as Record<symbol, unknown>)[ANNOTATION_BUILDER] === true
    ) {
      return (result as { readonly values: readonly AnnotationValue<unknown, OperationKind>[] })
        .values;
    }
    throw new Error(
      '.annotate(callback) returned an unexpected value: expected the meta builder or a readonly array of AnnotationValues',
    );
  }
}
