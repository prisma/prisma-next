import type {
  SchemaDiffIssue,
  SchemaVerificationNode,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { blindCast } from '@prisma-next/utils/casts';

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
 * A contract space's contract-satisfaction view. Strips the top-level entity
 * extras: the grafted root children the family stamped `reason:
 * 'not-expected'` (a live entity no contract expects has no declared
 * counterpart in the tree) and the `extra_table` issues describing them. Those
 * belong to the standalone unclaimed-elements list
 * ({@link collectExtraElementNames}), never a contract-tree node.
 *
 * Nested `not-expected` findings (an extra column on the space's own declared
 * table…) and extra-policy `schemaDiffIssues` are the space's **own drift** and
 * stay: their contribution is baked into the declared table's subtree and the
 * family's verdict, so stripping the issue would leave a failing space with no
 * visible evidence. On the legacy coordinate-based issue type the entity level
 * is not yet a structural field, so the issue filter narrows by the
 * framework-declared `extra_table` kind; the kind narrowing retires when the
 * issue-type merge makes issues node-typed.
 *
 * Counts: when nothing was dropped, the family's authoritative counts and
 * verdict are untouched. When a node was dropped, both are recomputed from the
 * pruned tree with a plain self-consistent walk ({@link countTree}) plus the
 * re-folded `schemaDiffIssues` count (they carry no tree node; the family
 * folds their count into `counts.fail` after its own walk).
 */
export function stripExtraFindings(result: VerifyDatabaseSchemaResult): VerifyDatabaseSchemaResult {
  const issues = result.schema.issues.filter(
    (issue) => !(issue.reason === 'not-expected' && issue.kind === 'extra_table'),
  );
  const keptChildren: SchemaVerificationNode[] = [];
  const dropped: SchemaVerificationNode[] = [];
  for (const child of result.schema.root.children) {
    if (child.reason === 'not-expected') dropped.push(child);
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
  counts.fail += result.schema.schemaDiffIssues.length;
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
 * The bare entity name a `not-expected` `SchemaDiffIssue` addresses, read off
 * its actual (current-side) node. The `tableName` read is the one remaining
 * family-node-shape access here — kept because in a tolerant verify the
 * relational walk emits no `extra_table` issue, so an undeclared table that
 * carries an RLS policy is only nameable through the policy's node; it retires
 * when the issue-type merge makes issues node-typed.
 */
function schemaDiffIssueEntityName(issue: SchemaDiffIssue): string | undefined {
  const actual = issue.actual;
  if (actual === undefined) return undefined;
  const tableName = blindCast<
    { readonly tableName?: unknown },
    'entity-name collection reads the optional target-specific tableName off a diff node'
  >(actual).tableName;
  return typeof tableName === 'string' ? tableName : undefined;
}

/**
 * The bare names of every live element this contract space's diff reports as
 * `not-expected`. The verifier gathers these across all spaces, deduplicates,
 * and keeps only the names no contract space declares — the standalone
 * unclaimed-elements list, reported once for the whole database.
 */
export function collectExtraElementNames(result: VerifyDatabaseSchemaResult): Set<string> {
  const names = new Set<string>();
  for (const issue of result.schema.issues) {
    if (issue.reason === 'not-expected' && 'table' in issue && issue.table !== undefined) {
      names.add(issue.table);
    }
  }
  for (const issue of result.schema.schemaDiffIssues) {
    if (issue.reason !== 'not-expected') continue;
    const name = schemaDiffIssueEntityName(issue);
    if (name !== undefined) names.add(name);
  }
  return names;
}
