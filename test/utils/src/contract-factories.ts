import type { PreserveEmptyPredicate, StorageSort } from '@prisma-next/contract/hashing';
import {
  computeExecutionHash,
  computeProfileHash,
  computeStorageHash,
} from '@prisma-next/contract/hashing';
import type {
  Contract,
  ContractModel,
  ContractModelBase,
  ContractValueObject,
  CrossReference,
  ExecutionSection,
  ModelStorageBase,
  ProfileHashBase,
  StorageBase,
} from '@prisma-next/contract/types';
import { coreHash, UNBOUND_DOMAIN_NAMESPACE_ID } from '@prisma-next/contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';

type ContractOverrides<
  TStorage extends StorageBase = StorageBase,
  TModels extends Record<string, ContractModelBase> = Record<string, ContractModel>,
> = {
  target?: string;
  targetFamily?: string;
  roots?: Record<string, CrossReference>;
  models?: TModels;
  storage?: Omit<TStorage, 'storageHash'>;
  valueObjects?: Record<string, ContractValueObject>;
  capabilities?: Record<string, Record<string, boolean>>;
  extensionPacks?: Record<string, unknown>;
  execution?: Omit<ExecutionSection, 'executionHash'>;
  profileHash?: ProfileHashBase<string>;
  meta?: Record<string, unknown>;
  shouldPreserveEmpty?: PreserveEmptyPredicate;
  sortStorage?: StorageSort;
};

const DUMMY_HASH = coreHash('sha256:test');

const DEFAULT_FRAMEWORK_STORAGE = { namespaces: {} } as const;

const UNBOUND_NAMESPACE_ID = '__unbound__' as const;

const DEFAULT_SQL_STORAGE = {
  namespaces: {
    [UNBOUND_NAMESPACE_ID]: {
      id: UNBOUND_NAMESPACE_ID,
      tables: {},
    },
  },
} as const;

export function createContract<
  TStorage extends StorageBase = StorageBase,
  TModels extends Record<string, ContractModelBase> = Record<string, ContractModel>,
>(overrides: ContractOverrides<TStorage, TModels> = {}): Contract<TStorage, TModels> {
  const target = overrides.target ?? 'postgres';
  const targetFamily = overrides.targetFamily ?? 'sql';
  const capabilities = overrides.capabilities ?? {};

  const rawStorage = overrides.storage ?? DEFAULT_FRAMEWORK_STORAGE;

  const storageHash = computeStorageHash({
    target,
    targetFamily,
    storage: rawStorage as Record<string, unknown>,
    ...ifDefined('shouldPreserveEmpty', overrides.shouldPreserveEmpty),
    ...ifDefined('sortStorage', overrides.sortStorage),
  });

  const storage = {
    ...rawStorage,
    storageHash,
  } as TStorage;

  const computedProfileHash =
    overrides.profileHash ?? computeProfileHash({ target, targetFamily, capabilities });

  return {
    target,
    targetFamily,
    roots: overrides.roots ?? {},
    domain: {
      namespaces: {
        [UNBOUND_DOMAIN_NAMESPACE_ID]: {
          models:
            overrides.models ??
            blindCast<TModels, 'default empty models when createContract omits models'>({}),
          ...ifDefined('valueObjects', overrides.valueObjects),
        },
      },
    },
    storage,
    capabilities,
    extensionPacks: overrides.extensionPacks ?? {},
    ...(overrides.execution !== undefined
      ? {
          execution: {
            ...overrides.execution,
            executionHash: computeExecutionHash({
              target,
              targetFamily,
              execution: overrides.execution,
            }),
          },
        }
      : {}),
    profileHash: computedProfileHash,
    meta: overrides.meta ?? {},
  };
}

type SqlStorageLike = StorageBase & {
  readonly namespaces: Readonly<
    Record<string, { readonly id: string; readonly tables: Readonly<Record<string, unknown>> }>
  >;
  readonly types?: Record<string, unknown>;
};

type SqlModelLike = ContractModel<ModelStorageBase & { table: string }>;

export function createSqlContract(
  overrides: ContractOverrides<SqlStorageLike, Record<string, SqlModelLike>> = {},
): Contract<SqlStorageLike, Record<string, SqlModelLike>> {
  return createContract<SqlStorageLike, Record<string, SqlModelLike>>({
    ...overrides,
    target: overrides.target ?? 'postgres',
    targetFamily: overrides.targetFamily ?? 'sql',
    storage: overrides.storage ?? DEFAULT_SQL_STORAGE,
  });
}

export { DUMMY_HASH };
