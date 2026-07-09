import type { ExpectationFailureReason } from './control-operation-results';

/**
 * Framework-neutral granularity of the entity a {@link SchemaDiffIssue}
 * concerns, stamped by the family/target that produces the issue (the
 * differ itself is family-blind and never sets it). Cross-family framework
 * consumers — the migration aggregate's unclaimed-elements sweep — read this
 * instead of reaching into the concrete schema-IR node: the node carries no
 * classification of its own, only its `nodeKind` identity, and the family
 * maps that identity to a granularity when it produces the issue.
 *
 * - `namespace`: a whole namespace.
 * - `entity`: a whole top-level entity (the thing a namespace contains).
 * - `field`: a field of an entity.
 * - `auxiliary`: a secondary part of an entity (an index, a default, a key).
 * - `structural`: a cross-cutting object (an access policy, a role, a tree
 *   root) that is the owning space's own concern, never a sibling's
 *   unclaimed entity.
 *
 * Absent for families that don't classify — for those, a consumer reads
 * granularity from path shape instead.
 */
export type SchemaSubjectGranularity =
  | 'namespace'
  | 'entity'
  | 'field'
  | 'auxiliary'
  | 'structural';

export interface SchemaDiffIssue<TNode extends DiffableNode = DiffableNode> {
  /** Path from the root node down to the diffed node, as a sequence of local keys. */
  readonly path: readonly string[];
  /** Why the actual state fails the expectation. Consumers filter on this field. */
  readonly reason: ExpectationFailureReason;
  readonly message: string;
  /**
   * The granularity of the issue's subject, stamped by the producing
   * family/target (absent when unclassified — see
   * {@link SchemaSubjectGranularity}). Framework consumers spanning families
   * read this rather than the concrete node.
   */
  readonly subjectGranularity?: SchemaSubjectGranularity;
  /** The expected (desired-side) node, when available. Absent for `not-expected` issues. */
  readonly expected?: TNode;
  /** The actual (current-side) node, when available. Absent for `not-found` issues. */
  readonly actual?: TNode;
}

/**
 * A node in the schema tree. Every node in the tree implements this interface.
 *
 * `id` must be unique among sibling nodes at the same level — the differ keys
 * on it and treats a collision as the same entity (enforced by a duplicate-id
 * throw). The differ accumulates these ids into a path that stamps every emitted
 * issue.
 */
export interface DiffableNode {
  readonly id: string;
  isEqualTo(other: DiffableNode): boolean;
  children(): readonly DiffableNode[];
}

function insertNode(map: Map<string, DiffableNode>, node: DiffableNode): void {
  const key = node.id;
  if (map.has(key)) {
    throw new Error(`diffSchemas: duplicate id among siblings: ${key}`);
  }
  map.set(key, node);
}

/**
 * The issue's own default message: the path, nothing else. `reason` already
 * carries why the node is flagged as structured data; turning that into a
 * human label ("missing: …" / "extra: …" / "mismatch: …") is a presentation
 * concern for whoever renders the issue (the CLI verify formatter), not the
 * differ's.
 */
function pathMessage(path: readonly string[]): string {
  return path.join('/');
}

function emitMissingSubtree(node: DiffableNode, parentPath: readonly string[]): SchemaDiffIssue[] {
  const path = [...parentPath, node.id];
  return [
    {
      path,
      reason: 'not-found',
      message: pathMessage(path),
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
      message: pathMessage(path),
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
      message: pathMessage(path),
      expected,
      actual,
    });
  }
  issues.push(...diffChildren(expected.children(), actual.children(), path));
  return issues;
}

/**
 * Align one level of nodes by id; emit issues in input order and recurse.
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
