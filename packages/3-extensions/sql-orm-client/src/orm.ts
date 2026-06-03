import { type Contract, domainModelsAtDefaultNamespace } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { blindCast } from '@prisma-next/utils/casts';
import { Collection } from './collection';
import {
  domainModelNames,
  domainModelNamesInNamespace,
  domainModelTableInNamespace,
} from './storage-resolution';
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
> = [CustomCollectionForKey<Collections, ModelName>] extends [never]
  ? Collection<TContract, ModelName, InferRootRow<TContract, ModelName>>
  : CustomCollectionForKey<Collections, ModelName>;

type ModelCollectionMap<
  TContract extends Contract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
> = {
  [K in ModelNames<TContract>]: ModelCollection<TContract, Collections, K>;
};

type NamespaceModelNames<
  TContract extends Contract<SqlStorage>,
  NsId extends keyof TContract['domain']['namespaces'],
> = keyof TContract['domain']['namespaces'][NsId]['models'] & string & ModelNames<TContract>;

// The model collections of a single domain namespace, keyed by bare model
// name. Lets callers reach a model by its namespace coordinate
// (`orm.<ns>.<Model>`) when the same bare name is declared in more than one
// namespace.
export type OrmNamespace<
  TContract extends Contract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
  NsId extends keyof TContract['domain']['namespaces'],
> = {
  [K in NamespaceModelNames<TContract, NsId>]: ModelCollection<TContract, Collections, K>;
};

type NamespacedClientMap<
  TContract extends Contract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
> = {
  [Ns in keyof TContract['domain']['namespaces']]: OrmNamespace<TContract, Collections, Ns>;
};

// Additive intersection: the flat by-bare-name surface retained alongside a
// per-namespace facet keyed by domain namespace id.
type OrmClient<
  TContract extends Contract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
> = ModelCollectionMap<TContract, Collections> & NamespacedClientMap<TContract, Collections>;

export function orm<
  TContract extends Contract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>> = Record<never, never>,
>(options: OrmOptions<TContract, Collections>): OrmClient<TContract, Collections> {
  const { runtime, collections, context } = options;
  const contract = context.contract;
  const ctx: CollectionContext<TContract> = { runtime, context };
  const modelNames = new Set(domainModelNames(contract));
  const collectionRegistry = createCollectionRegistry(contract, collections);

  type AnyCollection = Collection<TContract, string, unknown, CollectionTypeState>;

  function buildCollection(
    modelName: string,
    tableName?: string,
    namespaceId?: string,
  ): AnyCollection {
    const CollectionClass = collectionRegistry.get(modelName) ?? Collection;
    const CollectionCtor = blindCast<
      new (
        ctx: CollectionContext<TContract>,
        modelName: string,
        options?: Record<string, unknown>,
      ) => AnyCollection,
      'a registered collection class is a Collection subclass constructor'
    >(CollectionClass);
    return new CollectionCtor(ctx, modelName, {
      registry: collectionRegistry,
      ...(tableName !== undefined ? { tableName } : {}),
      ...(namespaceId !== undefined ? { namespaceId } : {}),
    });
  }

  const flatCache = new Map<string, AnyCollection>();
  const namespaceFacets = new Map<string, object>();

  function flatCollection(modelName: string): AnyCollection {
    const cached = flatCache.get(modelName);
    if (cached) {
      return cached;
    }
    const collection = buildCollection(modelName);
    flatCache.set(modelName, collection);
    return collection;
  }

  function namespaceFacet(namespaceId: string): object {
    const cached = namespaceFacets.get(namespaceId);
    if (cached) {
      return cached;
    }
    const facetModelNames = new Set(domainModelNamesInNamespace(contract, namespaceId));
    const facetCache = new Map<string, AnyCollection>();
    const facet = new Proxy(
      {},
      {
        get(_facetTarget, modelProp: string | symbol): unknown {
          if (typeof modelProp !== 'string') {
            return undefined;
          }
          if (!facetModelNames.has(modelProp)) {
            throw new Error(
              `No model '${modelProp}' in namespace '${namespaceId}'. Available models: ${[...facetModelNames].join(', ')}`,
            );
          }
          const hit = facetCache.get(modelProp);
          if (hit) {
            return hit;
          }
          const collection = buildCollection(
            modelProp,
            domainModelTableInNamespace(contract, namespaceId, modelProp),
            namespaceId,
          );
          facetCache.set(modelProp, collection);
          return collection;
        },
      },
    );
    namespaceFacets.set(namespaceId, facet);
    return facet;
  }

  return new Proxy({} as OrmClient<TContract, Collections>, {
    get(_target, prop: string | symbol): unknown {
      if (typeof prop !== 'string') {
        return undefined;
      }

      if (Object.hasOwn(contract.domain.namespaces, prop)) {
        return namespaceFacet(prop);
      }

      if (!modelNames.has(prop)) {
        throw new Error(
          `No model found for '${prop}'. Available models: ${[...modelNames].join(', ')}`,
        );
      }

      return flatCollection(prop);
    },
  });
}

function createCollectionRegistry<
  TContract extends Contract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
>(contract: TContract, collections: Collections | undefined): Map<string, AnyCollectionClass> {
  const registry = new Map<string, AnyCollectionClass>();
  if (!collections) {
    return registry;
  }

  const models = domainModelsAtDefaultNamespace(contract.domain);
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
    registry.set(key, collectionClass);
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
