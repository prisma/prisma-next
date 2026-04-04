import type { ContractReferenceRelation, PlanMeta } from '@prisma-next/contract/types';
import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoModelDefinition,
  MongoTypeMaps,
  MongoValue,
} from '@prisma-next/mongo-core';
import { MongoParamRef } from '@prisma-next/mongo-core';
import type {
  AnyMongoCommand,
  MongoFilterExpr,
  MongoQueryPlan,
} from '@prisma-next/mongo-query-ast';
import {
  DeleteManyCommand,
  FindOneAndDeleteCommand,
  FindOneAndUpdateCommand,
  InsertManyCommand,
  InsertOneCommand,
  MongoAndExpr,
  MongoFieldFilter,
  UpdateManyCommand,
} from '@prisma-next/mongo-query-ast';
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
  /** Returns the input data with the server-assigned `_id`. Does not re-read the stored document. */
  create(
    data: CreateInput<TContract, ModelName>,
  ): Promise<IncludedRow<TContract, ModelName, TIncludes>>;
  /** Returns input rows with server-assigned `_id`s. Does not re-read stored documents. */
  createAll(
    data: ReadonlyArray<CreateInput<TContract, ModelName>>,
  ): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>>;
  createCount(data: ReadonlyArray<CreateInput<TContract, ModelName>>): Promise<number>;
  update(
    data: Partial<DefaultModelRow<TContract, ModelName>>,
  ): Promise<IncludedRow<TContract, ModelName, TIncludes> | null>;
  /** Non-atomic: captures matching `_id`s, updates, then re-reads by `_id`. */
  updateAll(
    data: Partial<DefaultModelRow<TContract, ModelName>>,
  ): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>>;
  updateCount(data: Partial<DefaultModelRow<TContract, ModelName>>): Promise<number>;
  delete(): Promise<IncludedRow<TContract, ModelName, TIncludes> | null>;
  /** Non-atomic: reads matching docs then deletes them. Concurrent writes may cause stale results. */
  deleteAll(): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>>;
  deleteCount(): Promise<number>;
  /**
   * On insert: `update` fields are applied via `$set`, remaining `create` fields via `$setOnInsert`.
   * This means `update` values take precedence over `create` for overlapping fields on insert.
   */
  upsert(input: {
    create: CreateInput<TContract, ModelName>;
    update: Partial<DefaultModelRow<TContract, ModelName>>;
  }): Promise<IncludedRow<TContract, ModelName, TIncludes>>;
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
    this.#rejectIncludes('create');
    const document = this.#toDocument(data as Record<string, unknown>);
    const command = new InsertOneCommand(this.#collectionName, document);
    const results = await this.#drainPlan(command);
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
    this.#rejectIncludes('createAll');
    const self = this;
    async function* gen(): AsyncGenerator<IncludedRow<TContract, ModelName, TIncludes>> {
      const documents = data.map((d) => self.#toDocument(d as Record<string, unknown>));
      const command = new InsertManyCommand(self.#collectionName, documents);
      const results = await self.#drainPlan(command);
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
    const results = await this.#drainPlan(command);
    return (results[0] as { insertedCount: number }).insertedCount;
  }

  async update(
    data: Partial<DefaultModelRow<TContract, ModelName>>,
  ): Promise<IncludedRow<TContract, ModelName, TIncludes> | null> {
    this.#requireFilters('update');
    this.#rejectWindowing('update');
    this.#rejectIncludes('update');
    const filter = this.#mergeFilters();
    const updateDoc = this.#toUpdateDocument(data as Record<string, unknown>);
    const command = new FindOneAndUpdateCommand(this.#collectionName, filter, updateDoc, false);
    const results = await this.#drainPlan(command);
    return (results[0] as IncludedRow<TContract, ModelName, TIncludes>) ?? null;
  }

  updateAll(
    data: Partial<DefaultModelRow<TContract, ModelName>>,
  ): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>> {
    this.#requireFilters('updateAll');
    this.#rejectWindowing('updateAll');
    const self = this;
    async function* gen(): AsyncGenerator<IncludedRow<TContract, ModelName, TIncludes>> {
      const ids = await self.#readMatchingIds();
      if (ids.length === 0) return;

      const filter = self.#mergeFilters();
      const updateDoc = self.#toUpdateDocument(data as Record<string, unknown>);
      const command = new UpdateManyCommand(self.#collectionName, filter, updateDoc);
      await self.#drainPlan(command);

      const idFilter = MongoFieldFilter.in(
        '_id',
        ids.map((id) => new MongoParamRef(id)),
      );
      yield* self.#clone({ filters: [idFilter] }).#execute();
    }
    return new AsyncIterableResult(gen());
  }

  async updateCount(data: Partial<DefaultModelRow<TContract, ModelName>>): Promise<number> {
    this.#requireFilters('updateCount');
    this.#rejectWindowing('updateCount');
    const filter = this.#mergeFilters();
    const updateDoc = this.#toUpdateDocument(data as Record<string, unknown>);
    const command = new UpdateManyCommand(this.#collectionName, filter, updateDoc);
    const results = await this.#drainPlan(command);
    return (results[0] as { modifiedCount: number }).modifiedCount;
  }

  async delete(): Promise<IncludedRow<TContract, ModelName, TIncludes> | null> {
    this.#requireFilters('delete');
    this.#rejectWindowing('delete');
    this.#rejectIncludes('delete');
    const filter = this.#mergeFilters();
    const command = new FindOneAndDeleteCommand(this.#collectionName, filter);
    const results = await this.#drainPlan(command);
    return (results[0] as IncludedRow<TContract, ModelName, TIncludes>) ?? null;
  }

  deleteAll(): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>> {
    this.#requireFilters('deleteAll');
    this.#rejectWindowing('deleteAll');
    const self = this;
    async function* gen(): AsyncGenerator<IncludedRow<TContract, ModelName, TIncludes>> {
      const docs: IncludedRow<TContract, ModelName, TIncludes>[] = [];
      for await (const row of self.#execute()) {
        docs.push(row);
      }
      const filter = self.#mergeFilters();
      const command = new DeleteManyCommand(self.#collectionName, filter);
      await self.#drainPlan(command);
      yield* docs;
    }
    return new AsyncIterableResult(gen());
  }

  async deleteCount(): Promise<number> {
    this.#requireFilters('deleteCount');
    this.#rejectWindowing('deleteCount');
    const filter = this.#mergeFilters();
    const command = new DeleteManyCommand(this.#collectionName, filter);
    const results = await this.#drainPlan(command);
    return (results[0] as { deletedCount: number }).deletedCount;
  }

  async upsert(input: {
    create: CreateInput<TContract, ModelName>;
    update: Partial<DefaultModelRow<TContract, ModelName>>;
  }): Promise<IncludedRow<TContract, ModelName, TIncludes>> {
    this.#requireFilters('upsert');
    this.#rejectWindowing('upsert');
    this.#rejectIncludes('upsert');
    const filter = this.#mergeFilters();
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
    const results = await this.#drainPlan(command);
    return results[0] as IncludedRow<TContract, ModelName, TIncludes>;
  }

  async #readMatchingIds(): Promise<unknown[]> {
    const idQuery = this.#clone({
      includes: [],
      selectedFields: ['_id'],
      orderBy: undefined,
      limit: undefined,
      offset: undefined,
    });
    const ids: unknown[] = [];
    for await (const row of idQuery.#execute()) {
      ids.push((row as Record<string, unknown>)['_id']);
    }
    return ids;
  }

  #execute(): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>> {
    const plan = this.#compile();
    return this.#executor.execute(plan);
  }

  #compile(): MongoQueryPlan<IncludedRow<TContract, ModelName, TIncludes>> {
    return compileMongoQuery<IncludedRow<TContract, ModelName, TIncludes>>(
      this.#collectionName,
      this.#state,
      this.#contract.storage.storageHash,
    );
  }

  #wrapCommand(command: AnyMongoCommand): MongoQueryPlan {
    return { collection: this.#collectionName, command, meta: this.#planMeta() };
  }

  async #drainPlan(command: AnyMongoCommand): Promise<unknown[]> {
    const plan = this.#wrapCommand(command);
    const result = this.#executor.execute(plan);
    const rows: unknown[] = [];
    for await (const row of result) {
      rows.push(row);
    }
    return rows;
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

  #mergeFilters(): MongoFilterExpr {
    const [single] = this.#state.filters;
    if (this.#state.filters.length === 1 && single) {
      return single;
    }
    return MongoAndExpr.of([...this.#state.filters]);
  }

  #requireFilters(methodName: string): void {
    if (this.#state.filters.length === 0) {
      throw new Error(
        `${methodName}() requires a .where() filter. Call .where() before .${methodName}()`,
      );
    }
  }

  #rejectWindowing(methodName: string): void {
    if (
      this.#state.orderBy !== undefined ||
      this.#state.limit !== undefined ||
      this.#state.offset !== undefined
    ) {
      throw new Error(
        `${methodName}() does not support orderBy/skip/take. Remove windowing before calling .${methodName}()`,
      );
    }
  }

  #rejectIncludes(methodName: string): void {
    if (this.#state.includes.length > 0) {
      throw new Error(
        `${methodName}() does not support .include(). Remove includes before calling .${methodName}()`,
      );
    }
  }

  #planMeta(): PlanMeta {
    return {
      target: 'mongo',
      storageHash: this.#contract.storage.storageHash,
      lane: 'mongo-orm',
      paramDescriptors: [],
    };
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
