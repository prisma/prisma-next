# SSA/Sea-of-Nodes Query Planner for ORM

## Summary

Replace the current ad-hoc query dispatch in `sql-orm-client` with an SSA-style (Static Single Assignment) sea-of-nodes intermediate representation. The Collection API builds a pessimistic dependency graph of database operations; capability-aware optimization passes then collapse, merge, and eliminate nodes before execution.

## Description

### Problem

The current ORM execution model dispatches queries through strategy-specific code paths (`lateral`, `correlated`, `multiQuery`) chosen at execution time. This makes it hard to:

1. **Optimize across operation boundaries** - e.g., a write followed by a read of the same collection can't be collapsed into `UPDATE ... RETURNING` without special-case code for each combination
2. **Compose multi-level query plans** - nested includes with filters, aggregations, and mutations are handled by separate subsystems (`collection-dispatch.ts`, `mutation-executor.ts`) with no unified representation

### Solution

Introduce an SSA graph IR between the Collection API and SQL compilation:

1. **Collection methods build a graph** instead of accumulating flat `CollectionState`
2. **Optimization passes** transform the graph based on database capabilities
3. **Code generation** lowers the optimized graph to SQL execution plans

### Graph Structure

Nodes represent operations. Directed edges `A --> B` mean "A depends on B". Edges carry labels describing the dependency reason.

#### Node Types

All nodes produce `AsyncIterableIterator<Row>` as output. The executor **materializes** (collects into an array) a node's output only when required — see Execution Model for materialization rules.

| Node | Description |
|------|-------------|
| **Start** | Entry point of the plan. All initial CollectionState nodes connect here. |
| **Read** | Execute a SELECT query against a collection. Carries: collection name, selected columns, filters, ordering, limit/offset, optional groupBy columns, having filters, and aggregate selections. |
| **Create** | Execute an INSERT (also models upsert via optional `onConflict` config). Carries: collection name, data payload, optional onConflict, optional returning columns. |
| **Update** | Execute an UPDATE. Carries: collection name, data payload, filters, optional returning columns. |
| **Delete** | Execute a DELETE. Carries: collection name, filters, optional returning columns. |
| **Aggregate** | Execute a scalar aggregation query (count, sum, avg, min, max) directly against the database. Carries: collection name, aggregation function, optional target column, optional groupBy columns, filters. When inside an include, groupBy is set to the join key columns of the enclosing relationship for per-parent results (e.g., `SELECT userId, count(*) FROM posts WHERE userId IN (...) GROUP BY userId`). For top-level aggregates (e.g., `db.posts.count()`), groupBy is absent and the node produces a single scalar result (`SELECT count(*) FROM posts`). Aggregate is a self-contained SQL-generating node — it has its own FilterData and CollectionState edges, not a dependency on a Read node. |
| **Nest** | Group child results into parent rows by key. Produces nested output (e.g., `{ ...user, posts: [...] }`). Carries: left keys, right keys, target field name. Multiple Nest nodes chain for multi-include queries. Nest is aware of the expected arity of its child (array vs scalar). For scalar children (e.g., Aggregate or Combine), Nest unwraps the single-element array. Nest is unaware of Combine — it treats Combine output as any other scalar-arity child (rows with a join key column, one row per parent key). |
| **Return** | Terminal node. Points to the value(s) to return to the caller. |
| **Combine** | Group N named branch results by join key and output one row per parent key value. Carries: `rightKeys` (join key columns). Branch inputs are connected via BranchData edges (see below). Only valid inside include refinements for to-many relations (authoring-time constraint from Collection API). |
| **CollectionState** | Tracks write-ordering for a collection. Carries: collection name, counter. |

#### CollectionState Rules

- Each referenced collection starts with a `CollectionState(name, 0)` node connected to `Start`
- Each **Read** node depends on the `CollectionState` node with the highest known counter for that collection at the time the Read is created
- Each **Write** (Create/Update/Delete) node depends on the highest-counter `CollectionState` AND produces a new `CollectionState(name, counter+1)` node. The new CollectionState depends on the Write node (i.e., `CollectionState(name, counter+1) --> Write`).
- To determine if a write occurred between two nodes: check if they reference the same `CollectionState` node
- When the plan is finalized, `Return` depends on all latest `CollectionState` nodes (i.e., `Return --> CollectionState`)

#### Special Edge Types

| Edge | Description |
|------|-------------|
| **FilterData** | Copy specified columns from parent node's result into child node's `WHERE ... IN (...)` clause. Carries: source columns, target filter columns. |
| **PayloadData** | Copy specified columns from parent node's result into child node's mutation payload. Carries: source columns, target payload columns. |
| **BranchData** | Connect a Combine node to one of its branch inputs. Only valid on edges from a Combine node. Carries: branch name, kind (`rows` or `scalar`). |

### Building the Graph

The Collection API's public methods build the graph pessimistically - assuming no special database capabilities. Terminal methods (`.all()`, `.first()`, `.create()`, etc.) finalize the graph, trigger optimization, and execute.

#### Pessimistic Write Pattern

Since the graph assumes no capabilities, write nodes (Create/Update/Delete) do **not** carry `returning` columns. Every write terminal that returns rows to the caller pairs the Write with Reads:

