import { createHash } from 'node:crypto';

function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sortKeys(item));
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj).sort();
  for (const key of keys) {
    sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

function canonicalizeJson(obj: unknown): string {
  const sorted = sortKeys(obj);
  return JSON.stringify(sorted);
}

function computeHash(content: string): string {
  const hash = createHash('sha256');
  hash.update(content);
  return `sha256:${hash.digest('hex')}`;
}

export function computeCoreHash(contract: Record<string, unknown>): string {
  const coreContract = {
    schemaVersion: contract['schemaVersion'],
    targetFamily: contract['targetFamily'],
    target: contract['target'],
    models: contract['models'],
    relations: contract['relations'],
    storage: contract['storage'],
    extensions: contract['extensions'],
    sources: contract['sources'],
  };
  const canonical = canonicalizeJson(coreContract);
  return computeHash(canonical);
}

export function computeProfileHash(contract: Record<string, unknown>): string {
  const profileContract = {
    schemaVersion: contract['schemaVersion'],
    targetFamily: contract['targetFamily'],
    target: contract['target'],
    capabilities: contract['capabilities'],
  };
  const canonical = canonicalizeJson(profileContract);
  return computeHash(canonical);
}

