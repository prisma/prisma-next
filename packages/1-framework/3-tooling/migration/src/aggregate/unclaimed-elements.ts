import type {
  SchemaDiffIssue,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { blindCast } from '@prisma-next/utils/casts';

/**
 * The declared verdict-classification role of a diff issue's subject node,
 * read structurally (`diffRole` is declared by every SQL schema-diff node;
 * the aggregate never imports family node classes). Absent for issues whose
 * nodes carry no role (non-SQL families).
 */
function issueNodeRole(issue: SchemaDiffIssue): string | undefined {
  const node = issue.actual ?? issue.expected;
  if (node === undefined) return undefined;
  const role = blindCast<
    { readonly diffRole?: unknown },
    'structural read of the declared diffRole discriminant on a schema-diff node'
  >(node).diffRole;
  return typeof role === 'string' ? role : undefined;
}

function pathIsUnder(path: readonly string[], prefix: readonly string[]): boolean {
  if (path.length < prefix.length) return false;
  return prefix.every((segment, i) => path[i] === segment);
}

/**
 * Whether an issue's subject is a WHOLE top-level entity (a table, a Mongo
 * collection) rather than something nested under one (a column, an index, an
 * RLS policy). Families that declare a `diffRole` discriminant (SQL) answer
 * via the node's own role; families without one (Mongo) answer via `path`
 * shape — a top-level Mongo path is exactly the collection's own name (one
 * segment), so anything deeper is nested.
 */
function isWholeEntityIssue(issue: SchemaDiffIssue): boolean {
  const role = issueNodeRole(issue);
  if (role !== undefined) return role === 'table';
  return issue.path.length === 1;
}

/**
 * A contract space's contract-satisfaction view. Strips the top-level entity
 * extras — the `not-expected` findings on table-role nodes (plus the
 * findings the differ's total descent reported under those tables). Those
 * belong to the standalone unclaimed-elements list
 * ({@link collectExtraElementNames}), never a space's own verdict.
 *
 * Nested `not-expected` findings (an extra column on the space's own
 * declared table…) and structural findings (an undeclared RLS policy) are
 * the space's **own drift** and stay.
 *
 * The verdict recomputes from the surviving list: the per-space result is
 * issue-based (`ok` ⇔ the list is empty), so a space whose only failures
 * were top-level extras passes after the strip.
 */
export function stripExtraFindings(result: VerifyDatabaseSchemaResult): VerifyDatabaseSchemaResult {
  const droppedTablePaths = result.schema.issues
    .filter((issue) => issue.reason === 'not-expected' && isWholeEntityIssue(issue))
    .map((issue) => issue.path);
  const issues = result.schema.issues.filter((issue) => {
    if (issue.reason !== 'not-expected') return true;
    if (issueNodeRole(issue) === 'structural') return true;
    return !droppedTablePaths.some((prefix) => pathIsUnder(issue.path, prefix));
  });

  if (issues.length === result.schema.issues.length) return result;

  const ok = issues.length === 0;
  const { code: staleCode, ...envelope } = result;
  void staleCode;
  // Warnings are the space's own drift-watch (an observed-policy subject), never
  // a sibling's unclaimed extra, so the strip carries them through untouched.
  return {
    ...envelope,
    ok,
    ...(ok ? {} : { code: result.code ?? 'PN-RUN-3010' }),
    summary: ok ? 'Database schema satisfies contract' : result.summary,
    schema: {
      issues,
      ...(result.schema.warnings !== undefined ? { warnings: result.schema.warnings } : {}),
    },
  };
}

/**
 * The bare entity name a `not-expected` `SchemaDiffIssue` addresses, when its
 * subject is a whole top-level entity. A nested leaf (a column, an index, an
 * RLS policy on an undeclared table) has no entity name of its own to report
 * here.
 *
 * A `diffRole`-declaring family's whole-entity node names itself (its diff id
 * is the entity name); a family with no such discriminant (Mongo) has no node
 * to read at all for a bare coordinate finding, so the path itself — already
 * exactly the entity name at this depth — is the answer.
 */
function schemaDiffIssueEntityName(issue: SchemaDiffIssue): string | undefined {
  if (!isWholeEntityIssue(issue)) return undefined;
  if (issueNodeRole(issue) !== undefined) return issue.actual?.id;
  return issue.path[issue.path.length - 1];
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
    if (issue.reason !== 'not-expected') continue;
    const name = schemaDiffIssueEntityName(issue);
    if (name !== undefined) names.add(name);
  }
  return names;
}
