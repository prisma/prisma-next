import { createContract } from '@prisma-next/contract/testing';
import type { Contract } from '@prisma-next/contract/types';

type TestContractOverrides = {
  target?: string;
  targetFamily?: string;
  roots?: Record<string, string>;
  models?: Record<string, unknown>;
  storage?: Record<string, unknown>;
  capabilities?: Record<string, Record<string, boolean>>;
  extensionPacks?: Record<string, unknown>;
  execution?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  storageHash?: string;
  schemaVersion?: string;
  sources?: Record<string, unknown>;
};

export function createTestContract(overrides: TestContractOverrides = {}): Contract {
  const { storageHash: _sh, schemaVersion: _sv, sources: _src, storage, ...rest } = overrides;
  const cleanStorage = storage
    ? (() => {
        const { storageHash: _innerSh, ...storageRest } = storage as Record<string, unknown>;
        return storageRest;
      })()
    : undefined;
  return createContract({
    ...rest,
    ...(cleanStorage ? { storage: cleanStorage } : {}),
  } as Parameters<typeof createContract>[0]);
}
