import type { ContractReferenceRelation, PlanMeta } from '@prisma-next/contract/types';
import type {
  AnyMongoCommand,
  MongoContract,
  MongoContractWithTypeMaps,
  MongoModelDefinition,
  MongoTypeMaps,
  MongoValue,
} from '@prisma-next/mongo-core';
import {
  DeleteManyCommand,
  FindOneAndDeleteCommand,
  FindOneAndUpdateCommand,
  InsertManyCommand,
  InsertOneCommand,
  MongoParamRef,
  UpdateManyCommand,
} from '@prisma-next/mongo-core';
import type { MongoFilterExpr, MongoReadPlan } from '@prisma-next/mongo-query-ast';
import { lowerFilter, MongoAndExpr } from '@prisma-next/mongo-query-ast';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { MongoIncludeExpr } from './collection-state';
import { emptyCollectionState, type MongoCollectionState } from './collection-state';
import { compileMongoQuery } from './compile';
import type { MongoQueryExecutor } from './executor';
import type {
  CreateInput,
  DefaultModelRow,
  IncludedRow,
  MongoIncludeSpec,
  NoIncludes,
  ReferenceRelationKeys,
} from './types';

type ModelFieldKeys<
  TContract extends MongoContract,
  ModelName extends string & keyof TContract['models'],
> = keyof TContract['models'][ModelName]['fields'] & string;

export interface MongoCollection<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
  TIncludes extends MongoIncludeSpec<TContract, ModelName> = NoIncludes,
> {
  where(filter: MongoFilterExpr): MongoCollection<TContract, ModelName, TIncludes>;
  select(
    ...fields: ModelFieldKeys<TContract, ModelName>[]
  ): MongoCollection<TContract, ModelName, TIncludes>;
  include<K extends ReferenceRelationKeys<TContract, ModelName> & string>(
    relationName: K,
  ): MongoCollection<TContract, ModelName, TIncludes & Record<K, true>>;
  orderBy(
    spec: Partial<Record<ModelFieldKeys<TContract, ModelName>, 1 | -1>>,
  ): MongoCollection<TContract, ModelName, TIncludes>;
  take(n: number): MongoCollection<TContract, ModelName, TIncludes>;
  skip(n: number): MongoCollection<TContract, ModelName, TIncludes>;
  all(): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>>;
  first(): Promise<IncludedRow<TContract, ModelName, TIncludes> | null>;
}

function resolveCollectionName(model: MongoModelDefinition, modelName: string): string {
  return model.storage.collection ?? modelName;
}

class MongoCollectionImpl<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
  TIncludes extends MongoIncludeSpec<TContract, ModelName> = NoIncludes,
