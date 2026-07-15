import type { DiffableNode, SchemaDiffIssue } from './schema-diff';

const PATH_DELIMITER = ' ';

function pathKey(path: readonly string[]): string {
  return path.join(PATH_DELIMITER);
}

/**
 * Whether an issue's op builds its subject up (create or alter) rather than
 * only tearing it down. The differ sets `expected` on every create (`not-found`)
 * and alter (`not-equal`) issue and leaves it absent on a pure drop
 * (`not-expected`). This is the single signal the ordering law reads for edge
 * direction — never `reason`.
 */
function buildsUp(issue: SchemaDiffIssue): boolean {
  return issue.expected !== undefined;
}

/**
 * The index of the nearest strict-ancestor issue of `path` — the surviving
 * parent entity a child is contained by. Walks the path's proper prefixes from
 * longest to shortest and returns the first that is itself an issue; a gap
 * (a prefix that produced no issue) is skipped so containment always attaches
 * to the closest real parent.
 */
function nearestAncestorIndex(
  path: readonly string[],
  indexByPath: ReadonlyMap<string, number>,
): number | undefined {
  for (let end = path.length - 1; end >= 1; end -= 1) {
    const index = indexByPath.get(pathKey(path.slice(0, end)));
    if (index !== undefined) return index;
  }
  return undefined;
}

interface Dependency {
  /** The issue that requires the other to exist. */
  readonly dependent: number;
  /** The prerequisite the dependent needs. */
  readonly dependency: number;
}

/**
 * Orders schema-diff issues so that every dependency's op precedes its
 * dependent on the way up and follows it on the way down, breaking ties
 * deterministically by path.
 *
 * Edges come from two sources:
 * - **`dependsOn` cross-links** — the resolved issue-to-issue paths the differ
 *   mirrors onto each issue (a node's declared structural prerequisites). A
 *   path that resolves to no issue in this list is skipped (the dependency is
 *   satisfied by reality).
 * - **containment** — every issue depends on its nearest strict-ancestor issue
 *   (a child entity on the parent entity that owns it). Subtree coalescing has
 *   already removed the descendants of a whole create/drop, so this only links
 *   the parent/child pairs that legitimately survive together.
 *
 * The ordering law reads each dependent's presence for direction: an issue that
 * builds up (`expected` present — a create or alter) needs its dependency
 * first; a pure drop needs its dependent removed first, so the edge reverses.
 * The graph is a DAG by construction (dependencies point from dependents to
 * their prerequisites, and prerequisites never point back), so a cycle is a
 * derivation or authoring bug: the topological sort asserts acyclicity and
 * throws, naming the issues it could not place.
 */
export function orderIssuesByDependencies<TNode extends DiffableNode = DiffableNode>(
  issues: readonly SchemaDiffIssue<TNode>[],
): readonly SchemaDiffIssue<TNode>[] {
  const count = issues.length;
  if (count <= 1) return issues;

  const indexByPath = new Map<string, number>();
  issues.forEach((issue, index) => {
    indexByPath.set(pathKey(issue.path), index);
  });

  const dependencies: Dependency[] = [];
  issues.forEach((issue, index) => {
    for (const targetPath of issue.dependsOn ?? []) {
      const target = indexByPath.get(pathKey(targetPath));
      if (target !== undefined && target !== index) {
        dependencies.push({ dependent: index, dependency: target });
      }
    }
    const ancestor = nearestAncestorIndex(issue.path, indexByPath);
    if (ancestor !== undefined && ancestor !== index) {
      dependencies.push({ dependent: index, dependency: ancestor });
    }
  });

  const outgoing: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
  const inDegree = new Array<number>(count).fill(0);
  const addEdge = (before: number, after: number): void => {
    if (outgoing[before]!.has(after)) return;
    outgoing[before]!.add(after);
    inDegree[after]! += 1;
  };
  for (const { dependent, dependency } of dependencies) {
    if (buildsUp(issues[dependent]!)) {
      addEdge(dependency, dependent);
    } else {
      addEdge(dependent, dependency);
    }
  }

  const keys = issues.map((issue) => pathKey(issue.path));
  const ready: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (inDegree[index] === 0) ready.push(index);
  }

  const order: number[] = [];
  while (ready.length > 0) {
    let pick = 0;
    for (let candidate = 1; candidate < ready.length; candidate += 1) {
      if (keys[ready[candidate]!]! < keys[ready[pick]!]!) pick = candidate;
    }
    const node = ready.splice(pick, 1)[0]!;
    order.push(node);
    for (const next of outgoing[node]!) {
      inDegree[next]! -= 1;
      if (inDegree[next] === 0) ready.push(next);
    }
  }

  if (order.length !== count) {
    const placed = new Set(order);
    const unresolved = issues
      .map((issue, index) => ({ issue, index }))
      .filter(({ index }) => !placed.has(index))
      .map(({ issue }) => issue.path.join('/'));
    throw new Error(
      `orderIssuesByDependencies: dependency cycle among schema-diff issues (unresolved: ${unresolved.join(', ')})`,
    );
  }

  return order.map((index) => issues[index]!);
}
