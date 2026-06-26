import { describe, expect, it } from 'vitest';
import type { DiffableNode, SchemaDiffIssue } from '../src/control/schema-diff';
import { diffSchemas } from '../src/control/schema-diff';
import type { EntityCoordinate } from '../src/ir/storage';

/** A synthetic root node whose `isEqualTo` is always true — used to wrap flat node lists. */
function rootOf(nodes: readonly DiffableNode[]): DiffableNode {
  return {
    coord(): EntityCoordinate {
      return { plane: 'storage', namespaceId: '', entityKind: 'database', entityName: 'root' };
    },
    isEqualTo(): boolean {
      return true;
    },
    children(): readonly DiffableNode[] {
      return nodes;
    },
  };
}

function makeNode(
  namespaceId: string,
  entityKind: string,
  entityName: string,
  body = '',
  childNodes: readonly DiffableNode[] = [],
): DiffableNode {
  return {
    coord(): EntityCoordinate {
      return { plane: 'storage', namespaceId, entityKind, entityName };
    },
    children(): readonly DiffableNode[] {
      return childNodes;
    },
    isEqualTo(other: DiffableNode): boolean {
      const o = other.coord();
      const mine = this.coord();
      return (
        mine.entityName === o.entityName &&
        mine.entityKind === o.entityKind &&
        mine.namespaceId === o.namespaceId &&
        body === (other as typeof this & { _body?: string })._body
      );
    },
    _body: body,
  } as DiffableNode & { _body: string };
}

