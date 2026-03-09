# SSA Query Planner — Data Structures

Companion to `spec.md`. Defines the concrete TypeScript types for graph construction, optimization, and execution.

## Design Principles

1. **Discriminated unions everywhere** — node types and edge types use `kind` discriminants for exhaustive matching
2. **Opaque node IDs** — branded `number` type prevents accidental arithmetic
3. **Mutable graph, immutable node payloads** — the graph structure (edges, node set) mutates during optimization; individual node payloads are readonly
4. **Graph as a class** — navigation, mutation, and ID allocation are encapsulated in `QueryPlanGraph`

## Node ID

```typescript
type NodeId = number & { readonly __brand: 'NodeId' };
```

ID allocation is encapsulated inside `QueryPlanGraph` (see below).

## Node Types

All nodes share a common header. Type-specific payloads are carried in a discriminated union.

```typescript
interface NodeBase {
  readonly id: NodeId;
  readonly kind: NodeKind;
}

type NodeKind =
  | 'Start'
  | 'Read'
  | 'Create'
  | 'Update'
  | 'Delete'
  | 'Aggregate'
  | 'Nest'
  | 'Return'
  | 'Combine'
  | 'CollectionState';
```

### Individual Node Payloads

```typescript
interface StartNode extends NodeBase {
  readonly kind: 'Start';
}

/** Common query shape shared by ReadNode and SubqueryEntry. */
interface ReadBase {
  readonly collection: string;          // table name
  readonly columns: readonly string[] | '*';  // selected columns ('*' = all)
  readonly filters: readonly WhereExpr[];
  readonly orderBy: readonly OrderExpr[] | undefined;
  readonly limit: number | undefined;
  readonly offset: number | undefined;
  readonly distinctMode: DistinctMode | undefined;
  // Recursive: collapsed child queries folded into this read.
  // Set by subquery collapse optimization pass.
  // The SQL dialect determines the mechanism (LATERAL JOIN on Postgres, correlated subquery elsewhere).
  readonly subqueries: readonly SubqueryEntry[] | undefined;
}

interface ReadNode extends NodeBase, ReadBase {
  readonly kind: 'Read';
  // GroupedCollection support (spec §21)
  readonly groupBy: readonly string[] | undefined;
  readonly having: readonly WhereExpr[] | undefined;

  readonly aggregateSelections: readonly AggregateSelection[] | undefined;
}

/** Distinct and distinctOn are mutually exclusive. */
type DistinctMode =
  | { readonly kind: 'distinct' }   // SELECT DISTINCT — applies to all selected columns
  | { readonly kind: 'distinctOn'; readonly columns: readonly string[] };

interface AggregateSelection {
  readonly fn: AggregateFn;
  readonly column: AggregateTarget;
  readonly alias: string;
}

/** Explicit discriminant — no overloading undefined for count(*). */
type AggregateTarget =
  | { readonly kind: 'countAllRows' }   // count(*)
  | { readonly kind: 'column'; readonly name: string };  // sum(views), avg(price), etc.

/** One collapsed child query folded into the parent Read. Carries both the subquery config and the Nest metadata. */
interface SubqueryEntry extends ReadBase {
  // Nest metadata (preserved from the eliminated Nest node)
  readonly field: string;               // target property name on parent
  readonly arity: 'array' | 'scalar';
  readonly leftKeys: readonly string[];
  readonly rightKeys: readonly string[];
  // Subquery execution mode
  readonly subquery: 'jsonAgg' | 'scalar';
}

interface CreateNode extends NodeBase {
  readonly kind: 'Create';
  readonly collection: string;
  readonly data: Record<string, unknown> | readonly Record<string, unknown>[];
  readonly onConflict: OnConflictConfig | undefined;  // for upsert
  readonly returning: readonly string[] | undefined;  // set by RETURNING collapse
}

interface OnConflictConfig {
  readonly columns: readonly string[];
  readonly update: Record<string, unknown>;
}

interface UpdateNode extends NodeBase {
  readonly kind: 'Update';
  readonly collection: string;
  readonly data: Record<string, unknown>;
  readonly filters: readonly WhereExpr[];
  readonly returning: readonly string[] | undefined;  // set by RETURNING collapse
}

interface DeleteNode extends NodeBase {
  readonly kind: 'Delete';
  readonly collection: string;
  readonly filters: readonly WhereExpr[];
  readonly returning: readonly string[] | undefined;  // set by RETURNING collapse
}

interface AggregateNode extends NodeBase {
  readonly kind: 'Aggregate';
  readonly collection: string;
  readonly fn: AggregateFn;
  readonly column: AggregateTarget;
  readonly groupBy: readonly string[] | undefined;  // join keys when inside include
  readonly filters: readonly WhereExpr[];
}

interface NestNode extends NodeBase {
  readonly kind: 'Nest';
  readonly leftKeys: readonly string[];   // parent join columns
  readonly rightKeys: readonly string[];  // child join columns
  readonly field: string;                 // target property name on parent
  readonly arity: 'array' | 'scalar';    // array = to-many, scalar = to-one/aggregate/combine
}

interface ReturnNode extends NodeBase {
  readonly kind: 'Return';
}

interface CombineNode extends NodeBase {
  readonly kind: 'Combine';
  readonly rightKeys: readonly string[];  // join key columns for grouping
}

interface CollectionStateNode extends NodeBase {
  readonly kind: 'CollectionState';
  readonly collection: string;
  readonly version: number;
}

type PlanNode =
  | StartNode
  | ReadNode
  | CreateNode
  | UpdateNode
  | DeleteNode
  | AggregateNode
  | NestNode
  | ReturnNode
  | CombineNode
  | CollectionStateNode;
```

