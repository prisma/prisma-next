import type { DiffIssue, SchemaDiff } from '@prisma-next/framework-components/control';

/** The entity name a diff issue addresses, for ownership scoping. */
function issueEntityName(issue: DiffIssue): string | undefined {
  if ('outcome' in issue) {
    const actual = issue.actual;
    if (actual === undefined) return undefined;
    const tableName = (actual as { readonly tableName?: unknown }).tableName;
    return typeof tableName === 'string' ? tableName : undefined;
  }
  return 'table' in issue ? issue.table : undefined;
}

/**
 * Drops the `extra` findings for entities another contract-space member claims,
 * so the planner never emits DROP ops against a sibling space's tables. The
 * planner diffs the full live schema; this scopes the result to the member's
 * own space by entity name — the same coordinate the schema-pruning layer keyed
 * on. Absent/empty `ownedByOtherSpaces` returns the diff unchanged.
 */
export function scopePlanDiffToSpace(
  diff: SchemaDiff,
  ownedByOtherSpaces: ReadonlySet<string> | undefined,
): SchemaDiff {
  if (ownedByOtherSpaces === undefined || ownedByOtherSpaces.size === 0) return diff;
  return diff.filter((issue) => {
    const isExtra =
      'outcome' in issue ? issue.outcome === 'extra' : issue.kind.startsWith('extra_');
    if (!isExtra) return true;
    const name = issueEntityName(issue);
    return name === undefined || !ownedByOtherSpaces.has(name);
  });
}
