import { readFile } from 'node:fs/promises';
import type { Contract, StorageNamespace } from '@prisma-next/contract/types';
import { elementCoordinates } from '@prisma-next/framework-components/ir';
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
  AggregateContractSpace,
  ContractAtOptions,
  ContractAtResult,
  ContractSpaceAggregate,
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
        provenance: 'snapshot',
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
  return {
    hash,
    contractJson,
    contractDts,
    contract,
    provenance: 'graph-node',
    sourceDir: matchingBundle.dirPath,
  };
}

/**
 * Resolve a contract space's head ref, asserting it is present. The apply/verify
 * engine only runs after `checkIntegrity` has refused on `headRefMissing`,
 * so a space reaching the planner / verifier without a head ref is a
 * programming error (the integrity gate was skipped), not a user-facing
 * state. The app space's head ref is always synthesised, so this only
 * ever guards an ungated extension space.
 */
export function requireHeadRef(space: AggregateContractSpace): ContractSpaceHeadRecord {
  if (space.headRef === null) {
    throw new Error(
      `Contract space "${space.spaceId}" has no head ref; the integrity gate must refuse a missing head ref before planning or verifying.`,
    );
  }
  return space.headRef;
}

/**
 * Build a {@link AggregateContractSpace} with lazily-memoised `graph()`,
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
export function createAggregateContractSpace(args: {
  readonly spaceId: string;
  readonly packages: readonly OnDiskMigrationPackage[];
  readonly refs: Refs;
  readonly headRef: ContractSpaceHeadRecord | null;
  readonly refsDir: string;
  readonly resolveContract: () => Contract;
  readonly deserializeContract: (raw: unknown) => Contract;
}): AggregateContractSpace {
  const { spaceId, packages, refs, headRef, refsDir, resolveContract, deserializeContract } = args;
  let graphMemo: MigrationGraph | undefined;
  let contractMemo: Contract | undefined;
  const contractAtMemo = new Map<string, ContractAtResult>();

  function spaceGraph(): MigrationGraph {
    graphMemo ??= reconstructGraph(packages);
    return graphMemo;
  }

  return {
    spaceId,
    packages,
    refs,
    headRef,
    graph: spaceGraph,
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
        graph: spaceGraph(),
        deserializeContract,
      });
      contractAtMemo.set(key, result);
      return result;
    },
  };
}

/**
 * Collect the union of every namespace declared across all contract spaces of an
 * aggregate (app + extensions) and return a minimal object with the shape
 * `{ storage: { namespaces } }` suitable for passing to
 * `familyInstance.introspect`.
 *
 * Callers invoke this after the integrity gate (`buildContractSpaceAggregate`
 * with `checkContracts: true`), so every `space.contract()` call is safe —
 * no try/catch is needed here.
 */
export function collectAggregateNamespaces(aggregate: ContractSpaceAggregate): {
  readonly storage: { readonly namespaces: Readonly<Record<string, StorageNamespace>> };
} {
  const merged: Record<string, StorageNamespace> = {};
  for (const space of aggregate.spaces()) {
    for (const [key, ns] of Object.entries(space.contract().storage.namespaces)) {
      const existing = merged[key];
      merged[key] = existing === undefined ? ns : mergeNamespaceEntries(existing, ns);
    }
  }
  return { storage: { namespaces: merged } };
}

/**
 * Union two contract spaces' declarations for the same namespace id, per
 * entity kind. Two spaces may legitimately share a namespace (e.g. both
 * declaring tables in `public`); element-level disjointness is enforced by
 * `checkIntegrity`, so the kind maps never collide on a name — replacing the
 * whole namespace would silently drop the earlier space's entities.
 */
function mergeNamespaceEntries(a: StorageNamespace, b: StorageNamespace): StorageNamespace {
  const entries: Record<string, Readonly<Record<string, unknown>>> = { ...a.entries };
  for (const [entityKind, kindMap] of Object.entries(b.entries)) {
    entries[entityKind] = { ...entries[entityKind], ...kindMap };
  }
  return { ...a, entries };
}

/**
 * Assemble a {@link ContractSpaceAggregate} value from its contract spaces and a
 * `checkIntegrity` implementation. The query methods (`listSpaces` /
 * `hasSpace` / `space` / `spaces`) are derived here so every aggregate —
 * loader-built or test-built — shares one query surface: `app` first,
 * then `extensions` in the order supplied (the loader sorts them
 * lex-ascending by `spaceId`).
 */
export function createContractSpaceAggregate(args: {
  readonly targetId: string;
  readonly app: AggregateContractSpace;
  readonly extensions: readonly AggregateContractSpace[];
  readonly checkIntegrity: (opts?: IntegrityQueryOptions) => readonly IntegrityViolation[];
}): ContractSpaceAggregate {
  const { targetId, app, extensions, checkIntegrity } = args;
  const ordered: readonly AggregateContractSpace[] = [app, ...extensions];
  const byId = new Map(ordered.map((m) => [m.spaceId, m]));
  const spaceDeclares = (space: AggregateContractSpace, entityName: string): boolean => {
    for (const coord of elementCoordinates(space.contract().storage)) {
      if (coord.entityName === entityName) return true;
    }
    return false;
  };
  return {
    targetId,
    app,
    extensions,
    listSpaces: () => ordered.map((m) => m.spaceId),
    hasSpace: (id) => byId.has(id),
    space: (id) => byId.get(id),
    spaces: () => ordered,
    declaresEntity: (entityName) => ordered.some((space) => spaceDeclares(space, entityName)),
    declaringSpaces: (entityName) =>
      ordered.filter((space) => spaceDeclares(space, entityName)).map((s) => s.spaceId),
    siblingOwnedEntityNames: (spaceId) => {
      const names = new Set<string>();
      for (const space of ordered) {
        if (space.spaceId === spaceId) continue;
        for (const coord of elementCoordinates(space.contract().storage)) {
          names.add(coord.entityName);
        }
      }
      return names;
    },
    checkIntegrity,
  };
}
