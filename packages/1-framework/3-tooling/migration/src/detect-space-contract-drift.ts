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
 * `priorHeadHash` is `null` when no `contract.json` exists yet on disk for
 * the space (the descriptor declares an extension that has never been
 * emitted into the user's repo). That's the "first emit" case — no
 * drift to surface; the migrate emit will create the on-disk artefacts.
 */
export interface DetectSpaceContractDriftInputs {
  readonly descriptorHash: string;
  readonly priorHeadHash: string | null;
}

/**
 * Result discriminant for {@link detectSpaceContractDrift}.
 *
 * - `noDrift`: descriptor hash and on-disk head hash agree byte-for-byte.
 *   The migrate emit can proceed with no warning.
 * - `firstEmit`: no on-disk `contract.json` on disk yet. The extension
 *   was just added to `extensionPacks`; this run will create the
 *   on-disk artefacts. No warning either — the user's intent is to install
 *   the extension, not to "drift" from a state they haven't recorded.
 * - `drift`: descriptor hash differs from on-disk head hash. The caller
 *   surfaces a non-fatal warning naming the extension and the
 *   diff direction (descriptor → on-disk head). The migrate emit proceeds
 *   normally so the bump is materialised this run; the warning just
 *   confirms the bump is being captured.
 *
 * `spaceId`, `descriptorHash`, and `priorHeadHash` are threaded through
 * verbatim so the caller (logger / TerminalUI / strict-mode envelope)
 * has everything it needs to format the warning message without
 * re-reading the descriptor or the on-disk artefact.
 */
export type SpaceContractDriftResult = {
  readonly kind: 'noDrift' | 'firstEmit' | 'drift';
  readonly spaceId: string;
  readonly descriptorHash: string;
  readonly priorHeadHash: string | null;
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
 * Synchronous, pure, no I/O. The caller (SQL family) reads the on-disk
 * `contract.json` and computes its hash, then invokes this helper
 * alongside the descriptor's `headRef.hash`. Composes naturally with
 * {@link import('./read-contract-space-head-ref').readContractSpaceHeadRef}
 * which provides the read-side primitive.
 *
 * The drift warning surfaces the extension name and the diff direction.
 */
export function detectSpaceContractDrift(
  spaceId: string,
  inputs: DetectSpaceContractDriftInputs,
): SpaceContractDriftResult {
  if (inputs.priorHeadHash === null) {
    return {
      kind: 'firstEmit',
      spaceId,
      descriptorHash: inputs.descriptorHash,
      priorHeadHash: null,
    };
  }
  if (inputs.descriptorHash === inputs.priorHeadHash) {
    return {
      kind: 'noDrift',
      spaceId,
      descriptorHash: inputs.descriptorHash,
      priorHeadHash: inputs.priorHeadHash,
    };
  }
  return {
    kind: 'drift',
    spaceId,
    descriptorHash: inputs.descriptorHash,
    priorHeadHash: inputs.priorHeadHash,
  };
}
