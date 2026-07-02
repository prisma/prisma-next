import type {
  BaseSchemaIssue,
  SchemaDiffIssue,
  SchemaIssue,
  SchemaVerificationNode,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { elementCoordinates } from '@prisma-next/framework-components/ir';
import type { ContractSpaceMember } from './types';

/**
 * The entity names claimed by every aggregate member other than `member`.
 * Read from the contract-side storage IR through the framework's
 * {@link elementCoordinates}; the introspected schema shape is never touched.
 */
export function otherMemberEntityNames(
  member: ContractSpaceMember,
  otherMembers: ReadonlyArray<ContractSpaceMember>,
): Set<string> {
  const owned = new Set<string>();
  for (const other of otherMembers) {
    if (other.spaceId === member.spaceId) continue;
    for (const { entityName } of elementCoordinates(other.contract().storage)) {
      owned.add(entityName);
    }
  }
  return owned;
}

/** The entity name a verification node addresses: the last segment of its coordinate path. */
function nodeEntityName(node: SchemaVerificationNode): string | undefined {
  const segments = node.contractPath.split('.');
  return segments.length > 0 ? segments[segments.length - 1] : undefined;
}

/** True when an issue reports an entity present in the database but claimed by no member (an extra). */
function isExtraIssue(issue: SchemaIssue): issue is BaseSchemaIssue {
  return (
    issue.kind === 'extra_table' ||
    issue.kind === 'extra_column' ||
    issue.kind === 'extra_primary_key' ||
    issue.kind === 'extra_foreign_key' ||
    issue.kind === 'extra_unique_constraint' ||
    issue.kind === 'extra_index' ||
    issue.kind === 'extra_validator' ||
    issue.kind === 'extra_default'
  );
}

/** The bare entity name an extra `SchemaDiffIssue` addresses, read off its actual (live-DB) node. */
function schemaDiffIssueEntityName(issue: SchemaDiffIssue): string | undefined {
  const actual = issue.actual;
  if (actual === undefined) return undefined;
  const name = (actual as { readonly tableName?: unknown }).tableName;
  return typeof name === 'string' ? name : undefined;
}

function aggregateStatus(children: readonly SchemaVerificationNode[]): 'pass' | 'warn' | 'fail' {
  let status: 'pass' | 'warn' | 'fail' = 'pass';
  for (const child of children) {
    if (child.status === 'fail') return 'fail';
    if (child.status === 'warn') status = 'warn';
  }
  return status;
}

type Counts = { pass: number; warn: number; fail: number; totalNodes: number };

/**
 * Partitions `root.children` into the top-level table nodes another member
 * claims (dropped) and the rest (kept), then rebuilds the root over the kept
 * children with a freshly aggregated status. Only `root.children` is filtered —
 * each surviving table keeps its full subtree. Descending further would wrongly
 * drop a member's own column (or `storage.types` enum) whose name collides with
 * a sibling space's table; the pruning layer this replaces dropped top-level
 * entities only.
 */
function pruneTopLevelTables(
  root: SchemaVerificationNode,
  ownedByOthers: ReadonlySet<string>,
): { readonly root: SchemaVerificationNode; readonly dropped: readonly SchemaVerificationNode[] } {
  const kept: SchemaVerificationNode[] = [];
  const dropped: SchemaVerificationNode[] = [];
  for (const child of root.children) {
    const name = nodeEntityName(child);
    if (name !== undefined && ownedByOthers.has(name)) dropped.push(child);
    else kept.push(child);
  }
  return {
    root: { ...root, status: aggregateStatus(kept), children: kept },
    dropped,
  };
}

function subtreeCounts(node: SchemaVerificationNode): Counts {
  let pass = 0;
  let warn = 0;
  let fail = 0;
  let totalNodes = 0;
  const visit = (n: SchemaVerificationNode): void => {
    totalNodes += 1;
    if (n.status === 'pass') pass += 1;
    else if (n.status === 'warn') warn += 1;
    else fail += 1;
    for (const child of n.children) visit(child);
  };
  visit(node);
  return { pass, warn, fail, totalNodes };
}

/**
 * The verify tree keeps only the first namespace's `root` on a multi-schema
 * database (the counts are summed across namespaces), so recomputing counts
 * from the root would undercount. Instead subtract the dropped top-level
 * subtrees from the authoritative incoming counts, and reconcile the root's own
 * status flip: if dropping the last failing/worst top-level node changes the
 * root's status, that node is no longer counted at its old status.
 */
function countsAfterDrop(
  original: Counts,
  dropped: readonly SchemaVerificationNode[],
  oldRootStatus: SchemaVerificationNode['status'],
  newRootStatus: SchemaVerificationNode['status'],
): Counts {
  const next = { ...original };
  for (const node of dropped) {
    const c = subtreeCounts(node);
    next.pass -= c.pass;
    next.warn -= c.warn;
    next.fail -= c.fail;
    next.totalNodes -= c.totalNodes;
  }
  if (newRootStatus !== oldRootStatus) {
    next[oldRootStatus] -= 1;
    next[newRootStatus] += 1;
  }
  return next;
}

/**
 * Scope a per-member verify result to the member's own contract space: drop the
 * `extra` findings for entities another aggregate member claims. Diffing the
 * full introspected schema surfaces every other member's tables as extras;
 * this removes exactly those (keyed by entity name, the coordinate the pruning
 * layer keyed on), leaving each member's own drift plus the truly undeclared
 * tables (extras owned by no member).
 *
 * A framework-level filter over framework result types only — it reads no
 * storage shape and branches on no family. `ownedByOthers` is the set of entity
 * names every other member claims (see {@link otherMemberEntityNames}).
 */
export function scopeSchemaResultToSpace(
  result: VerifyDatabaseSchemaResult,
  ownedByOthers: ReadonlySet<string>,
): VerifyDatabaseSchemaResult {
  if (ownedByOthers.size === 0) return result;

  const issues = result.schema.issues.filter(
    (issue) =>
      !(isExtraIssue(issue) && issue.table !== undefined && ownedByOthers.has(issue.table)),
  );
  const schemaDiffIssues = result.schema.schemaDiffIssues.filter((issue) => {
    if (issue.outcome !== 'extra') return true;
    const name = schemaDiffIssueEntityName(issue);
    return name === undefined || !ownedByOthers.has(name);
  });
  const { root, dropped } = pruneTopLevelTables(result.schema.root, ownedByOthers);
  const counts = countsAfterDrop(
    result.schema.counts,
    dropped,
    result.schema.root.status,
    root.status,
  );
  const ok = counts.fail === 0;

  return {
    ...result,
    ok,
    ...(ok ? {} : { code: result.code ?? 'PN-RUN-3010' }),
    summary: ok ? 'Database schema satisfies contract' : result.summary,
    schema: { issues, schemaDiffIssues, root, counts },
  };
}
