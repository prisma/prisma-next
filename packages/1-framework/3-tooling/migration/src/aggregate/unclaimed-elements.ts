import type {
  SchemaDiffIssue,
  SchemaOwnershipCoordinate,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
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
 * The namespace-qualified coordinate a `not-expected` `SchemaDiffIssue`
 * addresses, when its subject is a whole top-level entity. A nested leaf (a
 * column, an index, an RLS policy on an undeclared table) has no entity of
 * its own to report here.
 *
 * A `diffRole`-declaring family's whole-entity node names itself (its diff id
 * is the entity name); a family with no such discriminant (Mongo) has no node
 * to read at all for a bare coordinate finding, so the path itself — already
 * exactly the entity name at this depth — is the answer. The namespace
 * segment only exists for namespace-qualified (Postgres-shaped) paths
 * (`['database', namespaceId, tableName]`); single-namespace families
 * (SQLite's flat `['database', tableName]`, Mongo's bare `[collectionName]`)
 * have no separate segment, so every entity they declare implicitly shares
 * one namespace — the same sentinel the aggregate's own coordinate walk
 * uses for those families.
 */
function schemaDiffIssueCoordinate(issue: SchemaDiffIssue): SchemaOwnershipCoordinate | undefined {
  if (!isWholeEntityIssue(issue)) return undefined;
  const entityName =
    issueNodeRole(issue) !== undefined ? issue.actual?.id : issue.path[issue.path.length - 1];
  if (entityName === undefined) return undefined;
  const namespaceId =
    issue.path.length === 3 ? (issue.path[1] ?? UNBOUND_NAMESPACE_ID) : UNBOUND_NAMESPACE_ID;
  return { namespaceId, entityName };
}

/**
 * The namespace-qualified coordinates of every live element this contract
 * space's diff reports as `not-expected`, deduplicated. The verifier gathers
 * these across all spaces and keeps only the coordinates no contract space
 * declares — the standalone unclaimed-elements list, reported once for the
 * whole database.
 */
export function collectExtraElementCoordinates(
  result: VerifyDatabaseSchemaResult,
): readonly SchemaOwnershipCoordinate[] {
  const seen = new Map<string, SchemaOwnershipCoordinate>();
  for (const issue of result.schema.issues) {
    if (issue.reason !== 'not-expected') continue;
    const coordinate = schemaDiffIssueCoordinate(issue);
    if (coordinate === undefined) continue;
    seen.set(`${coordinate.namespaceId} ${coordinate.entityName}`, coordinate);
  }
  return [...seen.values()];
}
