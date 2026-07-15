import type { ExpectationFailureReason } from './control-operation-results';

/**
 * A root-anchored chain of `(nodeKind, id)` steps identifying a node in a
 * schema tree — the same vocabulary the differ pairs siblings with. Used by
 * `DiffableNode.dependsOn` to name a node's structural prerequisites without
 * holding a reference to the node itself (the target may live on the other
 * diff side, or not exist at all).
 */
export type SchemaNodeRef = readonly { readonly nodeKind: string; readonly id: string }[];

export interface SchemaDiffIssue<TNode extends DiffableNode = DiffableNode> {
  /** Path from the root node down to the diffed node, as a sequence of local keys. */
  readonly path: readonly string[];
  /** Why the actual state fails the expectation. Consumers filter on this field. */
  readonly reason: ExpectationFailureReason;
  /** The expected (desired-side) node, when available. Absent for `not-expected` issues. */
  readonly expected?: TNode;
  /** The actual (current-side) node, when available. Absent for `not-found` issues. */
  readonly actual?: TNode;
  /**
   * Paths of the other in-diff issues this issue depends on. Mirrored by
   * `diffSchemas` from the node's own `dependsOn` refs: a ref resolves to a
   * path only when some emitted issue sits at that exact path with a
   * matching `nodeKind` — a ref whose target produced no issue is dropped
   * (the dependency is satisfied by reality).
   */
  readonly dependsOn?: readonly (readonly string[])[];
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
  /**
   * The nodes this node structurally depends on — resolved references to
   * prerequisites that must exist before it (e.g. a foreign key depends on
   * its referenced table). Stamped by the derivation that holds the parent
   * context; both the expected and the actual derivation stamp it by the
   * same structural rules. Never compared by `isEqualTo`.
   */
  readonly dependsOn?: readonly SchemaNodeRef[];
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
  return mirrorDependsOnOntoIssues(diffPair(expected, actual, []));
}

function schemaNodeRefKey(ref: SchemaNodeRef): string {
  return ref.map((step) => step.id).join(SIBLING_KEY_DELIMITER);
}

function issuePathKey(path: readonly string[]): string {
  return path.join(SIBLING_KEY_DELIMITER);
}

/**
 * Copies each issue's node's `dependsOn` refs onto the issue itself, as
 * issue-to-issue path references. A ref is kept only when some emitted issue
 * sits at that exact path AND that issue's node `nodeKind` matches the ref's
 * last step — otherwise the ref is dropped (its target either didn't
 * change, or was never part of either tree; either way the dependency is
 * satisfied by reality, not by an operation this diff will produce).
 */
function mirrorDependsOnOntoIssues(issues: readonly SchemaDiffIssue[]): readonly SchemaDiffIssue[] {
  const issuesByPath = new Map<string, SchemaDiffIssue>();
  for (const issue of issues) {
    issuesByPath.set(issuePathKey(issue.path), issue);
  }

  return issues.map((issue) => {
    const node = issue.expected ?? issue.actual;
    const refs = node?.dependsOn;
    if (refs === undefined || refs.length === 0) return issue;

    const dependsOn = refs.flatMap((ref) => {
      const lastStep = ref[ref.length - 1];
      if (lastStep === undefined) return [];
      const targetIssue = issuesByPath.get(schemaNodeRefKey(ref));
      if (targetIssue === undefined) return [];
      const targetNode = targetIssue.expected ?? targetIssue.actual;
      if (targetNode?.nodeKind !== lastStep.nodeKind) return [];
      return [ref.map((step) => step.id)];
    });

    if (dependsOn.length === 0) return issue;
    return { ...issue, dependsOn };
  });
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
