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

/** A node the generic differ can align and compare. Implemented by target IR nodes. */
export interface DiffableNode {
  identity(): EntityCoordinate;
  isEqualTo(other: DiffableNode): boolean;
}

/** Canonical string key for a coordinate. Uses pipe-separated fields so null bytes cannot appear. */
function stableKey(c: EntityCoordinate): string {
  return `${c.plane}|${c.namespaceId}|${c.entityKind}|${c.entityName}`;
}

function outcomeMessage(outcome: SchemaDiffOutcome, c: EntityCoordinate): string {
  return `${outcome}: ${c.entityKind} '${c.entityName}' in namespace '${c.namespaceId}'`;
}

/**
 * Align two flat node collections by identity; emit missing/extra/mismatch issues in input order.
 * Intentionally flat — child-node recursion is a separate follow-on concern (the relational port).
 */
export function diffNodes(
  expected: readonly DiffableNode[],
  actual: readonly DiffableNode[],
): readonly SchemaDiffIssue[] {
  const expectedMap = new Map<string, DiffableNode>();
  for (const node of expected) {
    expectedMap.set(stableKey(node.identity()), node);
  }

  const actualMap = new Map<string, DiffableNode>();
  for (const node of actual) {
    actualMap.set(stableKey(node.identity()), node);
  }

  const issues: SchemaDiffIssue[] = [];

  for (const [key, expectedNode] of expectedMap) {
    const actualNode = actualMap.get(key);
    const coordinate = expectedNode.identity();
    if (actualNode === undefined) {
      issues.push({
        coordinate,
        outcome: 'missing',
        message: outcomeMessage('missing', coordinate),
        expected: expectedNode,
      });
    } else if (!expectedNode.isEqualTo(actualNode)) {
      issues.push({
        coordinate,
        outcome: 'mismatch',
        message: outcomeMessage('mismatch', coordinate),
        expected: expectedNode,
        actual: actualNode,
      });
    }
  }

  for (const [key, actualNode] of actualMap) {
    if (!expectedMap.has(key)) {
      const coordinate = actualNode.identity();
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
