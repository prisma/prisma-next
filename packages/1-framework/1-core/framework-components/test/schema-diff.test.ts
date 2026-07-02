import { describe, expect, it } from 'vitest';
import type { SchemaIssue } from '../src/control/control-result-types';
import type { DiffableNode, DiffIssue, SchemaDiffIssue } from '../src/control/schema-diff';
import { diffSchemas, SchemaDiff } from '../src/control/schema-diff';

/** A synthetic root node whose `isEqualTo` is always true — used to wrap flat node lists. */
function rootOf(nodes: readonly DiffableNode[]): DiffableNode {
  return {
    id: 'root',
    isEqualTo(): boolean {
      return true;
    },
    children(): readonly DiffableNode[] {
      return nodes;
    },
  };
}

function makeNode(
  nodeId: string,
  body = '',
  childNodes: readonly DiffableNode[] = [],
): DiffableNode {
  return {
    id: nodeId,
    children(): readonly DiffableNode[] {
      return childNodes;
    },
    isEqualTo(other: DiffableNode): boolean {
      return nodeId === other.id && body === (other as typeof this & { _body?: string })._body;
    },
    _body: body,
  } as DiffableNode & { _body: string };
}

describe('diffSchemas', () => {
  it('returns empty when expected and actual are both empty', () => {
    expect(diffSchemas(rootOf([]), rootOf([]))).toEqual([]);
  });

  it('reports missing when an expected node has no match in actual', () => {
    const expected = [makeNode('public/policy/read_own_abcd1234')];
    const issues = diffSchemas(rootOf(expected), rootOf([]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      outcome: 'missing',
      path: ['root', 'public/policy/read_own_abcd1234'],
    });
  });

  it('reports extra when an actual node has no match in expected', () => {
    const actual = [makeNode('public/policy/stale_policy_deadbeef')];
    const issues = diffSchemas(rootOf([]), rootOf(actual));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      outcome: 'extra',
      path: ['root', 'public/policy/stale_policy_deadbeef'],
    });
  });

  it('reports mismatch when both sides have the node but isEqualTo returns false', () => {
    const expected = [makeNode('public/policy/read_own_abcd1234', 'body-v1')];
    const actual = [makeNode('public/policy/read_own_abcd1234', 'body-v2')];
    const issues = diffSchemas(rootOf(expected), rootOf(actual));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      outcome: 'mismatch',
      path: ['root', 'public/policy/read_own_abcd1234'],
    });
  });

  it('returns no issues when expected and actual match exactly', () => {
    const node = makeNode('public/policy/read_own_abcd1234', 'same-body');
    const expected = [node];
    const actual = [makeNode('public/policy/read_own_abcd1234', 'same-body')];
    const issues = diffSchemas(rootOf(expected), rootOf(actual));
    expect(issues).toEqual([]);
  });

  it('handles a mix of missing, extra, and mismatch in one call', () => {
    const expected = [
      makeNode('ns/widget/alpha', 'v1'),
      makeNode('ns/widget/beta', 'same'),
      makeNode('ns/widget/gamma', 'body'),
    ];
    const actual = [
      makeNode('ns/widget/alpha', 'v2'),
      makeNode('ns/widget/beta', 'same'),
      makeNode('ns/widget/delta', 'extra'),
    ];
    const issues = diffSchemas(rootOf(expected), rootOf(actual));
    expect(issues).toHaveLength(3);
    const byKey = Object.fromEntries(issues.map((i) => [i.path[i.path.length - 1], i.outcome]));
    expect(byKey).toEqual({
      'ns/widget/alpha': 'mismatch',
      'ns/widget/gamma': 'missing',
      'ns/widget/delta': 'extra',
    });
  });

  it('returns issues for all expected nodes when actual is empty', () => {
    const expected = [makeNode('ns/widget/zzz'), makeNode('ns/widget/aaa')];
    const issues = diffSchemas(rootOf(expected), rootOf([]));
    const keys = new Set(issues.map((i) => i.path[i.path.length - 1]));
    expect(keys).toEqual(new Set(['ns/widget/aaa', 'ns/widget/zzz']));
    expect(issues).toHaveLength(2);
  });

  it('message field is a non-empty string', () => {
    const issues = diffSchemas(rootOf([makeNode('ns/x/y')]), rootOf([]));
    expect(typeof issues[0]?.message).toBe('string');
    expect((issues[0]?.message.length ?? 0) > 0).toBe(true);
  });

  it('missing issue carries expected node ref but no actual', () => {
    const expectedNode = makeNode('public/policy/read_own_abcd1234');
    const issues = diffSchemas(rootOf([expectedNode]), rootOf([]));
    const issue = issues[0] as SchemaDiffIssue;
    expect(issue.expected).toBe(expectedNode);
    expect(issue.actual).toBeUndefined();
  });

  it('extra issue carries actual node ref but no expected', () => {
    const actualNode = makeNode('public/policy/stale_policy_deadbeef');
    const issues = diffSchemas(rootOf([]), rootOf([actualNode]));
    const issue = issues[0] as SchemaDiffIssue;
    expect(issue.actual).toBe(actualNode);
    expect(issue.expected).toBeUndefined();
  });

  it('mismatch issue carries both expected and actual node refs', () => {
    const expectedNode = makeNode('public/policy/read_own_abcd1234', 'body-v1');
    const actualNode = makeNode('public/policy/read_own_abcd1234', 'body-v2');
    const issues = diffSchemas(rootOf([expectedNode]), rootOf([actualNode]));
    const issue = issues[0] as SchemaDiffIssue;
    expect(issue.expected).toBe(expectedNode);
    expect(issue.actual).toBe(actualNode);
  });

  it('local keys that are prefixes of each other do not collide', () => {
    // 'pol' is a prefix of 'policy' — the differ must not conflate them.
    const nodeA = makeNode('pol/icy');
    const nodeB = makeNode('policy/x');
    const issues = diffSchemas(rootOf([nodeA]), rootOf([nodeB]));
    expect(issues).toHaveLength(2);
    const outcomes = new Set(issues.map((i) => i.outcome));
    expect(outcomes).toEqual(new Set(['missing', 'extra']));
  });

  it('throws when two siblings share the same id in expected', () => {
    const a = makeNode('public/policy/dup_name');
    const b = makeNode('public/policy/dup_name');
    expect(() => diffSchemas(rootOf([a, b]), rootOf([]))).toThrow(
      'diffSchemas: duplicate id among siblings',
    );
  });

  it('throws when two siblings share the same id in actual', () => {
    const a = makeNode('public/policy/dup_name');
    const b = makeNode('public/policy/dup_name');
    expect(() => diffSchemas(rootOf([]), rootOf([a, b]))).toThrow(
      'diffSchemas: duplicate id among siblings',
    );
  });

  it('descends into a matched pair and reports one issue at the child path (AC-2)', () => {
    // A parent present on both sides whose id() matches and isEqualTo is true,
    // but whose children differ on one child. diffSchemas descends the matched
    // pair and reports exactly one issue, at the child's path.
    const expectedChild = makeNode('present_child', 'same');
    const actualChild = makeNode('present_child', 'same');
    const missingChild = makeNode('only_in_expected', 'x');

    const expectedParent = makeNode('parent', 'parent-body', [expectedChild, missingChild]);
    const actualParent = makeNode('parent', 'parent-body', [actualChild]);

    const issues = diffSchemas(rootOf([expectedParent]), rootOf([actualParent]));

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      outcome: 'missing',
      path: ['root', 'parent', 'only_in_expected'],
    });
  });

  it('emits mismatch at node path AND child-level issues when diffing two nodes directly', () => {
    // Proves diffSchemas compares the given nodes themselves, not just their children.
    // tableA and tableB share the same id() but isEqualTo is false (different body).
    // Their children also differ (one column only on tableA).
    const onlyInA = makeNode('only_in_a', 'col');
    const shared = makeNode('shared_col', 'same');

    const tableA = makeNode('users', 'body-v1', [shared, onlyInA]);
    const tableB = makeNode('users', 'body-v2', [makeNode('shared_col', 'same')]);

    const issues = diffSchemas(tableA, tableB);

    expect(issues).toHaveLength(2);
    const byKey = Object.fromEntries(issues.map((i) => [i.path[i.path.length - 1], i.outcome]));
    expect(byKey['users']).toBe('mismatch');
    expect(byKey['only_in_a']).toBe('missing');
  });

  it('total descent: missing subtree emits one issue per node in the subtree', () => {
    const grandchildA = makeNode('grandchild_a', 'leaf');
    const grandchildB = makeNode('grandchild_b', 'leaf');
    const child = makeNode('child', 'body', [grandchildA, grandchildB]);

    const issues = diffSchemas(rootOf([child]), rootOf([]));

    expect(issues).toHaveLength(3);
    const paths = issues.map((i) => i.path.join('/'));
    expect(paths).toContain('root/child');
    expect(paths).toContain('root/child/grandchild_a');
    expect(paths).toContain('root/child/grandchild_b');
    expect(issues.every((i) => i.outcome === 'missing')).toBe(true);
  });

  it('total descent: extra subtree emits one issue per node in the subtree', () => {
    const grandchildA = makeNode('grandchild_a', 'leaf');
    const grandchildB = makeNode('grandchild_b', 'leaf');
    const child = makeNode('child', 'body', [grandchildA, grandchildB]);

    const issues = diffSchemas(rootOf([]), rootOf([child]));

    expect(issues).toHaveLength(3);
    const paths = issues.map((i) => i.path.join('/'));
    expect(paths).toContain('root/child');
    expect(paths).toContain('root/child/grandchild_a');
    expect(paths).toContain('root/child/grandchild_b');
    expect(issues.every((i) => i.outcome === 'extra')).toBe(true);
  });

  it('missing leaf still emits exactly one issue (behavior-preserving)', () => {
    const leaf = makeNode('lone_leaf', 'data');
    const issues = diffSchemas(rootOf([leaf]), rootOf([]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ outcome: 'missing', path: ['root', 'lone_leaf'] });
  });
});

