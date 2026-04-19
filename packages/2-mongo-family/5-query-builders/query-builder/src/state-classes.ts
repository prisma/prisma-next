import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-contract';
import type { MongoFilterExpr } from '@prisma-next/mongo-query-ast/execution';
import { MongoAndExpr, MongoMatchStage } from '@prisma-next/mongo-query-ast/execution';
import { PipelineChain } from './builder';
import { createFieldAccessor, type FieldAccessor } from './field-accessor';
import type { ModelToDocShape } from './types';

/**
 * Root state of the query-builder state machine. Returned from
 * `mongoQuery(...).from(name)` and bound to a single collection.
 *
 * Inherits the entire pipeline-stage surface from `PipelineChain` (since an
 * empty `CollectionHandle` is observably an empty pipeline). Adds:
 *
 *  - `match(...)` — overridden to transition to `FilteredCollection`, which
 *    accumulates filters for eventual splatting into write/find-and-modify
 *    wire commands.
 *  - **Insert / unqualified-write methods** (M2): `insertOne`, `insertMany`,
 *    `updateAll`, `deleteAll`. These live *only* here — the corresponding
 *    methods are absent from `FilteredCollection`, so a caller cannot
 *    accidentally produce an unqualified write by forgetting to `.match(...)`
 *    later in the chain. Bodies land in M2.
 */
export class CollectionHandle<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends keyof TContract['models'] & string,
> extends PipelineChain<TContract, ModelToDocShape<TContract, ModelName>, 'compat', 'compat'> {
  readonly #ctx: BindingContext<TContract>;
  readonly #modelName: ModelName;

  constructor(ctx: BindingContext<TContract>, modelName: ModelName) {
    super(ctx.contract, {
      collection: ctx.collection,
      stages: [],
      storageHash: ctx.storageHash,
    });
    this.#ctx = ctx;
    this.#modelName = modelName;
  }

  /**
   * Bound model name. Exposed so type tests can assert the binding without
   * flipping into a pipeline. Not part of the public-API contract.
   */
  get _modelName(): ModelName {
    return this.#modelName;
  }

  /**
   * Begin accumulating a filter. Transitions to `FilteredCollection`.
   *
   * Overrides `PipelineChain.match` (which appends another `$match` stage
   * and stays in the chain). The two implementations are semantically
   * equivalent for the read terminal — multiple `$match` stages AND-fold in
   * Mongo — but `FilteredCollection` makes the accumulated filter
   * addressable for the write/find-and-modify terminals landing in M2/M3.
   */
  override match(filter: MongoFilterExpr): FilteredCollection<TContract, ModelName>;
  override match(
    fn: (fields: FieldAccessor<ModelToDocShape<TContract, ModelName>>) => MongoFilterExpr,
  ): FilteredCollection<TContract, ModelName>;
  override match(
    filterOrFn:
      | MongoFilterExpr
      | ((fields: FieldAccessor<ModelToDocShape<TContract, ModelName>>) => MongoFilterExpr),
  ): FilteredCollection<TContract, ModelName> {
    const resolved =
      typeof filterOrFn === 'function'
        ? filterOrFn(createFieldAccessor<ModelToDocShape<TContract, ModelName>>())
        : filterOrFn;
    return new FilteredCollection<TContract, ModelName>(this.#ctx, this.#modelName, [resolved]);
  }
}

/**
 * State reached after one or more `.match(...)` calls on `CollectionHandle`.
 *
 * Inherits the pipeline-stage surface from `PipelineChain`, with the
 * accumulated filters baked in as a leading `$match` stage on the underlying
 * pipeline state. This means read-terminal output (`.aggregate()` /
 * `.build()`) and any subsequent pipeline-stage chain see the filtered
 * collection as input — the read story works through pure inheritance.
 *
 * Adds:
 *
 *  - `match(...)` — pushes another `$match` stage *and* records the filter in
 *    the accumulator, so the eventual write/find-and-modify terminal can
 *    splat the AND-folded filter into the wire command's `filter` slot.
 *  - **Filtered writes** (M2): `updateMany`, `updateOne`, `deleteMany`,
 *    `deleteOne`, `upsertOne`, `upsertMany`. Stubbed in M1.
 *  - **Find-and-modify** (M3): `findOneAndUpdate`, `findOneAndDelete`.
 *    Stubbed in M1.
 *
 * Notably *does not* expose `insertOne`/`insertMany`/`updateAll`/`deleteAll`
 * — those are insert or unqualified-write operations that are nonsense
 * after a filter has been applied.
 */
export class FilteredCollection<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends keyof TContract['models'] & string,
> extends PipelineChain<TContract, ModelToDocShape<TContract, ModelName>, 'compat', 'compat'> {
  readonly #ctx: BindingContext<TContract>;
  readonly #modelName: ModelName;
  readonly #filters: ReadonlyArray<MongoFilterExpr>;

  constructor(
    ctx: BindingContext<TContract>,
    modelName: ModelName,
    filters: ReadonlyArray<MongoFilterExpr>,
  ) {
    if (filters.length === 0) {
      throw new Error('FilteredCollection requires at least one accumulated filter');
    }
    const first = filters[0];
    if (first === undefined) {
      throw new Error('FilteredCollection: unreachable empty-filters branch');
    }
    const leading = filters.length === 1 ? first : foldAnd(filters);
    super(ctx.contract, {
      collection: ctx.collection,
      stages: [new MongoMatchStage(leading)],
      storageHash: ctx.storageHash,
    });
    this.#ctx = ctx;
    this.#modelName = modelName;
    this.#filters = filters;
  }

  get _modelName(): ModelName {
    return this.#modelName;
  }

  /**
   * Accumulated filter list. Exposed for the M2/M3 write/find-and-modify
   * terminals to splat into wire-command `filter` slots; not part of the
   * public-API contract.
   */
  get _filters(): ReadonlyArray<MongoFilterExpr> {
    return this.#filters;
  }

  /**
   * Append another filter to the accumulator. Returns a new
   * `FilteredCollection` whose underlying pipeline rebuilds the leading
   * `$match` from the AND-folded accumulator (rather than appending a
   * second `$match` stage), so the write/find-and-modify terminals see a
   * single authoritative filter expression.
   */
  override match(filter: MongoFilterExpr): FilteredCollection<TContract, ModelName>;
  override match(
    fn: (fields: FieldAccessor<ModelToDocShape<TContract, ModelName>>) => MongoFilterExpr,
  ): FilteredCollection<TContract, ModelName>;
  override match(
    filterOrFn:
      | MongoFilterExpr
      | ((fields: FieldAccessor<ModelToDocShape<TContract, ModelName>>) => MongoFilterExpr),
  ): FilteredCollection<TContract, ModelName> {
    const resolved =
      typeof filterOrFn === 'function'
        ? filterOrFn(createFieldAccessor<ModelToDocShape<TContract, ModelName>>())
        : filterOrFn;
    return new FilteredCollection<TContract, ModelName>(this.#ctx, this.#modelName, [
      ...this.#filters,
      resolved,
    ]);
  }
}

