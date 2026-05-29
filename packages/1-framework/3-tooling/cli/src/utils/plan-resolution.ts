import type { Contract } from '@prisma-next/contract/types';
import type { ControlFamilyInstance } from '@prisma-next/framework-components/control';
import { MigrationToolsError } from '@prisma-next/migration-tools/errors';
import type { MigrationGraph } from '@prisma-next/migration-tools/graph';
import {
  assertHashIsGraphNode,
  findLatestMigration,
  isGraphNode,
} from '@prisma-next/migration-tools/migration-graph';
import type { OnDiskMigrationPackage } from '@prisma-next/migration-tools/package';
import type { ContractRef } from '@prisma-next/migration-tools/ref-resolution';
import { parseContractRef } from '@prisma-next/migration-tools/ref-resolution';
import type { Refs } from '@prisma-next/migration-tools/refs';
import { readRefSnapshot, readRefs } from '@prisma-next/migration-tools/refs';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import {
  CliStructuredError,
  errorContractValidationFailed,
  errorPlanForgotTheFlag,
  errorSnapshotMissing,
  errorUnexpected,
  mapMigrationToolsError,
  mapRefResolutionError,
} from './cli-errors';

const FULL_HASH_PATTERN = /^sha256:([0-9a-f]{64}|empty)$/;

export function looksLikeFullHash(input: string): boolean {
  return FULL_HASH_PATTERN.test(input);
}

export type FromResolution =
  | { kind: 'greenfield'; fromHash: null; fromContract: null }
  | { kind: 'graph-node'; fromHash: string; fromContract: Contract; sourceDir: string }
  | {
      kind: 'snapshot';
      fromHash: string;
      fromContract: Contract;
      contractDts: string;
      contractJson: unknown;
    }
  | {
      kind: 'auto-baseline';
      fromHash: string;
      fromContract: Contract;
      contractDts: string;
      contractJson: unknown;
    };

export interface ResolveFromForPlanInput {
  readonly optionsFrom?: string | undefined;
  readonly refsDir: string;
  readonly bundles: readonly OnDiskMigrationPackage[];
  readonly graph: MigrationGraph;
  readonly familyInstance: ControlFamilyInstance<string, unknown>;
  readonly readBundleEndContract: (migrationDir: string) => Promise<Contract>;
}

function graphIsEmpty(bundles: readonly OnDiskMigrationPackage[]): boolean {
  return bundles.length === 0;
}

