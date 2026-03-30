import type { PlanMeta } from '@prisma-next/contract/types';
import {
  AggregateCommand,
  FindCommand,
  type MongoContract,
  type MongoContractWithTypeMaps,
  type MongoExpr,
  type MongoModelDefinition,
  type MongoQueryPlan,
  type MongoReferenceRelation,
  type MongoTypeMaps,
} from '@prisma-next/mongo-core';
import type { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type {
  MongoFindManyOptions,
  MongoIncludeSpec,
  MongoOrmClient,
  MongoOrmOptions,
  MongoQueryExecutor,
} from './types';

const stubMeta: PlanMeta = {
  target: 'mongo',
  storageHash: 'orm',
  lane: 'mongo-orm',
  paramDescriptors: [],
};

function resolveCollection(model: MongoModelDefinition, modelName: string): string {
  return model.storage.collection ?? modelName;
}

function buildLookupStages(
  contract: MongoContract,
  model: MongoModelDefinition,
  include: Record<string, true>,
): Record<string, unknown>[] {
  const stages: Record<string, unknown>[] = [];

  for (const [relName, shouldInclude] of Object.entries(include)) {
    if (!shouldInclude) continue;

    const relation = model.relations[relName];
    if (!relation || relation.strategy !== 'reference') continue;

    const refRelation = relation as MongoReferenceRelation;

    if (refRelation.on.localFields.length !== 1 || refRelation.on.targetFields.length !== 1) {
      throw new Error(
        `Compound references are not yet supported: relation "${relName}" has ${refRelation.on.localFields.length} local field(s) and ${refRelation.on.targetFields.length} target field(s)`,
      );
    }

    const targetModel = contract.models[refRelation.to];
    if (!targetModel) continue;

    const targetCollection = resolveCollection(targetModel, refRelation.to);

    stages.push({
      $lookup: {
        from: targetCollection,
        localField: refRelation.on.localFields[0],
        foreignField: refRelation.on.targetFields[0],
        as: relName,
      },
    });

    if (refRelation.cardinality === 'N:1' || refRelation.cardinality === '1:1') {
      stages.push({
        $unwind: {
          path: `$${relName}`,
          preserveNullAndEmptyArrays: true,
        },
      });
    }
  }

  return stages;
}

class MongoCollectionImpl<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
> {
  readonly #contract: TContract;
  readonly #modelName: ModelName;
  readonly #executor: MongoQueryExecutor;

  constructor(contract: TContract, modelName: ModelName, executor: MongoQueryExecutor) {
    this.#contract = contract;
    this.#modelName = modelName;
    this.#executor = executor;
  }

  findMany<TInclude extends MongoIncludeSpec<TContract, ModelName> = Record<string, never>>(
    options?: MongoFindManyOptions<TContract, ModelName, TInclude>,
  ): AsyncIterableResult<unknown> {
    const model = this.#contract.models[this.#modelName] as MongoModelDefinition;
    const collection = resolveCollection(model, this.#modelName as string);
    const filter = options?.where ? (options.where as unknown as MongoExpr) : undefined;
    const include = options?.include as Record<string, true> | undefined;

    const hasIncludes = include && Object.keys(include).length > 0;

    let plan: MongoQueryPlan;
    if (hasIncludes) {
      const pipeline: Record<string, unknown>[] = [];

      if (filter && Object.keys(filter as Record<string, unknown>).length > 0) {
        pipeline.push({ $match: filter });
      }

      pipeline.push(...buildLookupStages(this.#contract, model, include));

      plan = {
        command: new AggregateCommand(collection, pipeline),
        meta: stubMeta,
      };
    } else {
      plan = {
        command: new FindCommand(collection, filter),
        meta: stubMeta,
      };
    }

    return this.#executor.execute(plan);
  }
}

export function mongoOrm<TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>>(
  options: MongoOrmOptions<TContract>,
): MongoOrmClient<TContract> {
  const { contract, executor } = options;
  const client: Record<string, unknown> = {};

  for (const [rootName, modelName] of Object.entries(contract.roots)) {
    client[rootName] = new MongoCollectionImpl(
      contract,
      modelName as string & keyof TContract['models'],
      executor,
    );
  }

  return client as MongoOrmClient<TContract>;
}
