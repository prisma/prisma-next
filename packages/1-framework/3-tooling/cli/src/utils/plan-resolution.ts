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

async function resolveGraphNodeFromBundle(
  fromHash: string,
  bundles: readonly OnDiskMigrationPackage[],
  readBundleEndContract: (migrationDir: string) => Promise<Contract>,
  explicitFromLabel?: string,
): Promise<Result<Extract<FromResolution, { kind: 'graph-node' }>, CliStructuredError>> {
  const matchingBundle = bundles.find((pkg) => pkg.metadata.to === fromHash);
  if (!matchingBundle) {
    return notOk(
      errorUnexpected(
        explicitFromLabel
          ? `No migration bundle found for --from "${explicitFromLabel}" (resolved hash: ${fromHash})`
          : `No migration bundle found for graph node ${fromHash}`,
        {
          why: `The hash ${fromHash} is a graph node but no on-disk migration package has an end-contract hash matching it.`,
          fix: 'Provide a ref or hash that corresponds to an existing migration package, or run `migration list` to see available migrations.',
        },
      ),
    );
  }
  try {
    const fromContract = await readBundleEndContract(matchingBundle.dirPath);
    return ok({
      kind: 'graph-node',
      fromHash,
      fromContract,
      sourceDir: matchingBundle.dirPath,
    });
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    throw error;
  }
}

async function resolveFromRefName(
  refName: string,
  fromHash: string,
  input: ResolveFromForPlanInput,
  refs: Refs,
): Promise<Result<FromResolution, CliStructuredError>> {
  const { refsDir, bundles, graph, familyInstance, readBundleEndContract } = input;
  const empty = graphIsEmpty(bundles);
  const graphTip = findLatestMigration(graph)?.to ?? null;

  let snapshot: Awaited<ReturnType<typeof readRefSnapshot>>;
  try {
    snapshot = await readRefSnapshot(refsDir, refName);
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
    const fromContract = contractResult.value;
    const { contractDts, contract: contractJson } = snapshot;
    if (empty) {
      return ok({ kind: 'auto-baseline', fromHash, fromContract, contractDts, contractJson });
    }
    try {
      assertFromIsGraphNode(fromHash, graph, refs, graphTip);
    } catch (error) {
      if (CliStructuredError.is(error)) {
        return notOk(error);
      }
      throw error;
    }
    return ok({ kind: 'snapshot', fromHash, fromContract, contractDts, contractJson });
  }

  if (isGraphNode(fromHash, graph)) {
    return resolveGraphNodeFromBundle(fromHash, bundles, readBundleEndContract);
  }

  return notOk(errorSnapshotMissing(refName));
}

async function resolveFromHashProvenance(
  fromHash: string,
  input: ResolveFromForPlanInput,
  refs: Refs,
  explicitFromLabel?: string,
): Promise<Result<FromResolution, CliStructuredError>> {
  const { bundles, graph } = input;
  const empty = graphIsEmpty(bundles);
  const graphTip = findLatestMigration(graph)?.to ?? null;

  if (isGraphNode(fromHash, graph)) {
    return resolveGraphNodeFromBundle(
      fromHash,
      bundles,
      input.readBundleEndContract,
      explicitFromLabel,
    );
  }

  if (empty) {
    return notOk(errorSnapshotMissing(fromHash, { viaRef: false }));
  }

  return notOk(errorPlanForgotTheFlag(fromHash, getReachableRefs(refs, graph), graphTip));
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
    return resolveFromRefName('db', dbRef.hash, input, refs);
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

  const { hash: fromHash, provenance } = refResult.value;

  if (provenance.kind === 'ref') {
    return resolveFromRefName(provenance.refName, fromHash, input, refs);
  }

  return resolveFromHashProvenance(fromHash, input, refs, optionsFrom);
}