function getReachableRefs(
  refs: Refs,
  graph: MigrationGraph,
): ReadonlyArray<{ name: string; hash: string }> {
  return Object.entries(refs)
    .flatMap(([name, entry]) =>
      entry && isGraphNode(entry.hash, graph) ? [{ name, hash: entry.hash }] : [],
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function assertFromIsGraphNode(
  fromHash: string,
  graph: MigrationGraph,
  refs: Refs,
  graphTipHash: string | null,
): void {
  try {
    assertHashIsGraphNode(fromHash, graph);
  } catch (error) {
    if (MigrationToolsError.is(error) && error.code === 'MIGRATION.HASH_NOT_IN_GRAPH') {
      throw errorPlanForgotTheFlag(fromHash, getReachableRefs(refs, graph), graphTipHash);
    }
    throw error;
  }
}

async function deserializeSnapshotContract(
  familyInstance: ControlFamilyInstance<string, unknown>,
  contract: unknown,
): Promise<Result<Contract, CliStructuredError>> {
  try {
    return ok(familyInstance.deserializeContract(contract));
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    return notOk(
      errorContractValidationFailed(
        `Ref snapshot contract failed to deserialize: ${error instanceof Error ? error.message : String(error)}`,
        { where: { path: 'ref-snapshot' } },
      ),
    );
  }
}

/**
 * Materialized destination/source contract for an explicitly-parsed
 * reference. Both `--from` and `--to` resolve through {@link resolveContractRef}
 * to one of these variants:
 *
 *   - `snapshot`: the contract came from a ref's paired snapshot, so the raw
 *     `contractJson` / `contractDts` are already in hand.
 *   - `graph-node`: the hash is a migration graph node; `sourceDir` names the
 *     on-disk package whose `end-contract.*` carries the materialized contract.
 */
type RefContractResolution =
  | {
      kind: 'snapshot';
      hash: string;
      contract: Contract;
      contractJson: unknown;
      contractDts: string;
    }
  | { kind: 'graph-node'; hash: string; contract: Contract; sourceDir: string };

async function resolveGraphNodeFromBundle(
  hash: string,
  bundles: readonly OnDiskMigrationPackage[],
  readBundleEndContract: (migrationDir: string) => Promise<Contract>,
  explicitLabel?: string,
): Promise<Result<Extract<RefContractResolution, { kind: 'graph-node' }>, CliStructuredError>> {
  const matchingBundle = bundles.find((pkg) => pkg.metadata.to === hash);
  if (!matchingBundle) {
    return notOk(
      errorUnexpected(
        explicitLabel
          ? `No migration bundle found for reference "${explicitLabel}" (resolved hash: ${hash})`
          : `No migration bundle found for graph node ${hash}`,
        {
          why: `The hash ${hash} is a graph node but no on-disk migration package has an end-contract hash matching it.`,
          fix: 'Provide a ref or hash that corresponds to an existing migration package, or run `migration list` to see available migrations.',
        },
      ),
    );
  }
  try {
    const contract = await readBundleEndContract(matchingBundle.dirPath);
    return ok({ kind: 'graph-node', hash, contract, sourceDir: matchingBundle.dirPath });
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    throw error;
  }
}

/**
 * Shared reference→contract resolution core for `migration plan`. Maps a
 * successfully-parsed {@link ContractRef} to a materialized
 * {@link RefContractResolution}, dispatching on provenance:
 *
 *   - `ref`: prefer the ref's paired snapshot; fall back to the matching graph
 *     node's on-disk bundle; otherwise the ref points at no contract source.
 *   - `hash` / migration directory: resolve the graph node's bundle directly.
 *
 * `--from`-specific policy (greenfield default, auto-baseline on an empty
 * graph, graph-node reachability assertions) is layered on top by
 * {@link resolveFromPolicy}; `--to` consumes the resolution as-is.
 */
async function resolveContractRef(
  parsed: ContractRef,
  input: ResolveFromForPlanInput,
  explicitLabel?: string,
): Promise<Result<RefContractResolution, CliStructuredError>> {
  const { refsDir, bundles, graph, familyInstance, readBundleEndContract } = input;
  const { hash, provenance } = parsed;

  if (provenance.kind === 'ref') {
    let snapshot: Awaited<ReturnType<typeof readRefSnapshot>>;
    try {
      snapshot = await readRefSnapshot(refsDir, provenance.refName);
    } catch (error) {
      if (MigrationToolsError.is(error)) {
        return notOk(mapMigrationToolsError(error));
      }
      throw error;
    }

    if (snapshot) {
      const contractResult = await deserializeSnapshotContract(familyInstance, snapshot.contract);
      if (!contractResult.ok) {
        return contractResult;
      }
      return ok({
        kind: 'snapshot',
        hash,
        contract: contractResult.value,
        contractJson: snapshot.contract,
        contractDts: snapshot.contractDts,
      });
    }

    if (isGraphNode(hash, graph)) {
      return resolveGraphNodeFromBundle(hash, bundles, readBundleEndContract, explicitLabel);
    }

    return notOk(errorSnapshotMissing(provenance.refName));
  }

  if (isGraphNode(hash, graph)) {
    return resolveGraphNodeFromBundle(hash, bundles, readBundleEndContract, explicitLabel);
  }

  throw new Error(
    `resolveContractRef: non-graph-node hash ${hash} should be refused via looksLikeFullHash before this helper is called`,
  );
}

/**
 * Apply `--from`-specific policy on top of the shared {@link resolveContractRef}
 * core: relabel a snapshot resolution as `auto-baseline` on an empty graph,
 * and otherwise assert the resolved from-hash is reachable in the graph.
 */
async function resolveFromPolicy(
  parsed: ContractRef,
  input: ResolveFromForPlanInput,
  refs: Refs,
  explicitFromLabel?: string,
): Promise<Result<FromResolution, CliStructuredError>> {
  const resolution = await resolveContractRef(parsed, input, explicitFromLabel);
  if (!resolution.ok) {
    return resolution;
  }

  if (resolution.value.kind === 'graph-node') {
    return ok({
      kind: 'graph-node',
      fromHash: resolution.value.hash,
      fromContract: resolution.value.contract,
      sourceDir: resolution.value.sourceDir,
    });
  }

  const { hash, contract, contractJson, contractDts } = resolution.value;
  if (graphIsEmpty(input.bundles)) {
    return ok({
      kind: 'auto-baseline',
      fromHash: hash,
      fromContract: contract,
      contractDts,
      contractJson,
    });
  }

  const graphTip = findLatestMigration(input.graph)?.to ?? null;
  try {
    assertFromIsGraphNode(hash, input.graph, refs, graphTip);
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    throw error;
  }
  return ok({
    kind: 'snapshot',
    fromHash: hash,
    fromContract: contract,
    contractDts,
    contractJson,
  });
}

export async function resolveFromForPlan(
  input: ResolveFromForPlanInput,
): Promise<Result<FromResolution, CliStructuredError>> {
  const { optionsFrom, refsDir, graph } = input;

  let refs: Refs;
  try {
    refs = await readRefs(refsDir);
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(mapMigrationToolsError(error));
    }
    throw error;
  }

  if (optionsFrom === undefined) {
    const dbRef = refs['db'];
    if (!dbRef) {
      return ok({ kind: 'greenfield', fromHash: null, fromContract: null });
    }
    return resolveFromPolicy(
      { hash: dbRef.hash, provenance: { kind: 'ref', refName: 'db' } },
      input,
      refs,
    );
  }

  const refResult = parseContractRef(optionsFrom, { graph, refs });
  if (!refResult.ok) {
    if (looksLikeFullHash(optionsFrom)) {
      const empty = graphIsEmpty(input.bundles);
      const graphTip = findLatestMigration(graph)?.to ?? null;
      if (empty) {
        return notOk(errorSnapshotMissing(optionsFrom, { viaRef: false }));
      }
      return notOk(errorPlanForgotTheFlag(optionsFrom, getReachableRefs(refs, graph), graphTip));
    }
    return notOk(mapRefResolutionError(refResult.failure));
  }

  return resolveFromPolicy(refResult.value, input, refs, optionsFrom);
}

/**
 * Raw destination contract artifacts read from a migration package's sibling
 * `end-contract.json` / `end-contract.d.ts`. Injected by the command so the
 * resolver stays free of direct filesystem access.
 */
export interface ResolveToForPlanInput extends ResolveFromForPlanInput {
  readonly readBundleEndArtifacts: (
    migrationDir: string,
  ) => Promise<{ contractJson: unknown; contractDts: string }>;
}

/**
 * A fully-materialized contract reference: the resolved hash plus the
 * destination contract in every shape `migration plan` needs — the hydrated
 * `Contract` for the planner, and the raw `contractJson` / `contractDts` to
 * write as the package's `end-contract.*`.
 */
export interface ResolvedContractRef {
  readonly hash: string;
  readonly contract: Contract;
  readonly contractJson: unknown;
  readonly contractDts: string;
}

/**
 * Resolve `migration plan --to <ref>` to its destination contract, accepting
 * the same reference grammar as `--from` (full hash, prefix, ref name,
 * migration directory name, `<dir>^`). Shares {@link resolveContractRef} with
 * `--from`; for a graph-node target it reads the matching bundle's
 * `end-contract.*` via the injected {@link ResolveToForPlanInput.readBundleEndArtifacts}.
 */
export async function resolveToForPlan(
  optionsTo: string,
  input: ResolveToForPlanInput,
): Promise<Result<ResolvedContractRef, CliStructuredError>> {
  const { refsDir, graph, readBundleEndArtifacts } = input;

  let refs: Refs;
  try {
    refs = await readRefs(refsDir);
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(mapMigrationToolsError(error));
    }
    throw error;
  }

  const refResult = parseContractRef(optionsTo, { graph, refs });
  if (!refResult.ok) {
    return notOk(mapRefResolutionError(refResult.failure));
  }

  const resolution = await resolveContractRef(refResult.value, input, optionsTo);
  if (!resolution.ok) {
    return resolution;
  }

  if (resolution.value.kind === 'snapshot') {
    const { hash, contract, contractJson, contractDts } = resolution.value;
    return ok({ hash, contract, contractJson, contractDts });
  }

  const { hash, contract, sourceDir } = resolution.value;
  try {
    const { contractJson, contractDts } = await readBundleEndArtifacts(sourceDir);
    return ok({ hash, contract, contractJson, contractDts });
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    if (MigrationToolsError.is(error)) {
      return notOk(mapMigrationToolsError(error));
    }
    throw error;
  }
}