function makeSchemaIssue(table: string): SchemaIssue {
  return { kind: 'extra_table', table, message: `Extra table "${table}"` };
}

function makeSchemaDiffIssue(path: readonly string[]): SchemaDiffIssue {
  return { path, outcome: 'extra', message: outcomeMessageFor(path) };
}

function outcomeMessageFor(path: readonly string[]): string {
  return `extra: ${path.join('/')}`;
}

describe('SchemaDiff', () => {
  it('exposes the issues and schemaDiffIssues it was constructed with', () => {
    const issues = [makeSchemaIssue('a')];
    const schemaDiffIssues = [makeSchemaDiffIssue(['root', 'p'])];
    const diff = new SchemaDiff(issues, schemaDiffIssues);
    expect(diff.issues).toBe(issues);
    expect(diff.schemaDiffIssues).toBe(schemaDiffIssues);
  });

  it('filter narrows both issue lists using one predicate over the union', () => {
    const keep = makeSchemaIssue('keep');
    const drop = makeSchemaIssue('drop');
    const keepDiff = makeSchemaDiffIssue(['root', 'keep']);
    const dropDiff = makeSchemaDiffIssue(['root', 'drop']);
    const diff = new SchemaDiff([keep, drop], [keepDiff, dropDiff]);

    const keepPredicate = (issue: DiffIssue): boolean =>
      'outcome' in issue ? issue.path.includes('keep') : 'table' in issue && issue.table === 'keep';
    const filtered = diff.filter(keepPredicate);

    expect(filtered.issues).toEqual([keep]);
    expect(filtered.schemaDiffIssues).toEqual([keepDiff]);
  });

  it('filter returns a new SchemaDiff, not a mutation of the original', () => {
    const diff = new SchemaDiff([makeSchemaIssue('a')], []);
    const filtered = diff.filter(() => false);
    expect(filtered).not.toBe(diff);
    expect(diff.issues).toHaveLength(1);
    expect(filtered.issues).toHaveLength(0);
  });

  it('filter on an empty diff returns an empty diff', () => {
    const diff = new SchemaDiff([], []);
    const filtered = diff.filter(() => true);
    expect(filtered.issues).toEqual([]);
    expect(filtered.schemaDiffIssues).toEqual([]);
  });
});
