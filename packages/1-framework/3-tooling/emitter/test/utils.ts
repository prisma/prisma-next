import type {
  CanonicalizeContractOptions,
  PreserveEmptyPredicate,
} from '@prisma-next/contract/hashing';
import {
  createPreserveEmptyPredicate,
  createStorageSort,
  type NamedArraySortTarget,
  type PathPattern,
} from '@prisma-next/contract/hashing-utils';
import { createContract } from '@prisma-next/contract/testing';
import type { Contract, CrossReference } from '@prisma-next/contract/types';
import type { EmissionSpi } from '@prisma-next/framework-components/emission';
import type { JsonObject } from '@prisma-next/utils/json';
import type { EmitOptions, EmitResult, EmitStackInput } from '../src/exports';
import { emit as emitImpl } from '../src/exports';

const identitySerialize = (c: Contract): JsonObject => c as unknown as JsonObject;

const sqlPreserveEmptyPatterns = [
  ['storage', 'namespaces', '*', 'tables'],
  ['storage', 'namespaces', '*', 'tables', '*'],
  ['storage', 'namespaces', '*', 'tables', '*', ['uniques', 'indexes', 'foreignKeys']],
  ['storage', 'namespaces', '*', 'tables', '*', 'foreignKeys', ['constraint', 'index']],
  ['storage', 'types', '*', 'typeParams'],
] as const satisfies readonly PathPattern[];

const sqlSortTargets = [
  { path: ['namespaces', '*', 'tables', '*'], arrayKeys: ['indexes', 'uniques'] },
] as const satisfies readonly NamedArraySortTarget[];

const sqlPreserveEmpty = createPreserveEmptyPredicate(sqlPreserveEmptyPatterns);
const sqlSortStorage = createStorageSort(sqlSortTargets);

const SQL_EMIT_HOOKS = {
  shouldPreserveEmpty: sqlPreserveEmpty satisfies PreserveEmptyPredicate,
  sortStorage: sqlSortStorage,
} satisfies Pick<CanonicalizeContractOptions, 'shouldPreserveEmpty' | 'sortStorage'>;

/**
 * Tests author JSON-clean contracts directly, so the canonicalisation
 * hook trivially passes through. Production callers thread the target
 * descriptor's `contractSerializer.serializeContract` instead.
 */
export function emit(
  contract: Contract,
  stack: EmitStackInput,
  family: EmissionSpi,
  options?: Omit<EmitOptions, 'serializeContract'>,
): Promise<EmitResult> {
  return emitImpl(contract, stack, family, {
    ...SQL_EMIT_HOOKS,
    ...options,
    serializeContract: identitySerialize,
  });
}

type TestContractOverrides = {
  target?: string;
  targetFamily?: string;
  roots?: Record<string, CrossReference>;
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
