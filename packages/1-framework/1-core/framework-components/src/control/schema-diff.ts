import type { EntityCoordinate } from '../ir/storage';

export type SchemaDiffOutcome = 'missing' | 'extra' | 'mismatch';

export interface SchemaDiffIssue {
  readonly coordinate: EntityCoordinate;
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
 * `coord()` must be unique among sibling nodes aligned at the same level — the
 * differ keys on it and treats a collision as the same entity (now enforced by a
 * duplicate-key throw). A node kind whose natural key is not globally unique — for
 * example, a column that is only unique within its table — must fold its parent's
 * identity into the coordinate.
 */
export interface DiffableNode {
  coord(): EntityCoordinate;
  isEqualTo(other: DiffableNode): boolean;
  children(): readonly DiffableNode[];
}

/** Canonical string key for a coordinate — the differ keys its alignment maps on this. */
function stableKey(c: EntityCoordinate): string {
  return `${c.plane}|${c.namespaceId}|${c.entityKind}|${c.entityName}`;
}

function insertNode(map: Map<string, DiffableNode>, node: DiffableNode): void {
  const key = stableKey(node.coord());
  if (map.has(key)) {
    throw new Error(`diffSchemas: duplicate coordinate key among siblings: ${key}`);
  }
  map.set(key, node);
}

function outcomeMessage(outcome: SchemaDiffOutcome, c: EntityCoordinate): string {
  return `${outcome}: ${c.entityKind} '${c.entityName}' in namespace '${c.namespaceId}'`;
}

/**
 * Filter `extra` outcomes whose namespace is not owned by the caller.
 *
 * Use this after `diffSchemas` when a live introspection returns every entity
 * across all DB schemas, but the current contract only owns a subset of them.
 * `extra` issues in unowned namespaces belong to another contract space and
 * should be left alone. `missing` and `mismatch` outcomes pass through unchanged
 * regardless of ownership.
 */
export function filterSchemaIssuesByOwnership(
  issues: readonly SchemaDiffIssue[],
  isOwned: (namespaceId: string) => boolean,
): readonly SchemaDiffIssue[] {
  return issues.filter(
    (issue) => issue.outcome !== 'extra' || isOwned(issue.coordinate.namespaceId),
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
  return diffPair(expected, actual);
}

function diffPair(expected: DiffableNode, actual: DiffableNode): readonly SchemaDiffIssue[] {
  const issues: SchemaDiffIssue[] = [];
  if (!expected.isEqualTo(actual)) {
    const coordinate = expected.coord();
    issues.push({
      coordinate,
      outcome: 'mismatch',
      message: outcomeMessage('mismatch', coordinate),
      expected,
      actual,
    });
  }
  issues.push(...diffChildren(expected.children(), actual.children()));
  return issues;
}

/**
 * Align one level of nodes by coordinate; emit missing/extra/mismatch issues in
 * input order, and recurse into each matched pair. A `missing` or `extra` node
 * emits a single issue at its coordinate and is not descended (the whole subtree
 * is missing/extra).
 */
function diffChildren(
  expected: readonly DiffableNode[],
  actual: readonly DiffableNode[],
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
    const coordinate = expectedNode.coord();
    if (actualNode === undefined) {
      issues.push({
        coordinate,
        outcome: 'missing',
        message: outcomeMessage('missing', coordinate),
        expected: expectedNode,
      });
    } else {
      issues.push(...diffPair(expectedNode, actualNode));
    }
  }

  for (const [key, actualNode] of actualMap) {
    if (!expectedMap.has(key)) {
      const coordinate = actualNode.coord();
      issues.push({
        coordinate,
        outcome: 'extra',
        message: outcomeMessage('extra', coordinate),
        actual: actualNode,
      });
    }
  }

  return issues;
}
