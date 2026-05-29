import type {
  CanonicalizeContractOptions,
  PreserveEmptyPredicate,
  StorageSort,
} from '@prisma-next/contract/hashing';
import { createContract } from '@prisma-next/contract/testing';
import type { Contract, CrossReference } from '@prisma-next/contract/types';
import type { EmissionSpi } from '@prisma-next/framework-components/emission';
import type { JsonObject } from '@prisma-next/utils/json';
import type { EmitOptions, EmitResult, EmitStackInput } from '../src/exports';
import { emit as emitImpl } from '../src/exports';

const identitySerialize = (c: Contract): JsonObject => c as unknown as JsonObject;

function sqlPreserveEmpty(path: readonly string[]): boolean {
  const len = path.length;
  if (len < 2 || path[0] !== 'storage') return false;
  if (path[1] === 'namespaces') {
    if (len === 4 && path[3] === 'tables') return true;
    if (len === 5 && path[3] === 'tables') return true;
    if (
      len === 6 &&
      path[3] === 'tables' &&
      (path[5] === 'uniques' || path[5] === 'indexes' || path[5] === 'foreignKeys')
    )
      return true;
    if (
      len === 7 &&
      path[3] === 'tables' &&
      path[5] === 'foreignKeys' &&
      (path[6] === 'constraint' || path[6] === 'index')
    )
      return true;
  }
  if (path[1] === 'types' && len === 4 && path[3] === 'typeParams') return true;
  return false;
}

const sqlSortStorage: StorageSort = (storage) => {
  if (!storage || typeof storage !== 'object' || Array.isArray(storage)) return storage;
  const s = storage as Record<string, unknown>;
  const namespaces = s['namespaces'];
  if (!namespaces || typeof namespaces !== 'object' || Array.isArray(namespaces)) return storage;
  const ns = namespaces as Record<string, unknown>;
  const sortedNs: Record<string, unknown> = {};
  for (const nsId of Object.keys(ns)) {
    const nsEntry = ns[nsId];
    if (!nsEntry || typeof nsEntry !== 'object' || Array.isArray(nsEntry)) {
      sortedNs[nsId] = nsEntry;
      continue;
    }
    const tables = (nsEntry as Record<string, unknown>)['tables'];
    if (!tables || typeof tables !== 'object' || Array.isArray(tables)) {
      sortedNs[nsId] = nsEntry;
      continue;
    }
    const sortedTables: Record<string, unknown> = {};
    for (const tname of Object.keys(tables as Record<string, unknown>)) {
      const t = (tables as Record<string, unknown>)[tname];
      if (!t || typeof t !== 'object' || Array.isArray(t)) {
        sortedTables[tname] = t;
        continue;
      }
      const tableObj = t as Record<string, unknown>;
      const sorted: Record<string, unknown> = { ...tableObj };
      const byName = (a: unknown, b: unknown): number => {
        const na =
          a && typeof a === 'object' && 'name' in a && typeof a.name === 'string' ? a.name : '';
        const nb =
          b && typeof b === 'object' && 'name' in b && typeof b.name === 'string' ? b.name : '';
        return na.localeCompare(nb);
      };
      if (Array.isArray(tableObj['indexes'])) {
        sorted['indexes'] = [...tableObj['indexes']].sort(byName);
      }
      if (Array.isArray(tableObj['uniques'])) {
        sorted['uniques'] = [...tableObj['uniques']].sort(byName);
      }
      sortedTables[tname] = sorted;
    }
    sortedNs[nsId] = { ...(nsEntry as Record<string, unknown>), tables: sortedTables };
  }
  return { ...s, namespaces: sortedNs };
};

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
