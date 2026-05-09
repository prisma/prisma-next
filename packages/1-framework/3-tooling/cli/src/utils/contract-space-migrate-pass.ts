import {
  detectSpaceContractDrift,
  emitPinnedSpaceArtefacts,
  readPinnedContractHash,
  type SpaceContractDriftResult,
} from '@prisma-next/migration-tools/spaces';

/**
 * Minimal descriptor view consumed by the migrate-time per-space pass.
 *
 * The CLI receives descriptors typed against the SQL family (or any other
 * family in the future); this helper only needs the structural shape of
 * `contractSpace`, so it accepts an `unknown`-typed `contractJson` and
 * a structurally-typed `headRef`. SQL-family callers pass the same
 * `Contract<SqlStorage>` value through unchanged — `emitPinnedSpaceArtefacts`
 * already serialises through `canonicalizeJson` and is framework-neutral.
 *
 * @see specs/framework-mechanism.spec.md § 3 — Per-space helper location.
 */
export interface MigrateExtensionInput {
  readonly id: string;
  readonly contractSpace?: {
    readonly contractJson: unknown;
    readonly headRef: { readonly hash: string; readonly invariants: readonly string[] };
  };
}

/**
 * Inputs needed to compose the migrate-time per-space pass at the CLI
 * surface — typically called once after the app-space migration package
 * has been written, regardless of whether the app-space had structural
 * changes (an extension bump alone should still re-pin its artefacts).
 */
export interface ContractSpaceMigratePassInputs {
  readonly migrationsDir: string;
  readonly extensionPacks: ReadonlyArray<MigrateExtensionInput>;
}

export interface ContractSpaceMigratePassResult {
  readonly drifts: readonly SpaceContractDriftResult[];
  readonly emittedSpaceIds: readonly string[];
}

/**
 * Run drift detection + pinned-artefact emission for every loaded
 * extension space at `migrate` time.
 *
 * Per sub-spec § 3:
 *
 * - For each declared extension that exposes a `contractSpace`:
 *   - Read the pinned head hash from `migrations/<spaceId>/refs/head.json`
 *     (returns `null` on first emit).
 *   - Compare against the descriptor's `headRef.hash` via
 *     `detectSpaceContractDrift`. The `kind` discriminant decides whether
 *     the user sees a warning (`drift`), a no-op silent emit (`firstEmit`,
 *     `noDrift`), or nothing at all.
 *   - Always re-emit the pinned artefacts (`contract.json`, `contract.d.ts`,
 *     `refs/head.json`). The framework owns these files and the helper is
 *     idempotent.
 *
 * Drift warnings are returned to the caller for formatting (TerminalUI,
 * structured-output envelope, etc.) — the helper does not print directly,
 * keeping it framework-neutral and unit-testable.
 *
 * Extension migration packages (the descriptor's pre-canned `migrations`
 * array → `migrations/<spaceId>/<dirName>/`) are intentionally not
 * materialised here — that interaction will be wired in a follow-on round
 * once the runner-side single-tx slice (sub-spec § 6) is in place. Pinned
 * artefacts on disk are sufficient to lock the drift-warning behaviour
 * and the always-on re-pin AC for R2.
 *
 * @see specs/framework-mechanism.spec.md § 3 — Drift detection (T1.9).
 */
export async function runContractSpaceMigratePass(
  inputs: ContractSpaceMigratePassInputs,
): Promise<ContractSpaceMigratePassResult> {
  const drifts: SpaceContractDriftResult[] = [];
  const emittedSpaceIds: string[] = [];

  for (const pack of inputs.extensionPacks) {
    if (pack.contractSpace === undefined) continue;
    const { contractJson, headRef } = pack.contractSpace;

    const pinnedHash = await readPinnedContractHash(inputs.migrationsDir, pack.id);
    const drift = detectSpaceContractDrift(pack.id, {
      descriptorHash: headRef.hash,
      pinnedHash,
    });
    drifts.push(drift);

    await emitPinnedSpaceArtefacts(inputs.migrationsDir, pack.id, {
      contract: contractJson,
      contractDts: buildPlaceholderContractDts(pack.id),
      headRef: { hash: headRef.hash, invariants: headRef.invariants },
    });
    emittedSpaceIds.push(pack.id);
  }

  return { drifts, emittedSpaceIds };
}

/**
 * Format the user-facing drift warning for a single space. Callers
 * funnel this through their preferred output channel (TerminalUI line,
 * structured-output envelope `warnings[]`, etc.).
 *
 * Locks AM7 — drift warning surfaces the extension name and the diff
 * direction (descriptor → pinned).
 */
export function formatContractSpaceDriftWarning(drift: SpaceContractDriftResult): string {
  if (drift.kind !== 'drift') {
    throw new Error(`formatContractSpaceDriftWarning called with non-drift result: ${drift.kind}`);
  }
  return (
    `Contract-space drift detected for "${drift.spaceId}": descriptor hash ` +
    `${drift.descriptorHash} differs from pinned hash ${drift.pinnedHash ?? '<none>'}. ` +
    `The pinned files under migrations/${drift.spaceId}/ will be refreshed to match the descriptor.`
  );
}

/**
 * Placeholder `.d.ts` content for an extension space's pinned mirror.
 *
 * Rendering a fully-typed `.d.ts` for an extension contract requires the
 * SQL-family renderer with the codec / typemap registry threaded
 * through; that integration is a deferred follow-up.
 *
 * Until it ships, the pinned `.d.ts` is a `@ts-nocheck` stub. Pinned
 * per-space artefact byte-equivalence under `migrate` (the related
 * acceptance property) is therefore PARTIAL today: a placeholder
 * cannot be byte-equal to a fully-rendered `.d.ts` from the same
 * descriptor. The guarantee becomes fully-PASS once the typed renderer
 * gets its first real extension-space consumer.
 */
function buildPlaceholderContractDts(spaceId: string): string {
  return [
    '// @ts-nocheck',
    '/**',
    ` * Placeholder \`.d.ts\` for extension space "${spaceId}".`,
    ' *',
    ' * The framework re-emits this file on every `migrate` run alongside',
    ' * `contract.json` and `refs/head.json`. A typed `.d.ts` rendering',
    " * pass for extension contracts is tracked under the project's open",
    ' * questions; until that ships, consumers should import',
    ' * `contract.json` directly with `validateContract<…>(…)`.',
    ' */',
    'export {};',
    '',
  ].join('\n');
}
