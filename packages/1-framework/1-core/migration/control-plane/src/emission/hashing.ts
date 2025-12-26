import { createHash } from 'node:crypto';
import type { ContractIR } from '@prisma-next/contract/ir';
import { canonicalizeContract } from './canonicalization';

type ContractInput = {
  schemaVersion: string;
  targetFamily: string;
  target: string;
  models: Record<string, unknown>;
  relations: Record<string, unknown>;
  storage: Record<string, unknown>;
  extensions: Record<string, unknown>;
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

export function computeCoreHash(contract: ContractInput): string {
  const coreContract: ContractIR = {
    schemaVersion: contract.schemaVersion,
    targetFamily: contract.targetFamily,
    target: contract.target,
    models: contract.models,
    relations: contract.relations,
    storage: contract.storage,
    extensions: contract.extensions,
    sources: contract.sources,
    capabilities: contract.capabilities,
    meta: contract.meta,
  };
  const canonical = canonicalizeContract(coreContract);
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
    extensions: {},
    capabilities: contract.capabilities,
    meta: {},
    sources: {},
  };
  const canonical = canonicalizeContract(profileContract);
  return computeHash(canonical);
}
