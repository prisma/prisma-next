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
    children: [],
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
      counts: { pass: 2, warn: 0, fail: 0, totalNodes: 2 },
    });
    expect(stripExtraFindings(result)).toBe(result);
  });

  it('drops extra-table nodes and issues, leaving the declared nodes', () => {
    const result = makeResult({
      ok: false,
      children: [tableNode('user', 'pass'), extraTableNode('legacy', 'fail')],
      counts: { pass: 2, warn: 0, fail: 1, totalNodes: 3 },
      issues: [{ kind: 'extra_table', table: 'legacy', message: 'x' }],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped.schema.root.children.map((c) => c.name)).toEqual(['user']);
    expect(stripped.schema.issues).toEqual([]);
    // The extra node contributed the only failure; the space now satisfies.
    expect(stripped.ok).toBe(true);
    expect(stripped.schema.counts).toEqual({ pass: 2, warn: 0, fail: 0, totalNodes: 2 });
  });

  it('keeps a real missing/mismatch failure after stripping extras', () => {
    const result = makeResult({
      ok: false,
      children: [tableNode('user', 'fail', 'missing_column'), extraTableNode('legacy', 'fail')],
      counts: { pass: 0, warn: 0, fail: 2, totalNodes: 3 },
      issues: [
        { kind: 'missing_column', table: 'user', column: 'email', message: 'm' },
        { kind: 'extra_table', table: 'legacy', message: 'x' },
      ],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped.ok).toBe(false);
    expect(stripped.schema.issues.map((i) => i.kind)).toEqual(['missing_column']);
    expect(stripped.schema.counts.fail).toBe(1);
  });

  it('subtracts from authoritative counts rather than re-tallying (Mongo does not count the root)', () => {
    // Mongo-shaped counts: fail-per-collection, root not counted. Two extra
    // collections at fail; totalNodes counts only the collection children.
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

    // Both extras removed; no declared nodes remain; verdict passes.
    expect(stripped.schema.counts).toEqual({ pass: 0, warn: 0, fail: 0, totalNodes: 0 });
    expect(stripped.ok).toBe(true);
  });

  it('strips an extra node whatever disposition the control policy reconciled it to', () => {
    const result = makeResult({
      ok: true,
      children: [tableNode('user', 'pass'), extraTableNode('legacy', 'warn')],
      counts: { pass: 2, warn: 1, fail: 0, totalNodes: 3 },
      issues: [{ kind: 'extra_table', table: 'legacy', message: 'x' }],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped.schema.root.children.map((c) => c.name)).toEqual(['user']);
    expect(stripped.schema.counts.warn).toBe(0);
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
