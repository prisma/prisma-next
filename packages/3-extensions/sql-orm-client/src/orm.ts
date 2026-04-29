import type { Contract } from '@prisma-next/contract/types';
import {
  type AnnotationRegistry,
  createAnnotationRegistry,
} from '@prisma-next/framework-components/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { Collection } from './collection';
import type {
  CollectionContext,
  CollectionModelName,
  CollectionTypeState,
  InferRootRow,
  RuntimeQueryable,
} from './types';

export interface OrmOptions<
  TContract extends Contract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
> {
  readonly runtime: RuntimeQueryable;
  readonly collections?: Collections;
  readonly context: ExecutionContext<TContract>;
  /**
   * Registry of middleware-contributed annotation handles that
   * `Collection` terminals consume via the `.annotate(callback)` API.
   * Defaults to an empty registry when omitted; pass the registry
   * assembled by the family runtime (`postgres()` builds it from
   * `options.middleware`) to surface runtime-known annotations to
   * authoring sites.
   */
  readonly annotationRegistry?: AnnotationRegistry;
}

type ModelNames<TContract extends Contract<SqlStorage>> = CollectionModelName<TContract>;

type AnyCollectionClass = new (...args: never[]) => object;

type CustomCollectionForKey<
  Collections extends Partial<Record<string, AnyCollectionClass>>,
  Key extends string,
> = Key extends keyof Collections
  ? Collections[Key] extends AnyCollectionClass
    ? InstanceType<Collections[Key]>
    : never
  : never;

type ModelCollection<
  TContract extends Contract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
  ModelName extends ModelNames<TContract>,
  Registry,
> = [CustomCollectionForKey<Collections, ModelName>] extends [never]
  ? Collection<
      TContract,
      ModelName,
      InferRootRow<TContract, ModelName>,
      CollectionTypeState,
      Registry
    >
  : CustomCollectionForKey<Collections, ModelName>;

type ModelCollectionMap<
  TContract extends Contract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
  Registry,
> = {
  [K in ModelNames<TContract>]: ModelCollection<TContract, Collections, K, Registry>;
};

type OrmClient<
  TContract extends Contract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
  Registry,
> = ModelCollectionMap<TContract, Collections, Registry>;

export function orm<
  TContract extends Contract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>> = Record<never, never>,
  Registry = {},
>(options: OrmOptions<TContract, Collections>): OrmClient<TContract, Collections, Registry> {
  const { runtime, collections, context } = options;
  const contract = context.contract;
  const ctx: CollectionContext<TContract> = {
    runtime,
    context,
    annotationRegistry: options.annotationRegistry ?? createAnnotationRegistry(),
  };
  const modelNames = new Set(Object.keys(contract.models));
  const collectionRegistry = createCollectionRegistry(contract, collections);
  const cache = new Map<
    ModelNames<TContract>,
    Collection<TContract, string, unknown, CollectionTypeState>
  >();

  return new Proxy({} as OrmClient<TContract, Collections, Registry>, {
    get(_target, prop: string | symbol): unknown {
      if (typeof prop !== 'string') {
        return undefined;
      }

      if (!modelNames.has(prop)) {
        throw new Error(
          `No model found for '${prop}'. Available models: ${[...modelNames].join(', ')}`,
        );
      }

      const modelName = prop as ModelNames<TContract>;

      const cached = cache.get(modelName);
      if (cached) {
        return cached;
      }

      const CollectionClass =
        collectionRegistry.get(modelName) ?? (Collection as unknown as AnyCollectionClass);
      const CollectionCtor = CollectionClass as unknown as new (
        ctx: CollectionContext<TContract>,
        modelName: string,
        options?: Record<string, unknown>,
      ) => Collection<TContract, string, unknown, CollectionTypeState>;
      const collection = new CollectionCtor(ctx, modelName, {
        registry: collectionRegistry,
      }) as ModelCollection<TContract, Collections, ModelNames<TContract>, Registry>;
      cache.set(
        modelName,
        collection as unknown as Collection<TContract, string, unknown, CollectionTypeState>,
      );
      return collection;
    },
  });
}

function createCollectionRegistry<
  TContract extends Contract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
>(
  contract: TContract,
  collections: Collections | undefined,
): Map<ModelNames<TContract>, AnyCollectionClass> {
  const registry = new Map<ModelNames<TContract>, AnyCollectionClass>();
  if (!collections) {
    return registry;
  }

  const models = contract.models;
  for (const [key, collectionClass] of Object.entries(collections)) {
    if (!collectionClass) {
      continue;
    }
    if (!isCollectionClass(collectionClass)) {
      throw new Error(
        `Custom collection '${key}' must be a Collection class (constructor), not an instance`,
      );
    }
    if (!Object.hasOwn(models, key)) {
      throw new Error(
        `No model found for custom collection '${key}'. Available models: ${Object.keys(models).join(', ')}`,
      );
    }
    registry.set(key as ModelNames<TContract>, collectionClass as AnyCollectionClass);
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
