import type {
  ContractField,
  ContractReferenceRelation,
  ContractValueObject,
  PlanMeta,
} from '@prisma-next/contract/types';
import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoModelDefinition,
  MongoTypeMaps,
} from '@prisma-next/mongo-contract';
import type {
  AnyMongoCommand,
  MongoFilterExpr,
  MongoQueryPlan,
} from '@prisma-next/mongo-query-ast/execution';
import {
  DeleteManyCommand,
  FindOneAndDeleteCommand,
  FindOneAndUpdateCommand,
  InsertManyCommand,
  InsertOneCommand,
  isMongoFilterExpr,
  MongoAndExpr,
  MongoFieldFilter,
  UpdateManyCommand,
} from '@prisma-next/mongo-query-ast/execution';
import type { MongoValue } from '@prisma-next/mongo-value';
import { MongoParamRef } from '@prisma-next/mongo-value';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { MongoIncludeExpr } from './collection-state';
import { emptyCollectionState, type MongoCollectionState } from './collection-state';
import { compileMongoQuery } from './compile';
import type { MongoQueryExecutor } from './executor';
import {
  compileFieldOperations,
  createFieldAccessor,
  type FieldAccessor,
  type FieldOperation,
} from './field-accessor';
import type {
  DefaultModelRow,
  IncludedRow,
  MongoIncludeSpec,
  MongoWhereFilter,
  NoIncludes,
  ReferenceRelationKeys,
  ResolvedCreateInput,
  VariantNames,
} from './types';

type ModelFieldKeys<
  TContract extends MongoContract,
  ModelName extends string & keyof TContract['models'],
> = keyof TContract['models'][ModelName]['fields'] & string;

export interface MongoCollection<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
  TIncludes extends MongoIncludeSpec<TContract, ModelName> = NoIncludes,
  TVariant extends string = never,
