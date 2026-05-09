import { computeStorageHash } from '@prisma-next/contract/hashing';
import { errorDescriptorHeadHashMismatch } from './errors';

/**
 * Inputs the helper needs to recompute the descriptor's storage hash and
 * compare it to the published `headRef.hash`. Kept structural so the SQL
 * family (and any future target family) can compose the check without
 * coupling to its own descriptor types.
 */
export interface DescriptorSelfConsistencyInputs {
  readonly extensionId: string;
  readonly target: string;
  readonly targetFamily: string;
  readonly storage: Record<string, unknown>;
  readonly headRefHash: string;
}

/**
 * Assert that an extension descriptor is self-consistent: the
 * `headRef.hash` it publishes must match the canonical hash recomputed
 * from its `contractSpace.contractJson`.
 *
 * Recomputes via {@link computeStorageHash} — the same canonical-JSON
 * pipeline the descriptor's own emit pipeline produced the hash with —
 * over `(target, targetFamily, storage)`. Mismatch indicates the
 * extension author bumped `contractJson` without rerunning emit, leaving
 * the descriptor's `headRef.hash` stale; the consumer-side helpers
 * (drift detection, pinned artefact emission, runner marker writes) all
 * trust `headRef.hash` as the canonical identity, so a stale value would
 * silently corrupt every downstream boundary.
 *
 * Synchronous, pure, no I/O. Throws
 * `MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH` on failure with both the
 * recomputed and published hashes in `details` so callers can surface a
 * clear remediation hint without re-deriving them.
 */
export function assertDescriptorSelfConsistency(inputs: DescriptorSelfConsistencyInputs): void {
  // The published `storage.storageHash` is the *output* of the production
  // emit pipeline's `computeStorageHash` call, computed over a storage
  // object that did not yet carry `storageHash`. Recomputing against the
  // published storage as-is would feed the result back into its own input
  // and produce a different digest. Strip `storageHash` before
  // recomputing so the helper sees the same canonical shape the
  // descriptor's authoring pipeline saw.
  const { storageHash: _stripped, ...storageWithoutHash } = inputs.storage;
  const recomputed = computeStorageHash({
    target: inputs.target,
    targetFamily: inputs.targetFamily,
    storage: storageWithoutHash,
  });
  if (recomputed !== inputs.headRefHash) {
    throw errorDescriptorHeadHashMismatch({
      extensionId: inputs.extensionId,
      recomputedHash: recomputed,
      headRefHash: inputs.headRefHash,
    });
  }
}