> implements MongoCollection<TContract, ModelName, TIncludes>
{
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
    }) as MongoCollectionImpl<TContract, ModelName, TIncludes & Record<K, true>>;
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

  async create(
    data: CreateInput<TContract, ModelName>,
  ): Promise<IncludedRow<TContract, ModelName, TIncludes>> {
    const document = this.#toDocument(data as Record<string, unknown>);
    const command = new InsertOneCommand(this.#collectionName, document);
    const results = await this.#executeCommand(command);
    const insertedId = (results[0] as { insertedId: unknown }).insertedId;
    return { _id: insertedId, ...(data as object) } as unknown as IncludedRow<
      TContract,
      ModelName,
      TIncludes
    >;
  }

  createAll(
    data: ReadonlyArray<CreateInput<TContract, ModelName>>,
  ): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>> {
    const self = this;
    async function* gen(): AsyncGenerator<IncludedRow<TContract, ModelName, TIncludes>> {
      const documents = data.map((d) => self.#toDocument(d as Record<string, unknown>));
      const command = new InsertManyCommand(self.#collectionName, documents);
      const results = await self.#executeCommand(command);
      const insertedIds = (results[0] as { insertedIds: readonly unknown[] }).insertedIds;
      for (let i = 0; i < data.length; i++) {
        yield { _id: insertedIds[i], ...(data[i] as object) } as unknown as IncludedRow<
          TContract,
          ModelName,
          TIncludes
        >;
      }
    }
    return new AsyncIterableResult(gen());
  }

  async createCount(data: ReadonlyArray<CreateInput<TContract, ModelName>>): Promise<number> {
    const documents = data.map((d) => this.#toDocument(d as Record<string, unknown>));
    const command = new InsertManyCommand(this.#collectionName, documents);
    const results = await this.#executeCommand(command);
    return (results[0] as { insertedCount: number }).insertedCount;
  }

  async update(
    data: Partial<DefaultModelRow<TContract, ModelName>>,
  ): Promise<IncludedRow<TContract, ModelName, TIncludes> | null> {
    this.#requireFilters('update');
    const filter = this.#compileFilter();
    const updateDoc = this.#toUpdateDocument(data as Record<string, unknown>);
    const command = new FindOneAndUpdateCommand(this.#collectionName, filter, updateDoc, false);
    const results = await this.#executeCommand(command);
    return (results[0] as IncludedRow<TContract, ModelName, TIncludes>) ?? null;
  }

  updateAll(
    data: Partial<DefaultModelRow<TContract, ModelName>>,
  ): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>> {
    this.#requireFilters('updateAll');
    const self = this;
    async function* gen(): AsyncGenerator<IncludedRow<TContract, ModelName, TIncludes>> {
      const filter = self.#compileFilter();
      const updateDoc = self.#toUpdateDocument(data as Record<string, unknown>);
      const command = new UpdateManyCommand(self.#collectionName, filter, updateDoc);
      await self.#executeCommand(command);
      const readResult = self.#execute();
      yield* readResult;
    }
    return new AsyncIterableResult(gen());
  }

  async updateCount(data: Partial<DefaultModelRow<TContract, ModelName>>): Promise<number> {
    this.#requireFilters('updateCount');
    const filter = this.#compileFilter();
    const updateDoc = this.#toUpdateDocument(data as Record<string, unknown>);
    const command = new UpdateManyCommand(this.#collectionName, filter, updateDoc);
    const results = await this.#executeCommand(command);
    return (results[0] as { modifiedCount: number }).modifiedCount;
  }

  async delete(): Promise<IncludedRow<TContract, ModelName, TIncludes> | null> {
    this.#requireFilters('delete');
    const filter = this.#compileFilter();
    const command = new FindOneAndDeleteCommand(this.#collectionName, filter);
    const results = await this.#executeCommand(command);
    return (results[0] as IncludedRow<TContract, ModelName, TIncludes>) ?? null;
  }

  deleteAll(): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>> {
    this.#requireFilters('deleteAll');
    const self = this;
    async function* gen(): AsyncGenerator<IncludedRow<TContract, ModelName, TIncludes>> {
      const docs: IncludedRow<TContract, ModelName, TIncludes>[] = [];
      for await (const row of self.#execute()) {
        docs.push(row);
      }
      const filter = self.#compileFilter();
      const command = new DeleteManyCommand(self.#collectionName, filter);
      await self.#executeCommand(command);
      yield* docs;
    }
    return new AsyncIterableResult(gen());
  }

  async deleteCount(): Promise<number> {
    this.#requireFilters('deleteCount');
    const filter = this.#compileFilter();
    const command = new DeleteManyCommand(this.#collectionName, filter);
    const results = await this.#executeCommand(command);
    return (results[0] as { deletedCount: number }).deletedCount;
  }

  async upsert(input: {
    create: CreateInput<TContract, ModelName>;
    update: Partial<DefaultModelRow<TContract, ModelName>>;
  }): Promise<IncludedRow<TContract, ModelName, TIncludes>> {
    const filter = this.state.filters.length > 0 ? this.#compileFilter() : {};
    const setFields = this.#toSetFields(input.update as Record<string, unknown>);
    const allCreateFields = this.#toDocument(input.create as Record<string, unknown>);
    const setKeys = new Set(Object.keys(setFields));
    const insertOnlyFields: Record<string, MongoValue> = {};
    for (const [key, value] of Object.entries(allCreateFields)) {
      if (!setKeys.has(key)) {
        insertOnlyFields[key] = value;
      }
    }
    const updateDoc: Record<string, MongoValue> = {};
    if (Object.keys(setFields).length > 0) {
      updateDoc['$set'] = setFields;
    }
    if (Object.keys(insertOnlyFields).length > 0) {
      updateDoc['$setOnInsert'] = insertOnlyFields;
    }
    const command = new FindOneAndUpdateCommand(this.#collectionName, filter, updateDoc, true);
    const results = await this.#executeCommand(command);
    return results[0] as IncludedRow<TContract, ModelName, TIncludes>;
  }

  #execute(): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>> {
    const plan = this.#compile();
    return this.#executor.execute(plan);
  }

  #compile(): MongoReadPlan<IncludedRow<TContract, ModelName, TIncludes>> {
    return compileMongoQuery<IncludedRow<TContract, ModelName, TIncludes>>(
      this.#collectionName,
      this.#state,
      this.#contract.storage.storageHash,
    );
  }

  #toDocument(data: Record<string, unknown>): Record<string, MongoValue> {
    const doc: Record<string, MongoValue> = {};
    for (const [key, value] of Object.entries(data)) {
      doc[key] = new MongoParamRef(value);
    }
    return doc;
  }

  #toSetFields(data: Record<string, unknown>): Record<string, MongoValue> {
    const fields: Record<string, MongoValue> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        fields[key] = new MongoParamRef(value);
      }
    }
    return fields;
  }

  #toUpdateDocument(data: Record<string, unknown>): Record<string, MongoValue> {
    return { $set: this.#toSetFields(data) };
  }

  #compileFilter(): Record<string, MongoValue> {
    const singleFilter = this.state.filters.length === 1 ? this.state.filters[0] : undefined;
    const filterExpr = singleFilter ?? MongoAndExpr.of([...this.state.filters]);
    return lowerFilter(filterExpr) as Record<string, MongoValue>;
  }

  #requireFilters(methodName: string): void {
    if (this.state.filters.length === 0) {
      throw new Error(
        `${methodName}() requires a .where() filter. Call .where() before .${methodName}()`,
      );
    }
  }

  #planMeta(): PlanMeta {
    return {
      target: 'mongo',
      storageHash: this.#contract.storageHash,
      lane: 'mongo-orm',
      paramDescriptors: [],
    };
  }

  async #executeCommand(command: AnyMongoCommand): Promise<unknown[]> {
    const result = this.#executor.executeCommand(command, this.#planMeta());
    const rows: unknown[] = [];
    for await (const row of result) {
      rows.push(row);
    }
    return rows;
  }

  #clone(
    overrides: Partial<MongoCollectionState>,
  ): MongoCollectionImpl<TContract, ModelName, TIncludes> {
    const instance = new MongoCollectionImpl<TContract, ModelName, TIncludes>(
      this.#contract,
      this.#modelName,
      this.#executor,
    );
    instance.#state = { ...this.#state, ...overrides };
    instance.#collectionName = this.#collectionName;
    return instance;
  }
}

export function createMongoCollection<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
>(
  contract: TContract,
  modelName: ModelName,
  executor: MongoQueryExecutor,
): MongoCollection<TContract, ModelName> {
  return new MongoCollectionImpl(contract, modelName, executor);
}
