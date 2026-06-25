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

/** A node the differ can descend into. The root implements only this. */
export interface DiffableRoot {
  children(): readonly DiffableNode[];
}

/** A node the generic differ also aligns and compares. Implemented by target IR nodes. */
export interface DiffableNode extends DiffableRoot {
  coord(): EntityCoordinate;
  isEqualTo(other: DiffableNode): boolean;
}

/** Canonical string key for a coordinate. Uses pipe-separated fields so null bytes cannot appear. */
function stableKey(c: EntityCoordinate): string {
  return `${c.plane}|${c.namespaceId}|${c.entityKind}|${c.entityName}`;
}

function insertNode(map: Map<string, DiffableNode>, node: DiffableNode): void {
  const key = stableKey(node.coord());
  if (map.has(key)) {
    throw new Error(`diffSchema: duplicate coordinate key among siblings: ${key}`);
  }
  map.set(key, node);
}

function outcomeMessage(outcome: SchemaDiffOutcome, c: EntityCoordinate): string {
  return `${outcome}: ${c.entityKind} '${c.entityName}' in namespace '${c.namespaceId}'`;
}

/**
 * Drop `extra` issues whose namespace is not in `ownedNamespaceIds`.
 *
 * Use this after `diffSchema` when a live introspection returns every entity
 * across all DB schemas, but the current contract only owns a subset of them.
 * `extra` issues in unowned namespaces belong to another contract space and
 * should be left alone. All other outcomes pass through unchanged.
 */
export function dropUnownedExtraIssues(
  issues: readonly SchemaDiffIssue[],
  isOwned: (namespaceId: string) => boolean,
): readonly SchemaDiffIssue[] {
  return issues.filter(
    (issue) => issue.outcome !== 'extra' || isOwned(issue.coordinate.namespaceId),
  );
}

/**
 * Walk two schema trees from their roots: pair children by coordinate, descend
 * into each matched pair, and record one issue per disagreement. The differ
 * reads only `coord()` / `isEqualTo()` / `children()`, so it names no node type.
 */
export function diffSchema(
  expected: DiffableRoot,
  actual: DiffableRoot,
): readonly SchemaDiffIssue[] {
  return diffChildren(expected.children(), actual.children());
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
      if (!expectedNode.isEqualTo(actualNode)) {
        issues.push({
          coordinate,
          outcome: 'mismatch',
          message: outcomeMessage('mismatch', coordinate),
          expected: expectedNode,
          actual: actualNode,
        });
      }
      issues.push(...diffChildren(expectedNode.children(), actualNode.children()));
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
