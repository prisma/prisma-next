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
 * The indices of the nearest strict-ancestor issue(s) of `path` — the
 * surviving parent entity a child is contained by. Walks the path's proper
 * prefixes from longest to shortest and returns the first prefix that is itself
 * an issue; a gap (a prefix that produced no issue) is skipped so containment
 * always attaches to the closest real parent.
 *
 * Returns a list because a path prefix can be shared by two siblings of
 * different `nodeKind` (a role and a namespace named alike); linking the child
 * to every candidate over-constrains safely (the extra edge points at a same-
 * direction op and never forms a cycle, since a parent never depends on its
 * child) rather than risk picking the wrong one.
 */
function nearestAncestorIndices(
  path: readonly string[],
  indexByPath: ReadonlyMap<string, readonly number[]>,
): readonly number[] {
  for (let end = path.length - 1; end >= 1; end -= 1) {
    const indices = indexByPath.get(pathKey(path.slice(0, end)));
    if (indices !== undefined) return indices;
  }
  return [];
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
 *   satisfied by reality); a path shared by two same-id/different-kind siblings
 *   links to every match, over-constraining safely.
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

  const indexByPath = new Map<string, number[]>();
  issues.forEach((issue, index) => {
    const key = pathKey(issue.path);
    const bucket = indexByPath.get(key);
    if (bucket === undefined) indexByPath.set(key, [index]);
    else bucket.push(index);
  });

  const dependencies: Dependency[] = [];
  issues.forEach((issue, index) => {
    for (const targetPath of issue.dependsOn ?? []) {
      for (const target of indexByPath.get(pathKey(targetPath)) ?? []) {
        if (target !== index) dependencies.push({ dependent: index, dependency: target });
      }
    }
    for (const ancestor of nearestAncestorIndices(issue.path, indexByPath)) {
      if (ancestor !== index) dependencies.push({ dependent: index, dependency: ancestor });
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
