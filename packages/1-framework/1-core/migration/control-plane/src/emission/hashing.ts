import { createHash } from 'node:crypto';
import { ifDefined } from '@prisma-next/utils/defined';
import type { CanonicalContractInput } from './canonicalization';
import { canonicalizeContract } from './canonicalization';

function computeHash(content: string): string {
  const hash = createHash('sha256');
  hash.update(content);
  return `sha256:${hash.digest('hex')}`;
}

export function computeStorageHash(contract: CanonicalContractInput): string {
  const storageContract = {
    schemaVersion: contract.schemaVersion,
    targetFamily: contract.targetFamily,
    target: contract.target,
    storage: contract.storage,
    models: {},
    relations: {},
    extensionPacks: {},
    capabilities: {},
    meta: {},
  };
  const canonical = canonicalizeContract(storageContract);
  return computeHash(canonical);
}

export function computeProfileHash(contract: CanonicalContractInput): string {
  const profileContract = {
    schemaVersion: contract.schemaVersion,
    targetFamily: contract.targetFamily,
    target: contract.target,
    models: {},
    relations: {},
    storage: {},
    extensionPacks: {},
    capabilities: contract.capabilities,
    meta: {},
  };
  const canonical = canonicalizeContract(profileContract);
  return computeHash(canonical);
}

export function computeExecutionHash(contract: CanonicalContractInput): string {
  const executionContract = {
    schemaVersion: contract.schemaVersion,
    targetFamily: contract.targetFamily,
    target: contract.target,
    models: {},
    relations: {},
    storage: {},
    extensionPacks: {},
    capabilities: {},
    meta: {},
    ...ifDefined('execution', contract.execution),
  };
  const canonical = canonicalizeContract(executionContract);
  return computeHash(canonical);
}
