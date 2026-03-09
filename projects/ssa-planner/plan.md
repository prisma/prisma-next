# SSA Query Planner — Implementation Plan

## Summary

Build an SSA/sea-of-nodes query planner for the ORM layer that replaces the current ad-hoc dispatch in `sql-orm-client`. The Collection API will construct a pessimistic dependency graph, an executor runs unoptimized graphs to establish correctness against existing tests, then capability-aware optimization passes are layered on top. Success means: all existing ORM tests pass on unoptimized graphs first, then optimized graphs produce identical results with fewer queries.

**Spec:** `projects/ssa-planner/spec.md`
**Data Structures:** `projects/ssa-planner/data-structures.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | TBD | Drives execution |
| Reviewer | TBD | Architectural review — graph IR design, optimization correctness |

## Milestones

### Milestone 1: Graph IR & Core Infrastructure

Deliver the foundational data structures, graph class, and DOT renderer. Validated by: unit tests for graph operations (add/remove nodes/edges, topo sort) and DOT snapshot tests matching the spec's 16 example graphs.

**Tasks:**

- [ ] **1.1** Create `packages/3-extensions/sql-orm-client/src/planner/` directory and file stubs per data-structures.md file organization
- [ ] **1.2** Implement `types.ts` — `NodeId` branded type, all `PlanNode` discriminated union variants (`StartNode`, `ReadNode`, `CreateNode`, `UpdateNode`, `DeleteNode`, `AggregateNode`, `NestNode`, `ReturnNode`, `CombineNode`, `CollectionStateNode`), all `PlanEdge` variants (`DependencyEdge`, `FilterDataEdge`, `PayloadDataEdge`, `BranchDataEdge`, `NestParentEdge`, `NestChildEdge`), and supporting types (`DistinctMode`, `AggregateSelection`, `AggregateTarget`, `SubqueryEntry`, `OnConflictConfig`, `ReadBase`, `SubqueryBase`, `RowsSubquery`, `AggregateSubquery`)
- [ ] **1.3** Implement `graph.ts` — `QueryPlanGraph` class with: node storage (`Map<NodeId, PlanNode>`), forward/reverse edge indexes, monotonic ID allocation (`freshId`), mutation methods (`addNode`, `addEdge`, `removeNode`, `removeEdge`, `rewriteEdgesTo`), navigation methods (`dependenciesOf`, `dependentsOf`, `dependencyNodesOf`, `dependentNodesOf`, `findEdgeFrom`, `findEdgeTo`), analysis methods (`topoSort`, `nodesOfKind`), and `createGraph()` factory that pre-allocates Start + Return nodes
- [ ] **1.4** Implement `state-tracker.ts` — `CollectionStateTracker` with `latest(collection)` and `advance(collection, writeNodeId)` that creates new `CollectionStateNode` with incremented version, adds `Dependency` edge from new state to write node, and updates internal map
- [ ] **1.5** Implement `dot.ts` — `toDot(graph)` renderer producing Graphviz DOT with node labels (`kind` + key payload), edge styles (solid=Dependency, dashed=FilterData, dotted=PayloadData, bold=BranchData), and edge labels from typed metadata
- [ ] **1.6** Unit tests for `QueryPlanGraph`: add/remove nodes and edges, forward/reverse index consistency, `rewriteEdgesTo`, topological sort correctness, `nodesOfKind` filtering
- [ ] **1.7** Unit tests for `CollectionStateTracker`: initial state creation, version advancement, dependency edge creation
- [ ] **1.8** DOT snapshot tests: manually construct graphs matching all 16 spec examples (01–16) and assert DOT output matches the `.dot` files in `projects/ssa-planner/graphs/`

### Milestone 2: Graph Builder

Wire the Collection API to build SSA graphs instead of flat state. Validated by: graph construction tests covering reads, includes, mutations, combine, and aggregations — all verified via DOT snapshots.

**Tasks:**

- [ ] **2.1** Implement `builder.ts` — `PlanBuilderContext` interface with `graph`, `stateTracker`, `contract`, `currentOutputId`, `rootReadId`, `modelName`, `tableName`. Factory function `createBuilderContext(contract, modelName)` that creates a graph, adds the root Read node with CollectionState dependency, and initializes tracking fields
- [ ] **2.2** Implement read graph construction: `.select()`, `.where()`, `.orderBy()`, `.limit()`, `.offset()`, `.distinct()`/`.distinctOn()` modify the Read node's payload; `.cursor()` compiles into filter expressions (spec decision #20)
- [ ] **2.3** Implement include graph construction: `.include(relation)` adds a child Read with FilterData edge from root Read, a Nest node with NestParent/NestChild edges, and updates `currentOutputId` to the Nest. Multi-level nesting recurses (inner Read has FilterData from outer Read). Multiple includes chain Nest nodes (second Nest's left input is first Nest's output)
- [ ] **2.4** Implement include-with-aggregate graph construction: `.include(relation, p => p.count())` adds Aggregate node with FilterData from root Read, `groupBy` set to join keys, plus Nest with scalar arity
- [ ] **2.5** Implement combine graph construction: `.include(relation, p => p.combine({...}))` adds branch Read/Aggregate nodes with FilterData from root Read, Combine node with BranchData edges, and Nest with scalar arity consuming Combine
- [ ] **2.6** Implement create graph construction: `.create(data)` adds Create node with CollectionState dependency, advances state, adds Read-after-write with FilterData(PK→PK) from Create
- [ ] **2.7** Implement update graph construction: `.update(data)` adds Read-before-update (captures PKs), Update with FilterData from pre-read, advances state, Read-after-write with FilterData from pre-read
- [ ] **2.8** Implement delete graph construction: `.delete()` adds Read-before-delete (captures rows+PKs), Delete with FilterData from pre-read on PK, advances state
- [ ] **2.9** Implement upsert graph construction: `.upsert({create, update})` adds Create node with `onConflict` config, Read-after-write with FilterData(PK→PK) from Create (spec decision #3)
- [ ] **2.10** Implement nested mutation graph construction — parent-owned (N:1): nested create adds child Create + Read-after-write, main Write depends via PayloadData(related.PK → main.FK); connect adds lookup Read, main Write depends via PayloadData; disconnect sets FK to null in main Write's data
- [ ] **2.11** Implement nested mutation graph construction — child-owned (1:N): nested create adds child Create depending on main Write's Read-after-write via PayloadData(main.PK → related.FK); connect adds child Update via PayloadData; disconnect adds child Update setting FK to null via FilterData
- [ ] **2.12** Implement write-with-include stitching: when a write terminal has includes, add include subgraph using main Write's Read-after-write as Nest's left input, with include Read depending on related collection's latest CollectionState
- [ ] **2.13** Implement grouped collection graph construction: `.groupBy().aggregate()` terminal produces `Start → CollectionState → Read(groupBy, having, aggregateSelections) → Return` (spec decision #21)
- [ ] **2.14** Graph construction tests with DOT snapshots: read with filters/select/order/limit, single include, multi-include, nested include, include-with-count, combine, create, update, delete, upsert, nested create (parent-owned), nested create (child-owned), connect (both sides), disconnect, update-with-include, grouped collection

### Milestone 3: Executor & Integration (Unoptimized)

Implement the plan executor and wire it into terminal methods. Run all existing `sql-orm-client` tests against unoptimized graphs to establish correctness before adding optimizations. This is the primary backward-compatibility gate.

**Tasks:**

- [ ] **3.1** Implement `NodeResult` — streaming/materialized wrapper: `createStreamingResult(iter)` wrapping `AsyncIterableIterator<Row>`, `createMaterializedResult(rows)` wrapping `readonly Row[]`, `materialize()` transitions streaming→materialized (idempotent), `[Symbol.asyncIterator]()` yields from array if materialized or consumes iterator if streaming
- [ ] **3.2** Implement `executor.ts` — `PlanExecutor.execute()`: topological sort, iterate in dependency order, read dependency `NodeResult`s from `ResultMap`, materialize when edge requires buffered access (FilterData, PayloadData, NestChild, BranchData, multiple consumers), stream for sole NestParent consumer
- [ ] **3.3** Implement executor node handlers — Read/Create/Update/Delete/Aggregate: compile node payload to SQL via existing Kysely compiler infrastructure, execute against `RuntimeScope`, wrap result in `NodeResult`
- [ ] **3.4** Implement executor node handlers — Nest: materialize right child into `Map<KeyTuple, Row[]>`, stream over left parent, yield assembled rows with nested field
- [ ] **3.5** Implement executor node handlers — Combine: materialize all branch results, group by `rightKeys`, union keys, assemble one row per key with `rows` branches as arrays and `scalar` branches unwrapped
- [ ] **3.6** Implement empty parent short-circuit: when materialized FilterData parent is empty array, produce empty `NodeResult` for downstream node
- [ ] **3.7** Implement `requiresTransaction(graph)` — count write nodes, return true if >1
- [ ] **3.8** Wire planner into terminal methods: `.all()`, `.first()`, `.create()`, `.update()`, `.delete()`, `.upsert()` — build graph via `PlanBuilderContext`, run executor (no optimization yet). Ensure `RuntimeScope` and transaction wrapping are passed through
- [ ] **3.9** Wire grouped collection terminal: `.groupBy().aggregate()` builds graph, executes
- [ ] **3.10** **Gate: all existing `sql-orm-client` tests pass without modification** — this validates the unoptimized planner produces identical results to the current implementation
- [ ] **3.11** Integration tests: read with single include (multi-query path), write with read-after-write, nested mutation with transaction, combine execution, empty parent short-circuit, multi-level nested include

### Milestone 4: Optimization Passes

Layer optimization passes on top of the working unoptimized executor. Validated by: before/after DOT snapshots for each pass, capability gating tests, and existing tests still passing with optimizations enabled.

**Tasks:**

- [ ] **4.1** Implement `passes/index.ts` — `OptimizationPass` type signature, `passes` array ordering, `optimize()` fixpoint loop
- [ ] **4.2** Implement `passes/lateral-join.ts` — Lateral Join Collapse: match Nest → Read (right) → FilterData → Read (left), verify right Read has no other dependents, collapse into single Read with `RowsSubquery` entry, `rewriteEdgesTo` for Nest, remove Nest + right Read. Gate on `lateral` + `jsonAgg` capabilities
- [ ] **4.3** Implement `passes/lateral-aggregate.ts` — Lateral Aggregate Collapse: match Nest → Aggregate (right) → FilterData → Read (left), collapse into single Read with `AggregateSubquery` entry (drops Aggregate's `groupBy`). Gate on `lateral` capability
- [ ] **4.4** Implement `passes/returning-create.ts` — Create RETURNING Collapse: match Create → CollectionState(N+1) → Read where Read has FilterData(PK→PK) from Create, set `returning` on Create, rewrite edges from Read to Create, remove Read. Gate on `returning` capability
- [ ] **4.5** Implement `passes/returning-update.ts` — Update RETURNING Collapse: match Read(A) → Update (FilterData from A) → CollectionState → Read(B) (FilterData from A), set `returning` on Update, rewrite edges from both Reads to Update, remove both Reads. Gate on `returning` capability
- [ ] **4.6** Implement `passes/returning-delete.ts` — Delete RETURNING Collapse: match Read → Delete (FilterData from Read on PK), both sharing same CollectionState input, set `returning` on Delete, rewrite edges from Read to Delete, remove Read. Gate on `returning` capability
- [ ] **4.7** Implement `passes/read-dedup.ts` — Read Deduplication: find Read pairs with same collection, same CollectionState dependency, structurally equal filters/ordering/limit/offset, union column sets, rewrite edges from eliminated Read to surviving Read
- [ ] **4.8** Implement `passes/dce.ts` — Dead Code Elimination: walk backward from Return, mark reachable nodes, remove unreachable nodes (except Start)
- [ ] **4.9** Implement SQL compilation for optimized nodes: Read with `subqueries` (lateral join) generates LATERAL JOIN + `json_agg` SQL; Read with aggregate subqueries generates scalar lateral subquery; Write with `returning` generates `RETURNING` clause
- [ ] **4.10** Wire `optimize()` into terminal methods (between graph construction and execution)
- [ ] **4.11** Tests for lateral join collapse: single include, multi-include (two entries on same Read across fixpoint iterations), verify skip when right Read has other dependents, verify no-op without `lateral`/`jsonAgg` capabilities
- [ ] **4.12** Tests for lateral aggregate collapse: include-with-count, verify `groupBy` dropped, verify no-op without `lateral` capability
- [ ] **4.13** Tests for RETURNING collapse (create, update, delete): each pattern individually, verify edge rewriting, verify no-op without `returning` capability
- [ ] **4.14** Tests for read deduplication: identical reads merged, column union, non-identical reads preserved (different filters, different CollectionState)
- [ ] **4.15** Tests for DCE: orphaned CollectionState after lateral collapse removed, orphaned nodes from other passes removed
- [ ] **4.16** Tests for fixpoint optimizer: multi-pass convergence (e.g., lateral collapse followed by DCE), pass ordering sensitivity
- [ ] **4.17** **Gate: all existing `sql-orm-client` tests still pass with optimizations enabled**
- [ ] **4.18** Semantic equivalence integration tests: compare output of optimized vs unoptimized execution for representative queries

### Milestone 5: Close-out

Finalize documentation, clean up transient project artifacts, and verify all acceptance criteria.

**Tasks:**

- [ ] **5.1** Verify all acceptance criteria from spec are met — walk through each criterion and link to passing test
- [ ] **5.2** Add debug mode: dump SSA graph before and after optimization as DOT (spec Observability section)
- [ ] **5.3** Add optimization pass timing to debug output
- [ ] **5.4** Finalize ADRs for SSA query planner design decisions — migrate key decisions from spec's "Resolved Decisions" into `docs/architecture docs/adrs/`
- [ ] **5.5** Update `docs/architecture docs/subsystems/` with query planner subsystem documentation
- [ ] **5.6** Strip repo-wide references to `projects/ssa-planner/**`, replace with canonical `docs/` links
- [ ] **5.7** Delete `projects/ssa-planner/` directory

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| Collection methods produce nodes and edges in the SSA graph | Unit | 2.14 (M2) | DOT snapshot tests for each collection method |
| CollectionState nodes correctly track write ordering per collection | Unit | 1.7, 2.14 (M1, M2) | Tracker unit tests + write graph snapshots |
| Nested includes produce chains of Read → FilterData → Nest | Unit | 2.14 (M2) | Multi-level nesting DOT snapshots |
| Mutations produce Write nodes with correct CollectionState dependencies | Unit | 2.14 (M2) | Create/update/delete/upsert graph snapshots |
| `combine()` produces Combine + Nest node pairs | Unit | 2.14 (M2) | Combine DOT snapshots |
| Aggregate nodes are self-contained with FilterData and CollectionState edges | Unit | 2.14 (M2) | Include-with-count DOT snapshots |
| Upsert modeled as Create with `onConflict` | Unit | 2.14 (M2) | Upsert graph snapshot |
| Lateral join collapse | Unit | 4.11 (M4) | Before/after DOT snapshots, capability gating |
| Lateral aggregate collapse | Unit | 4.12 (M4) | Before/after DOT snapshots, capability gating |
| Create RETURNING collapse | Unit | 4.13 (M4) | Before/after DOT snapshots, capability gating |
| Update RETURNING collapse | Unit | 4.13 (M4) | Before/after DOT snapshots, capability gating |
| Delete RETURNING collapse | Unit | 4.13 (M4) | Before/after DOT snapshots, capability gating |
| Read deduplication | Unit | 4.14 (M4) | Structural equality, column union |
| Dead code elimination | Unit | 4.15 (M4) | Post-lateral-collapse orphan cleanup |
| Optimizations preserve semantic equivalence | Integration | 4.18 (M4) | Optimized vs unoptimized result comparison |
| Terminal methods finalize, optimize, and execute | Integration | 3.10 (M3) | Existing tests pass on unoptimized graphs |
| Results identical to current ORM output | Integration | 3.10, 4.17 (M3, M4) | Existing tests gate both milestones |
| Plans with >1 write node execute within a transaction | Integration | 3.11 (M3) | Nested mutation transaction test |
| DOT renderer produces valid Graphviz output | Unit | 1.8 (M1) | 16 spec example graph snapshots |
| Planning tests use DOT snapshot files | Unit | 1.8, 2.14, 4.11–4.15 (M1–M4) | Convention established in M1 |
| All existing `sql-orm-client` tests pass | Integration | 3.10, 4.17 (M3, M4) | Gates at both unoptimized and optimized stages |
| Public API types remain unchanged | Integration | 3.10 (M3) | No type signature changes to collection API |

## Open Items

- **Pass ordering**: Spec decision #11 says "determined empirically during implementation." The initial ordering in `passes/index.ts` (lateral → returning → dedup → DCE) may need adjustment based on test results in Milestone 4.
- **Kysely compiler integration**: The executor (M3) needs to compile unoptimized node payloads to SQL, and M4 adds optimized node compilation (lateral subqueries, RETURNING clauses). The existing Kysely compiler may need extensions — scope of changes will become clear during implementation.
- **Performance**: No benchmark targets specified. The planner adds an indirection layer; verify no measurable regression on hot paths during M3.
