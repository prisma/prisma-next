import { createHash } from 'node:crypto';
import { canonicalizeJson } from './canonicalize-json';
import { readMigrationPackage } from './io';
import type { MigrationBundle, MigrationManifest, MigrationOps } from './types';

export interface VerifyResult {
  readonly ok: boolean;
  readonly reason?: 'mismatch';
  readonly storedMigrationId?: string;
  readonly computedMigrationId?: string;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Content-addressed migration identity over (manifest envelope sans
 * contracts/hints, ops). See ADR 199 "Storage-only migration identity"
 * for the rationale: contracts are anchored separately by the
 * storage-hash bookends inside the envelope; planner hints are advisory
 * and must not affect identity.
 *
 * The `migrationId` field on the manifest is stripped before hashing so
 * the function can be used both at write time (when no id exists yet)
 * and at verify time (rehashing an already-attested manifest).
 */
export function computeMigrationId(
  manifest: Omit<MigrationManifest, 'migrationId'> & { readonly migrationId?: string },
  ops: MigrationOps,
): string {
  const {
    migrationId: _migrationId,
    signature: _signature,
    fromContract: _fromContract,
    toContract: _toContract,
    hints: _hints,
    ...strippedMeta
  } = manifest;

  const canonicalManifest = canonicalizeJson(strippedMeta);
  const canonicalOps = canonicalizeJson(ops);

  const partHashes = [canonicalManifest, canonicalOps].map(sha256Hex);
  const hash = sha256Hex(canonicalizeJson(partHashes));

  return `sha256:${hash}`;
}

/**
 * Re-hash an on-disk migration bundle and compare against the stored
 * `migrationId`. Returns `{ ok: true }` when the package is internally
 * consistent (manifest + ops still produce the recorded id), or
 * `{ ok: false, reason: 'mismatch', stored, computed }` when they do
 * not — typically a sign of FS corruption, partial writes, or a
 * post-emit hand edit.
 */
export function verifyMigrationBundle(bundle: MigrationBundle): VerifyResult {
  const computed = computeMigrationId(bundle.manifest, bundle.ops);

  if (bundle.manifest.migrationId === computed) {
    return {
      ok: true,
      storedMigrationId: bundle.manifest.migrationId,
      computedMigrationId: computed,
    };
  }

  return {
    ok: false,
    reason: 'mismatch',
    storedMigrationId: bundle.manifest.migrationId,
    computedMigrationId: computed,
  };
}

/** Convenience wrapper: read the package from disk then verify it. */
export async function verifyMigration(dir: string): Promise<VerifyResult> {
  const pkg = await readMigrationPackage(dir);
  return verifyMigrationBundle(pkg);
}
