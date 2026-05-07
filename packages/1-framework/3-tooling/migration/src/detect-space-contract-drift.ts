/**
 * Inputs for {@link detectSpaceContractDrift}.
 *
 * Both hashes are produced by the caller (the SQL-family wiring at the
 * consumption site) using the canonical contract hashing pipeline.
 * Keeping the helper pure lets `migration-tools` stay framework-neutral
 * — the SQL family already speaks `Contract<SqlStorage>`, the Mongo
 * family speaks its own contract type, and both reduce to a hash string
 * before drift detection runs.
 *
 * `pinnedHash` is `null` when no pinned `contract.json` exists yet for
 * the space (the descriptor declares an extension that has never been
 * emitted into the user's repo). That's the "first emit" case — no
 * drift to surface; the migrate emit will create the pinned files.
 *
 * @see specs/framework-mechanism.spec.md § 3 — Drift detection (T1.9).
 */
export interface DetectSpaceContractDriftInputs {
  readonly descriptorHash: string;
  readonly pinnedHash: string | null;
}

/**
 * Result discriminant for {@link detectSpaceContractDrift}.
 *
 * - `noDrift`: descriptor hash and pinned hash agree byte-for-byte.
 *   The migrate emit can proceed with no warning.
 * - `firstEmit`: no pinned `contract.json` on disk yet. The extension
 *   was just added to `extensionPacks`; this run will create the
 *   pinned files. No warning either — the user's intent is to install
 *   the extension, not to "drift" from a state they haven't pinned.
 * - `drift`: descriptor hash differs from pinned hash. The caller
 *   surfaces a non-fatal warning naming the extension and the
 *   diff direction (descriptor → pinned). The migrate emit proceeds
 *   normally so the bump is materialised this run; the warning just
 *   confirms the bump is being captured.
 *
 * `spaceId`, `descriptorHash`, and `pinnedHash` are threaded through
 * verbatim so the caller (logger / TerminalUI / strict-mode envelope)
 * has everything it needs to format the warning message without
 * re-reading the descriptor or the pinned file.
 */
export type SpaceContractDriftResult = {
  readonly kind: 'noDrift' | 'firstEmit' | 'drift';
  readonly spaceId: string;
  readonly descriptorHash: string;
  readonly pinnedHash: string | null;
};

/**
 * Pure drift-detection primitive for a single contract space.
 *
 * Runs once per loaded extension space, just before computing the
 * `priorContract` that feeds {@link import('./plan-all-spaces').planAllSpaces}.
 * Hash equality is byte-for-byte (no normalisation) — both sides are
 * already canonical hashes produced by the same pipeline, so any
 * difference is meaningful drift.
 *
 * Synchronous, pure, no I/O. The caller (SQL family in M2 R1) reads
 * the pinned `contract.json` and computes its hash, then invokes this
 * helper alongside the descriptor's `headRef.hash`. Composes naturally
 * with {@link import('./read-pinned-contract-hash').readPinnedContractHash}
 * which provides the read-side primitive.
 *
 * @see specs/framework-mechanism.spec.md § 3 — Drift detection (T1.9).
 * @see specs/framework-mechanism.spec.md AM7 — drift warning surfaces
 *   the extension name and the diff direction.
 */
export function detectSpaceContractDrift(
  spaceId: string,
  inputs: DetectSpaceContractDriftInputs,
): SpaceContractDriftResult {
  if (inputs.pinnedHash === null) {
    return {
      kind: 'firstEmit',
      spaceId,
      descriptorHash: inputs.descriptorHash,
      pinnedHash: null,
    };
  }
  if (inputs.descriptorHash === inputs.pinnedHash) {
    return {
      kind: 'noDrift',
      spaceId,
      descriptorHash: inputs.descriptorHash,
      pinnedHash: inputs.pinnedHash,
    };
  }
  return {
    kind: 'drift',
    spaceId,
    descriptorHash: inputs.descriptorHash,
    pinnedHash: inputs.pinnedHash,
  };
}