## Edge Types

Edges are `source → target` where source **depends on** target. Each edge carries an optional typed label.

```typescript
interface EdgeBase {
  readonly source: NodeId;   // the node that depends
  readonly target: NodeId;   // the node it depends on
  readonly kind: EdgeKind;
}

type EdgeKind =
  | 'Dependency'
  | 'FilterData'
  | 'PayloadData'
  | 'BranchData'
  | 'NestParent'
  | 'NestChild';

/** Plain structural dependency (execution ordering only, no data transfer). */
interface DependencyEdge extends EdgeBase {
  readonly kind: 'Dependency';
}

/** Copy columns from target's result into source's WHERE ... IN (...) clause. */
interface FilterDataEdge extends EdgeBase {
  readonly kind: 'FilterData';
  readonly sourceColumns: readonly string[];  // columns in target's result to read
  readonly targetColumns: readonly string[];  // columns in source's filter to populate
}

/** Copy columns from target's result into source's mutation payload. */
interface PayloadDataEdge extends EdgeBase {
  readonly kind: 'PayloadData';
  readonly sourceColumns: readonly string[];  // columns in target's result to read
  readonly targetColumns: readonly string[];  // columns in source's payload to set
}

/** Connect a Combine node to one of its branch inputs. */
interface BranchDataEdge extends EdgeBase {
  readonly kind: 'BranchData';
  readonly name: string;                      // branch name (e.g. "popular", "totalCount")
  readonly arity: 'rows' | 'scalar';         // rows = flat result rows, scalar = single value
}

/** Nest's left input (parent rows). */
interface NestParentEdge extends EdgeBase {
  readonly kind: 'NestParent';
}

/** Nest's right input (child rows — Read, Aggregate, Combine, or another Nest). */
interface NestChildEdge extends EdgeBase {
  readonly kind: 'NestChild';
}

type PlanEdge =
  | DependencyEdge
  | FilterDataEdge
  | PayloadDataEdge
  | BranchDataEdge
  | NestParentEdge
  | NestChildEdge;
```

## Graph

The graph is a class that encapsulates node storage, edge indexes (forward + reverse), ID allocation, and navigation. Optimization passes and the executor operate through its methods.

