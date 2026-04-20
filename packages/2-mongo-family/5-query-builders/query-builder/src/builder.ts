import type { PlanMeta } from '@prisma-next/contract/types';
import type {
  ExtractMongoCodecTypes,
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-contract';
import type {
  MongoAggAccumulator,
  MongoAggExpr,
  MongoDensifyRange,
  MongoFillOutput,
  MongoFilterExpr,
  MongoPipelineStage,
  MongoProjectionValue,
  MongoQueryPlan,
  MongoUpdatePipelineStage,
  MongoWindowField,
} from '@prisma-next/mongo-query-ast/execution';
import {
  AggregateCommand,
  FindOneAndDeleteCommand,
  FindOneAndUpdateCommand,
  MongoAddFieldsStage,
  MongoAndExpr,
  MongoBucketAutoStage,
  MongoBucketStage,
  MongoCountStage,
  MongoDensifyStage,
  MongoFacetStage,
  MongoFillStage,
  MongoGeoNearStage,
  MongoGraphLookupStage,
  MongoGroupStage,
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  MongoMergeStage,
  MongoOutStage,
  MongoProjectStage,
  MongoRedactStage,
  MongoReplaceRootStage,
  MongoSampleStage,
  MongoSearchMetaStage,
  MongoSearchStage,
  MongoSetWindowFieldsStage,
  MongoSkipStage,
  MongoSortByCountStage,
  MongoSortStage,
  MongoUnionWithStage,
  MongoUnwindStage,
  MongoVectorSearchStage,
  UpdateManyCommand,
  UpdateOneCommand,
} from '@prisma-next/mongo-query-ast/execution';
import { createFieldAccessor, type Expression, type FieldAccessor } from './field-accessor';
import type { FindAndModifyCompat, UpdateCompat } from './markers';
import type {
  DocField,
  DocShape,
  ExtractDocShape,
  GroupedDocShape,
  GroupSpec,
  ProjectedShape,
  ResolveRow,
  SortSpec,
  TypedAggExpr,
  UnwoundShape,
} from './types';
import { resolveUpdaterResult, type UpdaterItem } from './update-ops';

interface PipelineChainState {
  readonly collection: string;
  readonly stages: ReadonlyArray<MongoPipelineStage>;
  readonly storageHash: string;
}

/**
 * The pipeline state in the query-builder state machine.
 *
 * Reached from `CollectionHandle` or `FilteredCollection` after the first
 * pipeline-stage method call (or directly via `aggregate()` shortcuts). Holds
 * the accumulated `MongoPipelineStage[]` and exposes pipeline-stage methods,
 * the `merge`/`out` write terminals, and the `build`/`aggregate` read
 * terminals.
 *
 * Two phantom type parameters gate the conditional terminals:
 *
 *  - `U extends UpdateCompat` — when `'compat'`, the no-arg `updateMany()` /
 *    `updateOne()` form is available (consume the chain as an
 *    update-with-pipeline spec). Cleared by stages that produce content the
 *    `update` AST cannot represent (e.g. `$group`, `$lookup`, `$limit`).
 *  - `F extends FindAndModifyCompat` — when `'compat'`, the
 *    `findOneAndUpdate(...)` / `findOneAndDelete(...)` terminals are
 *    available. Cleared by stages incompatible with their wire-command slots
 *    (`$limit`, `$group`, mutating stages, …).
 *
 * The marker semantics are encoded in the per-method return types — see the
 * marker table in `query-builder-unification.spec.md`.
 */
export class PipelineChain<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  Shape extends DocShape,
  U extends UpdateCompat = 'compat',
  F extends FindAndModifyCompat = 'compat',
> {
  declare readonly __updateCompat: U;
  declare readonly __findAndModifyCompat: F;

  readonly #contract: TContract;
  readonly #state: PipelineChainState;

  constructor(contract: TContract, state: PipelineChainState) {
    this.#contract = contract;
    this.#state = state;
  }

  #withStage<
    NewShape extends DocShape,
    NewU extends UpdateCompat,
    NewF extends FindAndModifyCompat,
  >(stage: MongoPipelineStage): PipelineChain<TContract, NewShape, NewU, NewF> {
    return new PipelineChain<TContract, NewShape, NewU, NewF>(this.#contract, {
      ...this.#state,
      stages: [...this.#state.stages, stage],
    });
  }

  #writeMeta(): PlanMeta {
    return {
      target: 'mongo',
      storageHash: this.#state.storageHash,
      lane: 'mongo-write',
      paramDescriptors: [],
    };
  }

  // --- Identity stages ---

  /**
   * `$match`. Both markers preserved — the filter does not mutate documents
   * and is representable in every consuming wire command's `filter` slot.
   */
  match(filter: MongoFilterExpr): PipelineChain<TContract, Shape, U, F>;
  match(
    fn: (fields: FieldAccessor<Shape>) => MongoFilterExpr,
  ): PipelineChain<TContract, Shape, U, F>;
  match(
    filterOrFn: MongoFilterExpr | ((fields: FieldAccessor<Shape>) => MongoFilterExpr),
  ): PipelineChain<TContract, Shape, U, F> {
    const filter =
      typeof filterOrFn === 'function' ? filterOrFn(createFieldAccessor<Shape>()) : filterOrFn;
    return this.#withStage<Shape, U, F>(new MongoMatchStage(filter));
  }

  /**
   * `$sort`. Clears `UpdateCompat` (`update` has no per-document sort) but
   * preserves `FindAndModifyCompat` (`findAndModify` has a `sort` slot).
   */
  sort(spec: SortSpec<Shape>): PipelineChain<TContract, Shape, 'cleared', F> {
    return this.#withStage<Shape, 'cleared', F>(new MongoSortStage(spec as Record<string, 1 | -1>));
  }

  /**
   * `$limit`. Clears both markers — `limit` is incompatible with the `update`
   * wire command, and `findAndModify` already implies single-document
   * semantics (so `.limit(...)` adds no meaning, only ambiguity).
   */
  limit(n: number): PipelineChain<TContract, Shape, 'cleared', 'cleared'> {
    return this.#withStage<Shape, 'cleared', 'cleared'>(new MongoLimitStage(n));
  }

  /**
   * `$skip`. Clears `UpdateCompat`; preserved for `findAndModify` (which has
   * a `skip` slot).
   */
  skip(n: number): PipelineChain<TContract, Shape, 'cleared', F> {
    return this.#withStage<Shape, 'cleared', F>(new MongoSkipStage(n));
  }

  sample(n: number): PipelineChain<TContract, Shape, 'cleared', 'cleared'> {
    return this.#withStage<Shape, 'cleared', 'cleared'>(new MongoSampleStage(n));
  }

  // --- Additive stages ---

  /**
   * `$addFields`. Preserves `UpdateCompat` (representable as
   * update-with-pipeline `$set`); clears `FindAndModifyCompat` (no analogue
   * in the find-and-modify wire commands).
   */
  addFields<NewFields extends Record<string, TypedAggExpr<DocField>>>(
    fn: (fields: FieldAccessor<Shape>) => NewFields,
  ): PipelineChain<TContract, Shape & ExtractDocShape<NewFields>, U, 'cleared'> {
    const accessor = createFieldAccessor<Shape>();
    const newFields = fn(accessor);
    const exprRecord: Record<string, MongoAggExpr> = {};
    for (const [key, typed] of Object.entries(newFields)) {
      exprRecord[key] = typed.node;
    }
    return this.#withStage<Shape & ExtractDocShape<NewFields>, U, 'cleared'>(
      new MongoAddFieldsStage(exprRecord),
    );
  }

  /**
   * `$lookup`. Clears both markers — joins are not representable in either
   * the `update` or `findAndModify` wire commands.
   */
  lookup<ForeignRoot extends keyof TContract['roots'] & string, As extends string>(options: {
    from: ForeignRoot;
    localField: keyof Shape & string;
    foreignField: string;
    as: As;
  }): PipelineChain<
    TContract,
    Shape & Record<As, { readonly codecId: 'mongo/array@1'; readonly nullable: false }>,
    'cleared',
    'cleared'
  > {
    const contract = this.#contract as MongoContract;
    const modelName = contract.roots[options.from];
    if (!modelName) {
      const validRoots = Object.keys(contract.roots).join(', ');
      throw new Error(`lookup() unknown root: "${options.from}". Valid roots: ${validRoots}`);
    }
    const model = contract.models[modelName];
    const collectionName = model?.storage?.collection ?? options.from;
    return this.#withStage(
      new MongoLookupStage({
        from: collectionName,
        localField: options.localField,
        foreignField: options.foreignField,
        as: options.as,
      }),
    );
  }

  // --- Narrowing stages ---

  /**
   * `$project`. Preserves `UpdateCompat` (representable as update-with-pipeline
   * `$project` / `$unset`); clears `FindAndModifyCompat` (use `.project()` on
   * the result of `.build()` if both projection and find-and-modify are
   * needed — see spec).
   */
  project<K extends keyof Shape & string>(
    ...keys: K[]
  ): PipelineChain<
    TContract,
    Pick<Shape, K | ('_id' extends keyof Shape ? '_id' : never)>,
    U,
    'cleared'
  >;
  project<Spec extends Record<string, 1 | TypedAggExpr<DocField>>>(
    fn: (fields: FieldAccessor<Shape>) => Spec,
  ): PipelineChain<TContract, ProjectedShape<Shape, Spec>, U, 'cleared'>;
  project(...args: unknown[]): PipelineChain<TContract, DocShape, U, 'cleared'> {
    if (args.length === 1 && typeof args[0] === 'function') {
      const fn = args[0] as (
        fields: FieldAccessor<Shape>,
      ) => Record<string, 1 | TypedAggExpr<DocField>>;
      const accessor = createFieldAccessor<Shape>();
      const spec = fn(accessor);
      const projection: Record<string, MongoProjectionValue> = {};
      for (const [key, val] of Object.entries(spec)) {
        projection[key] = val === 1 ? 1 : (val as TypedAggExpr<DocField>).node;
      }
      return this.#withStage(new MongoProjectStage(projection));
    }
    const keys = args as string[];
    const projection: Record<string, 1> = {};
    for (const key of keys) {
      projection[key] = 1;
    }
    return this.#withStage(new MongoProjectStage(projection));
  }

  /**
   * `$unwind`. Clears both markers — array unrolling produces multiple output
   * documents per input, incompatible with both single-document update and
   * find-and-modify wire commands.
   */
  unwind<K extends keyof Shape & string>(
    field: K,
    options?: { preserveNullAndEmptyArrays?: boolean },
  ): PipelineChain<TContract, UnwoundShape<Shape, K>, 'cleared', 'cleared'> {
    return this.#withStage<UnwoundShape<Shape, K>, 'cleared', 'cleared'>(
      new MongoUnwindStage(`$${field}`, options?.preserveNullAndEmptyArrays ?? false),
    );
  }

  // --- Replacement stages ---

  /**
   * `$group`. Clears both markers — group output bears no relation to source
   * documents; neither `update` nor `findAndModify` can consume it.
   */
  group<Spec extends GroupSpec>(
    fn: (fields: FieldAccessor<Shape>) => Spec,
  ): PipelineChain<TContract, GroupedDocShape<Spec>, 'cleared', 'cleared'> {
    const accessor = createFieldAccessor<Shape>();
    const spec = fn(accessor);
    const { _id: groupIdExpr, ...rest } = spec;
    const groupId = groupIdExpr === null ? null : groupIdExpr.node;
    const accumulators: Record<string, MongoAggAccumulator> = {};
    for (const [key, typed] of Object.entries(rest)) {
      if (typed === null) {
        throw new Error(`group() field "${key}" must not be null. Only _id can be null.`);
      }
      if (typed.node.kind !== 'accumulator') {
        throw new Error(
          `group() field "${key}" must use an accumulator (e.g. acc.sum(), acc.count()). Got "${typed.node.kind}" expression.`,
        );
      }
      accumulators[key] = typed.node as MongoAggAccumulator;
    }
    return this.#withStage<GroupedDocShape<Spec>, 'cleared', 'cleared'>(
      new MongoGroupStage(groupId, accumulators),
    );
  }

  /**
   * `$replaceRoot`. Preserves `UpdateCompat` (representable as
   * update-with-pipeline `$replaceRoot`); clears `FindAndModifyCompat`.
   */
  replaceRoot<NewShape extends DocShape>(
    fn: (fields: FieldAccessor<Shape>) => Expression<DocField> | TypedAggExpr<DocField>,
  ): PipelineChain<TContract, NewShape, U, 'cleared'> {
    const accessor = createFieldAccessor<Shape>();
    const expr = fn(accessor);
    return this.#withStage<NewShape, U, 'cleared'>(new MongoReplaceRootStage(expr.node));
  }

  count<Field extends string>(
    field: Field,
  ): PipelineChain<
    TContract,
    Record<Field, { readonly codecId: 'mongo/double@1'; readonly nullable: false }>,
    'cleared',
    'cleared'
  > {
    return this.#withStage(new MongoCountStage(field));
  }

  sortByCount<F2 extends DocField>(
    fn: (fields: FieldAccessor<Shape>) => Expression<F2> | TypedAggExpr<F2>,
  ): PipelineChain<
    TContract,
    {
      _id: F2;
      count: { readonly codecId: 'mongo/double@1'; readonly nullable: false };
    },
    'cleared',
    'cleared'
  > {
    const accessor = createFieldAccessor<Shape>();
    const expr = fn(accessor);
    return this.#withStage(new MongoSortByCountStage(expr.node));
  }

  // --- Filter stages ---

  /**
   * `$redact`. Preserves `UpdateCompat`; clears `FindAndModifyCompat`.
   */
  redact(
    fn: (fields: FieldAccessor<Shape>) => Expression<DocField> | TypedAggExpr<DocField>,
  ): PipelineChain<TContract, Shape, U, 'cleared'> {
    const accessor = createFieldAccessor<Shape>();
    const expr = fn(accessor);
    return this.#withStage<Shape, U, 'cleared'>(new MongoRedactStage(expr.node));
  }

  // --- Write terminals (output stages) ---

  /**
   * `$out` write terminal. Materialises the pipeline output into
   * `collection` (optionally in `db`), replacing any prior contents. Unlike
   * the other pipeline-stage methods, this **terminates** the chain — it
   * returns a `MongoQueryPlan` rather than another `PipelineChain`, since
   * `$out` must be the final stage and there is nothing further to chain.
   *
   * Lane is `mongo-write` (vs. `mongo-pipeline` for read terminals) so
   * middleware can dispatch on intent without inspecting the command.
   *
   * The result row stream is empty (`unknown` row type) — the data lives
   * in the destination collection, not the response.
   */
  out(collection: string, db?: string): MongoQueryPlan<unknown> {
    return this.#writeTerminal(new MongoOutStage(collection, db));
  }

  /**
   * `$merge` write terminal. Streams the pipeline output into the target
   * collection per the supplied merge semantics (`whenMatched` /
   * `whenNotMatched`). Like `out()`, terminates the chain — `$merge` must
   * be the final stage.
   */
  merge(options: {
    into: string | { db: string; coll: string };
    on?: string | ReadonlyArray<string>;
    whenMatched?: string | ReadonlyArray<MongoUpdatePipelineStage>;
    whenNotMatched?: string;
  }): MongoQueryPlan<unknown> {
    return this.#writeTerminal(new MongoMergeStage(options));
  }

  #writeTerminal(stage: MongoPipelineStage): MongoQueryPlan<unknown> {
    const pipeline = [...this.#state.stages, stage];
    const command = new AggregateCommand(this.#state.collection, pipeline);
    const meta: PlanMeta = {
      target: 'mongo',
      storageHash: this.#state.storageHash,
      lane: 'mongo-write',
      paramDescriptors: [],
    };
    return { collection: this.#state.collection, command, meta };
  }

  // --- Union stages ---

  unionWith(
    collection: string,
    pipeline?: ReadonlyArray<MongoPipelineStage>,
  ): PipelineChain<TContract, Shape, 'cleared', 'cleared'> {
    return this.#withStage<Shape, 'cleared', 'cleared'>(
      new MongoUnionWithStage(collection, pipeline),
    );
  }

  // --- Bucketing stages ---

  bucket(options: {
    groupBy: MongoAggExpr;
    boundaries: ReadonlyArray<unknown>;
    default_?: unknown;
    output?: Record<string, MongoAggAccumulator>;
  }): PipelineChain<TContract, DocShape, 'cleared', 'cleared'> {
    return this.#withStage<DocShape, 'cleared', 'cleared'>(new MongoBucketStage(options));
  }

  bucketAuto(options: {
    groupBy: MongoAggExpr;
    buckets: number;
    output?: Record<string, MongoAggAccumulator>;
    granularity?: string;
  }): PipelineChain<TContract, DocShape, 'cleared', 'cleared'> {
    return this.#withStage<DocShape, 'cleared', 'cleared'>(new MongoBucketAutoStage(options));
  }

  // --- Geo stages ---

  geoNear(options: {
    near: unknown;
    distanceField: string;
    spherical?: boolean;
    maxDistance?: number;
    minDistance?: number;
    query?: MongoFilterExpr;
    key?: string;
    distanceMultiplier?: number;
    includeLocs?: string;
  }): PipelineChain<TContract, DocShape, 'cleared', 'cleared'> {
    return this.#withStage<DocShape, 'cleared', 'cleared'>(new MongoGeoNearStage(options));
  }

  // --- Multi-facet stages ---

  facet(
    facets: Record<string, ReadonlyArray<MongoPipelineStage>>,
  ): PipelineChain<TContract, DocShape, 'cleared', 'cleared'> {
    return this.#withStage<DocShape, 'cleared', 'cleared'>(new MongoFacetStage(facets));
  }

  // --- Graph stages ---

  graphLookup(options: {
    from: string;
    startWith: MongoAggExpr;
    connectFromField: string;
    connectToField: string;
    as: string;
    maxDepth?: number;
    depthField?: string;
    restrictSearchWithMatch?: MongoFilterExpr;
  }): PipelineChain<TContract, DocShape, 'cleared', 'cleared'> {
    return this.#withStage<DocShape, 'cleared', 'cleared'>(new MongoGraphLookupStage(options));
  }

  // --- Window stages ---

  setWindowFields(options: {
    partitionBy?: MongoAggExpr;
    sortBy?: Record<string, 1 | -1>;
    output: Record<string, MongoWindowField>;
  }): PipelineChain<TContract, DocShape, 'cleared', 'cleared'> {
    return this.#withStage<DocShape, 'cleared', 'cleared'>(new MongoSetWindowFieldsStage(options));
  }

  densify(options: {
    field: string;
    partitionByFields?: ReadonlyArray<string>;
    range: MongoDensifyRange;
  }): PipelineChain<TContract, Shape, 'cleared', 'cleared'> {
    return this.#withStage<Shape, 'cleared', 'cleared'>(new MongoDensifyStage(options));
  }

  fill(options: {
    partitionBy?: MongoAggExpr;
    partitionByFields?: ReadonlyArray<string>;
    sortBy?: Record<string, 1 | -1>;
    output: Record<string, MongoFillOutput>;
  }): PipelineChain<TContract, Shape, 'cleared', 'cleared'> {
    return this.#withStage<Shape, 'cleared', 'cleared'>(new MongoFillStage(options));
  }

  // --- Search stages ---

  search(
    config: Record<string, unknown>,
    index?: string,
  ): PipelineChain<TContract, Shape, 'cleared', 'cleared'> {
    return this.#withStage<Shape, 'cleared', 'cleared'>(new MongoSearchStage(config, index));
  }

  searchMeta(
    config: Record<string, unknown>,
    index?: string,
  ): PipelineChain<TContract, DocShape, 'cleared', 'cleared'> {
    return this.#withStage<DocShape, 'cleared', 'cleared'>(new MongoSearchMetaStage(config, index));
  }

  vectorSearch(options: {
    index: string;
    path: string;
    queryVector: ReadonlyArray<number>;
    numCandidates: number;
    limit: number;
    filter?: Record<string, unknown>;
  }): PipelineChain<TContract, Shape, 'cleared', 'cleared'> {
    return this.#withStage<Shape, 'cleared', 'cleared'>(new MongoVectorSearchStage(options));
  }

  // --- Escape hatch ---

  pipe(stage: MongoPipelineStage): PipelineChain<TContract, Shape, 'cleared', 'cleared'>;
  pipe<NewShape extends DocShape>(
    stage: MongoPipelineStage,
  ): PipelineChain<TContract, NewShape, 'cleared', 'cleared'>;
  pipe<NewShape extends DocShape = Shape>(
    stage: MongoPipelineStage,
  ): PipelineChain<TContract, NewShape, 'cleared', 'cleared'> {
    return this.#withStage<NewShape, 'cleared', 'cleared'>(stage);
  }

  // --- Pipeline-style write terminals (UpdateCompat-gated) ---

  /**
   * No-arg `updateMany()`: deconstruct the chain into leading `$match`
   * stages (folded into the filter) and remaining stages (which must all
   * be valid pipeline-update stages). Available only when `U = 'compat'`.
   *
   * Overloaded to accept an optional updater callback for subclass
   * compatibility with `FilteredCollection.updateMany(updaterFn)`.
   */
  updateMany(
    this: PipelineChain<TContract, Shape, 'compat', F>,
    updaterFn?: (fields: FieldAccessor<Shape>) => ReadonlyArray<UpdaterItem>,
  ): MongoQueryPlan<unknown> {
    if (updaterFn) {
      throw new Error(
        'updateMany() on a PipelineChain expects no arguments — the chain itself is the update pipeline. ' +
          'To update with an operator callback, call .updateMany(fn) on a FilteredCollection (i.e. after .match()).',
      );
    }
    const { filter, updatePipeline } = deconstructUpdateChain(this.#state.stages);
    const command = new UpdateManyCommand(this.#state.collection, filter, updatePipeline);
    return { collection: this.#state.collection, command, meta: this.#writeMeta() };
  }

  /**
   * No-arg `updateOne()`: same as `updateMany()` but maps to a single-doc
   * update.
   */
  updateOne(
    this: PipelineChain<TContract, Shape, 'compat', F>,
    updaterFn?: (fields: FieldAccessor<Shape>) => ReadonlyArray<UpdaterItem>,
  ): MongoQueryPlan<unknown> {
    if (updaterFn) {
      throw new Error(
        'updateOne() on a PipelineChain expects no arguments — the chain itself is the update pipeline. ' +
          'To update with an operator callback, call .updateOne(fn) on a FilteredCollection (i.e. after .match()).',
      );
    }
    const { filter, updatePipeline } = deconstructUpdateChain(this.#state.stages);
    const command = new UpdateOneCommand(this.#state.collection, filter, updatePipeline);
    return { collection: this.#state.collection, command, meta: this.#writeMeta() };
  }

  // --- Find-and-modify terminals (marker-gated) ---

  /**
   * Find a single document matching the accumulated pipeline (which must
   * consist solely of `$match`/`$sort`/`$skip` stages) and apply
   * `updaterFn`. Available only when `FindAndModifyCompat` is `'compat'`
   * — stages that clear the marker make this method invisible at the type
   * level.
   *
   * The pipeline stages are deconstructed into the wire command's `filter`,
   * `sort`, and `skip` slots. If any non-deconstructable stage is present,
   * a runtime error is thrown as a defensive check (the type system should
   * prevent this).
   */
  findOneAndUpdate(
    this: PipelineChain<TContract, Shape, U, 'compat'>,
    updaterFn: (fields: FieldAccessor<Shape>) => ReadonlyArray<UpdaterItem>,
    opts: { readonly upsert?: boolean; readonly returnDocument?: 'before' | 'after' } = {},
  ): MongoQueryPlan<unknown> {
    const { filter, sort, skip } = deconstructFindAndModifyChain(this.#state.stages);
    const accessor = createFieldAccessor<Shape>();
    const items = updaterFn(accessor);
    const update = resolveUpdaterResult(items);
    const command = new FindOneAndUpdateCommand(
      this.#state.collection,
      filter,
      update,
      opts.upsert ?? false,
      sort,
      skip,
      opts.returnDocument ?? 'after',
    );
    const meta: PlanMeta = {
      target: 'mongo',
      storageHash: this.#state.storageHash,
      lane: 'mongo-write',
      paramDescriptors: [],
    };
    return { collection: this.#state.collection, command, meta };
  }

  /**
   * Find a single document matching the accumulated pipeline and delete it.
   * Same marker gating and deconstruction as `findOneAndUpdate`.
   */
  findOneAndDelete(this: PipelineChain<TContract, Shape, U, 'compat'>): MongoQueryPlan<unknown> {
    const { filter, sort, skip } = deconstructFindAndModifyChain(this.#state.stages);
    const command = new FindOneAndDeleteCommand(this.#state.collection, filter, sort, skip);
    const meta: PlanMeta = {
      target: 'mongo',
      storageHash: this.#state.storageHash,
      lane: 'mongo-write',
      paramDescriptors: [],
    };
    return { collection: this.#state.collection, command, meta };
  }

  // --- Read terminals ---

  /**
   * Materialise the chain as a `MongoQueryPlan` wrapping an `AggregateCommand`.
   */
  build(): MongoQueryPlan<ResolveRow<Shape, ExtractMongoCodecTypes<TContract>>> {
    const command = new AggregateCommand(this.#state.collection, this.#state.stages);
    const meta: PlanMeta = {
      target: 'mongo',
      storageHash: this.#state.storageHash,
      lane: 'mongo-pipeline',
      paramDescriptors: [],
    };
    return { collection: this.#state.collection, command, meta };
  }

  /**
   * Alias for `build()` — surfaces the read intent at the call site.
   */
  aggregate(): MongoQueryPlan<ResolveRow<Shape, ExtractMongoCodecTypes<TContract>>> {
    return this.build();
  }
}

interface DeconstructedFindAndModify {
  filter: MongoFilterExpr;
  sort: Record<string, 1 | -1> | undefined;
  skip: number | undefined;
}

/**
 * Walk the accumulated pipeline stages and extract the `filter`, `sort`,
 * and `skip` slots for a `findOneAndUpdate` / `findOneAndDelete` wire
 * command. Only `$match`, `$sort`, and `$skip` stages are permitted; any
 * other stage triggers a runtime error (the type system should make this
 * unreachable, but the check is here as a defence-in-depth measure).
 *
 * Multiple `$match` stages are AND-folded. Multiple `$sort` stages fold
 * last-writer-wins per key (matching Mongo's own pipeline semantics).
 * The largest `$skip` value wins.
 */
function deconstructFindAndModifyChain(
  stages: ReadonlyArray<MongoPipelineStage>,
): DeconstructedFindAndModify {
  const matchFilters: MongoFilterExpr[] = [];
  let sort: Record<string, 1 | -1> | undefined;
  let skip: number | undefined;

  for (const stage of stages) {
    if (stage instanceof MongoMatchStage) {
      matchFilters.push(stage.filter);
    } else if (stage instanceof MongoSortStage) {
      sort = sort ? { ...sort, ...stage.sort } : { ...stage.sort };
    } else if (stage instanceof MongoSkipStage) {
      skip = skip != null ? Math.max(skip, stage.skip) : stage.skip;
    } else {
      throw new Error(
        'findOneAndUpdate/findOneAndDelete requires a chain of $match/$sort/$skip stages only, ' +
          `but encountered a '${stage.constructor.name}' stage. ` +
          'This is likely a bug — the type system should have prevented this chain.',
      );
    }
  }

  if (matchFilters.length === 0) {
    throw new Error('findOneAndUpdate/findOneAndDelete requires at least one .match() call.');
  }
  const first = matchFilters[0];
  if (first === undefined) {
    throw new Error('Unreachable: matchFilters.length > 0 but first is undefined');
  }
  const filter: MongoFilterExpr = matchFilters.length === 1 ? first : MongoAndExpr.of(matchFilters);

  return { filter, sort, skip };
}

interface DeconstructedUpdate {
  filter: MongoFilterExpr;
  updatePipeline: ReadonlyArray<MongoUpdatePipelineStage>;
}

/**
 * Walk the accumulated pipeline stages: leading `$match` stages become the
 * filter, remaining stages must all be valid `MongoUpdatePipelineStage`
 * members (currently `$addFields`, `$project`, `$replaceRoot`).
 */
function deconstructUpdateChain(stages: ReadonlyArray<MongoPipelineStage>): DeconstructedUpdate {
  const matchFilters: MongoFilterExpr[] = [];
  let boundary = 0;

  for (const stage of stages) {
    if (!(stage instanceof MongoMatchStage)) break;
    matchFilters.push(stage.filter);
    boundary++;
  }

  if (matchFilters.length === 0) {
    throw new Error('No-arg updateMany/updateOne requires at least one .match() call.');
  }

  const remaining = stages.slice(boundary);
  if (remaining.length === 0) {
    throw new Error(
      'No-arg updateMany/updateOne requires at least one pipeline-update stage ' +
        '(e.g. .addFields(), .project(), .replaceRoot()) after the .match() stages.',
    );
  }

  const updatePipeline: MongoUpdatePipelineStage[] = [];
  for (const stage of remaining) {
    if (
      stage instanceof MongoAddFieldsStage ||
      stage instanceof MongoProjectStage ||
      stage instanceof MongoReplaceRootStage
    ) {
      updatePipeline.push(stage);
    } else {
      throw new Error(
        `No-arg updateMany/updateOne: encountered non-update stage '${stage.constructor.name}' ` +
          'after the leading $match stages. Only $addFields/$set, $project/$unset, ' +
          'and $replaceRoot/$replaceWith stages are valid in an update pipeline.',
      );
    }
  }

  const first = matchFilters[0];
  if (first === undefined) {
    throw new Error('Unreachable: matchFilters.length > 0 but first is undefined');
  }
  const filter: MongoFilterExpr = matchFilters.length === 1 ? first : MongoAndExpr.of(matchFilters);

  return { filter, updatePipeline };
}
