import { promises as fs } from 'fs';
import { join } from 'path';
import { OpSet as BaseOpSet, Op } from './lowering/postgres';

// Contract reference types
export type ContractRef =
  | { kind: 'contract'; hash: `sha256:${string}` }
  | { kind: 'empty' }
  | { kind: 'unknown' }
  | { kind: 'anyOf'; hashes: Array<`sha256:${string}`> };

// Migration metadata
export type Meta = {
  id: string;
  target: 'postgres';
  from: ContractRef;
  to: { kind: 'contract'; hash: `sha256:${string}` };
  opSetHash: `sha256:${string}`;
  mode?: 'strict' | 'tolerant';
  supersedes?: string[];
  notes?: string;
};

// OpSet wrapper with version
export type OpSetWithVersion = {
  version: 1;
  operations: Op[];
};

// Migration program
export type MigrationProgram = {
  dir: string;
  meta: Meta;
  ops: OpSetWithVersion;
};

// Contract marker for database state
export type ContractMarker = {
  hash: `sha256:${string}` | null;
};

// Simple runtime validation
function validateMeta(data: unknown): Meta {
  if (typeof data !== 'object' || data === null) {
    throw new Error('meta.json must be an object');
  }

  const meta = data as Record<string, unknown>;

  if (typeof meta.id !== 'string') {
    throw new Error('meta.id must be a string');
  }

  if (meta.target !== 'postgres') {
    throw new Error('meta.target must be "postgres"');
  }

  if (typeof meta.opSetHash !== 'string') {
    throw new Error('meta.opSetHash must be a string');
  }

  return meta as Meta;
}

function validateOpSet(data: unknown): OpSetWithVersion {
  if (typeof data !== 'object' || data === null) {
    throw new Error('opset.json must be an object');
  }

  const opset = data as Record<string, unknown>;

  if (opset.version !== 1) {
    throw new Error('opset.version must be 1');
  }

  if (!Array.isArray(opset.operations)) {
    throw new Error('opset.operations must be an array');
  }

  return opset as OpSetWithVersion;
}

// Canonical JSON serialization (sorted keys)
function canonicalize(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort());
}

// Web Crypto API hashing
async function hashString(input: string): Promise<`sha256:${string}`> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hashHex}`;
}

// Compute canonical hash of OpSet
export async function hashOpSet(ops: OpSetWithVersion): Promise<`sha256:${string}`> {
  const canonical = canonicalize(ops);
  return await hashString(canonical);
}

// Check if a migration program matches the current contract state
export function matchesFrom(meta: Meta, current: ContractMarker): boolean {
  switch (meta.from.kind) {
    case 'empty':
      return current.hash === null;

    case 'unknown':
      return true; // Always matches (legacy DB)

    case 'contract':
      return current.hash === meta.from.hash;

    case 'anyOf':
      return current.hash !== null && meta.from.hashes.includes(current.hash);

    default:
      return false;
  }
}

// Find the next applicable migration program
export function nextApplicable(
  programs: MigrationProgram[],
  current: ContractMarker,
): MigrationProgram | null {
  for (const program of programs) {
    if (matchesFrom(program.meta, current)) {
      return program;
    }
  }
  return null;
}

// Load and validate a migration program from disk
export async function loadProgram(dir: string): Promise<MigrationProgram> {
  try {
    // Read meta.json
    const metaPath = join(dir, 'meta.json');
    const metaContent = await fs.readFile(metaPath, 'utf-8');
    const metaData = JSON.parse(metaContent);

    // Validate meta.json
    const meta = validateMeta(metaData);

    // Read opset.json
    const opsetPath = join(dir, 'opset.json');
    const opsetContent = await fs.readFile(opsetPath, 'utf-8');
    const opsetData = JSON.parse(opsetContent);

    // Validate opset.json
    const ops = validateOpSet(opsetData);

    // Verify opSetHash matches computed hash
    const computedHash = await hashOpSet(ops);
    if (computedHash !== meta.opSetHash) {
      throw new Error(
        `OpSet hash mismatch in ${dir}: expected ${meta.opSetHash}, got ${computedHash}`,
      );
    }

    return {
      dir,
      meta,
      ops,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load migration program from ${dir}: ${error.message}`);
    }
    throw error;
  }
}