```typescript
class QueryPlanGraph {

  /** All nodes keyed by ID. */
  readonly nodes: Map<NodeId, PlanNode>;

  /** Forward edges: source → edges FROM that node (its dependencies). */
  private readonly forwardEdges: Map<NodeId, PlanEdge[]>;

  /** Reverse edges: target → edges TO that node (its dependents). */
  private readonly reverseEdges: Map<NodeId, PlanEdge[]>;

  /** Monotonic ID counter, scoped to this graph instance. */
  private nextId: number;

  /** Singleton node references. */
  readonly startId: NodeId;
  readonly returnId: NodeId;

  // --- ID allocation ---

  private freshId(): NodeId;

  // --- Mutation ---

  /** Add a node (ID assigned internally). Returns its ID. */
  addNode(node: Omit<PlanNode, 'id'>): NodeId;

  /** Add an edge. Updates both forward and reverse indexes. */
  addEdge(edge: PlanEdge): void;

  /** Remove a node and all its edges (forward and reverse). */
  removeNode(id: NodeId): void;

  /** Remove a specific edge. */
  removeEdge(edge: PlanEdge): void;

  /**
   * Rewrite all edges where target === oldTarget to point to newTarget.
   * Used by optimization passes when collapsing nodes.
   */
  rewriteEdgesTo(oldTarget: NodeId, newTarget: NodeId): void;

  // --- Navigation ---

  /** Edges where `id` is the source (outgoing — "I depend on ..."). */
  dependenciesOf(id: NodeId): readonly PlanEdge[];

  /** Edges where `id` is the target (incoming — "... depends on me"). */
  dependentsOf(id: NodeId): readonly PlanEdge[];

  /** Dependency nodes of `id` (follow forward edges, return target nodes). */
  dependencyNodesOf(id: NodeId): readonly PlanNode[];

  /** Dependent nodes of `id` (follow reverse edges, return source nodes). */
  dependentNodesOf(id: NodeId): readonly PlanNode[];

  /**
   * Find the first edge from `sourceId` matching a predicate.
   * Common usage: find the FilterData edge from a Read to its parent.
   */
  findEdgeFrom(sourceId: NodeId, predicate: (e: PlanEdge) => boolean): PlanEdge | undefined;

  /**
   * Find the first edge to `targetId` matching a predicate.
   * Common usage: find who depends on a given CollectionState.
   */
  findEdgeTo(targetId: NodeId, predicate: (e: PlanEdge) => boolean): PlanEdge | undefined;

  // --- Analysis ---

  /** Topological sort of all nodes reachable from Return (reverse dependency order). */
  topoSort(): NodeId[];

  /** All nodes of a given kind. */
  nodesOfKind<K extends NodeKind>(kind: K): Extract<PlanNode, { kind: K }>[];
}
```

### Constructor

```typescript
/** Creates a graph with Start and Return nodes pre-allocated. */
function createGraph(): QueryPlanGraph;
```

## Collection State Tracker

Tracks the latest `CollectionState` counter per collection during graph construction.

```typescript
interface CollectionStateTracker {
  /** Get the latest CollectionState node ID for a collection. Creates one if absent. */
  latest(collection: string): NodeId;

  /** Advance the counter for a collection. Returns the new CollectionState node ID. */
  advance(collection: string, writeNodeId: NodeId): NodeId;
}
```

This is used by the graph builder during construction. On `advance`, it:
1. Creates a new `CollectionStateNode` with `version + 1`
2. Adds a `Dependency` edge from the new state to the write node
3. Updates its internal `Map<string, NodeId>` to point to the new state

## Plan Builder Context

Threaded through collection API methods during graph construction. Carries the graph and accumulated state for one terminal call.

```typescript
interface PlanBuilderContext {
  readonly graph: QueryPlanGraph;
  readonly stateTracker: CollectionStateTracker;
  readonly contract: SqlContract<SqlStorage>;

  /**
   * The "current output" node — the node whose result represents
   * the rows this collection builder will return. Updated as
   * includes/nesting are applied.
   *
   * For reads: starts as the Read node, becomes successive Nest nodes.
   * For writes: starts as the Read-after-write node.
   */
  currentOutputId: NodeId;

  /**
   * The "root read" node — the original Read node for this collection.
   * Used by includes to wire FilterData edges back to the root.
   * For writes: the Read-after-write of the main collection.
   */
  rootReadId: NodeId;

  /** The model/collection name this builder operates on. */
  readonly modelName: string;
  readonly tableName: string;
}
```

## Optimization Pass Interface

Each pass is a function that mutates the graph in-place and returns whether it made changes. Passes receive the contract directly — use `hasContractCapability()` to check capabilities.

```typescript
type OptimizationPass = (graph: QueryPlanGraph, contract: SqlContract<SqlStorage>) => boolean;

const passes: readonly OptimizationPass[] = [
  lateralJoinCollapse,       // requires: lateral + jsonAgg
  lateralAggregateCollapse,  // requires: lateral
  createReturningCollapse,   // requires: returning
  updateReturningCollapse,   // requires: returning
  deleteReturningCollapse,   // requires: returning
  // cteCombine,             // requires: cte (future)
  readDeduplication,         // no capability required
  deadCodeElimination,       // no capability required
];

/** Run all passes in a fixpoint loop until no pass makes changes. */
function optimize(graph: QueryPlanGraph, contract: SqlContract<SqlStorage>): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const pass of passes) {
      if (pass(graph, contract)) {
        changed = true;
      }
    }
  }
}
```

### Example: Lateral Join Collapse

This pass matches the pattern: **Nest → Read (right child) → FilterData → Read (left parent)**, and collapses it into a single Read with a lateral subquery.

**Before** (`db.users.include('posts').all()`):

