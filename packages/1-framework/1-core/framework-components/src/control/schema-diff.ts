export type SchemaDiffOutcome = 'missing' | 'extra' | 'mismatch';

export interface SchemaDiffIssue {
  /** Path from the root node down to the diffed node, as a sequence of local keys. */
  readonly path: readonly string[];
  readonly outcome: SchemaDiffOutcome;
  readonly message: string;
  /** The expected (contract-side) node, when available. Absent for `extra` outcomes. */
  readonly expected?: DiffableNode;
  /** The actual (live-DB-side) node, when available. Absent for `missing` outcomes. */
  readonly actual?: DiffableNode;
}

/**
 * A node in the schema tree. Every node in the tree — including the database root —
 * implements this interface.
 *
 * `localKey()` must be unique among sibling nodes at the same level — the
 * differ keys on it and treats a collision as the same entity (enforced by a
 * duplicate-key throw). The differ accumulates these keys into a path that
 * stamps every emitted issue. A node that is only unique within its parent
 * (e.g. a policy unique only within its table) must fold its parent identity
 * into its local key.
 */
export interface DiffableNode {
  localKey(): string;
  isEqualTo(other: DiffableNode): boolean;
  children(): readonly DiffableNode[];
}

function insertNode(map: Map<string, DiffableNode>, node: DiffableNode): void {
  const key = node.localKey();
  if (map.has(key)) {
    throw new Error(`diffSchemas: duplicate local key among siblings: ${key}`);
  }
  map.set(key, node);
}

function outcomeMessage(outcome: SchemaDiffOutcome, path: readonly string[]): string {
  return `${outcome}: ${path.join('/')}`;
}

/**
 * Filter `extra` outcomes whose namespace is not owned by the caller.
 *
 * Use this after `diffSchemas` when a live introspection returns every entity
 * across all DB schemas, but the current contract only owns a subset of them.
 * `extra` issues in unowned namespaces belong to another contract space and
 * should be left alone. `missing` and `mismatch` outcomes pass through unchanged
 * regardless of ownership.
 *
 * Because `SchemaDiffIssue` no longer carries a coordinate, ownership must be
 * determined from the node itself. Pass `getNamespaceId` to extract the
 * namespace from the node on an `extra` issue.
 */
export function filterSchemaIssuesByOwnership(
  issues: readonly SchemaDiffIssue[],
  isOwned: (namespaceId: string) => boolean,
  getNamespaceId: (node: DiffableNode) => string,
): readonly SchemaDiffIssue[] {
  return issues.filter(
    (issue) =>
      issue.outcome !== 'extra' ||
      (issue.actual !== undefined && isOwned(getNamespaceId(issue.actual))),
  );
}

/**
 * Compare two corresponding nodes and recurse into their children.
 *
 * Emits a `mismatch` if `expected.isEqualTo(actual)` is false, then descends
 * into both nodes' children regardless. The differ reads only the three
 * `DiffableNode` methods, so it names no node type.
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
  const path = [...parentPath, expected.localKey()];
  const issues: SchemaDiffIssue[] = [];
  if (!expected.isEqualTo(actual)) {
    issues.push({
      path,
      outcome: 'mismatch',
      message: outcomeMessage('mismatch', path),
      expected,
      actual,
    });
  }
  issues.push(...diffChildren(expected.children(), actual.children(), path));
  return issues;
}

/**
 * Align one level of nodes by local key; emit missing/extra/mismatch issues in
 * input order, and recurse into each matched pair. A `missing` or `extra` node
 * emits a single issue at its path and is not descended (the whole subtree
 * is missing/extra).
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
    const path = [...parentPath, key];
    if (actualNode === undefined) {
      issues.push({
        path,
        outcome: 'missing',
        message: outcomeMessage('missing', path),
        expected: expectedNode,
      });
    } else {
      issues.push(...diffPair(expectedNode, actualNode, parentPath));
    }
  }

  for (const [key, actualNode] of actualMap) {
    if (!expectedMap.has(key)) {
      const path = [...parentPath, key];
      issues.push({
        path,
        outcome: 'extra',
        message: outcomeMessage('extra', path),
        actual: actualNode,
      });
    }
  }

  return issues;
}