- **Create**: The Create node produces the inserted row's **PK columns** as its minimal output (derived from explicit input data, or from database-provided identity such as `LAST_INSERT_ID`). A **Read-after-write** connects to the Create via `FilterData(PK → PK)` to fetch the full row. This Read depends on the CollectionState produced by the Create.
- **Update**: A **Read-before-update** evaluates the user's WHERE clause and captures the matching PKs. The Update receives these PKs via `FilterData(PK → PK)` from the Read, pinning it to the exact rows found. A **Read-after-update** fetches the updated rows, also connected to the first Read via `FilterData(PK → PK)`, and depends on the CollectionState produced by the Update.
- **Delete**: A **Read-before-delete** evaluates the user's WHERE clause and captures the matching rows (including PKs). The Delete receives these PKs via `FilterData(PK → PK)` from the Read, pinning it to the exact rows found. Both share the same CollectionState input.

This pattern means that **data flowing to downstream nodes (via PayloadData or FilterData) always originates from a Read node's result**, never directly from a Write node. The RETURNING Collapse optimization pass merges these Write + Read pairs into single Write-with-RETURNING nodes when the `returning` capability is present.

#### Nested Mutation Expansion

Nested mutations are expanded into separate Create/Update/Delete nodes. The graph structure depends on **relation ownership** (which side holds the foreign key) and **mutation kind** (create, connect, disconnect).

