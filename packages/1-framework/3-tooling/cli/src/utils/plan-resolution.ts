import type { Contract } from '@prisma-next/contract/types';
import type { ContractSpaceMember } from '@prisma-next/migration-tools/aggregate';
import { MigrationToolsError } from '@prisma-next/migration-tools/errors';
import type { MigrationGraph } from '@prisma-next/migration-tools/graph';
import {
  assertHashIsGraphNode,
  findLatestMigration,
  isGraphNode,
} from '@prisma-next/migration-tools/migration-graph';
import type { ContractRef } from '@prisma-next/migration-tools/ref-resolution';
import { parseContractRef } from '@prisma-next/migration-tools/ref-resolution';
import type { Refs } from '@prisma-next/migration-tools/refs';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import {
  CliStructuredError,
  errorPlanForgotTheFlag,
  errorSnapshotMissing,
  errorUnexpected,
  mapRefResolutionError,
} from './cli-errors';
import { mapContractAtError } from './contract-at-errors';

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
  readonly member: ContractSpaceMember;
}

function graphIsEmpty(member: ContractSpaceMember): boolean {
  return member.packages.length === 0;
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

type RefContractResolution =
  | {
      kind: 'snapshot';
      hash: string;
      contract: Contract;
      contractJson: unknown;
      contractDts: string;
    }
  | {
      kind: 'graph-node';
      hash: string;
      contract: Contract;
      contractJson: unknown;
      contractDts: string;
      sourceDir: string;
    };

async function resolveContractRef(
  parsed: ContractRef,
  member: ContractSpaceMember,
  options?: { readonly explicitLabel?: string; readonly artifactRole?: 'from' | 'to' },
): Promise<Result<RefContractResolution, CliStructuredError>> {
  const { hash, provenance } = parsed;
  const refName = provenance.kind === 'ref' ? provenance.refName : undefined;

  try {
    const at = await member.contractAt(hash, refName !== undefined ? { refName } : undefined);

    if (refName !== undefined) {
      return ok({
        kind: 'snapshot',
        hash: at.hash,
        contract: at.contract,
        contractJson: at.contractJson,
        contractDts: at.contractDts,
      });
    }

    const matchingBundle = member.packages.find((pkg) => pkg.metadata.to === hash);
    if (!matchingBundle) {
      return notOk(
        errorUnexpected(
          options?.explicitLabel
            ? `No migration bundle found for reference "${options.explicitLabel}" (resolved hash: ${hash})`
            : `No migration bundle found for graph node ${hash}`,
          {
            why: `The hash ${hash} is a graph node but no on-disk migration package has an end-contract hash matching it.`,
            fix: 'Provide a ref or hash that corresponds to an existing migration package, or run `migration list` to see available migrations.',
          },
        ),
      );
    }

    return ok({
      kind: 'graph-node',
      hash: at.hash,
      contract: at.contract,
      contractJson: at.contractJson,
      contractDts: at.contractDts,
      sourceDir: matchingBundle.dirPath,
    });
  } catch (error) {
    return mapContractAtError(
      error,
      options?.artifactRole !== undefined ? { artifactRole: options.artifactRole } : undefined,
    );
  }
}

async function resolveFromPolicy(
  parsed: ContractRef,
  input: ResolveFromForPlanInput,
  refs: Refs,
  explicitFromLabel?: string,
): Promise<Result<FromResolution, CliStructuredError>> {
  const resolution = await resolveContractRef(parsed, input.member, {
    ...(explicitFromLabel !== undefined ? { explicitLabel: explicitFromLabel } : {}),
    artifactRole: 'from',
  });
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
  if (graphIsEmpty(input.member)) {
    return ok({
      kind: 'auto-baseline',
      fromHash: hash,
      fromContract: contract,
      contractDts,
      contractJson,
    });
  }

  const graph = input.member.graph();
  const graphTip = findLatestMigration(graph)?.to ?? null;
  try {
    assertFromIsGraphNode(hash, graph, refs, graphTip);
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
  const { optionsFrom, member } = input;
  const graph = member.graph();
  const refs = member.refs;

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
      const empty = graphIsEmpty(member);
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

export interface ResolveToForPlanInput {
  readonly member: ContractSpaceMember;
}

export interface ResolvedContractRef {
  readonly hash: string;
  readonly contract: Contract;
  readonly contractJson: unknown;
  readonly contractDts: string;
}

export async function resolveToForPlan(
  optionsTo: string,
  input: ResolveToForPlanInput,
): Promise<Result<ResolvedContractRef, CliStructuredError>> {
  const { member } = input;
  const graph = member.graph();
  const refs = member.refs;

  const refResult = parseContractRef(optionsTo, { graph, refs });
  if (!refResult.ok) {
    return notOk(mapRefResolutionError(refResult.failure));
  }

  const resolution = await resolveContractRef(refResult.value, member, {
    explicitLabel: optionsTo,
    artifactRole: 'to',
  });
  if (!resolution.ok) {
    return resolution;
  }

  const { hash, contract, contractJson, contractDts } = resolution.value;
  return ok({ hash, contract, contractJson, contractDts });
}