> {
  /** Narrows to a specific variant, injecting a discriminator filter. */
  variant<V extends VariantNames<TContract, ModelName>>(
    variantName: V,
  ): MongoCollection<TContract, ModelName, TIncludes, V>;
  /** Appends equality filters from a plain object. Values are encoded through codecs. */
  where(
    filter: MongoWhereFilter<TContract, ModelName>,
  ): MongoCollection<TContract, ModelName, TIncludes, TVariant>;
  /** Appends a filter condition from a raw filter expression. */
  where(filter: MongoFilterExpr): MongoCollection<TContract, ModelName, TIncludes, TVariant>;
  /** Restricts returned fields to the given subset. Returns a new immutable collection. */
  select(
    ...fields: ModelFieldKeys<TContract, ModelName>[]
  ): MongoCollection<TContract, ModelName, TIncludes, TVariant>;
  /** Adds a `$lookup` for a reference relation. Returns a new immutable collection. */
  include<K extends ReferenceRelationKeys<TContract, ModelName> & string>(
    relationName: K,
  ): MongoCollection<TContract, ModelName, TIncludes & Record<K, true>, TVariant>;
  /** Sets sort order. Returns a new immutable collection. */
  orderBy(
    spec: Partial<Record<ModelFieldKeys<TContract, ModelName>, 1 | -1>>,
  ): MongoCollection<TContract, ModelName, TIncludes, TVariant>;
  /** Limits the number of results. Returns a new immutable collection. */
  take(n: number): MongoCollection<TContract, ModelName, TIncludes, TVariant>;
  /** Skips the first `n` results. Returns a new immutable collection. */
  skip(n: number): MongoCollection<TContract, ModelName, TIncludes, TVariant>;
  /** Executes the query and returns all matching rows as an async iterable. */
  all(): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>>;
  /** Executes the query with limit 1. Returns the first matching row or `null`. */
  first(): Promise<IncludedRow<TContract, ModelName, TIncludes> | null>;
  /** Returns the input data with the server-assigned `_id`. Does not re-read the stored document. */
  create(
    data: ResolvedCreateInput<TContract, ModelName, TVariant>,
  ): Promise<IncludedRow<TContract, ModelName, TIncludes>>;
  /** Returns input rows with server-assigned `_id`s. Does not re-read stored documents. */
  createAll(
    data: ReadonlyArray<ResolvedCreateInput<TContract, ModelName, TVariant>>,
  ): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>>;
  /** Inserts multiple documents and returns the number inserted. */
  createCount(
    data: ReadonlyArray<ResolvedCreateInput<TContract, ModelName, TVariant>>,
  ): Promise<number>;
  /** Updates one matching document via `findOneAndUpdate`. Returns the updated document or `null`. Requires `.where()`. */
  update(
    data: Partial<DefaultModelRow<TContract, ModelName>>,
  ): Promise<IncludedRow<TContract, ModelName, TIncludes> | null>;
  /** Updates one matching document using field operations from a callback. Requires `.where()`. */
  update(
    callback: (u: FieldAccessor<TContract, ModelName>) => FieldOperation[],
  ): Promise<IncludedRow<TContract, ModelName, TIncludes> | null>;
  /** Non-atomic: captures matching `_id`s, updates, then re-reads by `_id`. Requires `.where()`. */
  updateAll(
    data: Partial<DefaultModelRow<TContract, ModelName>>,
  ): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>>;
  /** Updates all matching documents using field operations from a callback. Requires `.where()`. */
  updateAll(
    callback: (u: FieldAccessor<TContract, ModelName>) => FieldOperation[],
  ): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>>;
  /** Updates all matching documents and returns the number modified. Requires `.where()`. */
  updateCount(data: Partial<DefaultModelRow<TContract, ModelName>>): Promise<number>;
  /** Updates all matching documents using field operations and returns the number modified. Requires `.where()`. */
  updateCount(
    callback: (u: FieldAccessor<TContract, ModelName>) => FieldOperation[],
  ): Promise<number>;
  /** Deletes one matching document via `findOneAndDelete`. Returns the deleted document or `null`. Requires `.where()`. */
  delete(): Promise<IncludedRow<TContract, ModelName, TIncludes> | null>;
  /** Non-atomic: reads matching docs then deletes them. Concurrent writes may cause stale results. Requires `.where()`. */
  deleteAll(): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>>;
  /** Deletes all matching documents and returns the number deleted. Requires `.where()`. */
  deleteCount(): Promise<number>;
  /**
   * On insert: `update` fields are applied via `$set`, remaining `create` fields via `$setOnInsert`.
   * This means `update` values take precedence over `create` for overlapping fields on insert.
   * Requires `.where()`.
   */
  upsert(input: {
    create: ResolvedCreateInput<TContract, ModelName, TVariant>;
    update: Partial<DefaultModelRow<TContract, ModelName>>;
  }): Promise<IncludedRow<TContract, ModelName, TIncludes>>;
  /** Upsert using field operations callback for the update part. Requires `.where()`. */
  upsert(input: {
    create: ResolvedCreateInput<TContract, ModelName, TVariant>;
    update: (u: FieldAccessor<TContract, ModelName>) => FieldOperation[];
  }): Promise<IncludedRow<TContract, ModelName, TIncludes>>;
}

function resolveCollectionName(model: MongoModelDefinition, modelName: string): string {
  return model.storage.collection ?? modelName;
}

class MongoCollectionImpl<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
  TIncludes extends MongoIncludeSpec<TContract, ModelName> = NoIncludes,
  TVariant extends string = never,
