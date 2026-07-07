import type { Contract } from '@prisma-next/contract/types';
import type {
  BaseSchemaIssue,
  SchemaIssue,
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

/**
 * Scope a per-space post-apply verify result to the contract space's own
 * elements: drop the `extra` findings for collections another contract space
 * claims. The runner verifies the destination contract against the full live
 * database, which holds sibling spaces' collections — without the scoping a
 * multi-space apply could never pass strict verify. Extras claimed by NO space
 * survive, so genuine drift still fails the runner's verdict.
 *
 * The result is issue-based, so the verdict recomputes directly from the
 * surviving lists: `ok` holds exactly when both lists are empty. Mongo
 * results carry no `schemaDiffIssues`.
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
  if (issues.length === result.schema.issues.length) return result;

  const ok = issues.length === 0 && result.schema.schemaDiffIssues.length === 0;
  const { code: staleCode, ...envelope } = result;
  void staleCode;
  return {
    ...envelope,
    ok,
    ...(ok ? {} : { code: result.code ?? 'PN-RUN-3010' }),
    summary: ok ? 'Database schema satisfies contract' : result.summary,
    schema: { ...result.schema, issues },
  };
}
