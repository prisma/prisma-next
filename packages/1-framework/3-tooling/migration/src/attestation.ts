import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { canonicalizeContract } from '@prisma-next/core-control-plane/emission';
import { join } from 'pathe';
import { canonicalizeJson } from './canonicalize-json';
import { readMigrationPackage } from './io';
import type { MigrationManifest, MigrationOps } from './types';

export interface VerifyResult {
  readonly ok: boolean;
  readonly reason?: 'draft' | 'mismatch';
  readonly storedEdgeId?: string;
  readonly computedEdgeId?: string;
}

export function computeEdgeId(manifest: MigrationManifest, ops: MigrationOps): string {
  const { edgeId: _edgeId, signature: _signature, ...stripped } = manifest;

  const canonicalManifest = canonicalizeJson(stripped);
  const canonicalOps = canonicalizeJson(ops);

  const canonicalFromContract =
    manifest.fromContract !== null ? canonicalizeContract(manifest.fromContract) : 'null';
  const canonicalToContract = canonicalizeContract(manifest.toContract);

  const combined = canonicalManifest + canonicalOps + canonicalFromContract + canonicalToContract;
  const hash = createHash('sha256').update(combined).digest('hex');

  return `sha256:${hash}`;
}

export async function attestMigration(dir: string): Promise<string> {
  const pkg = await readMigrationPackage(dir);
  const edgeId = computeEdgeId(pkg.manifest, pkg.ops);

  const updated = { ...pkg.manifest, edgeId };
  await writeFile(join(dir, 'migration.json'), JSON.stringify(updated, null, 2));

  return edgeId;
}

export async function verifyMigration(dir: string): Promise<VerifyResult> {
  const pkg = await readMigrationPackage(dir);

  if (pkg.manifest.edgeId === null) {
    return { ok: false, reason: 'draft' };
  }

  const computed = computeEdgeId(pkg.manifest, pkg.ops);

  if (pkg.manifest.edgeId === computed) {
    return { ok: true, storedEdgeId: pkg.manifest.edgeId, computedEdgeId: computed };
  }

  return {
    ok: false,
    reason: 'mismatch',
    storedEdgeId: pkg.manifest.edgeId,
    computedEdgeId: computed,
  };
}
