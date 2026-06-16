import { describe, expect, it } from 'vitest';
import type { DiffableNode } from '../src/control/schema-diff';
import { diffNodes } from '../src/control/schema-diff';
import type { EntityCoordinate } from '../src/ir/storage';

function makeNode(
  namespaceId: string,
  entityKind: string,
  entityName: string,
  body = '',
): DiffableNode {
  return {
    identity(): EntityCoordinate {
      return { plane: 'storage', namespaceId, entityKind, entityName };
    },
    isEqualTo(other: DiffableNode): boolean {
      const o = other.identity();
      const mine = this.identity();
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

describe('diffNodes', () => {
  it('returns empty when expected and actual are both empty', () => {
    expect(diffNodes([], [])).toEqual([]);
  });

  it('reports missing when an expected node has no match in actual', () => {
    const expected = [makeNode('public', 'policy', 'read_own_abcd1234')];
    const issues = diffNodes(expected, []);
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
    const issues = diffNodes([], actual);
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
    const issues = diffNodes(expected, actual);
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
    const issues = diffNodes(expected, actual);
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
    const issues = diffNodes(expected, actual);
    expect(issues).toHaveLength(3);
    const byName = Object.fromEntries(issues.map((i) => [i.coordinate.entityName, i.outcome]));
    expect(byName).toEqual({ alpha: 'mismatch', gamma: 'missing', delta: 'extra' });
  });

  it('returns issues for all expected nodes when actual is empty', () => {
    const expected = [makeNode('ns', 'widget', 'zzz'), makeNode('ns', 'widget', 'aaa')];
    const issues = diffNodes(expected, []);
    const names = new Set(issues.map((i) => i.coordinate.entityName));
    expect(names).toEqual(new Set(['aaa', 'zzz']));
    expect(issues).toHaveLength(2);
  });

  it('message field is a non-empty string', () => {
    const issues = diffNodes([makeNode('ns', 'x', 'y')], []);
    expect(typeof issues[0]?.message).toBe('string');
    expect((issues[0]?.message.length ?? 0) > 0).toBe(true);
  });
});
