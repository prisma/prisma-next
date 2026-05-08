import {
  APP_SPACE_ID,
  gatherDiskContractSpaceState,
  type SpaceVerifierViolation,
  verifyContractSpaces,
} from '@prisma-next/migration-tools/spaces';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { CliStructuredError } from './cli-errors';

/**
 * Inputs needed to compose the per-space verifier at the CLI layer.
 * Pulled from the loaded `prisma-next.config.ts` plus the resolved
 * project `migrations/` directory.
 */
export interface ContractSpaceVerifierPrecheckInputs {
  readonly migrationsDir: string;
  readonly extensionPacks: ReadonlyArray<{
    readonly id: string;
    readonly contractSpace?: unknown;
  }>;
}

/**
 * Run the structural per-space verifier (sub-spec § 4) at the CLI surface
 * before invoking any database-touching operation.
 *
 * The check covers the three orphan / missing kinds that are decidable
 * without a database connection: `declaredButUnmigrated`,
 * `orphanPinnedDir`, plus the future hash / invariant comparisons once
 * marker rows are threaded through (deferred to R3 alongside the
 * single-tx runner work — `verifyContractSpaces` accepts an empty marker
 * map and simply does not surface those kinds).
 *
 * Surfaces violations as a structured CLI error whose envelope lists
 * every offence at once (so users see the full picture rather than
 * fixing them one at a time across re-runs).
 *
 * @see specs/framework-mechanism.spec.md § 4 — Verifier (T1.5).
 */
export async function runContractSpaceVerifierPrecheck(
  inputs: ContractSpaceVerifierPrecheckInputs,
): Promise<Result<void, CliStructuredError>> {
  const declaredExtensionSpaceIds = inputs.extensionPacks
    .filter((pack) => pack.contractSpace !== undefined)
    .map((pack) => pack.id);
  const loadedSpaces = new Set<string>([APP_SPACE_ID, ...declaredExtensionSpaceIds]);

  const diskState = await gatherDiskContractSpaceState({
    projectMigrationsDir: inputs.migrationsDir,
    loadedSpaceIds: loadedSpaces,
  });

  const result = verifyContractSpaces({
    loadedSpaces,
    pinnedDirsOnDisk: diskState.pinnedDirsOnDisk,
    pinnedHashesBySpace: diskState.pinnedHashesBySpace,
    markerRowsBySpace: new Map(),
  });

  if (result.ok) return ok(undefined);
  return notOk(buildContractSpaceVerifierError(result.violations));
}

function buildContractSpaceVerifierError(
  violations: readonly SpaceVerifierViolation[],
): CliStructuredError {
  const lines = violations.map((v) => `- [${v.kind}] ${v.spaceId}: ${v.remediation}`);
  const summary =
    violations.length === 1
      ? 'Contract-space layout violation detected'
      : `Contract-space layout violations detected (${violations.length})`;
  return new CliStructuredError('5001', summary, {
    domain: 'MIG',
    why: `The on-disk \`migrations/\` directory and your \`extensionPacks\` declaration are not in agreement.\n${lines.join('\n')}`,
    fix: violations[0]?.remediation ?? 'Review and reconcile the violations listed above.',
    docsUrl: 'https://pris.ly/contract-spaces',
    meta: {
      violations: violations.map((v) => ({
        kind: v.kind,
        spaceId: v.spaceId,
        remediation: v.remediation,
      })),
    },
  });
}