```
Read#1("users") --Dependency--> CollectionState("users", 0)

Read#2("posts") --FilterData(users.id → posts.userId)--> Read#1
Read#2 --Dependency--> CollectionState("posts", 0)

Nest#3(leftKeys=[id], rightKeys=[userId], field="posts", arity=array)
  --NestParent--> Read#1
  --NestChild-->  Read#2

Return --Dependency--> Nest#3
```

**Pattern matching** (pseudocode):

```typescript
function lateralJoinCollapse(graph: QueryPlanGraph, contract: SqlContract<SqlStorage>): boolean {
  if (!hasContractCapability(contract, 'lateral') || !hasContractCapability(contract, 'jsonAgg')) {
    return false;
  }

  let changed = false;

  for (const nest of graph.nodesOfKind('Nest')) {
    // 1. Find Nest's left and right inputs via typed edges.
    const parentEdge = graph.findEdgeFrom(nest.id, e => e.kind === 'NestParent');
    const childEdge = graph.findEdgeFrom(nest.id, e => e.kind === 'NestChild');
    if (!parentEdge || !childEdge) continue;

    const leftInput = graph.nodes.get(parentEdge.target)!;
    const rightInput = graph.nodes.get(childEdge.target)!;

    // 2. Right input must be a Read (not Aggregate, Combine, or Nest).
    if (rightInput.kind !== 'Read') continue;

    // 3. Right input must have no other dependents besides this Nest.
    //    If another node (e.g., a deeper include's FilterData) also depends on rightInput,
    //    collapsing would duplicate the query: once inside the lateral, once standalone.
    const rightDependents = graph.dependentsOf(rightInput.id);
    if (rightDependents.length !== 1 || rightDependents[0]!.source !== nest.id) continue;

    // 4. Verify rightInput has a FilterData edge back to leftInput.
    const filterEdge = graph.findEdgeFrom(rightInput.id,
      e => e.kind === 'FilterData' && e.target === leftInput.id
    ) as FilterDataEdge | undefined;
    if (!filterEdge) continue;

    // 5. Collapse: append a subquery entry to leftInput.
    //    If rightInput already has subqueries (from a prior inner collapse), carry them over.
    const entry: SubqueryEntry = {
      field: nest.field,
      arity: nest.arity,
      leftKeys: nest.leftKeys,
      rightKeys: nest.rightKeys,
      subquery: 'jsonAgg',
      collection: rightInput.collection,
      columns: rightInput.columns,
      filters: rightInput.filters,
      orderBy: rightInput.orderBy,
      limit: rightInput.limit,
      subqueries: rightInput.subqueries,
    };
    const updatedLeft: ReadNode = {
      ...leftInput,
      subqueries: [...(leftInput.kind === 'Read' ? leftInput.subqueries ?? [] : []), entry],
    };
    graph.nodes.set(leftInput.id, updatedLeft);

    // 6. Rewrite: anyone who depended on Nest now depends on the updated left Read.
    graph.rewriteEdgesTo(nest.id, leftInput.id);

    // 7. Remove Nest and right Read (safe — step 3 confirmed right has no other dependents).
    graph.removeNode(nest.id);
    graph.removeNode(rightInput.id);
    // If rightInput still has dependents, it stays — DCE won't touch it since it's reachable.
    // If it becomes orphaned later (e.g., after a deeper collapse), DCE cleans it up.

    changed = true;
  }

  return changed;
}
```

**After**:

```
Read#1("users", subqueries=[{ subquery: 'jsonAgg', field: "posts", collection: "posts", ... }])
  --Dependency--> CollectionState("users", 0)

Return --Dependency--> Read#1
```

CollectionState("posts", 0) is now orphaned — DCE removes it in a later pass.

