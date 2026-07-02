import type {
  DiffableNode,
  SchemaVerificationNode,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import { scopeSchemaResultToSpace } from '../../src/aggregate/scope-schema-result';

function policyNode(id: string, tableName: string): DiffableNode {
  return { id, tableName, isEqualTo: () => false, children: () => [] } as DiffableNode;
}

function tableNode(
  name: string,
  status: 'pass' | 'warn' | 'fail',
  code = '',
): SchemaVerificationNode {
  return {
    status,
    kind: 'table',
    name: `table ${name}`,
    contractPath: `storage.namespaces.*.entries.table.${name}`,
    code,
    message: '',
    expected: undefined,
    actual: undefined,
    children: [],
  };
}

function resultWith(
  children: readonly SchemaVerificationNode[],
  issues: VerifyDatabaseSchemaResult['schema']['issues'],
): VerifyDatabaseSchemaResult {
  const fail = children.filter((c) => c.status === 'fail').length;
  const warn = children.filter((c) => c.status === 'warn').length;
  const pass = children.filter((c) => c.status === 'pass').length;
  const rootStatus = fail > 0 ? 'fail' : warn > 0 ? 'warn' : 'pass';
  return {
    ok: fail === 0,
    summary: 'original summary',
    contract: { storageHash: 'sha256:test' },
    target: { expected: 'postgres' },
    schema: {
      issues,
      schemaDiffIssues: [],
      root: {
        status: rootStatus,
        kind: 'contract',
        name: 'contract',
        contractPath: '',
        code: '',
        message: '',
        expected: undefined,
        actual: undefined,
        children,
      },
      counts: { pass: pass + 1, warn, fail, totalNodes: children.length + 1 },
    },
    timings: { total: 0 },
  };
}

describe('scopeSchemaResultToSpace', () => {
  it('returns the input unchanged when no names are owned by others', () => {
    const result = resultWith([tableNode('user', 'pass')], []);
    expect(scopeSchemaResultToSpace(result, new Set())).toBe(result);
  });

  it('drops an extra-table issue owned by another member, keeps the undeclared one', () => {
    const result = resultWith(
      [tableNode('user', 'pass'), tableNode('cipher_state', 'warn'), tableNode('orphan', 'warn')],
      [
        { kind: 'extra_table', table: 'cipher_state', message: 'extra cipher_state' },
        { kind: 'extra_table', table: 'orphan', message: 'extra orphan' },
      ],
    );

    const scoped = scopeSchemaResultToSpace(result, new Set(['cipher_state']));

    expect(scoped.schema.issues).toEqual([
      { kind: 'extra_table', table: 'orphan', message: 'extra orphan' },
    ]);
    expect(scoped.schema.root.children.map((c) => c.name)).toEqual(['table user', 'table orphan']);
  });

  it('recomputes counts over the pruned tree', () => {
    const result = resultWith(
      [tableNode('user', 'pass'), tableNode('sibling', 'fail', 'extra_table')],
      [{ kind: 'extra_table', table: 'sibling', message: 'extra sibling' }],
    );

    const scoped = scopeSchemaResultToSpace(result, new Set(['sibling']));

    expect(scoped.schema.counts).toEqual({ pass: 2, warn: 0, fail: 0, totalNodes: 2 });
  });

  it('flips ok to true and re-derives the summary when the only failures were siblings', () => {
    const result = resultWith(
      [tableNode('user', 'pass'), tableNode('sibling', 'fail', 'extra_table')],
      [{ kind: 'extra_table', table: 'sibling', message: 'extra sibling' }],
    );
    expect(result.ok).toBe(false);

    const scoped = scopeSchemaResultToSpace(result, new Set(['sibling']));

    expect(scoped.ok).toBe(true);
    expect(scoped.code).toBeUndefined();
    expect(scoped.summary).toBe('Database schema satisfies contract');
  });

  it('keeps a real failure and stays not-ok when a sibling is dropped alongside it', () => {
    const result = resultWith(
      [tableNode('user', 'fail', 'missing_column'), tableNode('sibling', 'fail', 'extra_table')],
      [
        { kind: 'missing_column', table: 'user', column: 'age', message: 'missing age' },
        { kind: 'extra_table', table: 'sibling', message: 'extra sibling' },
      ],
    );

    const scoped = scopeSchemaResultToSpace(result, new Set(['sibling']));

    expect(scoped.ok).toBe(false);
    // The root node stays `fail` (user still fails) and is itself counted, so
    // fail = root + user = 2 once the sibling leaf is dropped.
    expect(scoped.schema.counts.fail).toBe(2);
    expect(scoped.schema.issues).toEqual([
      { kind: 'missing_column', table: 'user', column: 'age', message: 'missing age' },
    ]);
  });

  it('drops an extra policy schemaDiffIssue owned by another member', () => {
    const result: VerifyDatabaseSchemaResult = {
      ...resultWith([], []),
      schema: {
        issues: [],
        schemaDiffIssues: [
          {
            path: ['db', 'auth', 'sibling', 'p'],
            outcome: 'extra',
            message: 'extra policy',
            actual: policyNode('p', 'sibling'),
          },
          {
            path: ['db', 'public', 'orphan', 'q'],
            outcome: 'extra',
            message: 'extra policy',
            actual: policyNode('q', 'orphan'),
          },
        ],
        root: resultWith([], []).schema.root,
        counts: { pass: 1, warn: 0, fail: 0, totalNodes: 1 },
      },
    };

    const scoped = scopeSchemaResultToSpace(result, new Set(['sibling']));

    expect(scoped.schema.schemaDiffIssues.map((i) => i.path.join('/'))).toEqual([
      'db/public/orphan/q',
    ]);
  });
});
