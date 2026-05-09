import type { VerifyDatabaseSchemaResult } from '@prisma-next/framework-components/control';

/**
 * Collapse the aggregate verifier's per-space schema results into a
 * single {@link VerifyDatabaseSchemaResult} for the existing CLI
 * display surface. Concatenates issues across members; sums counts;
 * uses the app member's result as the structural envelope (storage
 * hash, target).
 *
 * **Summary policy.** Preserve the per-family phrasing whenever the
 * combined `ok` flag agrees with the app member's `ok` flag — this is
 * the common case (single-family deployments, single-app deployments)
 * and the family's "satisfies / does not satisfy contract" phrasing
 * stays user-visible. When the app passes but an extension fails (or
 * vice versa) the app's summary contradicts the envelope, so fall back
 * to the first failing member's summary. This keeps family phrasing
 * intact and the envelope internally consistent (`ok: false` ↔ failure
 * summary).
 */
export function combineSchemaResults(
  perSpace: ReadonlyMap<string, VerifyDatabaseSchemaResult>,
  appSpaceId: string,
  strict: boolean,
): VerifyDatabaseSchemaResult {
  const appResult = perSpace.get(appSpaceId) ?? perSpace.values().next().value;
  if (appResult === undefined) {
    throw new Error('Aggregate verifier returned no schema results — this is a wiring bug.');
  }

  let okAll = true;
  let firstFailure: VerifyDatabaseSchemaResult | undefined;
  let issues: VerifyDatabaseSchemaResult['schema']['issues'] = [];
  const counts = { pass: 0, warn: 0, fail: 0, totalNodes: 0 };
  const childRoots: Array<VerifyDatabaseSchemaResult['schema']['root']> = [];
  for (const [, result] of perSpace) {
    if (!result.ok) {
      okAll = false;
      if (firstFailure === undefined) firstFailure = result;
    }
    issues = [...issues, ...result.schema.issues];
    counts.pass += result.schema.counts.pass;
    counts.warn += result.schema.counts.warn;
    counts.fail += result.schema.counts.fail;
    counts.totalNodes += result.schema.counts.totalNodes;
    childRoots.push(result.schema.root);
  }

  const summary =
    okAll === appResult.ok ? appResult.summary : (firstFailure?.summary ?? appResult.summary);

  return {
    ok: okAll,
    ...(okAll ? {} : { code: appResult.code ?? 'PN-RUN-3010' }),
    summary,
    contract: appResult.contract,
    target: appResult.target,
    schema: {
      issues,
      root: {
        status: okAll ? 'pass' : 'fail',
        kind: 'aggregate',
        name: 'aggregate',
        contractPath: '',
        code: 'AGGREGATE',
        message: okAll ? 'Aggregate schema matches' : 'Aggregate schema mismatch',
        expected: undefined,
        actual: undefined,
        children: childRoots,
      },
      counts,
    },
    meta: { strict },
    timings: { total: 0 },
  };
}