**Execution order is encoded structurally via dependency edges** — no explicit ordering metadata is needed. Parent-owned mutations produce nodes that execute before the main Write (because the main Write depends on their output via PayloadData). Child-owned mutations produce nodes that execute after the main Write (because they depend on the main Write's output via PayloadData or FilterData).

##### Parent-owned relations (N:1) — the main record holds the FK

The main record's FK columns must be populated **before** the main Write executes.

| Mutation | Graph pattern |
|----------|--------------|
| **create** | A nested Create of the related collection executes first. A Read-after-write fetches the created row. The main Write depends on this Read via `PayloadData(related.PK → main.FK)`. |
| **connect** | A Read of the related collection looks up the row by criterion. The main Write depends on it via `PayloadData(related.PK → main.FK)`. The lookup Read is a standard Read node with its own CollectionState dependency — no special node type. |
| **disconnect** | No separate node. The main Write's data payload sets the FK columns to `null` directly. |

##### Child-owned relations (1:N, 1:1) — the related record holds the FK

The related record's FK columns must be populated with the main record's PK **after** the main Write executes. Since the main Write does not produce row data (pessimistic), a Read-after-write of the main collection provides the PK values for downstream nodes.

| Mutation | Graph pattern |
|----------|--------------|
| **create** | A nested Create of the related collection depends on the main Write's Read-after-write via `PayloadData(main.PK → related.FK)`. The parent's PK value is injected into each child record's FK at execution time. |
| **connect** | An Update of the related collection sets the FK to the parent's PK. Depends on the main Write's Read-after-write via `PayloadData(main.PK → related.FK)`. The Update's filter scopes to the connect criterion (e.g., `WHERE id = 10`). |
| **disconnect** | An Update of the related collection sets the FK to `null`. Depends on the main Write's Read-after-write via `FilterData(main.PK → related.FK)` to scope which children to disconnect (e.g., `WHERE FK = parent.id AND id = 11`). Uses FilterData (not PayloadData) because the parent's PK is used as a **filter**, not injected into the payload. |

##### Write + include stitching

When a write has includes (e.g., `.include('posts').create(...)`), the returned result contains nested related data. After all mutations complete, a Read fetches the related collection for stitching — identical to read-only includes, but with the main Write's Read-after-write as the Nest's left input. The include Read depends on the related collection's **latest** CollectionState, ensuring it sees any rows created or modified by nested mutations.

**Example: `db.users.include('posts').all()`**

Pessimistic graph (no lateral joins assumed):
```
Start
  --> CollectionState("users", 0)
  --> CollectionState("posts", 0)

Read("users", columns=[*]) --> CollectionState("users", 0)

Read("posts", columns=[*]) --FilterData(users.id -> posts.userId)--> Read("users")
Read("posts") --> CollectionState("posts", 0)

Nest(leftKeys=[id], rightKeys=[userId], field="posts")
  --> Read("users")
  --> Read("posts")

Return --> Nest
Return --> CollectionState("users", 0)
Return --> CollectionState("posts", 0)
```

**Example: `db.users.include('posts', p => p.count()).all()`**

```
Start --> CollectionState("users", 0) --> CollectionState("posts", 0)

Read("users", columns=[*]) --> CollectionState("users", 0)

Aggregate("posts", fn=count, groupBy=[userId])
  --FilterData(users.id -> posts.userId)--> Read("users")
  --> CollectionState("posts", 0)

Nest(leftKeys=[id], rightKeys=[userId], field="posts")
  --> Read("users")
  --> Aggregate

Return --> Nest
Return --> CollectionState("users", 0)
Return --> CollectionState("posts", 0)
```

**Example: `db.users.include('posts').include('profile').all()`**

Multiple includes chain Nest nodes — each Nest takes the result of the previous one as its left input:

```
Start
  --> CollectionState("users", 0)
  --> CollectionState("posts", 0)
  --> CollectionState("profiles", 0)

Read("users", columns=[*]) --> CollectionState("users", 0)

Read("posts", columns=[*]) --FilterData(users.id -> posts.userId)--> Read("users")
Read("posts") --> CollectionState("posts", 0)

Read("profiles", columns=[*]) --FilterData(users.id -> profiles.userId)--> Read("users")
Read("profiles") --> CollectionState("profiles", 0)

Nest(leftKeys=[id], rightKeys=[userId], field="posts")
  --> Read("users")
  --> Read("posts")

Nest(leftKeys=[id], rightKeys=[userId], field="profile")
  --> Nest("posts")    // result of first Nest (users-with-posts)
  --> Read("profiles")

Return --> Nest("profile")
Return --> CollectionState("users", 0)
Return --> CollectionState("posts", 0)
Return --> CollectionState("profiles", 0)
```

**Example: `db.users.include('posts', p => p.include('comments')).all()`**

Multi-level nesting produces recursive Read + FilterData + Nest subgraphs. The inner Read('comments') has a FilterData edge from Read('posts'), and Nest nodes chain: inner Nest attaches comments to posts, outer Nest attaches posts-with-comments to users.

```
Start
  --> CollectionState("users", 0)
  --> CollectionState("posts", 0)
  --> CollectionState("comments", 0)

Read("users", columns=[*]) --> CollectionState("users", 0)

Read("posts", columns=[*]) --FilterData(users.id -> posts.userId)--> Read("users")
Read("posts") --> CollectionState("posts", 0)

Read("comments", columns=[*]) --FilterData(posts.id -> comments.postId)--> Read("posts")
Read("comments") --> CollectionState("comments", 0)

Nest(leftKeys=[id], rightKeys=[postId], field="comments")
  --> Read("posts")
  --> Read("comments")

Nest(leftKeys=[id], rightKeys=[userId], field="posts")
  --> Read("users")
  --> Nest("comments")   // posts-with-comments

Return --> Nest("posts")
Return --> CollectionState("users", 0)
Return --> CollectionState("posts", 0)
Return --> CollectionState("comments", 0)
```

**Example: `db.users.include('posts', p => p.combine({ popular: p.where(p => p.views.gt(150)), totalCount: p.count() })).all()`**

Combine groups named branches and outputs Nest-compatible rows. Each branch has its own Read (with FilterData from parent). Combine assembles per-parent results into keyed objects. Nest consumes the Combine output as a scalar-arity child.

```
Start
  --> CollectionState("users", 0)
  --> CollectionState("posts", 0)

Read("users", columns=[*]) --> CollectionState("users", 0)

Read("posts:popular", columns=[*], where=[views > 150])
  --FilterData(users.id -> posts.userId)--> Read("users")
  --> CollectionState("posts", 0)

Aggregate("posts", fn=count, groupBy=[userId])
  --FilterData(users.id -> posts.userId)--> Read("users")
  --> CollectionState("posts", 0)

Combine(rightKeys=[userId])
  --BranchData(name="popular", kind=rows)--> Read("posts:popular")
  --BranchData(name="totalCount", kind=scalar)--> Aggregate

Nest(leftKeys=[id], rightKeys=[userId], field="posts", arity=scalar)
  --> Read("users")
  --> Combine

Return --> Nest
Return --> CollectionState("users", 0)
Return --> CollectionState("posts", 0)
```

**Example: `db.users.include('posts', p => p.combine({ popular: ..., count: p.count() })).include('profile').all()`**

Multiple includes chain independently of what each include resolves to — whether a plain Read, a Combine, or an Aggregate. The second Nest always takes the first Nest's output as its left input, regardless of what produced the first Nest's right input:

```
Start
  --> CollectionState("users", 0)
  --> CollectionState("posts", 0)
  --> CollectionState("profiles", 0)

Read("users", columns=[*]) --> CollectionState("users", 0)

Read("posts:popular", columns=[*], where=[views > 150])
  --FilterData(users.id -> posts.userId)--> Read("users")
  --> CollectionState("posts", 0)

Aggregate("posts", fn=count, groupBy=[userId])
  --FilterData(users.id -> posts.userId)--> Read("users")
  --> CollectionState("posts", 0)

Combine(rightKeys=[userId])
  --BranchData(name="popular", kind=rows)--> Read("posts:popular")
  --BranchData(name="totalCount", kind=scalar)--> Aggregate

Nest(leftKeys=[id], rightKeys=[userId], field="posts", arity=scalar)
  --> Read("users")
  --> Combine

Read("profiles", columns=[*]) --FilterData(users.id -> profiles.userId)--> Read("users")
Read("profiles") --> CollectionState("profiles", 0)

Nest(leftKeys=[id], rightKeys=[userId], field="profile")
  --> Nest("posts")    // result of first Nest (users-with-posts)
  --> Read("profiles")

Return --> Nest("profile")
Return --> CollectionState("users", 0)
Return --> CollectionState("posts", 0)
Return --> CollectionState("profiles", 0)
```

**Example: `db.users.create({ id: 1, name: 'Alice', email: 'alice@example.com' })`**

Create produces PK output. The Read-after-write connects via FilterData to fetch the full row.

```
Start
  --> CollectionState("users", 0)

Create("users", data={id:1, name:'Alice', email:'alice@example.com'})
  --> CollectionState("users", 0)

CollectionState("users", 1) --> Create("users")

Read("users", columns=[*])
  --FilterData(users.id -> users.id)--> Create("users")
  --> CollectionState("users", 1)

Return --> Read("users")
Return --> CollectionState("users", 1)
```

**Example: `db.users.where({ id: 1 }).update({ name: 'Bob' })`**

Read-before-update captures matching PKs. The Update receives those PKs via FilterData. The Read-after-update fetches the result, connected to the first Read via FilterData.

```
Start
  --> CollectionState("users", 0)

Read("users", columns=[id], where=[id = 1])                    // (A) filter read
  --> CollectionState("users", 0)

Update("users", data={name:'Bob'}, where=[id = 1])
  --FilterData(users.id -> users.id)--> Read("users")           // (A)
  --> CollectionState("users", 0)

CollectionState("users", 1) --> Update("users")

Read("users", columns=[*])                                      // (B) result read
  --FilterData(users.id -> users.id)--> Read("users")           // (A)
  --> CollectionState("users", 1)

Return --> Read("users")                                         // (B)
Return --> CollectionState("users", 1)
```

**Example: `db.users.where({ id: 1 }).delete()`**

Delete with Read-before-delete. The Read captures rows before removal. The Delete receives those PKs via FilterData, pinning it to the exact rows found. Both share the same CollectionState input.

```
Start
  --> CollectionState("users", 0)

Read("users", columns=[*], where=[id = 1]) --> CollectionState("users", 0)

Delete("users", where=[id = 1])
  --FilterData(users.id -> users.id)--> Read("users")
  --> CollectionState("users", 0)

CollectionState("users", 1) --> Delete("users")

Return --> Read("users")
Return --> CollectionState("users", 1)
```

**Example: `db.users.upsert({ create: { id: 1, name: 'Alice', email: 'a@b.com' }, update: { name: 'Alice' } })`**

Modeled as a Create node with `onConflict` config (resolved decision #3). The Read-after-write connects via FilterData to the Create's PK output.

```
Start
  --> CollectionState("users", 0)

Create("users", data={id:1, name:'Alice', email:'a@b.com'},
       onConflict={columns:[id], update:{name:'Alice'}})
  --> CollectionState("users", 0)

CollectionState("users", 1) --> Create("users")

Read("users", columns=[*])
  --FilterData(users.id -> users.id)--> Create("users")
  --> CollectionState("users", 1)

Return --> Read("users")
Return --> CollectionState("users", 1)
```

**Example: `db.users.include('posts').create({ id: 1, name: 'Alice', email: 'a@b.com', posts: p => p.create([{ id: 10, title: 'Post 1' }, { id: 11, title: 'Post 2' }]) })`**

Nested create on a child-owned (1:N) relation. The Read-after-write of users connects to the Create via FilterData and serves triple duty: (1) provides the return data for the parent, (2) provides PK values for child creates via PayloadData, and (3) serves as the Nest's left input. The Read-after-write of posts also connects via FilterData to its Create. This plan has 2 write nodes → automatic transaction.

```
Start
  --> CollectionState("users", 0)
  --> CollectionState("posts", 0)

Create("users", data={id:1, name:'Alice', email:'a@b.com'})
  --> CollectionState("users", 0)

CollectionState("users", 1) --> Create("users")

Read("users", columns=[*])
  --FilterData(users.id -> users.id)--> Create("users")
  --> CollectionState("users", 1)

Create("posts", data=[{id:10, title:'Post 1'}, {id:11, title:'Post 2'}])
  --PayloadData(users.id -> posts.userId)--> Read("users")
  --> CollectionState("posts", 0)

CollectionState("posts", 1) --> Create("posts")

Read("posts", columns=[*])
  --FilterData(posts.id -> posts.id)--> Create("posts")
  --> CollectionState("posts", 1)

Nest(leftKeys=[id], rightKeys=[userId], field="posts")
  --> Read("users")
  --> Read("posts")

Return --> Nest
Return --> CollectionState("users", 1)
Return --> CollectionState("posts", 1)
```

**Example: `db.posts.create({ id: 10, title: 'Post 1', author: a => a.create({ id: 1, name: 'Alice', email: 'a@b.com' }) })`**

Nested create on a parent-owned (N:1) relation. The related record must be created **first** so its PK can be copied into the main record's FK. The Read-after-write of users (via FilterData from Create) provides the PK via PayloadData to the outer Create.

```
Start
  --> CollectionState("users", 0)
  --> CollectionState("posts", 0)

Create("users", data={id:1, name:'Alice', email:'a@b.com'})
  --> CollectionState("users", 0)

CollectionState("users", 1) --> Create("users")

Read("users", columns=[id])
  --FilterData(users.id -> users.id)--> Create("users")
  --> CollectionState("users", 1)

Create("posts", data={id:10, title:'Post 1'})
  --PayloadData(users.id -> posts.userId)--> Read("users")
  --> CollectionState("posts", 0)

CollectionState("posts", 1) --> Create("posts")

Read("posts", columns=[*])
  --FilterData(posts.id -> posts.id)--> Create("posts")
  --> CollectionState("posts", 1)

Return --> Read("posts")
Return --> CollectionState("users", 1)
Return --> CollectionState("posts", 1)
```

**Example: `db.posts.create({ id: 10, title: 'Post 1', author: a => a.connect({ id: 1 }) })`**

Connect on a parent-owned (N:1) relation. A lookup Read finds the related row by criterion, then its PK is copied into the main record's FK via PayloadData. No Read-after-write needed for the connect lookup — it's already a Read. The Read-after-write of posts connects via FilterData to the Create.

```
Start
  --> CollectionState("users", 0)
  --> CollectionState("posts", 0)

Read("users", where=[id = 1], columns=[id]) --> CollectionState("users", 0)

Create("posts", data={id:10, title:'Post 1'})
  --PayloadData(users.id -> posts.userId)--> Read("users")
  --> CollectionState("posts", 0)

CollectionState("posts", 1) --> Create("posts")

Read("posts", columns=[*])
  --FilterData(posts.id -> posts.id)--> Create("posts")
  --> CollectionState("posts", 1)

Return --> Read("posts")
Return --> CollectionState("users", 0)
Return --> CollectionState("posts", 1)
```

**Example: `db.users.create({ id: 1, name: 'Alice', email: 'a@b.com', posts: p => p.connect([{ id: 10 }]) })`**

Connect on a child-owned (1:N) relation. The Read-after-write of users (via FilterData from Create) provides the parent PK. The Update sets the child's FK to the parent's PK via PayloadData. The Update's static data is empty — the FK value comes dynamically from the PayloadData edge at execution time.

```
Start
  --> CollectionState("users", 0)
  --> CollectionState("posts", 0)

Create("users", data={id:1, name:'Alice', email:'a@b.com'})
  --> CollectionState("users", 0)

CollectionState("users", 1) --> Create("users")

Read("users", columns=[*])
  --FilterData(users.id -> users.id)--> Create("users")
  --> CollectionState("users", 1)

Update("posts", data={}, where=[id = 10])
  --PayloadData(users.id -> posts.userId)--> Read("users")
  --> CollectionState("posts", 0)

CollectionState("posts", 1) --> Update("posts")

Return --> Read("users")
Return --> CollectionState("users", 1)
Return --> CollectionState("posts", 1)
```

**Example: `db.users.where({ id: 1 }).update({ posts: p => p.disconnect([{ id: 11 }]) })`**

Disconnect on a child-owned (1:N) relation. The parent Update follows the full Read → FilterData → Update → Read pattern. The Read-after-update (B) provides the parent PK for scoping the child disconnect. Uses FilterData (not PayloadData) on the child Update because the parent's PK scopes which children to disconnect.

```
Start
  --> CollectionState("users", 0)
  --> CollectionState("posts", 0)

Read("users", columns=[id], where=[id = 1])                    // (A) filter read
  --> CollectionState("users", 0)

Update("users", data={}, where=[id = 1])
  --FilterData(users.id -> users.id)--> Read("users")           // (A)
  --> CollectionState("users", 0)

CollectionState("users", 1) --> Update("users")

Read("users", columns=[*])                                      // (B) result read
  --FilterData(users.id -> users.id)--> Read("users")           // (A)
  --> CollectionState("users", 1)

Update("posts", data={userId: null}, where=[id = 11])
  --FilterData(users.id -> posts.userId)--> Read("users")       // (B)
  --> CollectionState("posts", 0)

CollectionState("posts", 1) --> Update("posts")

Return --> Read("users")                                         // (B)
Return --> CollectionState("users", 1)
Return --> CollectionState("posts", 1)
```

**Example: `db.users.where({ id: 1 }).include('posts').update({ name: 'Updated' })`**

Write with include. The Update follows the full Read → FilterData → Update → Read pattern. The Read-after-update (B) serves as both the Nest's left input and the data source for include FilterData.

```
Start
  --> CollectionState("users", 0)
  --> CollectionState("posts", 0)

Read("users", columns=[id], where=[id = 1])                    // (A) filter read
  --> CollectionState("users", 0)

Update("users", data={name:'Updated'}, where=[id = 1])
  --FilterData(users.id -> users.id)--> Read("users")           // (A)
  --> CollectionState("users", 0)

CollectionState("users", 1) --> Update("users")

Read("users", columns=[*])                                      // (B) result read
  --FilterData(users.id -> users.id)--> Read("users")           // (A)
  --> CollectionState("users", 1)

Read("posts", columns=[*])
  --FilterData(users.id -> posts.userId)--> Read("users")       // (B)
Read("posts") --> CollectionState("posts", 0)

Nest(leftKeys=[id], rightKeys=[userId], field="posts")
  --> Read("users")                                              // (B)
  --> Read("posts")

Return --> Nest
Return --> CollectionState("users", 1)
Return --> CollectionState("posts", 0)
```

### Optimization Passes

Each pass inspects the graph and rewrites it based on capabilities:

| Pass | Capability Required | Transformation |
|------|-------------------|----------------|
| **Lateral Join Collapse** | `lateral` + `jsonAgg` | Collapse Read + FilterData + Nest into a single Read with LATERAL JOIN. Pattern: Nest's right input is a Read connected to Nest's left input via FilterData. Rewrites to a single Read with a lateral subquery using `json_agg` to produce the nested array. |
| **Lateral Aggregate Collapse** | `lateral` | Collapse Aggregate + FilterData + Nest into a single Read with LATERAL subquery. Pattern: Nest's right input is an Aggregate connected to Nest's left input via FilterData. The aggregation function moves inside the lateral subquery; the Aggregate's `groupBy` is dropped (lateral correlation makes per-parent scoping implicit). The lateral subquery returns a scalar, not `json_agg`. |
| **Create RETURNING Collapse** | `returning` | Pattern: Create → CollectionState(N+1) → Read-after-write, where Read connects to Create via FilterData on PK. Collapse into a single Create-with-RETURNING. The Read is eliminated; edges that pointed to it are rewritten to point to the Create. |
| **Update RETURNING Collapse** | `returning` | Pattern: Read-before-update(A) → Update (FilterData from A) → CollectionState(N+1) → Read-after-update(B) (FilterData from A). Collapse into a single Update-with-RETURNING. Both Reads (A and B) are eliminated; the Update retains its WHERE clause and gains returning columns. Edges that pointed to either Read are rewritten to point to the Update. |
| **Delete RETURNING Collapse** | `returning` | Pattern: Read-before-delete → Delete (connected via FilterData on PK from Read), both sharing the same CollectionState input. Collapse into a single Delete-with-RETURNING. The Read is eliminated; edges that pointed to it are rewritten to point to the Delete. |
| **CTE Combine** | `cte` | Replace Combine node backed by multiple Reads with a single Read using CTEs |
| **Read Deduplication** | (none) | Merge two Read nodes targeting the same collection with the same CollectionState dependency **and identical non-projection parameters** (filters, ordering, limit/offset). Filter comparison uses structural equality (same AST shape, values, and order). When two Reads merge, all edges pointing to the eliminated Read are rewritten to point to the surviving Read. Selected column sets are unioned. |
| **Dead Code Elimination** | (none) | Remove nodes whose results are not consumed by any other node (except Return) |

Combine is transparent to optimization passes. Passes inspect the individual branch Read/Aggregate nodes directly. Combine itself is never collapsed or rewritten. Neither lateral join collapse nor lateral aggregate collapse apply to Combine branches (matching current behavior where `combine()` forces multi-query execution).

Passes run in a defined order. Idempotency is not guaranteed.

### Execution Model

After optimization, the graph is executed as follows:

1. **Scheduling**: Nodes are topologically sorted by their dependency edges and executed sequentially, one at a time, in dependency order. The graph is acyclic by construction.

2. **Data flow**: All nodes produce `AsyncIterableIterator<Row>` as output. A `ResultMap` holds the output of each executed node. When a node executes, it reads its dependencies' results from this map. Each node writes its own result to the map upon completion.

3. **Materialization**: The executor **materializes** (collects an async iterator into an array) a node's output when any downstream consumer requires buffered access:
   - **FilterData / PayloadData targets**: The consumer must collect the parent's rows to extract column values for `WHERE ... IN (...)` or payload injection. The parent's output is materialized.
   - **Nest right (child) input**: Nest buffers the right side into a key-indexed `Map<KeyTuple, Row[]>` for per-parent lookup. The right child's output is materialized.
   - **Combine branch inputs**: Combine must group all branch results by `rightKeys`. All branch outputs are materialized.
   - **Multiple consumers**: If more than one downstream node reads from the same source, the source is materialized (an iterator can only be consumed once).

   Nodes whose output feeds **only** into Nest as the left (parent) input — and has no other consumers — **stream**: Nest iterates over the left side lazily, yielding assembled rows one at a time.

   In practice, most intermediate nodes are materialized (reads that feed both FilterData and NestParent, writes that feed PayloadData). The streaming path matters most for the **outermost parent Read → Nest → Return** chain, where large result sets avoid full buffering.

4. **Empty parent short-circuit**: When a node's materialized output is an empty array, any downstream node connected via a FilterData edge skips execution and produces an empty iterator. This avoids issuing queries with empty `WHERE ... IN ()` clauses.

5. **Combine execution**: Combine materializes all N branch results (connected via BranchData edges), then yields one row per unique `rightKeys` value as an `AsyncIterableIterator`:
   1. **Group**: For each branch, group its result rows by the `rightKeys` columns, producing `Map<KeyTuple, Row[]>` per branch. This is necessary because `rows` branches can have multiple rows per key (e.g., multiple popular posts for one user).
   2. **Union keys**: Collect the set of all unique `rightKeys` tuples across all branches. This is necessary because different branches may have different filters, producing different key sets (e.g., branch A with `views > 150` has keys `{1, 2}` while branch B with `views > 1000` has only `{2}`).
   3. **Assemble**: For each unique key tuple, produce one output row containing:
      - The `rightKeys` columns (preserved for downstream Nest matching)
      - For each `kind: 'rows'` branch: an array of matching rows (with `rightKeys` columns stripped)
      - For each `kind: 'scalar'` branch: the single value from the matching row's non-key column. If no matching row exists, `null`.
   4. **Missing keys**: If a branch has no rows for a given key tuple, `rows` branches produce `[]` and `scalar` branches produce `null`.

   **Example**: Given `combine({ popular: posts.where(views > 150), totalCount: posts.count() })` for users `{1, 2}`:
   - `popular` branch result: `[{userId: 1, id: 10, views: 200}, {userId: 1, id: 11, views: 300}, {userId: 2, id: 12, views: 500}]`
   - `totalCount` branch result: `[{userId: 1, count: 2}, {userId: 2, count: 2}]`
   - After Group: `popular` → `{1: [row10, row11], 2: [row12]}`, `totalCount` → `{1: [{count: 2}], 2: [{count: 2}]}`
   - After Union keys: `{1, 2}`
   - After Assemble: `[{userId: 1, popular: [{id: 10, views: 200}, {id: 11, views: 300}], totalCount: 2}, {userId: 2, popular: [{id: 12, views: 500}], totalCount: 2}]`

6. **Nest execution**: Nest materializes the right (child) input into a `Map<KeyTuple, Row[]>` index, then **streams** over the left (parent) input. For each parent row, it looks up matching children by key and yields the assembled row with the nested field attached. This means Nest produces an `AsyncIterableIterator` without buffering the parent side.

7. **Sequential execution**: Independent branches (e.g., sibling includes) execute sequentially.

### Transaction Heuristic

During execution, if the finalized graph contains more than one write node (Create/Update/Delete), the executor automatically wraps the entire plan in a database transaction.

## Requirements

### Functional Requirements

1. **Graph construction**: Collection API methods produce an SSA graph instead of flat state
2. **CollectionState ordering**: Write ordering is correctly tracked via CollectionState nodes with monotonic counters per collection
3. **Pessimistic default**: Graph assumes no capabilities; all includes use separate Reads + FilterData + Join
4. **Optimization passes**: At minimum: lateral join collapse, lateral aggregate collapse, create/update/delete RETURNING collapse, read deduplication, dead code elimination
5. **Terminal execution**: `.all()`, `.first()`, `.create()` etc. finalize graph, optimize, and execute
6. **Backward compatibility**: Public Collection API surface remains unchanged
7. **Include support**: Nested includes (multi-level) correctly represented as chains of Read + FilterData + Nest nodes
8. **Mutation support**: Create, update, delete, upsert operations represented as graph nodes with correct CollectionState dependencies
9. **Combine support**: `combine()` in include refinements maps to Combine nodes (non-terminal)
10. **Aggregation support**: Scalar aggregations (count, sum, avg, min, max) in includes map to Aggregate nodes that depend on Read nodes
11. **Transaction heuristic**: Plans with >1 write node are automatically executed within a transaction
12. **DOT output**: Debug helper renders the graph in Graphviz DOT format for visualization and snapshot testing

### Non-goals

- **Query result caching** - We cache plans (structure), not results (data)
- **Custom user-defined optimization passes** - Plugin API for passes is phase 2
- **Distributed query planning** - Single-database target only
- **Migration plane integration** - This is runtime-only
- **Plan caching** - Storing and reusing optimized plans across invocations is deferred

## Acceptance Criteria

### Graph Construction
- [ ] Collection methods produce nodes and edges in the SSA graph
- [ ] CollectionState nodes correctly track write ordering per collection
- [ ] Nested includes produce chains of Read -> FilterData -> Nest
- [ ] Mutations produce Write nodes with correct CollectionState dependencies
- [ ] `combine()` produces Combine + Nest node pairs: Combine groups branches by `rightKeys`, Nest attaches with scalar arity
- [ ] Aggregate nodes are self-contained SQL nodes with their own FilterData and CollectionState edges
- [ ] Upsert is modeled as a Create node with `onConflict` config

### Optimization Passes
- [ ] Lateral join collapse merges Read + FilterData + Nest into single Read with `json_agg` lateral subquery when `lateral` + `jsonAgg` capabilities present
- [ ] Lateral aggregate collapse merges Aggregate + FilterData + Nest into single Read with scalar lateral subquery when `lateral` capability present (drops Aggregate's `groupBy`)
- [ ] Create RETURNING collapse merges Create + Read-after-write (FilterData on PK) into single Create-with-RETURNING when `returning` capability present
- [ ] Update RETURNING collapse merges Read-before-update + Update + Read-after-update triple into single Update-with-RETURNING when `returning` capability present
- [ ] Delete RETURNING collapse merges Read-before-delete + Delete into single Delete-with-RETURNING when `returning` capability present
- [ ] Read deduplication merges reads with identical collection, CollectionState, filters, ordering, and limit/offset - unioning only selected columns
- [ ] Dead code elimination removes nodes not reachable from Return
- [ ] Optimizations preserve semantic equivalence (same results as unoptimized plan)

### Execution
- [ ] Terminal methods finalize, optimize, and execute the graph
- [ ] Results are identical to current ORM output for all supported operations
- [ ] Plans with >1 write node execute within a transaction

### Debug & Testing
- [ ] DOT renderer produces valid Graphviz output for any graph
- [ ] Planning tests use DOT snapshot files (separate `.dot` files alongside test files)

### Backward Compatibility
- [ ] All existing `sql-orm-client` tests pass without modification
- [ ] Public API types remain unchanged

## Other Considerations

### Security

No new attack surface. SQL generation still goes through parameterized queries via Kysely.

### Observability

- Debug mode to dump SSA graph before and after optimization as DOT
- Optimization pass timing available in debug output

## References

- [Current Collection implementation](packages/3-extensions/sql-orm-client/src/collection.ts)
- [Current dispatch logic](packages/3-extensions/sql-orm-client/src/collection-dispatch.ts)
- [Include strategy selection](packages/3-extensions/sql-orm-client/src/include-strategy.ts)
- [Mutation executor](packages/3-extensions/sql-orm-client/src/mutation-executor.ts)
- [Capability gating](packages/3-extensions/sql-orm-client/src/collection-contract.ts)
- SSA form: [Wikipedia - Static single-assignment form](https://en.wikipedia.org/wiki/Static_single_assignment_form)
- Sea of Nodes: [Click & Paleczny, 1995 - "A Simple Graph-Based Intermediate Representation"](https://www.oracle.com/technetwork/java/javase/tech/c2-ir95-150110.pdf)

## Resolved Decisions

1. **Aggregations**: Separate `Aggregate` node type — a self-contained SQL-generating node (not dependent on a Read). Carries collection name, aggregation function, filters, and optional `groupBy` columns. When inside an include, groupBy is set to the join key columns of the enclosing relationship (per-parent results). For top-level aggregates, groupBy is absent (single scalar result). Has its own FilterData and CollectionState edges
2. **Nested mutations**: Expanded into separate Write nodes connected via `PayloadData` or `FilterData` edges, with their own CollectionState dependencies
3. **Upsert**: Modeled as a `Create` node with optional `onConflict` config
4. **Combine**: Groups N named branch results by `rightKeys` and outputs Nest-compatible rows (one per parent key value, carrying join key + branch values). Nest consumes with scalar arity — no special case in Nest. Combine carries only `rightKeys`; branch inputs are connected via BranchData edges (carrying branch name and kind). FilterData edges wire from parent Read to each branch Read directly. Only valid inside include refinements for to-many relations. Combine execution algorithm: group each branch by rightKeys, union all key tuples, assemble one output row per key with `rows` branches as arrays and `scalar` branches unwrapped.
5. **Nest (formerly Join)**: Produces nested/grouped output, not flat rows. Named "Nest" to reflect parent-child nesting semantics.
6. **Graph scope**: Each terminal call creates an independent graph — no session-level accumulation
7. **CollectionState for nested reads**: Every read of a collection depends on its CollectionState, including reads triggered by includes
8. **Multi-include chaining**: Multiple includes produce chained Nest nodes — second Nest takes result of first as its left input

9. **Cross-collection write state**: Only the directly written collection advances its counter. Reading collection B to filter a write to collection A does not advance B's state.
10. **Aggregate + lateral**: Separate pass (Lateral Aggregate Collapse) — different graph topology (Aggregate with FilterData → Nest vs Read with FilterData → Nest), different SQL generation (scalar aggregation vs `json_agg`), and the Aggregate's `groupBy` is dropped since lateral correlation provides implicit per-parent scoping. Requires only `lateral` capability (not `jsonAgg`).
11. **Optimization pass ordering**: Determined empirically during implementation
12. **Execution scheduling**: Topological sort, sequential execution, `ResultMap` (`Map<NodeId, MaterializedRows | NodeOutput>`) for data flow with lazy materialization
13. **Empty parent handling**: Skip execution (short-circuit with empty results) when parent Read returns zero rows
14. **Node output arity**: All nodes produce `AsyncIterableIterator<Row>`. The executor materializes a node's output only when a downstream consumer requires buffered access (FilterData/PayloadData targets, Nest right child, Combine branches, multiple consumers). Nest is arity-aware and unwraps scalars (e.g., Aggregate results)
15. **Multi-level nesting**: Recursive subgraph — inner Read has FilterData from outer Read, Nest nodes chain from inner to outer
16. **RETURNING collapse — three separate passes**: (a) **Create RETURNING**: matches Create → CollectionState → Read where Read has FilterData on PK from Create. (b) **Update RETURNING**: matches Read(A) → Update (FilterData from A) → CollectionState → Read(B) (FilterData from A); eliminates both Reads. (c) **Delete RETURNING**: matches Read → Delete (FilterData from Read on PK) where both share CollectionState input. In all three, edges to eliminated Reads are rewritten to point to the Write-with-RETURNING node
17. **Read deduplication mechanics**: Structural equality of filter ASTs, edge rewriting to surviving Read, column set union
18. **DOT snapshots**: Separate `.dot` files alongside test files
19. **Sequential execution**: All nodes execute sequentially in topological order
20. **Cursor pagination**: Cursor is compiled into filter expressions during graph construction (e.g., `after: {id: 5}` with `orderBy: {id: 'asc'}` becomes a `WHERE id > 5` filter). No separate field on Read, no special node type, edge, or optimization pass required.
21. **GroupedCollection**: groupBy/having/aggregate are optional properties on Read nodes. `.groupBy().aggregate()` is a terminal that produces a single-node graph (`Start → CollectionState → Read(groupBy) → Return`). Since groupBy is forbidden in include refinements and `.aggregate()` is a terminal, the grouped Read is always isolated — no optimization passes apply. If groupBy ever becomes non-terminal, a separate GroupedRead node type can be introduced.

22. **Connect**: Modeled as a standard Read node (lookup by criterion) feeding into the Write node via PayloadData. No special node type — the lookup Read has its own CollectionState dependency like any other Read. For parent-owned (N:1) connect, the Read finds the related row and its PK flows via PayloadData into the main Write's FK columns. For child-owned (1:N) connect, the main Write executes first, then an Update of the child collection sets the FK, with the parent's PK flowing via PayloadData.
23. **Disconnect**: For parent-owned (N:1), disconnect is absorbed into the parent Write's data (FK columns set to null) — no separate node. For child-owned (1:N), disconnect produces a separate Update node that sets the child's FK to null. The parent's PK flows via FilterData to scope which children to disconnect (WHERE FK = parent.id AND criterion).
24. **Nested mutation execution order**: Parent-owned (N:1) relation mutations execute **before** the main Write (they provide FK values the main Write needs). Child-owned (1:N) relation mutations execute **after** the main Write (they need the main Write's PK). This ordering is encoded structurally in the graph via data dependency edges — no explicit ordering metadata needed.

## Open Questions

None.
