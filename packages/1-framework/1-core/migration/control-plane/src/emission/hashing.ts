import { createHash } from 'node:crypto';
import type { ContractIR } from '@prisma-next/contract/ir';
import { ifDefined } from '@prisma-next/utils/defined';
import { canonicalizeContract } from './canonicalization';

type ContractInput = {
  schemaVersion: string;
  targetFamily: string;
  target: string;
  models: Record<string, unknown>;
  relations: Record<string, unknown>;
  storage: Record<string, unknown>;
  execution?: Record<string, unknown>;
  extensionPacks: Record<string, unknown>;
  sources: Record<string, unknown>;
  capabilities: Record<string, Record<string, boolean>>;
  meta: Record<string, unknown>;
  [key: string]: unknown;
};

function computeHash(content: string): string {
  const hash = createHash('sha256');
  hash.update(content);
  return `sha256:${hash.digest('hex')}`;
}

export function computeStorageHash(contract: ContractInput): string {
  const storageContract: ContractIR = {
    schemaVersion: contract.schemaVersion,
    targetFamily: contract.targetFamily,
    target: contract.target,
    storage: contract.storage,
    models: {},
    relations: {},
    extensionPacks: {},
    sources: {},
    capabilities: {},
    meta: {},
  };
  const canonical = canonicalizeContract(storageContract);
  return computeHash(canonical);
}

export function computeProfileHash(contract: ContractInput): string {
  const profileContract: ContractIR = {
    schemaVersion: contract.schemaVersion,
    targetFamily: contract.targetFamily,
    target: contract.target,
    models: {},
    relations: {},
    storage: {},
    extensionPacks: {},
    capabilities: contract.capabilities,
    meta: {},
    sources: {},
  };
  const canonical = canonicalizeContract(profileContract);
  return computeHash(canonical);
}

export function computeExecutionHash(contract: ContractInput): string {
  const executionContract: ContractIR = {
    schemaVersion: contract.schemaVersion,
    targetFamily: contract.targetFamily,
    target: contract.target,
    models: {},
    relations: {},
    storage: {},
    extensionPacks: {},
    sources: {},
    capabilities: {},
    meta: {},
    ...ifDefined('execution', contract.execution),
  };
  const canonical = canonicalizeContract(executionContract);
  return computeHash(canonical);
}