function foldAnd(filters: ReadonlyArray<MongoFilterExpr>): MongoFilterExpr {
  return MongoAndExpr.of(filters);
}

/**
 * Bound execution context shared across the three state classes.
 */
export interface BindingContext<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
> {
  readonly contract: TContract;
  readonly collection: string;
  readonly storageHash: string;
}

/**
 * Construct a `CollectionHandle` from a validated contract + root name.
 * Used by `mongoQuery(...).from(name)` to enter the state machine.
 */
export function createCollectionHandle<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  RootName extends keyof TContract['roots'] & string,
>(
  contract: TContract,
  rootName: RootName,
): CollectionHandle<TContract, TContract['roots'][RootName] & string & keyof TContract['models']> {
  const c = contract as unknown as MongoContract;
  const modelName = c.roots[rootName];
  if (!modelName) {
    const validRoots = Object.keys(c.roots).join(', ');
    throw new Error(`Unknown root: "${rootName}". Valid roots: ${validRoots}`);
  }
  const model = c.models[modelName];
  if (!model) {
    throw new Error(`Unknown model: "${modelName}" referenced by root "${rootName}".`);
  }
  const collectionName = model.storage?.collection ?? rootName;
  if (!c.storage?.storageHash) {
    throw new Error(
      'Contract is missing storage.storageHash. Pass a validated contract to mongoQuery().',
    );
  }
  return new CollectionHandle(
    {
      contract,
      collection: collectionName,
      storageHash: String(c.storage.storageHash),
    },
    modelName as TContract['roots'][RootName] & string & keyof TContract['models'],
  );
}
