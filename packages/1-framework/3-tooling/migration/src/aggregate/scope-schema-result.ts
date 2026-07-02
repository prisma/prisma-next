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

function pruneTree(
  node: SchemaVerificationNode,
  ownedByOthers: ReadonlySet<string>,
): SchemaVerificationNode {
  if (node.children.length === 0) return node;
  const keptChildren = node.children
    .filter((child) => {
      const name = nodeEntityName(child);
      return name === undefined || !ownedByOthers.has(name);
    })
    .map((child) => pruneTree(child, ownedByOthers));
  return { ...node, status: aggregateStatus(keptChildren), children: keptChildren };
}

function countTree(node: SchemaVerificationNode): {
  pass: number;
  warn: number;
  fail: number;
  totalNodes: number;
} {
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
  const root = pruneTree(result.schema.root, ownedByOthers);
  const counts = countTree(root);
  const ok = counts.fail === 0;

  return {
    ...result,
    ok,
    ...(ok ? {} : { code: result.code ?? 'PN-RUN-3010' }),
    summary: ok ? 'Database schema satisfies contract' : result.summary,
    schema: { issues, schemaDiffIssues, root, counts },
  };
}
