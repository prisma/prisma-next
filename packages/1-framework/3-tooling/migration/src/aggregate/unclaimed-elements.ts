import type {
  SchemaDiffIssue,
  SchemaEntityCoordinate,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { coordinateKey, UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';

function pathIsUnder(path: readonly string[], prefix: readonly string[]): boolean {
  if (path.length < prefix.length) return false;
  return prefix.every((segment, i) => path[i] === segment);
}

/**
 * Whether an issue's subject is a WHOLE top-level entity — as opposed to
 * something nested under one (e.g. a field, an index, or a policy). Reads the
 * issue's `subjectGranularity`, which the producing family/target stamps
 * (this aggregate never imports family node classes and never reads a
 * classification off the node). Families that don't classify leave it absent;
 * for those the `path` shape answers instead — their top-level entity's path
 * is exactly its own name (one segment), so anything deeper is nested.
 */
function isWholeEntityIssue(issue: SchemaDiffIssue): boolean {
  if (issue.subjectGranularity !== undefined) return issue.subjectGranularity === 'entity';
  return issue.path.length === 1;
}

/**
 * A contract space's contract-satisfaction view. Strips the top-level entity
 * extras — the `not-expected` findings on whole-entity nodes (plus the
 * findings the differ's total descent reported under those entities). Those
 * belong to the standalone unclaimed-elements list
 * ({@link collectExtraElementCoordinates}), never a space's own verdict.
 *
 * Nested `not-expected` findings (an extra field on the space's own
 * declared entity…) and structural findings (an undeclared policy) are
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
    if (issue.subjectGranularity === 'structural') return true;
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
 * The schema-IR entity coordinate a `not-expected` `SchemaDiffIssue`
 * addresses, when its subject is a whole top-level entity. A nested leaf
 * (a field, an index, a policy on an undeclared entity) has no entity of
 * its own to report here.
 *
 * The whole-entity's name is the last path segment: the differ builds each
 * path from its nodes' ids, so at a whole-entity finding the last segment is
 * exactly the entity name — for every family, whether or not it stamps a
 * granularity. The namespace segment only exists for namespace-qualified
 * paths (`['database', namespaceId, entityName]`); single-namespace families
 * (a flat `['database', entityName]`, or a bare `[entityName]`) have no
 * separate segment, so every entity they declare implicitly shares one
 * namespace — the same sentinel the aggregate's own coordinate walk uses
 * for those families.
 *
 * `entityKind` is stamped `'table'` for both path shapes. For the
 * namespace-qualified (SQL family) shape this is exact: on that differ, a
 * whole-entity `'not-expected'` issue is always a live table — no other
 * storage entity kind (an enum's `valueSet`, an RLS `policy`) is represented
 * as a node in the schema-diff tree. For the bare, single-segment shape
 * (families that stamp no granularity, e.g. a Mongo collection extra)
 * `'table'` is a placeholder, not a real classification: no ownership
 * consumer queries `declaresEntity` for those families today, so nothing
 * reads this value as true. A family that starts asking ownership questions
 * over a non-table entity kind needs a real per-family kind here instead of
 * the literal.
 */
function schemaDiffIssueCoordinate(issue: SchemaDiffIssue): SchemaEntityCoordinate | undefined {
  if (!isWholeEntityIssue(issue)) return undefined;
  const entityName = issue.path[issue.path.length - 1];
  if (entityName === undefined) return undefined;
  const namespaceId =
    issue.path.length === 3 ? (issue.path[1] ?? UNBOUND_NAMESPACE_ID) : UNBOUND_NAMESPACE_ID;
  return { namespaceId, entityKind: 'table', entityName };
}

/**
 * The schema-IR entity coordinates of every live element this contract
 * space's diff reports as `not-expected`, deduplicated. The verifier gathers
 * these across all spaces and keeps only the coordinates no contract space
 * declares — the standalone unclaimed-elements list, reported once for the
 * whole database.
 */
export function collectExtraElementCoordinates(
  result: VerifyDatabaseSchemaResult,
): readonly SchemaEntityCoordinate[] {
  const seen = new Map<string, SchemaEntityCoordinate>();
  for (const issue of result.schema.issues) {
    if (issue.reason !== 'not-expected') continue;
    const coordinate = schemaDiffIssueCoordinate(issue);
    if (coordinate === undefined) continue;
    seen.set(coordinateKey(coordinate), coordinate);
  }
  return [...seen.values()];
}
