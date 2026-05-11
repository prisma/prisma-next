import { emitContractSpaceArtefacts } from '@prisma-next/migration-tools/spaces';

/**
 * Minimal descriptor view consumed by the migrate-time per-space pass.
 *
 * The CLI receives descriptors typed against the SQL family (or any other
 * family in the future); this helper only needs the structural shape of
 * `contractSpace`, so it accepts an `unknown`-typed `contractJson` and
 * a structurally-typed `headRef`. SQL-family callers pass the same
 * `Contract<SqlStorage>` value through unchanged — `emitContractSpaceArtefacts`
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
  readonly emittedSpaceIds: readonly string[];
}

/**
 * Unconditionally re-emit on-disk artefacts for every loaded extension
 * space at `migrate` time.
 *
 * For each declared extension that exposes a `contractSpace`, write
 * `contract.json` / `contract.d.ts` / `refs/head.json` from the
 * descriptor. The framework owns these files; the helper is idempotent
 * and the descriptor wins (no comparison against on-disk state).
 */
export async function runContractSpaceMigratePass(
  inputs: ContractSpaceMigratePassInputs,
): Promise<ContractSpaceMigratePassResult> {
  const emittedSpaceIds: string[] = [];

  for (const pack of inputs.extensionPacks) {
    if (pack.contractSpace === undefined) continue;
    const { contractJson, headRef } = pack.contractSpace;

    await emitContractSpaceArtefacts(inputs.migrationsDir, pack.id, {
      contract: contractJson,
      contractDts: buildPlaceholderContractDts(pack.id),
      headRef: { hash: headRef.hash, invariants: headRef.invariants },
    });
    emittedSpaceIds.push(pack.id);
  }

  return { emittedSpaceIds };
}

/**
 * Placeholder `.d.ts` content for an extension space's on-disk mirror.
 *
 * Rendering a fully-typed `.d.ts` for an extension contract requires the
 * SQL-family renderer with the codec / typemap registry threaded
 * through; that integration is tracked under sub-spec Open Question 3
 * (see `projects/extension-contract-spaces/specs/framework-mechanism.spec.md`).
 *
 * Until that ships, the on-disk `.d.ts` is a `@ts-nocheck` stub. The
 * spec gap closing alongside the typed renderer is **AC2 / AC14**
 * (byte-equivalence of per-space artefacts under `migrate`):
 * a placeholder cannot be byte-equal to a fully-rendered `.d.ts` from
 * the same descriptor, so AC2 / AC14 are PARTIAL today and become
 * fully-PASS once OQ3 closes.
 *
 * Scheduled to close in **M3** (cipherstash editor tooling) — that's
 * the milestone where the typed renderer gets its first real
 * extension-space consumer and the byte-equivalence guarantee is
 * practically required.
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
