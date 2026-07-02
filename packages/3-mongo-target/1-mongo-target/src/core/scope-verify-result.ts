import type { Contract } from '@prisma-next/contract/types';
import type {
  BaseSchemaIssue,
  SchemaIssue,
  SchemaVerificationNode,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { elementCoordinates } from '@prisma-next/framework-components/ir';

/**
 * The bare entity names the given contracts declare, unioned. The Mongo runner
 * asks this of every OTHER contract space in a multi-space apply, so each
 * space's post-apply verify can drop the extras those siblings claim.
 */
export function entityNamesDeclaredBy(contracts: ReadonlyArray<Contract>): Set<string> {
  const owned = new Set<string>();
  for (const contract of contracts) {
    for (const { entityName } of elementCoordinates(contract.storage)) {
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

/** True for a top-level entity verify-node (a Mongo `collection`). */
function isEntityNode(node: SchemaVerificationNode): boolean {
  return node.kind === 'collection';
}

/** True when an issue reports an element present in the database but declared by no contract (an extra). */
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
 * Counts the pass/warn/fail statuses over a verification tree (root included).
 * Used only when scoping actually dropped a node — the pruned tree is then
 * self-consistent, so the recomputed `fail` is the honest verdict signal.
 */
function countTree(node: SchemaVerificationNode): Counts {
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
 * Partitions `root.children` into the top-level collection nodes another
 * contract space claims (dropped) and the rest (kept), then rebuilds the root
 * over the kept children with a freshly aggregated status. Only `root.children`
 * is filtered — each surviving collection keeps its full subtree, so a space's
 * own field named like a sibling's collection is never dropped.
 */
function pruneTopLevelCollections(
  root: SchemaVerificationNode,
  ownedByOtherSpaces: ReadonlySet<string>,
): { readonly root: SchemaVerificationNode; readonly dropped: readonly SchemaVerificationNode[] } {
  const kept: SchemaVerificationNode[] = [];
  const dropped: SchemaVerificationNode[] = [];
  for (const child of root.children) {
    const name = nodeEntityName(child);
    if (isEntityNode(child) && name !== undefined && ownedByOtherSpaces.has(name)) {
      dropped.push(child);
    } else {
      kept.push(child);
    }
  }
  return {
    root: { ...root, status: aggregateStatus(kept), children: kept },
    dropped,
  };
}

/**
 * Scope a per-space post-apply verify result to the contract space's own
 * elements: drop the `extra` findings for collections another contract space
 * claims. The runner verifies the destination contract against the full live
 * database, which holds sibling spaces' collections — without the scoping a
 * multi-space apply could never pass strict verify. Extras claimed by NO space
 * survive, so genuine drift still fails the runner's verdict.
 *
 * Counts: when nothing was dropped, the family's authoritative counts/verdict
 * are untouched; when a collection was dropped, both are recomputed from the
 * pruned tree (self-consistent in Mongo's count basis). Mongo runner results
 * carry no `schemaDiffIssues`, so no re-fold is needed.
 */
export function scopeVerifyResultToSpace(
  result: VerifyDatabaseSchemaResult,
  ownedByOtherSpaces: ReadonlySet<string>,
): VerifyDatabaseSchemaResult {
  if (ownedByOtherSpaces.size === 0) return result;

  const issues = result.schema.issues.filter(
    (issue) =>
      !(isExtraIssue(issue) && issue.table !== undefined && ownedByOtherSpaces.has(issue.table)),
  );
  const { root, dropped } = pruneTopLevelCollections(result.schema.root, ownedByOtherSpaces);

  if (dropped.length === 0) {
    return { ...result, schema: { ...result.schema, issues, root } };
  }

  const counts = countTree(root);
  const ok = counts.fail === 0;

  return {
    ...result,
    ok,
    ...(ok ? {} : { code: result.code ?? 'PN-RUN-3010' }),
    summary: ok ? 'Database schema satisfies contract' : result.summary,
    schema: { ...result.schema, issues, root, counts },
  };
}