**Key observations**:
- `NestParent`/`NestChild` edges make input identification trivial — no topology inference needed
- **Early bail on shared right Read**: if the right Read has dependents other than this Nest (e.g., a deeper include's FilterData), the pass skips — collapsing would duplicate the query (once in lateral, once standalone)
- `subqueries` is an array: `include('posts').include('profile')` produces two entries on the same Read across two fixpoint iterations
- `SubqueryEntry` carries Nest metadata (field, arity, keys) since the Nest node is eliminated
- `rewriteEdgesTo` is the core primitive — it rewires Return (and any chained Nest above) in one call

## Execution

### Result Types

```typescript
type Row = Record<string, unknown>;

/**
 * Wraps a node's output, providing uniform access regardless of whether
 * the result is still streaming or has been materialized.
 *
 * Starts in streaming state. On first call to `materialize()`, collects
 * the iterator into an array and transitions to materialized state.
 * Subsequent calls to `materialize()` return the cached array.
 */
interface NodeResult {
  /**
   * Async-iterate over the rows. If already materialized, yields from the array.
   * Can only be called once when in streaming state (consuming the iterator).
   */
  [Symbol.asyncIterator](): AsyncIterableIterator<Row>;

  /**
   * Collect all rows into an array (if not already done) and return them.
   * Transitions the result from streaming to materialized state.
   * Idempotent — subsequent calls return the same cached array.
   */
  materialize(): Promise<readonly Row[]>;

  /** True if `materialize()` has already been called and the rows are buffered. */
  readonly isMaterialized: boolean;
}

/** Create a NodeResult from an async iterator (streaming). */
function createStreamingResult(iter: AsyncIterableIterator<Row>): NodeResult;

/** Create a NodeResult from an already-materialized array. */
function createMaterializedResult(rows: readonly Row[]): NodeResult;

/**
 * Holds executed node outputs. Each entry is a `NodeResult` — the executor
 * reads via `[Symbol.asyncIterator]()` for streaming consumers (Nest left parent)
 * and via `materialize()` for buffered consumers (FilterData, PayloadData,
 * Nest right child, Combine branches, multiple consumers).
 */
type ResultMap = Map<NodeId, NodeResult>;
```

### Executor

```typescript
interface PlanExecutor {
  execute(
    graph: QueryPlanGraph,
    scope: RuntimeScope,
    contract: SqlContract<SqlStorage>,
  ): AsyncIterableIterator<Row>;
}
```

The executor:
1. Topologically sorts the graph
2. Iterates nodes in dependency order
3. For each node, reads dependency `NodeResult`s from `ResultMap`
   - Calls `result.materialize()` when the consuming edge requires buffered access: FilterData, PayloadData, Nest right child (NestChild edge), Combine branches (BranchData edge), or when the dependency has multiple consumers
   - Iterates via `result[Symbol.asyncIterator]()` when the dependency feeds only into Nest as left parent (NestParent edge) with no other consumers
4. **Short-circuits** on empty materialized FilterData parents (produces an empty `NodeResult`)
5. Executes the node (SQL for Read/Create/Update/Delete/Aggregate, in-memory for Nest/Combine)
6. Stores result in `ResultMap` as a `NodeResult` (via `createStreamingResult` or `createMaterializedResult`)
7. Returns the `NodeResult` from `ResultMap.get(returnId)` — the caller iterates it directly

### Transaction Heuristic

```typescript
function requiresTransaction(graph: QueryPlanGraph): boolean {
  let writeCount = 0;
  for (const node of graph.nodes.values()) {
    if (node.kind === 'Create' || node.kind === 'Update' || node.kind === 'Delete') {
      writeCount++;
      if (writeCount > 1) return true;
    }
  }
  return false;
}
```

## DOT Renderer

```typescript
function toDot(graph: QueryPlanGraph): string;
```

Produces Graphviz DOT with:
- Nodes labeled by `kind` + key payload (e.g., `Read("users")`, `CollectionState("users", 0)`)
- Edge styles: solid for Dependency, dashed for FilterData, dotted for PayloadData, bold for BranchData
- Edge labels from typed metadata (e.g., `users.id → posts.userId`)

## Relationship to Existing Types

| New Type | Existing Type | Relationship |
|----------|--------------|--------------|
| `ReadNode.filters` | `CollectionState.filters` / `WhereExpr[]` | Same AST, copied from collection state |
| `ReadNode.orderBy` | `CollectionState.orderBy` / `OrderExpr[]` | Same type, copied |
| `NestNode` | `IncludeExpr` | Replaces include descriptor in the graph |
| `AggregateNode.fn` | `AggregateFn` | Reuses existing type |
| `CreateNode.data` | `CreateInput<C, M>` | Runtime value, not generic-typed in the graph |
| `FilterDataEdge` | Implicit in `compileRelationSelect()` | Made explicit as graph edge |
| `PayloadDataEdge` | Implicit in `mutation-executor.ts` | Made explicit as graph edge |

## File Organization

```
packages/3-extensions/sql-orm-client/src/planner/
  types.ts            — NodeId, PlanNode, PlanEdge
  graph.ts            — QueryPlanGraph class
  state-tracker.ts    — CollectionStateTracker
  builder.ts          — PlanBuilderContext, graph construction from CollectionState
  passes/
    index.ts          — optimize() orchestrator
    lateral-join.ts
    lateral-aggregate.ts
    returning-create.ts
    returning-update.ts
    returning-delete.ts
    read-dedup.ts
    dce.ts
  executor.ts         — PlanExecutor, ResultMap, transaction heuristic
  dot.ts              — toDot() renderer
```
