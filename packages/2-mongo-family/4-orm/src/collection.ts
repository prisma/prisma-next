import type { ContractReferenceRelation } from '@prisma-next/contract/types';
import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoModelDefinition,
  MongoTypeMaps,
} from '@prisma-next/mongo-core';
import type { MongoFilterExpr, MongoReadPlan } from '@prisma-next/mongo-query-ast';
import type { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { MongoIncludeExpr } from './collection-state';
import { emptyCollectionState, type MongoCollectionState } from './collection-state';
import { compileMongoQuery } from './compile';
import type { MongoQueryExecutor } from './executor';

function resolveCollectionName(model: MongoModelDefinition, modelName: string): string {
  return model.storage.collection ?? modelName;
}

export interface MongoCollectionInit {
  readonly state?: MongoCollectionState;
  readonly collectionName?: string;
}

export class MongoCollection<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
> {
  readonly #contract: TContract;
  readonly #modelName: ModelName;
  readonly #executor: MongoQueryExecutor;
  readonly #collectionName: string;
  readonly state: MongoCollectionState;

  constructor(
    contract: TContract,
    modelName: ModelName,
    executor: MongoQueryExecutor,
    init: MongoCollectionInit = {},
  ) {
    this.#contract = contract;
    this.#modelName = modelName;
    this.#executor = executor;
    const model = contract.models[modelName] as MongoModelDefinition;
    this.#collectionName = init.collectionName ?? resolveCollectionName(model, modelName);
    this.state = init.state ?? emptyCollectionState();
  }

  where(filter: MongoFilterExpr): MongoCollection<TContract, ModelName> {
    return this.#clone({
      filters: [...this.state.filters, filter],
    });
  }

  select(...fields: string[]): MongoCollection<TContract, ModelName> {
    return this.#clone({ selectedFields: fields });
  }

  include(relationName: string): MongoCollection<TContract, ModelName> {
    const model = this.#contract.models[this.#modelName] as MongoModelDefinition;
    const relation = model.relations?.[relationName];
    if (!relation) {
      throw new Error(`Unknown relation "${relationName}" on model "${this.#modelName as string}"`);
    }

    if (!('on' in relation)) {
      throw new Error(
        `Relation "${relationName}" is an embed relation — only reference relations can be included`,
      );
    }

    const ref = relation as ContractReferenceRelation;
    if (ref.on.localFields.length !== 1 || ref.on.targetFields.length !== 1) {
      throw new Error(`Compound references are not yet supported: relation "${relationName}"`);
    }

    const targetModel = this.#contract.models[ref.to] as MongoModelDefinition | undefined;
    if (!targetModel) {
      throw new Error(`Target model "${ref.to}" not found for relation "${relationName}"`);
    }

    const includeExpr: MongoIncludeExpr = {
      relationName,
      from: resolveCollectionName(targetModel, ref.to),
      localField: ref.on.localFields[0]!,
      foreignField: ref.on.targetFields[0]!,
      cardinality: ref.cardinality,
    };

    return this.#clone({
      includes: [...this.state.includes, includeExpr],
    });
  }

  orderBy(spec: Record<string, 1 | -1>): MongoCollection<TContract, ModelName> {
    const merged = { ...this.state.orderBy, ...spec };
    return this.#clone({ orderBy: merged });
  }

  take(n: number): MongoCollection<TContract, ModelName> {
    return this.#clone({ limit: n });
  }

  skip(n: number): MongoCollection<TContract, ModelName> {
    return this.#clone({ offset: n });
  }

  all(): AsyncIterableResult<unknown> {
    return this.#execute();
  }

  async first(): Promise<unknown | null> {
    const limited = this.#clone({ limit: 1 });
    const result = limited.#execute();
    for await (const row of result) {
      return row;
    }
    return null;
  }

  #execute(): AsyncIterableResult<unknown> {
    const plan = this.#compile();
    return this.#executor.execute(plan);
  }

  #compile(): MongoReadPlan {
    return compileMongoQuery(this.#collectionName, this.state);
  }

  #clone(overrides: Partial<MongoCollectionState>): MongoCollection<TContract, ModelName> {
    return this.#createSelf({
      ...this.state,
      ...overrides,
    });
  }

  #createSelf(state: MongoCollectionState): MongoCollection<TContract, ModelName> {
    const Ctor = this.constructor as new (
      contract: TContract,
      modelName: ModelName,
      executor: MongoQueryExecutor,
      init: MongoCollectionInit,
    ) => MongoCollection<TContract, ModelName>;

    return new Ctor(this.#contract, this.#modelName, this.#executor, {
      state,
      collectionName: this.#collectionName,
    });
  }
}
