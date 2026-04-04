import type { Contract } from './contract-types';
import type { ContractModel, ModelStorageBase } from './domain-types';
import { computeProfileHash, computeStorageHash } from './hashing';
import type { ExecutionSection, ProfileHashBase, StorageBase } from './types';
import { coreHash } from './types';

type ContractOverrides<
  TStorage extends StorageBase = StorageBase,
  TModels extends Record<string, ContractModel> = Record<string, ContractModel>,
> = {
  target?: string;
  targetFamily?: string;
  roots?: Record<string, string>;
  models?: TModels;
  storage?: Omit<TStorage, 'storageHash'>;
  capabilities?: Record<string, Record<string, boolean>>;
  extensionPacks?: Record<string, unknown>;
  execution?: ExecutionSection;
  profileHash?: ProfileHashBase<string>;
  meta?: Record<string, unknown>;
};

const DUMMY_HASH = coreHash('sha256:test');

export function createContract<
  TStorage extends StorageBase = StorageBase,
  TModels extends Record<string, ContractModel> = Record<string, ContractModel>,
>(overrides: ContractOverrides<TStorage, TModels> = {}): Contract<TStorage, TModels> {
  const target = overrides.target ?? 'postgres';
  const targetFamily = overrides.targetFamily ?? 'sql';
  const capabilities = overrides.capabilities ?? {};

  const rawStorage =
    overrides.storage ?? ({ tables: {} } as unknown as Omit<TStorage, 'storageHash'>);

  const storageHash = computeStorageHash({
    target,
    targetFamily,
    storage: rawStorage as Record<string, unknown>,
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
    models: (overrides.models ?? {}) as TModels,
    storage,
    capabilities,
    extensionPacks: overrides.extensionPacks ?? {},
    ...(overrides.execution !== undefined ? { execution: overrides.execution } : {}),
    profileHash: computedProfileHash,
    meta: overrides.meta ?? {},
  };
}

type SqlStorageLike = StorageBase & {
  readonly tables: Record<string, unknown>;
  readonly types?: Record<string, unknown>;
};

type SqlModelLike = ContractModel<ModelStorageBase & { table: string }>;

export function createSqlContract(
  overrides: ContractOverrides<SqlStorageLike, Record<string, SqlModelLike>> = {},
): Contract<SqlStorageLike, Record<string, SqlModelLike>> {
  return createContract<SqlStorageLike, Record<string, SqlModelLike>>({
    target: 'postgres',
    targetFamily: 'sql',
    storage: overrides.storage ?? { tables: {} },
    ...overrides,
  });
}

export { DUMMY_HASH };
