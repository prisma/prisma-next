import { Queue } from './queue';

/**
 * One step of a BFS traversal.
 *
 * `parent` and `incomingEdge` are `null` for start nodes — they were not
 * reached via any edge. For every other node they record the node and edge
 * by which this node was first reached.
 */
export interface BfsStep<E> {
  readonly node: string;
  readonly parent: string | null;
  readonly incomingEdge: E | null;
}

/**
 * Generic breadth-first traversal.
 *
 * Direction (forward/reverse) is expressed by the caller's `neighbours`
 * closure: return `{ next, edge }` pairs where `next` is the node to visit
 * next and `edge` is the edge that connects them. Callers that don't need
 * path reconstruction can ignore the `parent`/`incomingEdge` fields of each
 * yielded step.
 *
 * Stops are intrinsic — callers `break` out of the `for..of` loop when
 * they've found what they're looking for.
 *
 * `ordering`, if provided, controls the order in which neighbours of each
 * node are enqueued. Only matters for path-finding: a deterministic ordering
 * makes BFS return a deterministic shortest path when multiple exist.
 */
export function* bfs<E>(
  starts: Iterable<string>,
  neighbours: (node: string) => Iterable<{ next: string; edge: E }>,
  ordering?: (items: readonly { next: string; edge: E }[]) => readonly { next: string; edge: E }[],
): Generator<BfsStep<E>> {
  const visited = new Set<string>();
  const parentMap = new Map<string, { parent: string; edge: E }>();
  const queue = new Queue<string>();
  for (const start of starts) {
    if (!visited.has(start)) {
      visited.add(start);
      queue.push(start);
    }
  }
  while (!queue.isEmpty) {
    const current = queue.shift();
    const parentInfo = parentMap.get(current);
    yield {
      node: current,
      parent: parentInfo?.parent ?? null,
      incomingEdge: parentInfo?.edge ?? null,
    };

    const items = neighbours(current);
    const toVisit = ordering ? ordering([...items]) : items;
    for (const { next, edge } of toVisit) {
      if (!visited.has(next)) {
        visited.add(next);
        parentMap.set(next, { parent: current, edge });
        queue.push(next);
      }
    }
  }
}
