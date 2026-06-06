import { elementCoordinates } from '@prisma-next/framework-components/ir';
import { EMPTY_CONTRACT_HASH } from '../constants';
import { MigrationToolsError } from '../errors';
import type {
  DeclaredExtensionEntry,
  IntegrityQueryOptions,
  IntegrityViolation,
} from '../integrity-violation';
import type { PackageLoadProblem } from '../io';
import type { OnDiskMigrationPackage } from '../package';
import type { RefLoadProblem } from '../refs';
import type { ContractSpaceMember } from './types';

/**
 * One space's load-time facts that `checkIntegrity` judges: the loaded
 * member, the load-time problems `readMigrationsDir` surfaced for it, and
 * whether it is the app space (the app head ref is synthesised, so the
 * head-ref checks are skipped for it).
 */
export interface IntegritySpaceState {
  readonly member: ContractSpaceMember;
  readonly problems: readonly PackageLoadProblem[];
  /** Per-ref problems: a user ref `*.json` that exists but is unparseable. */
  readonly refProblems: readonly RefLoadProblem[];
  /**
   * The space's `refs/head.json` problem when it exists but is unparseable.
   * `null` means the head ref was read cleanly or is genuinely absent —
   * the absent case is judged `headRefMissing`, the corrupt case here is
   * judged `refUnreadable` (and suppresses `headRefMissing`).
   *
   * Always `null` for spaces whose head ref is synthesised (app space and
   * migration-less extension spaces) — there is no on-disk `head.json` to
   * read or fail on.
   */
  readonly headRefProblem: RefLoadProblem | null;
  readonly isApp: boolean;
  /**
   * `true` for spaces whose head ref is synthesised from the contract's
   * `storage.storageHash` rather than read from an on-disk `refs/head.json`.
   *
   * The app space always has a synthesised head ref. Extension spaces that
   * declare **zero migration packages** (all-external spaces like Supabase
   * that manage no DDL) also get a synthesised head ref — the graph is empty
   * by design, so graph-reachability checks would always fail. The planner
   * handles these spaces the same way it handles the app space: synth
   * strategy, zero ops.
   *
   * When `hasSynthesizedHead` is `true`, the `headRefMissing` and
   * `headRefNotInGraph` violations are never emitted for the space.
   */
  readonly hasSynthesizedHead: boolean;
}

export interface IntegrityComputationInput {
  readonly targetId: string;
  readonly spaces: readonly IntegritySpaceState[];
}

/**
 * Walk the loaded model and return **every** integrity violation — never
 * bailing at the first. Structurally-derivable violations (load-time
 * problems, self-edges, missing / unreachable head refs) are always
 * produced; layout-drift checks require `declaredExtensions`, and
 * contract / target / disjointness checks require `checkContracts`.
 */
export function computeIntegrityViolations(
  input: IntegrityComputationInput,
  opts?: IntegrityQueryOptions,
): readonly IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];

  for (const {
    member,
    problems,
    refProblems,
    headRefProblem,
    isApp,
    hasSynthesizedHead,
  } of input.spaces) {
    const { spaceId } = member;

    for (const problem of problems) {
      violations.push(loadProblemToViolation(spaceId, problem));
    }

    for (const refProblem of refProblems) {
      violations.push({
        kind: 'refUnreadable',
        spaceId,
        refName: refProblem.refName,
        detail: refProblem.detail,
      });
    }
    if (headRefProblem !== null) {
      violations.push({
        kind: 'refUnreadable',
        spaceId,
        refName: headRefProblem.refName,
        detail: headRefProblem.detail,
      });
    }

    for (const pkg of member.packages) {
      const from = pkg.metadata.from ?? EMPTY_CONTRACT_HASH;
      const isSelfEdge = from === pkg.metadata.to;
      const hasDataOp = pkg.ops.some((op) => op.operationClass === 'data');
      if (isSelfEdge && !hasDataOp) {
        violations.push({ kind: 'sameSourceAndTarget', spaceId, dirName: pkg.dirName, hash: from });
      }
    }

    violations.push(...duplicateMigrationHashViolations(spaceId, member.packages));

    // Skip graph-reachability checks for spaces whose head ref is synthesised
    // from the contract hash (app space, and migration-less extension spaces).
    // Those spaces have an empty graph by design; requiring the head hash to
    // appear in an empty graph would always fail. The planner's synth strategy
    // handles them correctly: zero ops when the DB is already up to date.
    // Extension spaces with non-empty graphs (migration-backed packs like
    // pgvector) still go through the full head-ref check as before.
    if (!isApp && !hasSynthesizedHead && headRefProblem === null) {
      if (member.headRef === null) {
        violations.push({ kind: 'headRefMissing', spaceId });
      } else if (!headRefPresentInGraph(member, member.headRef.hash)) {
        violations.push({ kind: 'headRefNotInGraph', spaceId, hash: member.headRef.hash });
      }
    }
  }

  if (opts?.declaredExtensions !== undefined) {
    violations.push(...layoutViolations(input.spaces, opts.declaredExtensions));
  }

  if (opts?.checkContracts === true) {
    violations.push(...contractViolations(input));
  }

  return violations;
}

