import type {
  DiffableNode,
  SchemaDiffIssue,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import {
  collectExtraElementCoordinates,
  stripExtraFindings,
} from '../../src/aggregate/unclaimed-elements';

/** A minimal diff node: the strip reads only the issue's stamped granularity + path. */
function diffNode(id: string): DiffableNode {
  return { id, isEqualTo: () => true, children: () => [] };
}

function extraTableIssue(name: string): SchemaDiffIssue {
  return {
    path: ['database', 'public', name],
    reason: 'not-expected',
    message: `extra: ${name}`,
    subjectGranularity: 'entity',
    actual: diffNode(name),
  };
}

function extraColumnIssueUnder(tableName: string, columnName: string): SchemaDiffIssue {
  return {
    path: ['database', 'public', tableName, `column:${columnName}`],
    reason: 'not-expected',
    message: `extra column: ${columnName}`,
    subjectGranularity: 'field',
    actual: diffNode(`column:${columnName}`),
  };
}

function extraPolicyIssue(tableName: string, policyName: string): SchemaDiffIssue {
  return {
    path: ['database', 'public', tableName, policyName],
    reason: 'not-expected',
    message: `RLS policy '${policyName}' is present in the database but not in the contract`,
    subjectGranularity: 'structural',
    actual: diffNode(policyName),
  };
}

/** A document-family extra-collection issue: no stamped granularity, path is the bare name. */
function extraCollectionIssue(name: string): SchemaDiffIssue {
  return {
    path: [name],
    reason: 'not-expected',
    message: `Extra collection "${name}" exists in the database but not in the contract`,
    actual: diffNode(name),
  };
}

function makeResult(args: {
  ok: boolean;
  issues?: VerifyDatabaseSchemaResult['schema']['issues'];
}): VerifyDatabaseSchemaResult {
  return {
    ok: args.ok,
    ...(args.ok ? {} : { code: 'PN-RUN-3010' }),
    summary: args.ok ? 'Database schema satisfies contract' : 'does not satisfy',
    contract: { storageHash: 'sha256:x' },
    target: { expected: 'postgres' },
    schema: {
      issues: args.issues ?? [],
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
      issues: [extraTableIssue('legacy'), extraColumnIssueUnder('legacy', 'id')],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped.schema.issues).toEqual([]);
    expect(stripped.ok).toBe(true);
    expect(stripped.summary).toBe('Database schema satisfies contract');
  });

  it('a Mongo-shape extra collection issue is stripped the same way', () => {
    const result = makeResult({
      ok: false,
      issues: [extraCollectionIssue('a'), extraCollectionIssue('b')],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped.schema.issues).toEqual([]);
    expect(stripped.ok).toBe(true);
  });

  it('a real missing/mismatch failure survives the strip', () => {
    const missingColumn: SchemaDiffIssue = {
      path: ['database', 'public', 'user', 'column:email'],
      reason: 'not-found',
      message: 'm',
      subjectGranularity: 'field',
      expected: diffNode('column:email'),
    };
    const result = makeResult({
      ok: false,
      issues: [missingColumn, extraTableIssue('legacy')],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped.ok).toBe(false);
    expect(stripped.schema.issues).toEqual([missingColumn]);
  });

  it('keeps an extra column on a declared table as the space’s own drift', () => {
    // The extra column's path is not under any dropped table, so it stays and
    // the verdict stays consistent with the surviving evidence.
    const result = makeResult({
      ok: false,
      issues: [extraColumnIssueUnder('user', 'stale')],
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
      issues: [extraTableIssue('cipher_state'), policyIssue],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped.schema.issues).toEqual([policyIssue]);
    expect(stripped.ok).toBe(false);
  });

  it('a structural policy extra under a DROPPED stray table still survives the strip', () => {
    const policyIssue = extraPolicyIssue('cipher_state', 'policy_rogue');
    const result = makeResult({
      ok: false,
      issues: [
        extraTableIssue('cipher_state'),
        extraColumnIssueUnder('cipher_state', 'id'),
        policyIssue,
      ],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped.schema.issues).toEqual([policyIssue]);
    expect(stripped.ok).toBe(false);
  });

  it('keeps an extra-policy issue as the space’s own drift (nothing else stripped)', () => {
    const result = makeResult({
      ok: false,
      issues: [extraPolicyIssue('user', 'policy_rogue')],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped).toBe(result);
    expect(stripped.schema.issues).toHaveLength(1);
    expect(stripped.ok).toBe(false);
  });
});

describe('collectExtraElementCoordinates', () => {
  it('gathers extra coordinates from whole-table-role nodes and Mongo-shape whole-collection issues', () => {
    const result = makeResult({
      ok: false,
      issues: [
        extraTableIssue('stray'),
        extraCollectionIssue('legacy'),
        extraPolicyIssue('audit', 'p'),
      ],
    });

    const coordinates = [...collectExtraElementCoordinates(result)].sort((a, b) =>
      a.entityName.localeCompare(b.entityName),
    );
    expect(coordinates).toEqual([
      { namespaceId: UNBOUND_NAMESPACE_ID, entityKind: 'table', entityName: 'legacy' },
      { namespaceId: 'public', entityKind: 'table', entityName: 'stray' },
    ]);
  });

  it('does not conflate the same bare name declared in two different namespaces', () => {
    const result = makeResult({
      ok: false,
      issues: [
        extraTableIssue('orphan_table'),
        {
          path: ['database', 'tenant_b', 'orphan_table'],
          reason: 'not-expected',
          message: 'extra: orphan_table',
          subjectGranularity: 'entity',
          actual: diffNode('orphan_table'),
        },
      ],
    });

    const coordinates = [...collectExtraElementCoordinates(result)].sort((a, b) =>
      a.namespaceId.localeCompare(b.namespaceId),
    );
    expect(coordinates).toEqual([
      { namespaceId: 'public', entityKind: 'table', entityName: 'orphan_table' },
      { namespaceId: 'tenant_b', entityKind: 'table', entityName: 'orphan_table' },
    ]);
  });
});
