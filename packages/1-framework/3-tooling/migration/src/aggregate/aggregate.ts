import { readFile } from 'node:fs/promises';
import type { Contract } from '@prisma-next/contract/types';
import { join } from 'pathe';
import {
  errorBundleNotFoundForGraphNode,
  errorContractDeserializationFailed,
  errorHashNotInGraph,
  errorInvalidJson,
  errorMissingFile,
  errorSnapshotMissing,
  MigrationToolsError,
} from '../errors';
import type { MigrationGraph } from '../graph';
import { isGraphNode } from '../graph-membership';
import type { IntegrityQueryOptions, IntegrityViolation } from '../integrity-violation';
import { reconstructGraph } from '../migration-graph';
import type { OnDiskMigrationPackage } from '../package';
import type { Refs } from '../refs';
import { readRefSnapshot } from '../refs/snapshot';
import type { ContractSpaceHeadRecord } from '../verify-contract-spaces';
import type {
  ContractAtOptions,
  ContractAtResult,
  ContractSpaceAggregate,
  ContractSpaceMember,
} from './types';

function hasErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as { code?: string }).code === code;
}

function contractAtMemoKey(hash: string, refName: string | undefined): string {
  return `${hash}\0${refName ?? ''}`;
}

function deserializeContractAtPath(
  filePath: string,
  contractJson: unknown,
  deserializeContract: (raw: unknown) => Contract,
): Contract {
  try {
    return deserializeContract(contractJson);
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw errorContractDeserializationFailed(filePath, message);
  }
}

async function readGraphNodeEndContract(
  packageDir: string,
  deserializeContract: (raw: unknown) => Contract,
): Promise<{ contractJson: unknown; contractDts: string; contract: Contract }> {
  const jsonPath = join(packageDir, 'end-contract.json');
  const dtsPath = join(packageDir, 'end-contract.d.ts');

  let rawJson: string;
  try {
    rawJson = await readFile(jsonPath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      throw errorMissingFile('end-contract.json', packageDir);
    }
    throw error;
  }

  let contractJson: unknown;
  try {
    contractJson = JSON.parse(rawJson);
  } catch (error) {
    throw errorInvalidJson(jsonPath, error instanceof Error ? error.message : String(error));
  }

  let contractDts: string;
  try {
    contractDts = await readFile(dtsPath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      throw errorMissingFile('end-contract.d.ts', packageDir);
    }
    throw error;
  }

  const contract = deserializeContractAtPath(jsonPath, contractJson, deserializeContract);
  return { contractJson, contractDts, contract };
}

async function resolveContractAt(args: {
  readonly hash: string;
  readonly opts: ContractAtOptions | undefined;
  readonly refsDir: string;
  readonly packages: readonly OnDiskMigrationPackage[];
  readonly graph: MigrationGraph;
  readonly deserializeContract: (raw: unknown) => Contract;
}): Promise<ContractAtResult> {
  const { hash, opts, refsDir, packages, graph, deserializeContract } = args;
  const refName = opts?.refName;

  if (refName !== undefined) {
    const snapshot = await readRefSnapshot(refsDir, refName);
    if (snapshot) {
      const jsonPath = join(refsDir, `${refName}.contract.json`);
      return {
        hash,
        contractJson: snapshot.contract,
        contractDts: snapshot.contractDts,
        contract: deserializeContractAtPath(jsonPath, snapshot.contract, deserializeContract),
      };
    }

    if (isGraphNode(hash, graph)) {
      return resolveGraphNodeContractAt({
        hash,
        packages,
        deserializeContract,
        explicitLabel: refName,
      });
    }

    throw errorSnapshotMissing(refName);
  }

  if (isGraphNode(hash, graph)) {
    return resolveGraphNodeContractAt({ hash, packages, deserializeContract });
  }

  throw errorHashNotInGraph(hash, graph);
}

async function resolveGraphNodeContractAt(args: {
  readonly hash: string;
  readonly packages: readonly OnDiskMigrationPackage[];
  readonly deserializeContract: (raw: unknown) => Contract;
  readonly explicitLabel?: string;
}): Promise<ContractAtResult> {
  const { hash, packages, deserializeContract, explicitLabel } = args;
  const matchingBundle = packages.find((pkg) => pkg.metadata.to === hash);
  if (!matchingBundle) {
    throw errorBundleNotFoundForGraphNode(hash, explicitLabel);
  }

  const { contractJson, contractDts, contract } = await readGraphNodeEndContract(
    matchingBundle.dirPath,
    deserializeContract,
  );
  return { hash, contractJson, contractDts, contract };
}

