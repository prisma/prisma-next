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
 * A contract space's contract-satisfaction view. Strips the top-level entity
 * extras — the `not-expected` findings on table-role nodes (plus the
 * findings the differ's total descent reported under those tables) and the
 * `extra_table` coordinate issues describing the same entities. Those belong
 * to the standalone unclaimed-elements list
 * ({@link collectExtraElementNames}), never a space's own verdict.
 *
 * Nested `not-expected` findings (an extra column on the space's own
 * declared table…) and structural findings (an undeclared RLS policy) are
 * the space's **own drift** and stay. On the legacy coordinate-based issue
 * type the entity level is not a structural field, so the issue filter
 * narrows by the framework-declared `extra_table` kind; that narrowing
 * retires with the issue-type merge.
 *
 * The verdict recomputes from the surviving lists: the per-space result is
 * issue-based (`ok` ⇔ both lists empty), so a space whose only failures
 * were top-level extras passes after the strip.
 */
export function stripExtraFindings(result: VerifyDatabaseSchemaResult): VerifyDatabaseSchemaResult {
  const issues = result.schema.issues.filter(
    (issue) => !(issue.reason === 'not-expected' && issue.kind === 'extra_table'),
  );
  const droppedTablePaths = result.schema.schemaDiffIssues
    .filter((issue) => issue.reason === 'not-expected' && issueNodeRole(issue) === 'table')
    .map((issue) => issue.path);
  const schemaDiffIssues = result.schema.schemaDiffIssues.filter((issue) => {
    if (issue.reason !== 'not-expected') return true;
    if (issueNodeRole(issue) === 'structural') return true;
    return !droppedTablePaths.some((prefix) => pathIsUnder(issue.path, prefix));
  });

  const strippedNothing =
    issues.length === result.schema.issues.length &&
    schemaDiffIssues.length === result.schema.schemaDiffIssues.length;
  if (strippedNothing) return result;

  const ok = issues.length === 0 && schemaDiffIssues.length === 0;
  const { code: staleCode, ...envelope } = result;
  void staleCode;
  return {
    ...envelope,
    ok,
    ...(ok ? {} : { code: result.code ?? 'PN-RUN-3010' }),
    summary: ok ? 'Database schema satisfies contract' : result.summary,
    schema: { issues, schemaDiffIssues },
  };
}

/**
 * The bare entity name a `not-expected` `SchemaDiffIssue` addresses. A
 * table-role node names itself (its diff id is the table name); a structural
 * leaf (an RLS policy on an undeclared table) names its subject table via
 * `tableName` — the one remaining family-node-shape access here, kept
 * because in a tolerant verify the strict gating drops table extras from the
 * verdict, so an undeclared table that carries an RLS policy is only
 * nameable through the policy's node. It retires with the issue-type merge.
 */
function schemaDiffIssueEntityName(issue: SchemaDiffIssue): string | undefined {
  const actual = issue.actual;
  if (actual === undefined) return undefined;
  if (issueNodeRole(issue) === 'table') return actual.id;
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