export function loadProblemToViolation(
  spaceId: string,
  problem: PackageLoadProblem,
): IntegrityViolation {
  switch (problem.kind) {
    case 'hashMismatch':
      return {
        kind: 'hashMismatch',
        spaceId,
        dirName: problem.dirName,
        stored: problem.stored,
        computed: problem.computed,
      };
    case 'providedInvariantsMismatch':
      return { kind: 'providedInvariantsMismatch', spaceId, dirName: problem.dirName };
    case 'packageUnloadable':
      return {
        kind: 'packageUnloadable',
        spaceId,
        dirName: problem.dirName,
        detail: problem.detail,
      };
  }
}

function duplicateMigrationHashViolations(
  spaceId: string,
  packages: readonly OnDiskMigrationPackage[],
): readonly IntegrityViolation[] {
  const dirNamesByHash = new Map<string, string[]>();
  for (const pkg of packages) {
    const hash = pkg.metadata.migrationHash;
    const dirNames = dirNamesByHash.get(hash);
    if (dirNames) dirNames.push(pkg.dirName);
    else dirNamesByHash.set(hash, [pkg.dirName]);
  }

  const out: IntegrityViolation[] = [];
  for (const [migrationHash, dirNames] of dirNamesByHash) {
    if (dirNames.length > 1) {
      out.push({
        kind: 'duplicateMigrationHash',
        spaceId,
        migrationHash,
        dirNames: [...dirNames].sort(),
      });
    }
  }
  return out;
}

/**
 * Whether a space's head-ref hash is present in its reconstructed graph.
 * An empty graph is reachable only by the empty-contract sentinel.
 */
function headRefPresentInGraph(member: ContractSpaceMember, headHash: string): boolean {
  const graph = member.graph();
  if (graph.nodes.size === 0) {
    return headHash === EMPTY_CONTRACT_HASH;
  }
  return graph.nodes.has(headHash);
}

function layoutViolations(
  spaces: readonly IntegritySpaceState[],
  declaredExtensions: readonly DeclaredExtensionEntry[],
): readonly IntegrityViolation[] {
  const out: IntegrityViolation[] = [];
  const extensionSpaceIds = new Set(spaces.filter((s) => !s.isApp).map((s) => s.member.spaceId));
  const declaredIds = new Set(declaredExtensions.map((d) => d.id));

  for (const id of [...extensionSpaceIds].sort()) {
    if (!declaredIds.has(id)) {
      out.push({ kind: 'orphanSpaceDir', spaceId: id });
    }
  }
  for (const id of [...declaredIds].sort()) {
    if (!extensionSpaceIds.has(id)) {
      out.push({ kind: 'declaredButUnmigrated', spaceId: id });
    }
  }
  return out;
}

function contractViolations(input: IntegrityComputationInput): readonly IntegrityViolation[] {
  const out: IntegrityViolation[] = [];
  const elementClaimedBy = new Map<string, string[]>();

  for (const { member } of input.spaces) {
    let contract: ReturnType<ContractSpaceMember['contract']>;
    try {
      contract = member.contract();
    } catch (error) {
      out.push({ kind: 'contractUnreadable', spaceId: member.spaceId, detail: detailOf(error) });
      continue;
    }

    if (contract.target !== input.targetId) {
      out.push({
        kind: 'targetMismatch',
        spaceId: member.spaceId,
        expected: input.targetId,
        actual: contract.target,
      });
    }

    for (const { entityName: elementName } of elementCoordinates(contract.storage)) {
      const claimers = elementClaimedBy.get(elementName);
      if (claimers) claimers.push(member.spaceId);
      else elementClaimedBy.set(elementName, [member.spaceId]);
    }
  }

  const disjointness: IntegrityViolation[] = [];
  for (const [element, claimedBy] of elementClaimedBy) {
    if (claimedBy.length > 1) {
      disjointness.push({ kind: 'disjointness', element, claimedBy: [...claimedBy].sort() });
    }
  }
  disjointness.sort((a, b) =>
    a.kind === 'disjointness' && b.kind === 'disjointness' ? a.element.localeCompare(b.element) : 0,
  );
  out.push(...disjointness);
  return out;
}

function detailOf(error: unknown): string {
  if (MigrationToolsError.is(error)) return error.why;
  if (error instanceof Error) return error.message;
  return String(error);
}
