import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import {
  APP_SPACE_ID,
  gatherDiskContractSpaceState,
  type SpaceVerifierViolation,
  verifyContractSpaces,
} from '@prisma-next/migration-tools/spaces';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { CliStructuredError } from './cli-errors';

/**
 * Inputs for the marker-aware verifier pass.
 *
 * Mirrors {@link import('./contract-space-verifier-precheck').ContractSpaceVerifierPrecheckInputs}
 * but threads the marker rows the caller has just read from the database.
 * Used by `db verify` after connection is established and the live
 * marker rows are available; covers the marker-half of the verifier
 * (orphan marker rows, marker-vs-pinned hash / invariants drift).
 */
export interface ContractSpaceVerifierMarkerCheckInputs {
  readonly migrationsDir: string;
  readonly extensionPacks: ReadonlyArray<{
    readonly id: string;
    readonly contractSpace?: unknown;
  }>;
  readonly markerRowsBySpace: ReadonlyMap<string, ContractMarkerRecord>;
}

/**
 * Run the full per-space verifier — same composition as
 * {@link import('./contract-space-verifier-precheck').runContractSpaceVerifierPrecheck}
 * but with marker rows threaded through. Surfaces every violation kind
 * the helper supports:
 *
 * - `declaredButUnmigrated` — extension declared in `extensionPacks` but
 *   no pinned dir on disk (also caught by the layout-only precheck).
 * - `orphanPinnedDir` — pinned dir on disk for a space that's not in
 *   `extensionPacks` (also caught by the layout-only precheck).
 * - `orphanMarker` — marker row for a space that's not in `extensionPacks`.
 * - `hashMismatch` — marker hash does not match pinned hash for a space.
 * - `invariantsMismatch` — marker is missing invariants the pinned
 *   `refs/head.json` declares.
 *
 * Promotes the layout-only precheck into a full check at the cost of a
 * single extra `SELECT` on `prisma_contract.marker`. Surfaces every
 * violation in one structured envelope (so users see the full picture).
 */
export async function runContractSpaceVerifierMarkerCheck(
  inputs: ContractSpaceVerifierMarkerCheckInputs,
): Promise<Result<void, CliStructuredError>> {
  const declaredExtensionSpaceIds = inputs.extensionPacks
    .filter((pack) => pack.contractSpace !== undefined)
    .map((pack) => pack.id);
  const loadedSpaces = new Set<string>([APP_SPACE_ID, ...declaredExtensionSpaceIds]);

  const diskState = await gatherDiskContractSpaceState({
    projectMigrationsDir: inputs.migrationsDir,
    loadedSpaceIds: loadedSpaces,
  });

  const markerRowsBySpace = new Map(
    [...inputs.markerRowsBySpace.entries()].map(([space, marker]) => [
      space,
      {
        hash: marker.storageHash,
        invariants: marker.invariants,
      },
    ]),
  );

  const result = verifyContractSpaces({
    loadedSpaces,
    pinnedDirsOnDisk: diskState.pinnedDirsOnDisk,
    pinnedHashesBySpace: diskState.pinnedHashesBySpace,
    markerRowsBySpace,
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
      ? 'Contract-space verifier found a violation'
      : `Contract-space verifier found violations (${violations.length})`;
  return new CliStructuredError('5002', summary, {
    domain: 'MIG',
    why: `The on-disk \`migrations/\` directory, the \`extensionPacks\` declaration, and the live database marker rows are not in agreement.\n${lines.join('\n')}`,
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
