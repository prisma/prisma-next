import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import type { PreserveEmptyPredicate, StorageSort } from '../../src/canonicalization';
import type { Contract } from '../../src/contract-types';
import type { CrossReference } from '../../src/cross-reference';
import { UNBOUND_DOMAIN_NAMESPACE_ID } from '../../src/domain-envelope';
import type {
  ContractModel,
  ContractModelBase,
  ContractValueObject,
  ModelStorageBase,
} from '../../src/domain-types';
import { computeExecutionHash, computeProfileHash, computeStorageHash } from '../../src/hashing';
import type { ExecutionSection, ProfileHashBase, StorageBase } from '../../src/types';
import { coreHash } from '../../src/types';

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
      entries: { table: {} },
    },
  },
} as const;

/**
 * Contract authoring convenience for this package's own tests. The shared copy
 * lives in `@prisma-next/test-utils`, but the foundation `contract` package
 * cannot depend on test-utils (test-utils depends on contract), so the helper
 * is duplicated here to keep package boundaries one-way.
 */
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
    Record<
      string,
      {
        readonly id: string;
        readonly entries: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
      }
    >
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
