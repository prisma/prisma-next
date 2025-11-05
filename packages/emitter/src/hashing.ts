import { createHash } from 'node:crypto';
import { canonicalizeContract } from './canonicalization';
import type { ContractIR } from './types';

function computeHash(content: string): string {
  const hash = createHash('sha256');
  hash.update(content);
  return `sha256:${hash.digest('hex')}`;
}

export function computeCoreHash(contract: Record<string, unknown>): string {
  const coreContract: ContractIR = {
    schemaVersion: contract['schemaVersion'] as string | undefined,
    targetFamily: contract['targetFamily'] as string,
    target: contract['target'] as string,
    models: contract['models'] as Record<string, unknown> | undefined,
    relations: contract['relations'] as Record<string, unknown> | undefined,
    storage: contract['storage'] as Record<string, unknown> | undefined,
    extensions: contract['extensions'] as Record<string, unknown> | undefined,
    sources: contract['sources'] as Record<string, unknown> | undefined,
  };
  const canonical = canonicalizeContract(coreContract);
  return computeHash(canonical);
}

export function computeProfileHash(contract: Record<string, unknown>): string {
  const profileContract: ContractIR = {
    schemaVersion: contract['schemaVersion'] as string | undefined,
    targetFamily: contract['targetFamily'] as string,
    target: contract['target'] as string,
    capabilities: contract['capabilities'] as Record<string, Record<string, boolean>> | undefined,
  };
  const canonical = canonicalizeContract(profileContract);
  return computeHash(canonical);
}

