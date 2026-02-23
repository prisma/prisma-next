import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { Collection } from './collection';
import type {
  CollectionContext,
  CollectionModelName,
  CollectionTypeState,
  DefaultModelRow,
  RuntimeQueryable,
} from './types';

export interface OrmOptions<
  TContract extends SqlContract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
> {
  readonly contract: TContract;
  readonly runtime: RuntimeQueryable;
  readonly collections?: Collections;
}

type ModelNames<TContract extends SqlContract<SqlStorage>> = CollectionModelName<TContract>;

type AnyCollectionClass = new (...args: never[]) => object;

type LowercaseFirst<Name extends string> = Name extends `${infer Head}${infer Tail}`
  ? `${Lowercase<Head>}${Tail}`
  : Name;

type ModelAliasKeys<Name extends string> = Name | LowercaseFirst<Name> | `${LowercaseFirst<Name>}s`;

type CustomCollectionForKey<
  Collections extends Partial<Record<string, AnyCollectionClass>>,
  Key extends string,
> = Key extends keyof Collections
  ? Collections[Key] extends AnyCollectionClass
    ? InstanceType<Collections[Key]>
    : never
  : never;

type CustomCollectionForModel<
  TContract extends SqlContract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
  ModelName extends ModelNames<TContract>,
> =
  | CustomCollectionForKey<Collections, ModelName>
  | CustomCollectionForKey<Collections, LowercaseFirst<ModelName>>
  | CustomCollectionForKey<Collections, `${LowercaseFirst<ModelName>}s`>;

type ModelCollection<
  TContract extends SqlContract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
  ModelName extends ModelNames<TContract>,
> = [CustomCollectionForModel<TContract, Collections, ModelName>] extends [never]
  ? Collection<TContract, ModelName, DefaultModelRow<TContract, ModelName>>
  : CustomCollectionForModel<TContract, Collections, ModelName>;

type ModelCollectionMap<
  TContract extends SqlContract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
> = {
  [K in ModelNames<TContract> as ModelAliasKeys<K>]: ModelCollection<TContract, Collections, K>;
};

type OrmClient<
  TContract extends SqlContract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
> = ModelCollectionMap<TContract, Collections>;

export function orm<
  TContract extends SqlContract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>> = Record<never, never>,
>(options: OrmOptions<TContract, Collections>): OrmClient<TContract, Collections> {
  const { contract, runtime, collections } = options;
  const ctx: CollectionContext<TContract> = { contract, runtime };
  const modelAliases = createModelAliases(contract);
  const collectionRegistry = createCollectionRegistry(contract, collections, modelAliases);
  const cache = new Map<
    ModelNames<TContract>,
    Collection<TContract, string, unknown, CollectionTypeState>
  >();

  return new Proxy({} as OrmClient<TContract, Collections>, {
    get(_target, prop: string | symbol): unknown {
      if (typeof prop !== 'string') {
        return undefined;
      }

      const modelName = resolveModelName(prop, modelAliases);
      if (!modelName) {
        throw new Error(
          `No model found for '${prop}'. Available models: ${Object.keys(contract.models as Record<string, unknown>).join(', ')}`,
        );
      }

      const cached = cache.get(modelName);
      if (cached) {
        return cached;
      }

      const CollectionClass =
        collectionRegistry.get(modelName as ModelNames<TContract>) ??
        (Collection as unknown as AnyCollectionClass);
      const CollectionCtor = CollectionClass as unknown as new (
        ctx: CollectionContext<TContract>,
        modelName: string,
        options?: Record<string, unknown>,
      ) => Collection<TContract, string, unknown, CollectionTypeState>;
      const collection = new CollectionCtor(ctx, modelName, {
        registry: collectionRegistry,
      }) as ModelCollection<TContract, Collections, ModelNames<TContract>>;
      cache.set(
        modelName as ModelNames<TContract>,
        collection as unknown as Collection<TContract, string, unknown, CollectionTypeState>,
      );
      return collection;
    },
  });
}

function createModelAliases<TContract extends SqlContract<SqlStorage>>(
  contract: TContract,
): Map<string, ModelNames<TContract>> {
  const aliases = new Map<string, ModelNames<TContract>>();
  const modelNames = Object.keys(
    contract.models as Record<string, unknown>,
  ) as ModelNames<TContract>[];
  const modelToTable = contract.mappings.modelToTable ?? {};

  for (const modelName of modelNames) {
    const lowerModel = lowercaseFirst(modelName);

    aliases.set(modelName, modelName);
    aliases.set(lowerModel, modelName);
    aliases.set(`${lowerModel}s`, modelName);

    const tableName = modelToTable[modelName];
    if (tableName) {
      aliases.set(tableName, modelName);
      if (!tableName.endsWith('s')) {
        aliases.set(`${tableName}s`, modelName);
      }
    }
  }

  return aliases;
}

function createCollectionRegistry<
  TContract extends SqlContract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
>(
  contract: TContract,
  collections: Collections | undefined,
  aliases: Map<string, ModelNames<TContract>>,
): Map<ModelNames<TContract>, AnyCollectionClass> {
  const registry = new Map<ModelNames<TContract>, AnyCollectionClass>();
  if (!collections) {
    return registry;
  }

  for (const [key, collectionClass] of Object.entries(collections)) {
    if (!collectionClass) {
      continue;
    }
    if (!isCollectionClass(collectionClass)) {
      throw new Error(
        `Custom collection '${key}' must be a Collection class (constructor), not an instance`,
      );
    }
    const modelName = resolveModelName(key, aliases);
    if (!modelName) {
      throw new Error(
        `No model found for custom collection '${key}'. Available models: ${Object.keys(contract.models as Record<string, unknown>).join(', ')}`,
      );
    }
    registry.set(modelName, collectionClass as AnyCollectionClass);
  }

  return registry;
}

function isCollectionClass(value: unknown): value is AnyCollectionClass {
  if (typeof value !== 'function') {
    return false;
  }
  const candidate = value as { prototype?: unknown };
  if (!candidate.prototype || typeof candidate.prototype !== 'object') {
    return false;
  }
  return candidate.prototype instanceof Collection;
}

function resolveModelName<ModelName extends string>(
  key: string,
  aliases: Map<string, ModelName>,
): ModelName | undefined {
  const exact = aliases.get(key);
  if (exact) {
    return exact;
  }

  if (key.endsWith('s')) {
    return aliases.get(key.slice(0, -1));
  }

  return undefined;
}

function lowercaseFirst(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return value.charAt(0).toLowerCase() + value.slice(1);
}
