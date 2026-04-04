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
import type { IncludedRow, MongoIncludeSpec, NoIncludes, ReferenceRelationKeys } from './types';

type ModelFieldKeys<
  TContract extends MongoContract,
  ModelName extends string & keyof TContract['models'],
> = keyof TContract['models'][ModelName]['fields'] & string;

function resolveCollectionName(model: MongoModelDefinition, modelName: string): string {
  return model.storage.collection ?? modelName;
}

export class MongoCollection<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
  TIncludes extends MongoIncludeSpec<TContract, ModelName> = NoIncludes,
> {
  readonly #contract: TContract;
  readonly #modelName: ModelName;
  readonly #executor: MongoQueryExecutor;
  #collectionName: string;
  #state: MongoCollectionState;

  constructor(contract: TContract, modelName: ModelName, executor: MongoQueryExecutor) {
    this.#contract = contract;
    this.#modelName = modelName;
    this.#executor = executor;
    const model = contract.models[modelName] as MongoModelDefinition;
    this.#collectionName = resolveCollectionName(model, modelName);
    this.#state = emptyCollectionState();
  }

  where(filter: MongoFilterExpr): MongoCollection<TContract, ModelName, TIncludes> {
    return this.#clone({
      filters: [...this.#state.filters, filter],
    });
  }

  select(
    ...fields: ModelFieldKeys<TContract, ModelName>[]
  ): MongoCollection<TContract, ModelName, TIncludes> {
    return this.#clone({ selectedFields: [...(this.#state.selectedFields ?? []), ...fields] });
  }

  include<K extends ReferenceRelationKeys<TContract, ModelName> & string>(
    relationName: K,
  ): MongoCollection<TContract, ModelName, TIncludes & Record<K, true>> {
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
    const localField = ref.on.localFields[0];
    const foreignField = ref.on.targetFields[0];
    if (
      !localField ||
      !foreignField ||
      ref.on.localFields.length !== 1 ||
      ref.on.targetFields.length !== 1
    ) {
      throw new Error(`Compound references are not yet supported: relation "${relationName}"`);
    }

    const targetModel = this.#contract.models[ref.to] as MongoModelDefinition | undefined;
    if (!targetModel) {
      throw new Error(`Target model "${ref.to}" not found for relation "${relationName}"`);
    }

    const includeExpr: MongoIncludeExpr = {
      relationName,
      from: resolveCollectionName(targetModel, ref.to),
      localField,
      foreignField,
      cardinality: ref.cardinality,
    };

    return this.#clone({
      includes: [...this.#state.includes, includeExpr],
    }) as MongoCollection<TContract, ModelName, TIncludes & Record<K, true>>;
  }

  orderBy(
    spec: Partial<Record<ModelFieldKeys<TContract, ModelName>, 1 | -1>>,
  ): MongoCollection<TContract, ModelName, TIncludes> {
    const merged = { ...this.#state.orderBy, ...(spec as Readonly<Record<string, 1 | -1>>) };
    return this.#clone({ orderBy: merged });
  }

  take(n: number): MongoCollection<TContract, ModelName, TIncludes> {
    return this.#clone({ limit: n });
  }

  skip(n: number): MongoCollection<TContract, ModelName, TIncludes> {
    return this.#clone({ offset: n });
  }

  all(): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>> {
    return this.#execute();
  }

  async first(): Promise<IncludedRow<TContract, ModelName, TIncludes> | null> {
    const limited = this.#clone({ limit: 1 });
    const result = limited.#execute();
    for await (const row of result) {
      return row;
    }
    return null;
  }

  #execute(): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>> {
    const plan = this.#compile();
    return this.#executor.execute(plan);
  }

  #compile(): MongoReadPlan<IncludedRow<TContract, ModelName, TIncludes>> {
    return compileMongoQuery<IncludedRow<TContract, ModelName, TIncludes>>(
      this.#collectionName,
      this.#state,
      this.#contract.storageHash,
    );
  }

  #clone(
    overrides: Partial<MongoCollectionState>,
  ): MongoCollection<TContract, ModelName, TIncludes> {
    return this.#createSelf({
      ...this.#state,
      ...overrides,
    });
  }

  #createSelf(state: MongoCollectionState): MongoCollection<TContract, ModelName, TIncludes> {
    const Ctor = this.constructor as new (
      contract: TContract,
      modelName: ModelName,
      executor: MongoQueryExecutor,
    ) => MongoCollection<TContract, ModelName, TIncludes>;

    const instance = new Ctor(this.#contract, this.#modelName, this.#executor);
    instance.#state = state;
    instance.#collectionName = this.#collectionName;
    return instance;
  }
}
