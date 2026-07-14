import type { ExpectationFailureReason } from './control-operation-results';

export interface SchemaDiffIssue<TNode extends DiffableNode = DiffableNode> {
  /** Path from the root node down to the diffed node, as a sequence of local keys. */
  readonly path: readonly string[];
  /** Why the actual state fails the expectation. Consumers filter on this field. */
  readonly reason: ExpectationFailureReason;
  /** The expected (desired-side) node, when available. Absent for `not-expected` issues. */
  readonly expected?: TNode;
  /** The actual (current-side) node, when available. Absent for `not-found` issues. */
  readonly actual?: TNode;
}

/**
 * A node in the schema tree. Every node in the tree implements this interface.
 *
 * The differ pairs siblings by the combination of `nodeKind` and `id`, not by
 * `id` alone: `id` needs only be unique among siblings of the same
 * `nodeKind` at the same level, not globally unique at that level. Two
 * distinct kinds of child in distinct slots (e.g. a role and a namespace) may
 * legitimately share a name — they are never paired against each other, so
 * the collision is harmless. A node never folds its kind into its id string
 * to route around this; `nodeKind` is the discriminant that does that job.
 * A same-`nodeKind`/same-`id` collision among siblings is a genuine
 * duplicate and is enforced by a throw. The differ accumulates ids (not
 * nodeKind) into a path that stamps every emitted issue.
 */
export interface DiffableNode {
  readonly id: string;
  readonly nodeKind: string;
  isEqualTo(other: DiffableNode): boolean;
  children(): readonly DiffableNode[];
}

/** Delimiter joining `nodeKind` and `id` into one sibling-map key. Every `nodeKind` is a code-defined literal (kebab-case-style), so a null character can never appear in one. */
const SIBLING_KEY_DELIMITER = '\u0000';

function siblingKey(node: DiffableNode): string {
  return `${node.nodeKind}${SIBLING_KEY_DELIMITER}${node.id}`;
}

function insertNode(map: Map<string, DiffableNode>, node: DiffableNode): void {
  const key = siblingKey(node);
  if (map.has(key)) {
    throw new Error(`diffSchemas: duplicate id among siblings: ${node.nodeKind}/${node.id}`);
  }
  map.set(key, node);
}

function emitMissingSubtree(node: DiffableNode, parentPath: readonly string[]): SchemaDiffIssue[] {
  const path = [...parentPath, node.id];
  return [
    {
      path,
      reason: 'not-found',
      expected: node,
    },
    ...node.children().flatMap((c) => emitMissingSubtree(c, path)),
  ];
}

function emitExtraSubtree(node: DiffableNode, parentPath: readonly string[]): SchemaDiffIssue[] {
  const path = [...parentPath, node.id];
  return [
    {
      path,
      reason: 'not-expected',
      actual: node,
    },
    ...node.children().flatMap((c) => emitExtraSubtree(c, path)),
  ];
}

/**
 * Diff two schema trees starting from their roots.
 *
 * The differ is **total**: every node-level difference is reported. An unmatched
 * non-leaf node emits its own issue and descends, emitting an issue for every
 * node in the missing/extra subtree. Coalescing a parent change over its
 * children is the planner's responsibility. Ownership filtering (dropping `extra`
 * issues in namespaces a contract doesn't own) is the caller's responsibility.
 */
export function diffSchemas(
  expected: DiffableNode,
  actual: DiffableNode,
): readonly SchemaDiffIssue[] {
  return diffPair(expected, actual, []);
}

function diffPair(
  expected: DiffableNode,
  actual: DiffableNode,
  parentPath: readonly string[],
): readonly SchemaDiffIssue[] {
  const path = [...parentPath, expected.id];
  const issues: SchemaDiffIssue[] = [];
  if (!expected.isEqualTo(actual)) {
    issues.push({
      path,
      reason: 'not-equal',
      expected,
      actual,
    });
  }
  issues.push(...diffChildren(expected.children(), actual.children(), path));
  return issues;
}

/**
 * Align one level of nodes by `(nodeKind, id)`; emit issues in input order
 * and recurse.
 *
 * A missing node emits one issue for itself and one for every node in its
 * subtree (total descent). Same for extra nodes. A matched pair recurses via
 * `diffPair`.
 */
function diffChildren(
  expected: readonly DiffableNode[],
  actual: readonly DiffableNode[],
  parentPath: readonly string[],
): readonly SchemaDiffIssue[] {
  const expectedMap = new Map<string, DiffableNode>();
  for (const node of expected) {
    insertNode(expectedMap, node);
  }

  const actualMap = new Map<string, DiffableNode>();
  for (const node of actual) {
    insertNode(actualMap, node);
  }

  const issues: SchemaDiffIssue[] = [];

  for (const [key, expectedNode] of expectedMap) {
    const actualNode = actualMap.get(key);
    if (actualNode === undefined) {
      issues.push(...emitMissingSubtree(expectedNode, parentPath));
    } else {
      issues.push(...diffPair(expectedNode, actualNode, parentPath));
    }
  }

  for (const [key, actualNode] of actualMap) {
    if (!expectedMap.has(key)) {
      issues.push(...emitExtraSubtree(actualNode, parentPath));
    }
  }

  return issues;
}

/**
 * The result of diffing a contract's expected schema against the introspected
 * actual schema: one node-typed issue list. Carries no verdict, verification
 * tree, or counts — those are the verifier's own presentation, built from the
 * same underlying comparison.
 *
 * `TNode` is the concrete schema-IR node the issues carry; it defaults to
 * `DiffableNode`, so this is purely additive — a caller that wants the
 * concrete node opts in (the Postgres planner uses the concrete node type),
 * everyone else keeps the default unchanged.
 */
export class SchemaDiff<TNode extends DiffableNode = DiffableNode> {
  readonly issues: readonly SchemaDiffIssue<TNode>[];

  constructor(issues: readonly SchemaDiffIssue<TNode>[]) {
    this.issues = issues;
  }

  /** Returns a new `SchemaDiff` narrowed to the issues `keep` returns true for. */
  filter(keep: (issue: SchemaDiffIssue<TNode>) => boolean): SchemaDiff<TNode> {
    return new SchemaDiff(this.issues.filter(keep));
  }
}
