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
 * Counts the pass/warn/fail statuses over a verification tree (root included).
 * Used only when the strip actually dropped a node — the pruned tree is then
 * self-consistent regardless of family, so the recomputed `fail` is the honest
 * verdict signal in both count bases (SQL counts the root at its recomputed
 * status; Mongo's root was never a failure carrier, so a fresh walk of the
 * surviving collection nodes matches its tally).
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
 * Part 1 — a contract space's contract-satisfaction view. Strips the
 * **top-level entity extras only**: `extra_table` issues and the grafted
 * top-level extra-entity nodes (a SQL `table` / a Mongo `collection` the family
 * added for a live element declared by no contract). Those belong to the
 * separate unclaimed list ({@link collectExtraElementNames}), never a
 * contract-tree node.
 *
 * Nested `extra_*` findings (an extra column on the space's own declared
 * table…) and extra-policy `schemaDiffIssues` are the space's **own drift** and
 * stay in Part 1: their contribution is baked into the declared table's subtree
 * and the family's verdict, so stripping the issue would leave a failing space
 * with no visible evidence.
 *
 * Counts: when nothing was dropped, the family's authoritative counts and
 * verdict are untouched. When a node was dropped, both are recomputed from the
 * pruned tree with a plain self-consistent walk ({@link countTree}) —
 * family-agnostic, correct in the SQL (root-counted) and Mongo (root-not-
 * counted) bases alike, and free of family-specific count arithmetic.
 */
export function stripExtraFindings(result: VerifyDatabaseSchemaResult): VerifyDatabaseSchemaResult {
  const issues = result.schema.issues.filter((issue) => issue.kind !== 'extra_table');
  const keptChildren: SchemaVerificationNode[] = [];
  const dropped: SchemaVerificationNode[] = [];
  for (const child of result.schema.root.children) {
    if (isEntityNode(child) && isExtraTableNode(child)) dropped.push(child);
    else keptChildren.push(child);
  }

  const strippedIssues = issues.length !== result.schema.issues.length;
  if (!strippedIssues && dropped.length === 0) return result;
  if (dropped.length === 0) {
    return { ...result, schema: { ...result.schema, issues } };
  }

  const root: SchemaVerificationNode = {
    ...result.schema.root,
    status: aggregateStatus(keptChildren),
    children: keptChildren,
  };
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