describe('diffSchemas', () => {
  it('returns empty when expected and actual are both empty', () => {
    expect(diffSchemas(rootOf([]), rootOf([]))).toEqual([]);
  });

  it('reports missing when an expected node has no match in actual', () => {
    const expected = [makeNode('public', 'policy', 'read_own_abcd1234')];
    const issues = diffSchemas(rootOf(expected), rootOf([]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      outcome: 'missing',
      coordinate: {
        plane: 'storage',
        namespaceId: 'public',
        entityKind: 'policy',
        entityName: 'read_own_abcd1234',
      },
    });
  });

  it('reports extra when an actual node has no match in expected', () => {
    const actual = [makeNode('public', 'policy', 'stale_policy_deadbeef')];
    const issues = diffSchemas(rootOf([]), rootOf(actual));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      outcome: 'extra',
      coordinate: {
        plane: 'storage',
        namespaceId: 'public',
        entityKind: 'policy',
        entityName: 'stale_policy_deadbeef',
      },
    });
  });

  it('reports mismatch when both sides have the node but isEqualTo returns false', () => {
    const expected = [makeNode('public', 'policy', 'read_own_abcd1234', 'body-v1')];
    const actual = [makeNode('public', 'policy', 'read_own_abcd1234', 'body-v2')];
    const issues = diffSchemas(rootOf(expected), rootOf(actual));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      outcome: 'mismatch',
      coordinate: {
        plane: 'storage',
        namespaceId: 'public',
        entityKind: 'policy',
        entityName: 'read_own_abcd1234',
      },
    });
  });

  it('returns no issues when expected and actual match exactly', () => {
    const node = makeNode('public', 'policy', 'read_own_abcd1234', 'same-body');
    const expected = [node];
    const actual = [makeNode('public', 'policy', 'read_own_abcd1234', 'same-body')];
    const issues = diffSchemas(rootOf(expected), rootOf(actual));
    expect(issues).toEqual([]);
  });

  it('handles a mix of missing, extra, and mismatch in one call', () => {
    const expected = [
      makeNode('ns', 'widget', 'alpha', 'v1'),
      makeNode('ns', 'widget', 'beta', 'same'),
      makeNode('ns', 'widget', 'gamma', 'body'),
    ];
    const actual = [
      makeNode('ns', 'widget', 'alpha', 'v2'),
      makeNode('ns', 'widget', 'beta', 'same'),
      makeNode('ns', 'widget', 'delta', 'extra'),
    ];
    const issues = diffSchemas(rootOf(expected), rootOf(actual));
    expect(issues).toHaveLength(3);
    const byName = Object.fromEntries(issues.map((i) => [i.coordinate.entityName, i.outcome]));
    expect(byName).toEqual({ alpha: 'mismatch', gamma: 'missing', delta: 'extra' });
  });

  it('returns issues for all expected nodes when actual is empty', () => {
    const expected = [makeNode('ns', 'widget', 'zzz'), makeNode('ns', 'widget', 'aaa')];
    const issues = diffSchemas(rootOf(expected), rootOf([]));
    const names = new Set(issues.map((i) => i.coordinate.entityName));
    expect(names).toEqual(new Set(['aaa', 'zzz']));
    expect(issues).toHaveLength(2);
  });

  it('message field is a non-empty string', () => {
    const issues = diffSchemas(rootOf([makeNode('ns', 'x', 'y')]), rootOf([]));
    expect(typeof issues[0]?.message).toBe('string');
    expect((issues[0]?.message.length ?? 0) > 0).toBe(true);
  });

  it('missing issue carries expected node ref but no actual', () => {
    const expectedNode = makeNode('public', 'policy', 'read_own_abcd1234');
    const issues = diffSchemas(rootOf([expectedNode]), rootOf([]));
    const issue = issues[0] as SchemaDiffIssue;
    expect(issue.expected).toBe(expectedNode);
    expect(issue.actual).toBeUndefined();
  });

  it('extra issue carries actual node ref but no expected', () => {
    const actualNode = makeNode('public', 'policy', 'stale_policy_deadbeef');
    const issues = diffSchemas(rootOf([]), rootOf([actualNode]));
    const issue = issues[0] as SchemaDiffIssue;
    expect(issue.actual).toBe(actualNode);
    expect(issue.expected).toBeUndefined();
  });

  it('mismatch issue carries both expected and actual node refs', () => {
    const expectedNode = makeNode('public', 'policy', 'read_own_abcd1234', 'body-v1');
    const actualNode = makeNode('public', 'policy', 'read_own_abcd1234', 'body-v2');
    const issues = diffSchemas(rootOf([expectedNode]), rootOf([actualNode]));
    const issue = issues[0] as SchemaDiffIssue;
    expect(issue.expected).toBe(expectedNode);
    expect(issue.actual).toBe(actualNode);
  });

  it('stableKey does not use null bytes — coordinate fields are pipe-separated', () => {
    // Two nodes with entityKind 'pol' + entityName 'icy' must not collide with
    // a node with entityKind 'policy' and an entityName that starts at the same
    // byte offset. Null-byte separation would not prevent this; the canonical
    // coordinate stringify must use a separator that cannot appear in any field.
    const nodeA = makeNode('public', 'pol', 'icy');
    const nodeB = makeNode('public', 'policy', 'x');
    const issues = diffSchemas(rootOf([nodeA]), rootOf([nodeB]));
    // Both expected — one missing, one extra
    expect(issues).toHaveLength(2);
    const outcomes = new Set(issues.map((i) => i.outcome));
    expect(outcomes).toEqual(new Set(['missing', 'extra']));
  });

  it('throws when two siblings share the same coordinate in expected', () => {
    const a = makeNode('public', 'policy', 'dup_name');
    const b = makeNode('public', 'policy', 'dup_name');
    expect(() => diffSchemas(rootOf([a, b]), rootOf([]))).toThrow(
      'diffSchemas: duplicate coordinate key among siblings',
    );
  });

  it('throws when two siblings share the same coordinate in actual', () => {
    const a = makeNode('public', 'policy', 'dup_name');
    const b = makeNode('public', 'policy', 'dup_name');
    expect(() => diffSchemas(rootOf([]), rootOf([a, b]))).toThrow(
      'diffSchemas: duplicate coordinate key among siblings',
    );
  });

  it('descends into a matched pair and reports one issue at the child coordinate (AC-2)', () => {
    // A parent present on both sides whose coord() matches and isEqualTo is true,
    // but whose children differ on one child. diffSchemas descends the matched
    // pair and reports exactly one issue, at the child's coordinate.
    const expectedChild = makeNode('public', 'column', 'present_child', 'same');
    const actualChild = makeNode('public', 'column', 'present_child', 'same');
    const missingChild = makeNode('public', 'column', 'only_in_expected', 'x');

    const expectedParent = makeNode('public', 'table', 'parent', 'parent-body', [
      expectedChild,
      missingChild,
    ]);
    const actualParent = makeNode('public', 'table', 'parent', 'parent-body', [actualChild]);

    const issues = diffSchemas(rootOf([expectedParent]), rootOf([actualParent]));

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      outcome: 'missing',
      coordinate: {
        plane: 'storage',
        namespaceId: 'public',
        entityKind: 'column',
        entityName: 'only_in_expected',
      },
    });
  });

  it('emits mismatch at node coord AND child-level issues when diffing two nodes directly', () => {
    // Proves diffSchemas compares the given nodes themselves, not just their children.
    // tableA and tableB share the same coordinate but isEqualTo is false (different body).
    // Their children also differ (one column only on tableA).
    const onlyInA = makeNode('public', 'column', 'only_in_a', 'col');
    const shared = makeNode('public', 'column', 'shared_col', 'same');

    const tableA = makeNode('public', 'table', 'users', 'body-v1', [shared, onlyInA]);
    const tableB = makeNode('public', 'table', 'users', 'body-v2', [
      makeNode('public', 'column', 'shared_col', 'same'),
    ]);

    const issues = diffSchemas(tableA, tableB);

    expect(issues).toHaveLength(2);
    const byName = Object.fromEntries(issues.map((i) => [i.coordinate.entityName, i.outcome]));
    expect(byName['users']).toBe('mismatch');
    expect(byName['only_in_a']).toBe('missing');
  });
});
