import type { VerifyDatabaseSchemaResult } from '@prisma-next/framework-components/control';

/**
 * The combined per-space contract-satisfaction result (Part 1) plus the
 * standalone unclaimed-elements list (Part 2), reported once. The CLI renders
 * both; `unclaimed` is never folded into the combined tree or its issues.
 */
export interface CombinedVerifyResult {
  readonly result: VerifyDatabaseSchemaResult;
  readonly unclaimed: readonly string[];
}

/**
 * Collapse the aggregate verifier's per-space contract-satisfaction results
 * (Part 1) into a single {@link VerifyDatabaseSchemaResult} for the existing CLI
 * display surface, and carry the deduplicated unclaimed-elements list (Part 2)
 * alongside it. Concatenates issues across spaces; sums counts; uses the app
 * space's result as the structural envelope (storage hash, target). Extras are
 * already stripped from each per-space result, so nothing here duplicates an
 * unclaimed element per space.
 *
 * **Unclaimed disposition.** In strict mode a non-empty `unclaimed` list fails
 * the combined verdict (`ok: false`); in lenient mode it is carried for
 * informational rendering only. The list itself is returned unchanged for the
 * renderer.
 *
 * **Summary policy.** Preserve the per-family phrasing whenever the
 * combined `ok` flag agrees with the app space's `ok` flag — this is
 * the common case (single-family deployments, single-app deployments)
 * and the family's "satisfies / does not satisfy contract" phrasing
 * stays user-visible. When the app passes but an extension fails (or
 * vice versa) the app's summary contradicts the envelope, so fall back
 * to the first failing space's summary. This keeps family phrasing
 * intact and the envelope internally consistent (`ok: false` ↔ failure
 * summary).
 */
export function combineVerifyResults(
  perSpace: ReadonlyMap<string, VerifyDatabaseSchemaResult>,
  appSpaceId: string,
  strict: boolean,
  unclaimed: readonly string[],
): CombinedVerifyResult {
  const appResult = perSpace.get(appSpaceId) ?? perSpace.values().next().value;
  if (appResult === undefined) {
    throw new Error(
      'Aggregate verifier returned no per-space verify results — this is a wiring bug.',
    );
  }

  let okAll = true;
  let firstFailure: VerifyDatabaseSchemaResult | undefined;
  let issues: VerifyDatabaseSchemaResult['schema']['issues'] = [];
  let schemaDiffIssues: VerifyDatabaseSchemaResult['schema']['schemaDiffIssues'] = [];
  const counts = { pass: 0, warn: 0, fail: 0, totalNodes: 0 };
  const childRoots: Array<VerifyDatabaseSchemaResult['schema']['root']> = [];
  for (const [, result] of perSpace) {
    if (!result.ok) {
      okAll = false;
      if (firstFailure === undefined) firstFailure = result;
    }
    issues = [...issues, ...result.schema.issues];
    schemaDiffIssues = [...schemaDiffIssues, ...result.schema.schemaDiffIssues];
    counts.pass += result.schema.counts.pass;
    counts.warn += result.schema.counts.warn;
    counts.fail += result.schema.counts.fail;
    counts.totalNodes += result.schema.counts.totalNodes;
    childRoots.push(result.schema.root);
  }

  const unclaimedFails = strict && unclaimed.length > 0;
  const ok = okAll && !unclaimedFails;

  // Prefer a failing space's family phrasing; else, when only the unclaimed list
  // fails the verdict, say so; else keep the app space's phrasing.
  const summary = okAll
    ? unclaimedFails
      ? `Database schema has ${unclaimed.length} unclaimed element${unclaimed.length === 1 ? '' : 's'} (not in any contract)`
      : appResult.summary
    : appResult.ok
      ? (firstFailure as VerifyDatabaseSchemaResult).summary
      : appResult.summary;

  return {
    result: {
      ok,
      ...(ok ? {} : { code: appResult.code ?? 'PN-RUN-3010' }),
      summary,
      contract: appResult.contract,
      target: appResult.target,
      schema: {
        issues,
        schemaDiffIssues,
        root: {
          status: ok ? 'pass' : 'fail',
          kind: 'aggregate',
          name: 'aggregate',
          contractPath: '',
          code: 'AGGREGATE',
          message: ok ? 'Aggregate schema matches' : 'Aggregate schema mismatch',
          expected: undefined,
          actual: undefined,
          children: childRoots,
        },
        counts,
      },
      meta: { strict },
      timings: { total: 0 },
    },
    unclaimed,
  };
}
