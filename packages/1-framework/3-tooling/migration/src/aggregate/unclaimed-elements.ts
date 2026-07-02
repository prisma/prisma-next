import type {
  BaseSchemaIssue,
  SchemaDiffIssue,
  SchemaIssue,
  SchemaVerificationNode,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';

/**
 * True for a top-level entity verify-node: a SQL `table` or a Mongo `collection`.
 */
function isEntityNode(node: SchemaVerificationNode): boolean {
  return node.kind === 'table' || node.kind === 'collection';
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
 * Counts the pass/warn/fail statuses over a subtree, root included. Used only to
 * measure the contribution of a stripped extra node so it can be subtracted from
 * the family's authoritative counts — never to re-tally the whole result, whose
 * count basis varies by family (SQL counts the root, Mongo does not).
 */
function countSubtree(node: SchemaVerificationNode): Counts {
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
 * Part 1 — a contract space's contract-satisfaction view. Strips every `extra_*`
 * finding (the family differ grafts them as fail nodes / issues so the shared
 * single-space verdict stays correct for the planner and runner) so the view is
 * the space's **declared** nodes only, each pass/fail by whether a
 * missing/mismatch issue concerns it. Extras belong to the separate unclaimed
 * list ({@link collectExtraElementNames}), never a contract-tree node.
 *
 * Only top-level entity nodes (a SQL `table` / a Mongo `collection`) are
 * droppable — an extra column or constraint lives inside a declared table's
 * subtree and is stripped from `issues`, not by pruning the tree. The verdict is
 * recomputed by subtracting each stripped node's own tally from the family's
 * authoritative counts (family-agnostic — SQL counts the root, Mongo does not,
 * so re-tallying the whole tree would drift the count basis). Only the root
 * status is re-derived from the surviving children.
 */
export function stripExtraFindings(result: VerifyDatabaseSchemaResult): VerifyDatabaseSchemaResult {
  const issues = result.schema.issues.filter((issue) => !isExtraIssue(issue));
  const schemaDiffIssues = result.schema.schemaDiffIssues.filter(
    (issue) => issue.outcome !== 'extra',
  );
  const keptChildren: SchemaVerificationNode[] = [];
  const dropped: SchemaVerificationNode[] = [];
  for (const child of result.schema.root.children) {
    if (isEntityNode(child) && isExtraTableNode(child)) dropped.push(child);
    else keptChildren.push(child);
  }

  const nothingStripped =
    issues.length === result.schema.issues.length &&
    schemaDiffIssues.length === result.schema.schemaDiffIssues.length &&
    dropped.length === 0;
  if (nothingStripped) return result;

  const counts = { ...result.schema.counts };
  for (const node of dropped) {
    const sub = countSubtree(node);
    counts.pass -= sub.pass;
    counts.warn -= sub.warn;
    counts.fail -= sub.fail;
    counts.totalNodes -= sub.totalNodes;
  }
  const root: SchemaVerificationNode = {
    ...result.schema.root,
    status: aggregateStatus(keptChildren),
    children: keptChildren,
  };
  const ok = counts.fail === 0;
  return {
    ...result,
    ok,
    ...(ok ? {} : { code: result.code ?? 'PN-RUN-3010' }),
    summary: ok ? 'Database schema satisfies contract' : result.summary,
    schema: { issues, schemaDiffIssues, root, counts },
  };
}

/**
 * A top-level entity node the family grafted for a live element declared by no
 * contract. The family sets `code: 'extra_table'` (SQL) or
 * `code: 'EXTRA_COLLECTION'` (Mongo) on these nodes, whatever disposition the
 * control policy reconciled the node status to.
 */
function isExtraTableNode(node: SchemaVerificationNode): boolean {
  return node.code === 'extra_table' || node.code === 'EXTRA_COLLECTION';
}

/**
 * Part 2 (per-space contribution) — the bare names of every live element this
 * space's diff reports as an extra. The verifier gathers these across all
 * spaces, deduplicates, and keeps only the names no contract space declares.
 */
export function collectExtraElementNames(result: VerifyDatabaseSchemaResult): Set<string> {
  const names = new Set<string>();
  for (const issue of result.schema.issues) {
    if (isExtraIssue(issue) && issue.table !== undefined) names.add(issue.table);
  }
  for (const issue of result.schema.schemaDiffIssues) {
    if (issue.outcome !== 'extra') continue;
    const name = schemaDiffIssueEntityName(issue);
    if (name !== undefined) names.add(name);
  }
  return names;
}