> implements MongoCollection<TContract, ModelName, TIncludes, TVariant>
{
  readonly #contract: TContract;
  readonly #modelName: ModelName;
  readonly #executor: MongoQueryExecutor;
  #collectionName: string;
  #state: MongoCollectionState;
  #variantName: string | undefined;

  constructor(contract: TContract, modelName: ModelName, executor: MongoQueryExecutor) {
    this.#contract = contract;
    this.#modelName = modelName;
    this.#executor = executor;
    const model = contract.models[modelName] as MongoModelDefinition;
    this.#collectionName = resolveCollectionName(model, modelName);
    this.#state = emptyCollectionState();
  }

  variant<V extends VariantNames<TContract, ModelName>>(
    variantName: V,
  ): MongoCollection<TContract, ModelName, TIncludes, V> {
    const model = this.#contract.models[this.#modelName] as MongoModelDefinition | undefined;
    if (!model?.discriminator || !model.variants) {
      // No polymorphism metadata on this model — return unchanged. Cast required
      // because TS cannot verify TVariant (the current variant) is assignable to V.
      return this as unknown as MongoCollection<TContract, ModelName, TIncludes, V>;
    }

    const variantEntry = model.variants[variantName as string];
    if (!variantEntry) {
      // Unknown variant name at runtime — return unchanged. Same cast rationale.
      return this as unknown as MongoCollection<TContract, ModelName, TIncludes, V>;
    }

    const filter = MongoFieldFilter.eq(
      model.discriminator.field,
      new MongoParamRef(variantEntry.value),
    );
    return this.#cloneWithVariant<V>(
      { filters: [...this.#state.filters, filter] },
      variantName as string,
    );
  }

  where(
    filter: MongoWhereFilter<TContract, ModelName> | MongoFilterExpr,
  ): MongoCollection<TContract, ModelName, TIncludes, TVariant> {
    if (isMongoFilterExpr(filter)) {
      return this.#clone({ filters: [...this.#state.filters, filter] });
    }
    const compiled = this.#compileWhereObject(filter as Record<string, unknown>);
    return this.#clone({ filters: [...this.#state.filters, ...compiled] });
  }

  select(
    ...fields: ModelFieldKeys<TContract, ModelName>[]
  ): MongoCollection<TContract, ModelName, TIncludes, TVariant> {
    return this.#clone({ selectedFields: [...(this.#state.selectedFields ?? []), ...fields] });
  }

  include<K extends ReferenceRelationKeys<TContract, ModelName> & string>(
    relationName: K,
  ): MongoCollection<TContract, ModelName, TIncludes & Record<K, true>, TVariant> {
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
    }) as unknown as MongoCollectionImpl<
      TContract,
      ModelName,
      TIncludes & Record<K, true>,
      TVariant
    >;
  }

  orderBy(
    spec: Partial<Record<ModelFieldKeys<TContract, ModelName>, 1 | -1>>,
  ): MongoCollection<TContract, ModelName, TIncludes, TVariant> {
    const merged = { ...this.#state.orderBy, ...(spec as Readonly<Record<string, 1 | -1>>) };
    return this.#clone({ orderBy: merged });
  }

  take(n: number): MongoCollection<TContract, ModelName, TIncludes, TVariant> {
    return this.#clone({ limit: n });
  }

  skip(n: number): MongoCollection<TContract, ModelName, TIncludes, TVariant> {
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
    data: ResolvedCreateInput<TContract, ModelName, TVariant>,
  ): Promise<IncludedRow<TContract, ModelName, TIncludes>> {
    this.#rejectIncludes('create');
    const normalized = this.#injectDiscriminator(
      this.#stripUndefined(data as Record<string, unknown>),
    );
    const document = this.#toDocument(normalized);
    const command = new InsertOneCommand(this.#collectionName, document);
    const results = await this.#drainPlan(command);
    const insertedId = (results[0] as { insertedId: unknown }).insertedId;
    return { _id: insertedId, ...normalized } as unknown as IncludedRow<
      TContract,
      ModelName,
      TIncludes
    >;
  }

  createAll(
    data: ReadonlyArray<ResolvedCreateInput<TContract, ModelName, TVariant>>,
  ): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>> {
    this.#rejectIncludes('createAll');
    const self = this;
    async function* gen(): AsyncGenerator<IncludedRow<TContract, ModelName, TIncludes>> {
      const normalizedRows = data.map((d) =>
        self.#injectDiscriminator(self.#stripUndefined(d as Record<string, unknown>)),
      );
      const documents = normalizedRows.map((d) => self.#toDocument(d));
      const command = new InsertManyCommand(self.#collectionName, documents);
      const results = await self.#drainPlan(command);
      const insertedIds = (results[0] as { insertedIds: readonly unknown[] }).insertedIds;
      for (let i = 0; i < normalizedRows.length; i++) {
        yield { _id: insertedIds[i], ...normalizedRows[i] } as unknown as IncludedRow<
          TContract,
          ModelName,
          TIncludes
        >;
      }
    }
    return new AsyncIterableResult(gen());
  }

  async createCount(
    data: ReadonlyArray<ResolvedCreateInput<TContract, ModelName, TVariant>>,
  ): Promise<number> {
    this.#rejectIncludes('createCount');
    const documents = data.map((d) =>
      this.#toDocument(this.#injectDiscriminator(d as Record<string, unknown>)),
    );
    const command = new InsertManyCommand(this.#collectionName, documents);
    const results = await this.#drainPlan(command);
    return (results[0] as { insertedCount: number }).insertedCount;
  }

  async update(
    dataOrCallback:
      | Partial<DefaultModelRow<TContract, ModelName>>
      | ((u: FieldAccessor<TContract, ModelName>) => FieldOperation[]),
  ): Promise<IncludedRow<TContract, ModelName, TIncludes> | null> {
    this.#requireFilters('update');
    this.#rejectWindowing('update');
    this.#rejectIncludes('update');
    const filter = this.#mergeFilters();
    const updateDoc = this.#resolveUpdateDoc(dataOrCallback);
    const command = new FindOneAndUpdateCommand(this.#collectionName, filter, updateDoc, false);
    const results = await this.#drainPlan(command);
    return (results[0] as IncludedRow<TContract, ModelName, TIncludes>) ?? null;
  }

  updateAll(
    dataOrCallback:
      | Partial<DefaultModelRow<TContract, ModelName>>
      | ((u: FieldAccessor<TContract, ModelName>) => FieldOperation[]),
  ): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>> {
    this.#requireFilters('updateAll');
    this.#rejectWindowing('updateAll');
    const self = this;
    async function* gen(): AsyncGenerator<IncludedRow<TContract, ModelName, TIncludes>> {
      const ids = await self.#readMatchingIds();
      if (ids.length === 0) return;

      const filter = self.#mergeFilters();
      const updateDoc = self.#resolveUpdateDoc(dataOrCallback);
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

  async updateCount(
    dataOrCallback:
      | Partial<DefaultModelRow<TContract, ModelName>>
      | ((u: FieldAccessor<TContract, ModelName>) => FieldOperation[]),
  ): Promise<number> {
    this.#requireFilters('updateCount');
    this.#rejectWindowing('updateCount');
    this.#rejectIncludes('updateCount');
    const filter = this.#mergeFilters();
    const updateDoc = this.#resolveUpdateDoc(dataOrCallback);
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
    this.#rejectIncludes('deleteCount');
    const filter = this.#mergeFilters();
    const command = new DeleteManyCommand(this.#collectionName, filter);
    const results = await this.#drainPlan(command);
    return (results[0] as { deletedCount: number }).deletedCount;
  }

  async upsert(input: {
    create: ResolvedCreateInput<TContract, ModelName, TVariant>;
    update:
      | Partial<DefaultModelRow<TContract, ModelName>>
      | ((u: FieldAccessor<TContract, ModelName>) => FieldOperation[]);
  }): Promise<IncludedRow<TContract, ModelName, TIncludes>> {
    this.#requireFilters('upsert');
    this.#rejectWindowing('upsert');
    this.#rejectIncludes('upsert');
    const filter = this.#mergeFilters();

    const allCreateFields = this.#toDocument(
      this.#injectDiscriminator(input.create as Record<string, unknown>),
    );

    let updateDoc: Record<string, Record<string, MongoValue>>;
    if (typeof input.update === 'function') {
      const accessor = createFieldAccessor<TContract, ModelName>();
      const ops = input.update(accessor);
      const idOp = ops.find((op) => op.field === '_id');
      if (idOp) {
        throw new Error('Mutation payloads cannot modify `_id`');
      }
      const dotPathOp = ops.find((op) => op.field.includes('.'));
      if (dotPathOp) {
        throw new Error(
          `upsert() does not support dot-path field operations (found "${dotPathOp.field}"). ` +
            'Dot-path updates conflict with $setOnInsert on the insert path, producing incomplete documents. ' +
            'Use top-level field operations instead.',
        );
      }
      updateDoc = compileFieldOperations(ops, (field, value, operator) =>
        this.#wrapFieldOpValue(field, value, operator),
      );
    } else {
      const setFields = this.#toSetFields(input.update as Record<string, unknown>);
      updateDoc = {};
      if (Object.keys(setFields).length > 0) {
        updateDoc['$set'] = setFields;
      }
    }

    const updatedFields = new Set<string>();
    for (const operatorGroup of Object.values(updateDoc)) {
      for (const fieldPath of Object.keys(operatorGroup)) {
        updatedFields.add(fieldPath.split('.')[0] ?? fieldPath);
      }
    }
    const insertOnlyFields: Record<string, MongoValue> = {};
    for (const [key, value] of Object.entries(allCreateFields)) {
      if (!updatedFields.has(key)) {
        insertOnlyFields[key] = value;
      }
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

  #modelFields(): Record<string, ContractField> {
    const model = this.#contract.models[this.#modelName] as MongoModelDefinition | undefined;
    return model?.fields ?? {};
  }

  #compileWhereObject(data: Record<string, unknown>): MongoFilterExpr[] {
    const fields = this.#modelFields();
    const filters: MongoFilterExpr[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      const wrapped = this.#wrapFieldValue(value, fields[key]);
      filters.push(MongoFieldFilter.eq(key, wrapped));
    }
    return filters;
  }

  #wrapFieldValue(value: unknown, field: ContractField | undefined): MongoValue {
    if (field === undefined) return new MongoParamRef(value);

    if (field.type.kind === 'scalar') {
      return new MongoParamRef(value, { codecId: field.type.codecId });
    }

    if (field.type.kind === 'valueObject') {
      const voName = field.type.name;
      const voDef = (this.#contract as { valueObjects?: Record<string, ContractValueObject> })
        .valueObjects?.[voName];
      if (!voDef || value === null) return new MongoParamRef(value);

      if (field.many && Array.isArray(value)) {
        return value.map((item) =>
          this.#wrapValueObject(item as Record<string, unknown>, voDef),
        ) as unknown as MongoValue;
      }
      return this.#wrapValueObject(value as Record<string, unknown>, voDef);
    }

    return new MongoParamRef(value);
  }

  #wrapValueObject(
    data: Record<string, unknown>,
    voDef: ContractValueObject,
  ): Record<string, MongoValue> {
    const doc: Record<string, MongoValue> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      const fieldDef = voDef.fields[key];
      doc[key] = this.#wrapFieldValue(value, fieldDef);
    }
    return doc;
  }

  #toDocument(data: Record<string, unknown>): Record<string, MongoValue> {
    const fields = this.#modelFields();
    const doc: Record<string, MongoValue> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        doc[key] = this.#wrapFieldValue(value, fields[key]);
      }
    }
    return doc;
  }

  #toSetFields(data: Record<string, unknown>): Record<string, MongoValue> {
    const fields = this.#modelFields();
    const result: Record<string, MongoValue> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === '_id' && value !== undefined) {
        throw new Error('Mutation payloads cannot modify `_id`');
      }
      if (value !== undefined) {
        result[key] = this.#wrapFieldValue(value, fields[key]);
      }
    }
    return result;
  }

  #stripUndefined(data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  #toUpdateDocument(data: Record<string, unknown>): Record<string, Record<string, MongoValue>> {
    return { $set: this.#toSetFields(data) };
  }

  #resolveUpdateDoc(
    dataOrCallback:
      | Partial<DefaultModelRow<TContract, ModelName>>
      | ((u: FieldAccessor<TContract, ModelName>) => FieldOperation[]),
  ): Record<string, Record<string, MongoValue>> {
    if (typeof dataOrCallback === 'function') {
      const accessor = createFieldAccessor<TContract, ModelName>();
      const ops = dataOrCallback(accessor);
      const idOp = ops.find((op) => op.field === '_id');
      if (idOp) {
        throw new Error('Mutation payloads cannot modify `_id`');
      }
      if (ops.length === 0) {
        return { $set: {} };
      }
      return compileFieldOperations(ops, (field, value, operator) =>
        this.#wrapFieldOpValue(field, value, operator),
      );
    }
    return this.#toUpdateDocument(dataOrCallback as Record<string, unknown>);
  }

  #wrapFieldOpValue(field: string, value: MongoValue, operator?: string): MongoValue {
    if (operator === '$unset') return value;

    const topLevelField = field.split('.')[0] ?? field;
    const fields = this.#modelFields();
    const contractField = fields[topLevelField];
    if (!contractField) return value;

    if (field.includes('.')) {
      return this.#wrapDotPathValue(field, value);
    }

    if (value instanceof MongoParamRef && contractField.type.kind === 'scalar') {
      return new MongoParamRef(value.value, { codecId: contractField.type.codecId });
    }

    if (contractField.type.kind === 'valueObject' && value instanceof MongoParamRef) {
      const raw = value.value;
      if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        const voName = contractField.type.name;
        const voDef = (this.#contract as { valueObjects?: Record<string, ContractValueObject> })
          .valueObjects?.[voName];
        if (voDef) {
          return this.#wrapValueObject(raw as Record<string, unknown>, voDef);
        }
      }
    }

    return value;
  }

  #wrapDotPathValue(dotPath: string, value: MongoValue): MongoValue {
    const parts = dotPath.split('.');
    const fields = this.#modelFields();
    let currentField: ContractField | undefined = parts[0] ? fields[parts[0]] : undefined;

    for (let i = 1; i < parts.length; i++) {
      if (!currentField || currentField.type.kind !== 'valueObject') return value;
      const voName = currentField.type.name;
      const voDef = (this.#contract as { valueObjects?: Record<string, ContractValueObject> })
        .valueObjects?.[voName];
      if (!voDef) return value;
      const partKey = parts[i];
      currentField = partKey ? voDef.fields[partKey] : undefined;
    }

    if (currentField?.type.kind === 'scalar' && value instanceof MongoParamRef) {
      return new MongoParamRef(value.value, { codecId: currentField.type.codecId });
    }

    if (currentField?.type.kind === 'valueObject' && value instanceof MongoParamRef) {
      const raw = value.value;
      if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        const voName = currentField.type.name;
        const voDef = (this.#contract as { valueObjects?: Record<string, ContractValueObject> })
          .valueObjects?.[voName];
        if (voDef) {
          return this.#wrapValueObject(raw as Record<string, unknown>, voDef);
        }
      }
    }

    return value;
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

  #injectDiscriminator(data: Record<string, unknown>): Record<string, unknown> {
    if (!this.#variantName) return data;
    const model = this.#contract.models[this.#modelName] as MongoModelDefinition | undefined;
    if (!model?.discriminator || !model.variants) return data;
    const variantEntry = model.variants[this.#variantName];
    if (!variantEntry) return data;
    return { ...data, [model.discriminator.field]: variantEntry.value };
  }

  #clone(
    overrides: Partial<MongoCollectionState>,
  ): MongoCollectionImpl<TContract, ModelName, TIncludes, TVariant> {
    const instance = new MongoCollectionImpl<TContract, ModelName, TIncludes, TVariant>(
      this.#contract,
      this.#modelName,
      this.#executor,
    );
    instance.#state = { ...this.#state, ...overrides };
    instance.#collectionName = this.#collectionName;
    instance.#variantName = this.#variantName;
    return instance;
  }

  #cloneWithVariant<VNew extends string>(
    overrides: Partial<MongoCollectionState>,
    variantName: string,
  ): MongoCollectionImpl<TContract, ModelName, TIncludes, VNew> {
    const instance = new MongoCollectionImpl<TContract, ModelName, TIncludes, VNew>(
      this.#contract,
      this.#modelName,
      this.#executor,
    );
    instance.#state = { ...this.#state, ...overrides };
    instance.#collectionName = this.#collectionName;
    instance.#variantName = variantName;
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
