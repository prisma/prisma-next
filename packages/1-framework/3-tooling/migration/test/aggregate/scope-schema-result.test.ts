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

function columnNode(
  tableName: string,
  columnName: string,
  status: 'pass' | 'warn' | 'fail',
  code = '',
): SchemaVerificationNode {
  return {
    status,
    kind: 'column',
    name: columnName,
    contractPath: `storage.namespaces.*.entries.table.${tableName}.columns.${columnName}`,
    code,
    message: '',
    expected: undefined,
    actual: undefined,
    children: [],
  };
}

function tableNode(
  name: string,
  status: 'pass' | 'warn' | 'fail',
  code = '',
  children: readonly SchemaVerificationNode[] = [],
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
    children,
  };
}

function resultWith(
  children: readonly SchemaVerificationNode[],
  issues: VerifyDatabaseSchemaResult['schema']['issues'],
): VerifyDatabaseSchemaResult {
  let fail = children.filter((c) => c.status === 'fail').length;
  let warn = children.filter((c) => c.status === 'warn').length;
  let pass = children.filter((c) => c.status === 'pass').length;
  const rootStatus = fail > 0 ? 'fail' : warn > 0 ? 'warn' : 'pass';
  // Count the root node itself at its own status — matching the family verify's
  // `computeCounts`, which walks every node including the root.
  if (rootStatus === 'fail') fail += 1;
  else if (rootStatus === 'warn') warn += 1;
  else pass += 1;
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
      counts: { pass, warn, fail, totalNodes: children.length + 1 },
    },
    timings: { total: 0 },
  };
}

describe('scopeSchemaResultToSpace', () => {
  it('returns the input unchanged when no names are owned by others', () => {
    const result = resultWith([tableNode('user', 'pass')], []);
    expect(scopeSchemaResultToSpace(result, new Set())).toBe(result);
  });

  it('preserves the authoritative counts when a non-empty owned set drops nothing', () => {
    // A multi-schema result keeps only the first namespace's root but sums the
    // counts across every namespace, so `counts` is not derivable from `root`.
    // Scoping must not recompute counts from the (partial) root when it drops
    // nothing — it must leave the authoritative counts untouched.
    const result = resultWith([tableNode('user', 'pass')], []);
    const authoritative = { pass: 9, warn: 2, fail: 1, totalNodes: 12 };
    const multiSchema: VerifyDatabaseSchemaResult = {
      ...result,
      ok: false,
      schema: { ...result.schema, counts: authoritative },
    };

    const scoped = scopeSchemaResultToSpace(multiSchema, new Set(['nothing_here']));

    expect(scoped.schema.counts).toEqual(authoritative);
    expect(scoped.ok).toBe(false);
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

  it('prunes only top-level table nodes, never a member’s own column named like a sibling table', () => {
    // A sibling space owns a table named `orders`. The member's own `user` table
    // has two columns, `orders` (passing) and `orders` again as a failing type
    // mismatch — both share the sibling table's name. Scoping must touch NEITHER
    // column (they are not top-level tables), so the real failure survives and
    // the verdict does not flip to a false pass.
    const passCol = columnNode('user', 'orders', 'pass');
    const failCol = columnNode('user', 'orders', 'fail', 'type_mismatch');
    const userTable = tableNode('user', 'fail', 'type_mismatch', [passCol, failCol]);
    const result: VerifyDatabaseSchemaResult = {
      ok: false,
      code: 'PN-RUN-3010',
      summary: 'Database schema does not satisfy contract (1 failure)',
      contract: { storageHash: 'sha256:test' },
      target: { expected: 'postgres' },
      schema: {
        issues: [
          {
            kind: 'type_mismatch',
            table: 'user',
            column: 'orders',
            message: 'type mismatch on user.orders',
          },
        ],
        schemaDiffIssues: [],
        root: {
          status: 'fail',
          kind: 'contract',
          name: 'contract',
          contractPath: '',
          code: 'type_mismatch',
          message: '',
          expected: undefined,
          actual: undefined,
          children: [userTable],
        },
        counts: { pass: 2, warn: 0, fail: 2, totalNodes: 4 },
      },
      timings: { total: 0 },
    };
    // The sibling space owns a table literally named `orders`.
    const scoped = scopeSchemaResultToSpace(result, new Set(['orders']));

    // The member's own `user` table and both its columns are untouched, so the
    // failing column survives and the verdict does not flip to a false pass.
    const scopedUser = scoped.schema.root.children[0];
    expect(scopedUser?.name).toBe('table user');
    expect(scopedUser?.children).toHaveLength(2);
    expect(scoped.ok).toBe(false);
    expect(scoped.schema.counts.fail).toBe(result.schema.counts.fail);
    expect(scoped.schema.issues).toEqual(result.schema.issues);
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