/**
 * Resolve a member's head ref, asserting it is present. The apply/verify
 * engine only runs after `checkIntegrity` has refused on `headRefMissing`,
 * so a member reaching the planner / verifier without a head ref is a
 * programming error (the integrity gate was skipped), not a user-facing
 * state. The app member's head ref is always synthesised, so this only
 * ever guards an ungated extension space.
 */
export function requireHeadRef(member: ContractSpaceMember): ContractSpaceHeadRecord {
  if (member.headRef === null) {
    throw new Error(
      `Contract space "${member.spaceId}" has no head ref; the integrity gate must refuse a missing head ref before planning or verifying.`,
    );
  }
  return member.headRef;
}

/**
 * Build a {@link ContractSpaceMember} with lazily-memoised `graph()`,
 * `contract()`, and `contractAt()` facets.
 *
 * `graph()` reconstructs the migration graph from `packages` on first
 * call and caches it. `contract()` calls `resolveContract` on first call
 * and caches the result; a throwing `resolveContract` (e.g. a missing or
 * undeserializable on-disk contract) re-throws on each call rather than
 * caching a value — `checkIntegrity` surfaces that as `contractUnreadable`.
 * `contractAt()` materializes the contract at an arbitrary graph node with
 * the same resolution order as plan-time ref resolution: ref snapshot first
 * (when `opts.refName` is set), else the matching package's `end-contract.*`.
 */
export function createContractSpaceMember(args: {
  readonly spaceId: string;
  readonly packages: readonly OnDiskMigrationPackage[];
  readonly refs: Refs;
  readonly headRef: ContractSpaceHeadRecord | null;
  readonly refsDir: string;
  readonly resolveContract: () => Contract;
  readonly deserializeContract: (raw: unknown) => Contract;
}): ContractSpaceMember {
  const { spaceId, packages, refs, headRef, refsDir, resolveContract, deserializeContract } = args;
  let graphMemo: MigrationGraph | undefined;
  let contractMemo: Contract | undefined;
  const contractAtMemo = new Map<string, ContractAtResult>();

  function memberGraph(): MigrationGraph {
    graphMemo ??= reconstructGraph(packages);
    return graphMemo;
  }

  return {
    spaceId,
    packages,
    refs,
    headRef,
    graph: memberGraph,
    contract() {
      contractMemo ??= resolveContract();
      return contractMemo;
    },
    async contractAt(hash, opts) {
      const key = contractAtMemoKey(hash, opts?.refName);
      const cached = contractAtMemo.get(key);
      if (cached) {
        return cached;
      }

      const result = await resolveContractAt({
        hash,
        opts,
        refsDir,
        packages,
        graph: memberGraph(),
        deserializeContract,
      });
      contractAtMemo.set(key, result);
      return result;
    },
  };
}

/**
 * Assemble a {@link ContractSpaceAggregate} value from its members and a
 * `checkIntegrity` implementation. The query methods (`listSpaces` /
 * `hasSpace` / `space` / `spaces`) are derived here so every aggregate —
 * loader-built or test-built — shares one query surface: `app` first,
 * then `extensions` in the order supplied (the loader sorts them
 * lex-ascending by `spaceId`).
 */
export function createContractSpaceAggregate(args: {
  readonly targetId: string;
  readonly app: ContractSpaceMember;
  readonly extensions: readonly ContractSpaceMember[];
  readonly checkIntegrity: (opts?: IntegrityQueryOptions) => readonly IntegrityViolation[];
}): ContractSpaceAggregate {
  const { targetId, app, extensions, checkIntegrity } = args;
  const ordered: readonly ContractSpaceMember[] = [app, ...extensions];
  const byId = new Map(ordered.map((m) => [m.spaceId, m]));
  return {
    targetId,
    app,
    extensions,
    listSpaces: () => ordered.map((m) => m.spaceId),
    hasSpace: (id) => byId.has(id),
    space: (id) => byId.get(id),
    spaces: () => ordered,
    checkIntegrity,
  };
}
