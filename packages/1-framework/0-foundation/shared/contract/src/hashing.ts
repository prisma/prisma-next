import { createHash } from 'node:crypto';
import { canonicalizeContract } from './canonicalization';
import type { Contract } from './contract-types';
import type { ExecutionHashBase, ProfileHashBase, StorageHashBase } from './types';

const SCHEMA_VERSION = '1';

function sha256(content: string): string {
  const hash = createHash('sha256');
  hash.update(content);
  return `sha256:${hash.digest('hex')}`;
}

function hashContract(section: Record<string, unknown>): string {
  const contract = {
    targetFamily: section['targetFamily'],
    target: section['target'],
    roots: {},
    models: {},
    storage: section['storage'] ?? {},
    execution: section['execution'],
    extensionPacks: {},
    capabilities: section['capabilities'] ?? {},
    meta: {},
    profileHash: '',
    ...section,
  } as Contract;
  return canonicalizeContract(contract, { schemaVersion: SCHEMA_VERSION });
}

export function computeStorageHash(args: {
  target: string;
  targetFamily: string;
  storage: Record<string, unknown>;
}): StorageHashBase<string> {
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
