import type { PlanMeta } from '@prisma-next/contract/types';
import type {
  ExtractMongoCodecTypes,
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-contract';
import type { MongoFilterExpr, MongoQueryPlan, MongoReadStage } from '@prisma-next/mongo-query-ast';
import {
  AggregateCommand,
  MongoAddFieldsStage,
  MongoCountStage,
  MongoGroupStage,
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  MongoProjectStage,
  MongoReplaceRootStage,
  MongoSampleStage,
  MongoSkipStage,
  MongoSortByCountStage,
  MongoSortStage,
  MongoUnwindStage,
} from '@prisma-next/mongo-query-ast';
import { createFieldProxy } from './field-proxy';
import { createFilterProxy } from './filter-proxy';
import type { PipelineBuilderState } from './state';
import { cloneState } from './state';
import type {
  DocField,
  DocShape,
  ExtractDocShape,
  FieldProxy,
  FilterProxy,
  GroupedDocShape,
  GroupSpec,
  ProjectedShape,
  ResolveRow,
  SortSpec,
  TypedAggExpr,
  UnwoundShape,
} from './types';

export class PipelineBuilder<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  Shape extends DocShape,
> {
  readonly #contract: TContract;
  readonly #state: PipelineBuilderState;

  constructor(contract: TContract, state: PipelineBuilderState) {
    this.#contract = contract;
    this.#state = state;
  }

  #withStage<NewShape extends DocShape>(
    stage: MongoReadStage,
  ): PipelineBuilder<TContract, NewShape> {
    return new PipelineBuilder<TContract, NewShape>(
      this.#contract,
      cloneState(this.#state, { stages: [...this.#state.stages, stage] }),
    );
  }

  // --- Identity stages ---

  match(filter: MongoFilterExpr): PipelineBuilder<TContract, Shape>;
  match(fn: (fields: FilterProxy<Shape>) => MongoFilterExpr): PipelineBuilder<TContract, Shape>;
  match(
    filterOrFn: MongoFilterExpr | ((fields: FilterProxy<Shape>) => MongoFilterExpr),
  ): PipelineBuilder<TContract, Shape> {
    const filter =
      typeof filterOrFn === 'function' ? filterOrFn(createFilterProxy<Shape>()) : filterOrFn;
    return this.#withStage<Shape>(new MongoMatchStage(filter));
  }

  sort(spec: SortSpec<Shape>): PipelineBuilder<TContract, Shape> {
    return this.#withStage<Shape>(new MongoSortStage(spec as Record<string, 1 | -1>));
  }

  limit(n: number): PipelineBuilder<TContract, Shape> {
    return this.#withStage<Shape>(new MongoLimitStage(n));
  }

  skip(n: number): PipelineBuilder<TContract, Shape> {
    return this.#withStage<Shape>(new MongoSkipStage(n));
  }

  sample(n: number): PipelineBuilder<TContract, Shape> {
    return this.#withStage<Shape>(new MongoSampleStage(n));
  }

  // --- Additive stages ---

  addFields<NewFields extends Record<string, TypedAggExpr<DocField>>>(
    fn: (fields: FieldProxy<Shape>) => NewFields,
  ): PipelineBuilder<TContract, Shape & ExtractDocShape<NewFields>> {
    const proxy = createFieldProxy<Shape>();
    const newFields = fn(proxy);
    const exprRecord: Record<string, import('@prisma-next/mongo-query-ast').MongoAggExpr> = {};
    for (const [key, typed] of Object.entries(newFields)) {
      exprRecord[key] = typed.node;
    }
    return this.#withStage<Shape & ExtractDocShape<NewFields>>(new MongoAddFieldsStage(exprRecord));
  }

  lookup<ForeignRoot extends keyof TContract['roots'] & string, As extends string>(options: {
    from: ForeignRoot;
    localField: keyof Shape & string;
    foreignField: string;
    as: As;
  }): PipelineBuilder<
    TContract,
    Shape & Record<As, { readonly codecId: 'mongo/array@1'; readonly nullable: false }>
  > {
    const contract = this.#contract as MongoContract;
    const modelName = contract.roots[options.from];
    const model = modelName ? contract.models[modelName] : undefined;
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

  project<K extends keyof Shape & string>(
    ...keys: K[]
  ): PipelineBuilder<TContract, Pick<Shape, K | ('_id' extends keyof Shape ? '_id' : never)>>;
  project<Spec extends Record<string, 1 | TypedAggExpr<DocField>>>(
    fn: (fields: FieldProxy<Shape>) => Spec,
  ): PipelineBuilder<TContract, ProjectedShape<Shape, Spec>>;
  project(...args: unknown[]): PipelineBuilder<TContract, DocShape> {
    if (args.length === 1 && typeof args[0] === 'function') {
      const fn = args[0] as (
        fields: FieldProxy<Shape>,
      ) => Record<string, 1 | TypedAggExpr<DocField>>;
      const proxy = createFieldProxy<Shape>();
      const spec = fn(proxy);
      const projection: Record<
        string,
        import('@prisma-next/mongo-query-ast').MongoProjectionValue
      > = {};
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

  unwind<K extends keyof Shape & string>(
    field: K,
    options?: { preserveNullAndEmptyArrays?: boolean },
  ): PipelineBuilder<TContract, UnwoundShape<Shape, K>> {
    return this.#withStage<UnwoundShape<Shape, K>>(
      new MongoUnwindStage(`$${field}`, options?.preserveNullAndEmptyArrays ?? false),
    );
  }

  // --- Replacement stages ---

  group<Spec extends GroupSpec>(
    fn: (fields: FieldProxy<Shape>) => Spec,
  ): PipelineBuilder<TContract, GroupedDocShape<Spec>> {
    const proxy = createFieldProxy<Shape>();
    const spec = fn(proxy);
    const { _id: groupIdExpr, ...rest } = spec;
    const groupId = groupIdExpr === null ? null : groupIdExpr.node;
    const accumulators: Record<string, import('@prisma-next/mongo-query-ast').MongoAggAccumulator> =
      {};
    for (const [key, typed] of Object.entries(rest)) {
      if (typed === null) {
        throw new Error(`group() field "${key}" must not be null. Only _id can be null.`);
      }
      if (typed.node.kind !== 'accumulator') {
        throw new Error(
          `group() field "${key}" must use an accumulator (e.g. acc.sum(), acc.count()). Got "${typed.node.kind}" expression.`,
        );
      }
      accumulators[key] = typed.node as import('@prisma-next/mongo-query-ast').MongoAggAccumulator;
    }
    return this.#withStage<GroupedDocShape<Spec>>(new MongoGroupStage(groupId, accumulators));
  }

  replaceRoot<NewShape extends DocShape>(
    fn: (fields: FieldProxy<Shape>) => TypedAggExpr<DocField>,
  ): PipelineBuilder<TContract, NewShape> {
    const proxy = createFieldProxy<Shape>();
    const expr = fn(proxy);
    return this.#withStage<NewShape>(new MongoReplaceRootStage(expr.node));
  }

  count<Field extends string>(
    field: Field,
  ): PipelineBuilder<
    TContract,
    Record<Field, { readonly codecId: 'mongo/double@1'; readonly nullable: false }>
  > {
    return this.#withStage(new MongoCountStage(field));
  }

  sortByCount(fn: (fields: FieldProxy<Shape>) => TypedAggExpr<DocField>): PipelineBuilder<
    TContract,
    {
      _id: DocField;
      count: { readonly codecId: 'mongo/double@1'; readonly nullable: false };
    }
  > {
    const proxy = createFieldProxy<Shape>();
    const expr = fn(proxy);
    return this.#withStage(new MongoSortByCountStage(expr.node));
  }

  // --- Escape hatch ---

  pipe(stage: MongoReadStage): PipelineBuilder<TContract, Shape>;
  pipe<NewShape extends DocShape>(stage: MongoReadStage): PipelineBuilder<TContract, NewShape>;
  pipe<NewShape extends DocShape = Shape>(
    stage: MongoReadStage,
  ): PipelineBuilder<TContract, NewShape> {
    return this.#withStage<NewShape>(stage);
  }

  // --- Terminal ---

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
}
