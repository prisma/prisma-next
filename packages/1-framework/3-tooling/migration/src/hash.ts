import { createHash } from 'node:crypto';
import { canonicalizeJson } from './canonicalize-json';
import type { MigrationMetadata } from './metadata';
import type { MigrationOps, MigrationPackage } from './package';

export interface VerifyResult {
  readonly ok: boolean;
  readonly reason?: 'mismatch';
  readonly storedHash: string;
  readonly computedHash: string;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Content-addressed migration hash over (metadata envelope sans
 * contracts/hints/signature, ops). See ADR 199 — Storage-only migration
 * identity for the rationale: contracts are anchored separately by the
 * storage-hash bookends inside the envelope; planner hints are advisory
 * and must not affect identity.
 *
 * The integrity check is purely structural, not semantic. The function
 * canonicalizes its inputs via `sortKeys` (recursive) + `JSON.stringify`
 * and hashes the result. Target-specific operation payloads (`step.sql`,
 * Mongo's pipeline AST, …) are hashed verbatim — no per-target
 * normalization is required, because what's being verified is "do the
 * on-disk bytes still produce their recorded hash", not "do two
 * semantically-equivalent migrations hash the same". The latter is an
 * emit-drift concern (ADR 192 step 2).
 *
 * The symmetry across write and read holds because `JSON.parse(
 * JSON.stringify(x))` round-trips JSON-safe values losslessly and
 * `sortKeys` is idempotent and deterministic — write-time and read-time
 * canonicalization produce the same canonical bytes regardless of
 * source-side key ordering or whitespace.
 *
 * The `migrationHash` field on the metadata is stripped before hashing
 * so the function can be used both at write time (when no hash exists
 * yet) and at verify time (rehashing an already-attested record).
 */
export function computeMigrationHash(
  metadata: Omit<MigrationMetadata, 'migrationHash'> & { readonly migrationHash?: string },
  ops: MigrationOps,
): string {
  const {
    migrationHash: _migrationHash,
    signature: _signature,
    fromContract: _fromContract,
    toContract: _toContract,
    hints: _hints,
    ...strippedMeta
  } = metadata;

  const canonicalMetadata = canonicalizeJson(strippedMeta);
  const canonicalOps = canonicalizeJson(ops);

  const partHashes = [canonicalMetadata, canonicalOps].map(sha256Hex);
  const hash = sha256Hex(canonicalizeJson(partHashes));

  return `sha256:${hash}`;
}

/**
 * Re-hash an in-memory migration package and compare against the stored
 * `migrationHash`. See `computeMigrationHash` for the canonicalization rules.
 *
 * Returns `{ ok: true }` when the package is internally consistent, or
 * `{ ok: false, reason: 'mismatch', storedHash, computedHash }` when it is
 * not — typically a sign of FS corruption, partial writes, or a post-emit
 * hand edit.
 */
export function verifyMigrationHash(pkg: MigrationPackage): VerifyResult {
  const computed = computeMigrationHash(pkg.metadata, pkg.ops);

  if (pkg.metadata.migrationHash === computed) {
    return {
      ok: true,
      storedHash: pkg.metadata.migrationHash,
      computedHash: computed,
    };
  }

  return {
    ok: false,
    reason: 'mismatch',
    storedHash: pkg.metadata.migrationHash,
    computedHash: computed,
  };
}
