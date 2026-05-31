import { createHash } from 'node:crypto';
import { ifDefined } from '@prisma-next/utils/defined';
import type { JsonObject } from '@prisma-next/utils/json';
import {
  canonicalizeContract,
  type PreserveEmptyPredicate,
  type StorageSort,
} from './canonicalization';
import type { Contract } from './contract-types';
import type { ExecutionHashBase, ProfileHashBase, StorageHashBase } from './types';

const SCHEMA_VERSION = '1';

function sha256(content: string): string {
  const hash = createHash('sha256');
  hash.update(content);
  return `sha256:${hash.digest('hex')}`;
}

type HashContractSection = Record<string, unknown> & {
  readonly shouldPreserveEmpty?: PreserveEmptyPredicate;
  readonly sortStorage?: StorageSort;
};

function hashContract(section: HashContractSection): string {
  const { shouldPreserveEmpty, sortStorage, ...sectionData } = section;
  // Blind cast: the synthesised object is a hash-only stand-in
  // — never returned to callers, never executed as a Contract.
  // `canonicalizeContract` only walks the storage / execution /
  // capabilities slices, all of which are populated above, so the
  // missing precise Contract typing on the other slots is
  // immaterial for the hash result.
  const contract = {
    targetFamily: sectionData['targetFamily'],
    target: sectionData['target'],
    roots: {},
    domain: { namespaces: {} },
    storage: sectionData['storage'] ?? {},
    execution: sectionData['execution'],
    extensionPacks: {},
    capabilities: sectionData['capabilities'] ?? {},
    meta: {},
    profileHash: '',
    ...sectionData,
  } as unknown as Contract;
  return canonicalizeContract(contract, {
    schemaVersion: SCHEMA_VERSION,
    serializeContract: (c) => JSON.parse(JSON.stringify(c)) as JsonObject,
    ...ifDefined('shouldPreserveEmpty', shouldPreserveEmpty),
    ...ifDefined('sortStorage', sortStorage),
  });
}

export type ComputeStorageHashArgs = {
  target: string;
  targetFamily: string;
  storage: Record<string, unknown>;
  readonly shouldPreserveEmpty?: PreserveEmptyPredicate;
  readonly sortStorage?: StorageSort;
};

export function computeStorageHash(args: ComputeStorageHashArgs): StorageHashBase<string> {
  return sha256(hashContract(args)) as StorageHashBase<string>;
}

export function computeExecutionHash(args: {
  target: string;
  targetFamily: string;
  execution: Record<string, unknown>;
}): ExecutionHashBase<string> {
  return sha256(hashContract(args)) as ExecutionHashBase<string>;
}

export function computeProfileHash(args: {
  target: string;
  targetFamily: string;
  capabilities: Record<string, Record<string, boolean>>;
}): ProfileHashBase<string> {
  return sha256(hashContract(args)) as ProfileHashBase<string>;
}
