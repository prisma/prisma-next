import type {
  SchemaVerificationNode,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import {
  collectExtraElementNames,
  stripExtraFindings,
} from '../../src/aggregate/unclaimed-elements';

function tableNode(
  name: string,
  status: SchemaVerificationNode['status'],
  code = '',
  children: SchemaVerificationNode[] = [],
): SchemaVerificationNode {
  return {
    status,
    kind: 'table',
    name,
    contractPath: `storage.namespaces.public.entries.table.${name}`,
    code,
    message: '',
    expected: undefined,
    actual: undefined,
    children,
  };
}

function extraTableNode(name: string, status: 'fail' | 'warn'): SchemaVerificationNode {
  return { ...tableNode(`table ${name}`, status, 'extra_table') };
}

function makeResult(args: {
  ok: boolean;
  children: SchemaVerificationNode[];
  counts: VerifyDatabaseSchemaResult['schema']['counts'];
  issues?: VerifyDatabaseSchemaResult['schema']['issues'];
  schemaDiffIssues?: VerifyDatabaseSchemaResult['schema']['schemaDiffIssues'];
}): VerifyDatabaseSchemaResult {
  const rootStatus = args.children.some((c) => c.status === 'fail')
    ? 'fail'
    : args.children.some((c) => c.status === 'warn')
      ? 'warn'
      : 'pass';
  return {
    ok: args.ok,
    ...(args.ok ? {} : { code: 'PN-RUN-3010' }),
    summary: args.ok ? 'Database schema satisfies contract' : 'does not satisfy',
    contract: { storageHash: 'sha256:x' },
    target: { expected: 'postgres' },
    schema: {
      issues: args.issues ?? [],
      schemaDiffIssues: args.schemaDiffIssues ?? [],
      root: {
        status: rootStatus,
        kind: 'contract',
        name: 'contract',
        contractPath: '',
        code: '',
        message: '',
        expected: undefined,
        actual: undefined,
        children: args.children,
      },
      counts: args.counts,
    },
    timings: { total: 0 },
  };
}

describe('stripExtraFindings', () => {
  it('returns the result unchanged when there are no extras', () => {
    const result = makeResult({
      ok: true,
      children: [tableNode('user', 'pass')],
      // Faithful SQL basis: the root is counted at its own status (pass).
      counts: { pass: 2, warn: 0, fail: 0, totalNodes: 2 },
    });
    expect(stripExtraFindings(result)).toBe(result);
  });

  it('SQL basis (root counted): strict extras-only failure passes after the strip', () => {
    // Faithful SQL counts: computeCounts walks EVERY node including the root at
    // its own status. Root fail + user pass + extra fail => pass=1, fail=2.
    const result = makeResult({
      ok: false,
      children: [tableNode('user', 'pass'), extraTableNode('legacy', 'fail')],
      counts: { pass: 1, warn: 0, fail: 2, totalNodes: 3 },
      issues: [{ kind: 'extra_table', table: 'legacy', message: 'x' }],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped.schema.root.children.map((c) => c.name)).toEqual(['user']);
    expect(stripped.schema.issues).toEqual([]);
    // The only failures were the extra node and the root's echo of it. The
    // pruned tree is all-pass, so the space satisfies its contract.
    expect(stripped.ok).toBe(true);
    expect(stripped.schema.counts).toEqual({ pass: 2, warn: 0, fail: 0, totalNodes: 2 });
  });

  it('SQL basis: a real missing/mismatch failure survives the strip', () => {
    // Root fail + user fail + extra fail => fail=3 under the SQL basis.
    const result = makeResult({
      ok: false,
      children: [tableNode('user', 'fail', 'missing_column'), extraTableNode('legacy', 'fail')],
      counts: { pass: 0, warn: 0, fail: 3, totalNodes: 3 },
      issues: [
        { kind: 'missing_column', table: 'user', column: 'email', message: 'm' },
        { kind: 'extra_table', table: 'legacy', message: 'x' },
      ],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped.ok).toBe(false);
    expect(stripped.schema.issues.map((i) => i.kind)).toEqual(['missing_column']);
    // Recomputed from the pruned tree: root fail + user fail.
    expect(stripped.schema.counts.fail).toBe(2);
  });

  it('Mongo basis (root not counted): strict extras-only failure passes after the strip', () => {
    // Faithful Mongo counts: fail++ per collection, the root is never counted.
    // Two extra collections => fail=2, totalNodes=2.
    const result = makeResult({
      ok: false,
      children: [extraTableNode('a', 'fail'), extraTableNode('b', 'fail')],
      counts: { pass: 0, warn: 0, fail: 2, totalNodes: 2 },
      issues: [
        { kind: 'extra_table', table: 'a', message: 'x' },
        { kind: 'extra_table', table: 'b', message: 'x' },
      ],
    });

    const stripped = stripExtraFindings(result);

    // Recomputed with a plain self-consistent walk of the pruned tree: only the
    // (now passing) root remains.
    expect(stripped.schema.counts).toEqual({ pass: 1, warn: 0, fail: 0, totalNodes: 1 });
    expect(stripped.ok).toBe(true);
  });

  it('strips an extra node whatever disposition the control policy reconciled it to', () => {
    // Mongo lenient basis: user pass + extra warn => pass=1, warn=1, root not counted.
    const result = makeResult({
      ok: true,
      children: [tableNode('user', 'pass'), extraTableNode('legacy', 'warn')],
      counts: { pass: 1, warn: 1, fail: 0, totalNodes: 2 },
      issues: [{ kind: 'extra_table', table: 'legacy', message: 'x' }],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped.schema.root.children.map((c) => c.name)).toEqual(['user']);
    expect(stripped.schema.counts.warn).toBe(0);
    expect(stripped.ok).toBe(true);
  });

  it('keeps an extra column on a declared table in Part 1 as the space’s own drift', () => {
    // An extra column lives INSIDE a declared table's subtree; its fail is baked
    // into the tree and counts. Stripping the issue while the failure stays
    // would make the space fail with an empty issue list.
    const columnNode: SchemaVerificationNode = {
      status: 'fail',
      kind: 'column',
      name: 'stale',
      contractPath: 'storage.namespaces.public.entries.table.user.columns.stale',
      code: 'extra_column',
      message: 'Extra column "stale"',
      expected: undefined,
      actual: 'stale',
      children: [],
    };
    const result = makeResult({
      ok: false,
      children: [tableNode('user', 'fail', 'extra_column', [columnNode])],
      counts: { pass: 0, warn: 0, fail: 3, totalNodes: 3 },
      issues: [{ kind: 'extra_column', table: 'user', column: 'stale', message: 'x' }],
    });

    const stripped = stripExtraFindings(result);

    // Nothing top-level was stripped, so the result is untouched: the issue
    // stays as evidence and the verdict stays consistent with it.
    expect(stripped).toBe(result);
    expect(stripped.schema.issues.map((i) => i.kind)).toEqual(['extra_column']);
    expect(stripped.ok).toBe(false);
  });

  it('keeps an extra-policy schemaDiffIssue in Part 1 as the space’s own drift', () => {
    const result = makeResult({
      ok: false,
      children: [tableNode('user', 'pass')],
      counts: { pass: 2, warn: 0, fail: 1, totalNodes: 2 },
      schemaDiffIssues: [
        {
          path: ['public', 'user', 'policy_rogue'],
          outcome: 'extra',
          message: "RLS policy 'policy_rogue' is present in the database but not in the contract",
        },
      ],
    });

    const stripped = stripExtraFindings(result);

    // Policy extras are the space's own drift evidence; the family already
    // folded them into the verdict, so they must stay visible in Part 1.
    expect(stripped).toBe(result);
    expect(stripped.schema.schemaDiffIssues).toHaveLength(1);
    expect(stripped.ok).toBe(false);
  });
});

describe('collectExtraElementNames', () => {
  it('gathers extra names from issues and extra schemaDiffIssues', () => {
    const result = makeResult({
      ok: false,
      children: [],
      counts: { pass: 0, warn: 0, fail: 0, totalNodes: 0 },
      issues: [
        { kind: 'extra_table', table: 'legacy', message: 'x' },
        { kind: 'missing_table', table: 'wanted', message: 'm' },
      ],
      schemaDiffIssues: [
        {
          path: ['public', 'audit', 'p'],
          outcome: 'extra',
          message: 'e',
          actual: { tableName: 'audit' } as never,
        },
        { path: ['public', 'x', 'p'], outcome: 'missing', message: 'm' },
      ],
    });

    expect([...collectExtraElementNames(result)].sort()).toEqual(['audit', 'legacy']);
  });
});
