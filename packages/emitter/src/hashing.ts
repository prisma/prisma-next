import { createHash } from 'node:crypto';
import { canonicalizeContract } from './canonicalization';
import type { ContractIR } from './types';

type ContractInput = {
  schemaVersion?: string;
  targetFamily: string;
  target: string;
  models?: Record<string, unknown>;
  relations?: Record<string, unknown>;
  storage?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
  sources?: Record<string, unknown>;
  capabilities?: Record<string, Record<string, boolean>>;
  [key: string]: unknown;
};

function computeHash(content: string): string {
  const hash = createHash('sha256');
  hash.update(content);
  return `sha256:${hash.digest('hex')}`;
}

export function computeCoreHash(contract: ContractInput): string {
  const coreContract: ContractIR = {
    ...(contract.schemaVersion !== undefined
      ? { schemaVersion: contract.schemaVersion as string }
      : {}),
    targetFamily: contract.targetFamily as string,
    target: contract.target as string,
    ...(contract.models !== undefined
      ? { models: contract.models as Record<string, unknown> }
      : {}),
    ...(contract.relations !== undefined
      ? { relations: contract.relations as Record<string, unknown> }
      : {}),
    ...(contract.storage !== undefined
      ? { storage: contract.storage as Record<string, unknown> }
      : {}),
    ...(contract.extensions !== undefined
      ? { extensions: contract.extensions as Record<string, unknown> }
      : {}),
    ...(contract.sources !== undefined
      ? { sources: contract.sources as Record<string, unknown> }
      : {}),
  };
  const canonical = canonicalizeContract(coreContract);
  return computeHash(canonical);
}

export function computeProfileHash(contract: ContractInput): string {
  const profileContract: ContractIR = {
    ...(contract.schemaVersion !== undefined
      ? { schemaVersion: contract.schemaVersion as string }
      : {}),
    targetFamily: contract.targetFamily as string,
    target: contract.target as string,
    ...(contract.capabilities !== undefined
      ? { capabilities: contract.capabilities as Record<string, Record<string, boolean>> }
      : {}),
  };
  const canonical = canonicalizeContract(profileContract);
  return computeHash(canonical);
}
