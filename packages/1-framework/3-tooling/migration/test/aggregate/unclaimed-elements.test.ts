import type {
  DiffableNode,
  SchemaDiffIssue,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import {
  collectExtraElementNames,
  stripExtraFindings,
} from '../../src/aggregate/unclaimed-elements';

/**
 * Structural stand-in for a SQL schema-diff node: the strip reads `diffRole`
 * and `id` structurally off issue nodes, never importing family node classes.
 */
function diffNode(id: string, diffRole: string): DiffableNode {
  return {
    id,
    diffRole,
    isEqualTo: () => true,
    children: () => [],
  } as never;
}

function extraTableIssue(name: string): SchemaDiffIssue {
  return {
    path: ['database', 'public', name],
    outcome: 'extra',
    reason: 'not-expected',
    message: `extra: ${name}`,
    actual: diffNode(name, 'table'),
  };
}

function extraColumnIssueUnder(tableName: string, columnName: string): SchemaDiffIssue {
  return {
    path: ['database', 'public', tableName, `column:${columnName}`],
    outcome: 'extra',
    reason: 'not-expected',
    message: `extra column: ${columnName}`,
    actual: diffNode(`column:${columnName}`, 'column'),
  };
}

function extraPolicyIssue(tableName: string, policyName: string): SchemaDiffIssue {
  return {
    path: ['database', 'public', tableName, policyName],
    outcome: 'extra',
    reason: 'not-expected',
    message: `RLS policy '${policyName}' is present in the database but not in the contract`,
    actual: {
      ...(diffNode(policyName, 'structural') as object),
      tableName,
    } as never,
  };
}

function makeResult(args: {
  ok: boolean;
  issues?: VerifyDatabaseSchemaResult['schema']['issues'];
  schemaDiffIssues?: VerifyDatabaseSchemaResult['schema']['schemaDiffIssues'];
}): VerifyDatabaseSchemaResult {
  return {
    ok: args.ok,
    ...(args.ok ? {} : { code: 'PN-RUN-3010' }),
    summary: args.ok ? 'Database schema satisfies contract' : 'does not satisfy',
    contract: { storageHash: 'sha256:x' },
    target: { expected: 'postgres' },
    schema: {
      issues: args.issues ?? [],
      schemaDiffIssues: args.schemaDiffIssues ?? [],
    },
    timings: { total: 0 },
  };
}

describe('stripExtraFindings', () => {
  it('returns the result unchanged when there are no extras', () => {
    const result = makeResult({ ok: true });
    expect(stripExtraFindings(result)).toBe(result);
  });

  it('strict extras-only failure passes after the strip (table + its descendants dropped)', () => {
    const result = makeResult({
      ok: false,
      schemaDiffIssues: [extraTableIssue('legacy'), extraColumnIssueUnder('legacy', 'id')],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped.schema.schemaDiffIssues).toEqual([]);
    expect(stripped.ok).toBe(true);
    expect(stripped.summary).toBe('Database schema satisfies contract');
  });

  it('coordinate extra_table issues are stripped the same way (Mongo shape)', () => {
    const result = makeResult({
      ok: false,
      issues: [
        { kind: 'extra_table', table: 'a', reason: 'not-expected', message: 'x' },
        { kind: 'extra_table', table: 'b', reason: 'not-expected', message: 'x' },
      ],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped.schema.issues).toEqual([]);
    expect(stripped.ok).toBe(true);
  });

  it('a real missing/mismatch failure survives the strip', () => {
    const result = makeResult({
      ok: false,
      issues: [
        {
          kind: 'missing_column',
          table: 'user',
          column: 'email',
          reason: 'not-found',
          message: 'm',
        },
        { kind: 'extra_table', table: 'legacy', reason: 'not-expected', message: 'x' },
      ],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped.ok).toBe(false);
    expect(stripped.schema.issues.map((i) => i.kind)).toEqual(['missing_column']);
  });

  it('keeps an extra column on a declared table as the space’s own drift', () => {
    // The extra column's path is not under any dropped table, so it stays and
    // the verdict stays consistent with the surviving evidence.
    const result = makeResult({
      ok: false,
      schemaDiffIssues: [extraColumnIssueUnder('user', 'stale')],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped).toBe(result);
    expect(stripped.ok).toBe(false);
  });

  it('keeps failing on an extra RLS policy when a sibling extra table is dropped', () => {
    // The policy is structural: it survives the strip even though its subject
    // sits under the space's own table, so live policy drift never false-passes.
    const policyIssue = extraPolicyIssue('user', 'policy_rogue');
    const result = makeResult({
      ok: false,
      schemaDiffIssues: [extraTableIssue('cipher_state'), policyIssue],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped.schema.schemaDiffIssues).toEqual([policyIssue]);
    expect(stripped.ok).toBe(false);
  });

  it('a structural policy extra under a DROPPED stray table still survives the strip', () => {
    const policyIssue = extraPolicyIssue('cipher_state', 'policy_rogue');
    const result = makeResult({
      ok: false,
      schemaDiffIssues: [
        extraTableIssue('cipher_state'),
        extraColumnIssueUnder('cipher_state', 'id'),
        policyIssue,
      ],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped.schema.schemaDiffIssues).toEqual([policyIssue]);
    expect(stripped.ok).toBe(false);
  });

  it('keeps an extra-policy schemaDiffIssue as the space’s own drift (nothing else stripped)', () => {
    const result = makeResult({
      ok: false,
      schemaDiffIssues: [extraPolicyIssue('user', 'policy_rogue')],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped).toBe(result);
    expect(stripped.schema.schemaDiffIssues).toHaveLength(1);
    expect(stripped.ok).toBe(false);
  });
});

describe('collectExtraElementNames', () => {
  it('gathers extra names from coordinate issues, table-role nodes, and policy subjects', () => {
    const result = makeResult({
      ok: false,
      issues: [
        { kind: 'extra_table', table: 'legacy', reason: 'not-expected', message: 'x' },
        { kind: 'missing_table', table: 'wanted', reason: 'not-found', message: 'm' },
      ],
      schemaDiffIssues: [
        extraTableIssue('stray'),
        extraPolicyIssue('audit', 'p'),
        {
          path: ['database', 'public', 'x', 'p'],
          outcome: 'missing',
          reason: 'not-found',
          message: 'm',
        },
      ],
    });

    expect([...collectExtraElementNames(result)].sort()).toEqual(['audit', 'legacy', 'stray']);
  });
});
