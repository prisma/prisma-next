import { createHash } from 'node:crypto';
import { canonicalizeContract } from './canonicalization';
import type { ExecutionHashBase, ProfileHashBase, StorageHashBase } from './types';

const SCHEMA_VERSION = '1';

function sha256(content: string): string {
  const hash = createHash('sha256');
  hash.update(content);
  return `sha256:${hash.digest('hex')}`;
}

export function computeStorageHash(args: {
  target: string;
  targetFamily: string;
  storage: Record<string, unknown>;
}): StorageHashBase<string> {
  const canonical = canonicalizeContract({
    schemaVersion: SCHEMA_VERSION,
    targetFamily: args.targetFamily,
    target: args.target,
    storage: args.storage,
    models: {},
    extensionPacks: {},
    capabilities: {},
    meta: {},
  });
  return sha256(canonical) as StorageHashBase<string>;
}

export function computeExecutionHash(args: {
  target: string;
  targetFamily: string;
  execution: Record<string, unknown>;
}): ExecutionHashBase<string> {
  const canonical = canonicalizeContract({
    schemaVersion: SCHEMA_VERSION,
    targetFamily: args.targetFamily,
    target: args.target,
    execution: args.execution,
    models: {},
    storage: {},
    extensionPacks: {},
    capabilities: {},
    meta: {},
  });
  return sha256(canonical) as ExecutionHashBase<string>;
}

export function computeProfileHash(args: {
  target: string;
  targetFamily: string;
  capabilities: Record<string, Record<string, boolean>>;
}): ProfileHashBase<string> {
  const canonical = canonicalizeContract({
    schemaVersion: SCHEMA_VERSION,
    targetFamily: args.targetFamily,
    target: args.target,
    capabilities: args.capabilities,
    models: {},
    storage: {},
    extensionPacks: {},
    meta: {},
  });
  return sha256(canonical) as ProfileHashBase<string>;
}
