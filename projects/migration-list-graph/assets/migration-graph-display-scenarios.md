# Migration Graph Display — Topology Scenarios

Design reference for terminal rendering of the migration graph.

## Why this is harder than `git log --graph`

Git's commit graph is a **DAG** (directed acyclic graph). Every edge is an implicit parent pointer, direction is always child→parent, and a topological sort trivially produces the display order. The `git log --graph` algorithm exploits all of this.

Migration graphs are **directed graphs that permit cycles**:

1. **Edges are directional and named**: each migration is a `from → to` edge with a `dirName`, labels, and ops. Direction matters — the runner applies an edge only when the DB marker equals `from`.
2. **Cycles are legal**: a rollback migration H2 → H1 creates a cycle (H1 → H2 → H1). BFS pathfinding handles cycles via visited-node tracking, but the display must show them.
3. **Parallel edges**: two edges with the same `(from, to)` but different ops are allowed with the `parallel-ok` label.
4. **A node can have multiple incoming edges**: unlike git where each commit has a unique identity, two different migration paths can target the same contract hash (convergence via rebase).

These properties mean we cannot simply topologically sort and render top-down. We need: explicit direction, back-edge connectors, and parallel edge handling.

### Migrations are the atomic element

In `git log --graph`, each line is a commit (a node), and the edges (parent pointers) are implicit connectors between them. We tried this same approach — one line per contract state — but it breaks down because:

- **Edges carry the important information**: migration name, labels, ops, direction. Contract hashes are opaque identifiers.
- **Direction is an edge property, not a node property**: putting direction on a node line conflates "which node is this" with "how did we get here," and gets tangled when a node has multiple incoming edges.
- **Cycles require showing edges explicitly**: when H2 has both a forward edge arriving (add-posts) and a back-edge departing (rollback-posts), you need separate lines for each.

The solution: **show contracts and migrations on separate lines.** Contracts are `*` nodes. Migrations are `│↑` (forward) or `│↓` (backward) edges. Each migration gets its own line with its own direction arrow. The arrow direction matches the physical direction in the vertical layout — `↑` goes toward the top (forward in time), `↓` goes toward the bottom (rollback).

```
*   def5678
│↑  2025-02-03T0905_add-posts
│↓  2025-02-03T0906_rollback-add-posts
*   abc1234
│↑  2025-01-15T1022_add-users
│↓  2025-01-15T1023_rollback-add-users
*   (empty)
```

Each `*` line is a contract state. Each `│↑` / `│↓` line is a migration edge with its direction. Reading bottom-to-top: from empty, `add-users` goes up to abc1234; `rollback-add-users` goes down to empty. From abc1234, `add-posts` goes up to def5678; `rollback-add-posts` goes down to abc1234.

### Node ordering (linearization)

The display is optimized for the user's primary question: **"what do I need to apply to get from where I am to where I want to be?"**

Ordering priority:

1. **Path from DB marker → contract target** (the action path). The contract target appears at the top; the DB marker is the midpoint; genesis is toward the bottom. This path occupies the primary (leftmost) column.
2. **Paths from named refs → genesis**. Refs are anchor points for the broader graph context. Nodes reachable from refs are ordered working backward from each ref toward genesis.
3. **Away from refs** for subgraphs disconnected from both the contract target and genesis. Traverse outward from the nearest ref.
4. **Chronological** (`createdAt` of first incoming edge) as the final tiebreaker for nodes not reachable from any anchor point.

Any edge whose `to` node appears *below* its `from` node in this ordering is classified as a **back-edge** and rendered with `↓` rather than `↑`. This is a rendering decision, not a semantic property of the migration.

## Conventions

**Layout:**

- Contract target at the top, genesis toward the bottom
- The action path (DB → target) occupies the leftmost column
- Branches appear as side columns to the right
- **Two kinds of lines**: contract nodes (`*`) and migration edges (`│↑`/`│↓`)
- Migrations are grouped under the contract node they depart FROM

**Contract node lines:**

- `*` — contract state (shows the hash)
- `◆` — contract state matching the current DB marker

**Migration edge lines:**

- `│↑` — forward migration (goes upward to the next contract)
- `│↓` — backward migration / rollback (goes downward to a previous contract)

**Branch connectors:**

- `│` — edge passing through vertically
- `/` `\` — branch / merge diagonals

---

## Part 1: Basic topologies

### 1. Empty graph

No migrations exist.

```
*   (empty database)
```

### 2. Single edge

∅ → H1. One migration from empty.

```
*   abc1234
│↑  2025-01-15T1022_add-users
*   (empty)
```

### 3. Linear chain

∅ → H1 → H2 → H3. The common case.

```
*   f03da82
│↑  2025-03-10T0900_add-comments
*   7e1b9a0
│↑  2025-02-03T0905_add-posts
*   abc1234
│↑  2025-01-15T1022_add-users
*   (empty)
```

### 4. Linear chain with rollbacks

Each migration has a corresponding rollback. Rollbacks are `↓` edges on the same contract node as their forward counterpart.

```
*   def5678
│↑  2025-02-03T0905_add-posts
│↓  2025-02-03T0906_rollback-add-posts
*   abc1234
│↑  2025-01-15T1022_add-users
│↓  2025-01-15T1023_rollback-add-users
*   (empty)
```

### 5. No genesis

Early migrations were squashed and pruned. The graph starts at a baseline node whose `from` hash is no longer present.

```
*   f03da82
│↑  2025-03-10T0900_add-comments
*   7e1b9a0
│↑  2025-02-03T0905_add-posts
*   abc1234
│↑  2025-01-15T1022_baseline-zero-to-2025-01
```

No `* (empty)` at the bottom — the chain just ends.

### 6. Branch (divergence)

H1 has two outgoing forward edges. The action path (DB → contract target) determines the left column.

```
*   7e1b9a0
│↑  2025-02-03T0905_add-posts
│ *   9c4f1e7
│ │↑  2025-02-10T0800_add-tags
│/
◆   abc1234
│↑  2025-01-15T1022_add-users
*   (empty)
```

### 7. Branch with continuation

Both branches continue growing after the fork.

```
*   f03da82
│↑  2025-03-10T0900_add-comments
*   7e1b9a0
│↑  2025-02-03T0905_add-posts
│ *   b82cc10
│ │↑  2025-03-20T0900_add-reactions
│/
◆   abc1234
│↑  2025-01-15T1022_add-users
*   (empty)
```

### 8. Convergence (diamond)

Classic diverge-then-converge. Two edges arrive at the same node.

```
*     d41a8c3
│↑    2025-03-01T1000_merge-schema
│\
│ *   9c4f1e7
│ │↑  2025-02-10T0800_add-tags
* │   7e1b9a0
│↑|   2025-02-03T0905_add-posts
│/
*   abc1234
│↑  2025-01-15T1022_add-users
*   (empty)
```

---

## Part 2: Cycles and back-edges

Each node appears **exactly once**. Rollbacks are `↓` edges grouped under the same contract node as the forward edges, making cycles visible at a glance.

### 9. Simple rollback cycle

H1 → H2 (add-posts), H2 → H1 (rollback-posts).

```
*   def5678
│↑  2025-02-03T0905_add-posts
│↓  2025-02-05T1000_rollback-add-posts
*   abc1234
│↑  2025-01-15T1022_add-users
*   (empty)
```

The `↓` on def5678 shows the rollback going downward to abc1234. The `↑` on abc1234 shows the forward migration going upward from below.

### 10. Multi-hop rollback

∅ → H1 → H2 → H3, then H3 → H1 (full rollback skipping H2).

```
*   ghi7890
│↑  2025-03-10T0900_add-comments
│↓  2025-03-12T0800_full-rollback (→ abc1234)
*   def5678
│↑  2025-02-03T0905_add-posts
*   abc1234
│↑  2025-01-15T1022_add-users
*   (empty)
```

The `(→ abc1234)` annotation names the target explicitly because the rollback skips def5678 (it doesn't go to the immediately adjacent node below).

### 11. Partial rollback then continue

∅ → H1 → H2 → H3, then H3 → H2 (rollback), then H2 → H4 (continue).

```
*   jkl1234
│↑  2025-03-20T0900_add-likes
│ *   ghi7890
│ │↑  2025-03-10T0900_add-comments
│ │↓  2025-03-12T0800_rollback-add-comments
│/
*   def5678
│↑  2025-02-03T0905_add-posts
*   abc1234
│↑  2025-01-15T1022_add-users
*   (empty)
```

ghi7890 is a dead end — its only departing edge is the `↓` rollback back to def5678. jkl1234 continues forward from def5678 on the main path.

---

## Part 3: Parallel edges

### 12. Parallel edges (same from → to, different ops)

Two migrations from the same source to the same target with different operations. Requires the `parallel-ok` label.

```
*   def5678
│↑  2025-02-03T0905_add-posts
│↑  2025-02-03T0906_add-posts-v2
*   abc1234
│↑  2025-01-15T1022_add-users
*   (empty)
```

Both `↑` edges depart from abc1234 and arrive at def5678. The runner's tie-breaking rules determine which is selected.

---

## Part 4: Baselines

### 13. Baseline (squash)

A baseline edge replaces the path ∅ → H1 → H2, creating a single ∅ → H2. It's just a regular edge.

```
*   f03da82
│↑  2025-03-10T0900_add-comments
*   7e1b9a0
│↑  2025-02-01T0800_baseline-zero-to-2025-02
*   (empty)
```

### 14. Baseline with archived edges visible

`--show-archived` displays the superseded edges dimmed.

```
*   f03da82
│↑  2025-03-10T0900_add-comments
*   7e1b9a0
│↑  2025-02-01T0800_baseline-zero-to-2025-02
│   · 2025-01-15T1022_add-users               (archived)
*   (empty)
```

### 15. Baseline alongside regular path

Both paths coexist — the baseline is just another forward edge from ∅.

```
*   f03da82
│↑  2025-03-10T0900_add-comments
*   7e1b9a0
│↑  2025-02-03T0905_add-posts
│↑  2025-02-01T0800_baseline-zero-to-2025-02
*   abc1234
│↑  2025-01-15T1022_add-users
*   (empty)
```

7e1b9a0 has two incoming forward paths: the regular chain via abc1234, and the baseline directly from ∅. Both `↑` edges appear on their respective source nodes. The runner selects based on the DB marker.

---

## Part 5: Status overlay

### 16. DB marker — fully applied

DB is at the contract target.

```
◆   f03da82
│↑  2025-03-10T0900_add-comments
*   abc1234
│↑  2025-01-15T1022_add-users
*   (empty)
```

### 17. DB marker — partially applied

DB is behind the target. Nodes above the marker are pending.

```
*   f03da82                                    (pending)
│↑  2025-03-10T0900_add-comments               (pending)
*   7e1b9a0                                    (pending)
│↑  2025-02-03T0905_add-posts                  (pending)
◆   abc1234                                    ← DB
│↑  2025-01-15T1022_add-users
*   (empty)
```

### 18. DB marker on a branch

DB is on a different branch from the action path.

```
*   f03da82
│↑  2025-03-10T0900_add-comments
│ ◆   9c4f1e7                                  ← DB
│ │↑  2025-02-10T0800_add-tags
│/
*   abc1234
│↑  2025-01-15T1022_add-users
*   (empty)
```

### 19. DB marker — drift

DB marker hash doesn't match any node in the graph.

```
*   f03da82
│↑  2025-03-10T0900_add-comments
*   abc1234
│↑  2025-01-15T1022_add-users
*   (empty)

⚠ Database marker 9f7a3b1 does not match any known contract state.
  The database may have drifted from the migration graph.
```

### 20. DB marker after rollback

DB followed ∅ → H1 → H2 → H1 (via rollback). DB marker is at H1.

```
*   def5678
│↑  2025-02-03T0905_add-posts
│↓  2025-02-05T1000_rollback-add-posts
◆   abc1234                                    ← DB
│↑  2025-01-15T1022_add-users
*   (empty)
```

### 21. Named refs (multi-environment)

```
*   f03da82                                     ref: production
│↑  2025-03-10T0900_add-comments
*   7e1b9a0                                     ref: staging
│↑  2025-02-03T0905_add-posts
*   abc1234
│↑  2025-01-15T1022_add-users
*   (empty)
```

### 22. Refs + DB marker combined

```
*   f03da82                         (pending)   ref: production
│↑  2025-03-10T0900_add-comments    (pending)
◆   7e1b9a0                        ← DB        ref: staging
│↑  2025-02-03T0905_add-posts
*   abc1234
│↑  2025-01-15T1022_add-users
*   (empty)
```

---

## Part 6: Diagnostics

### 23. Orphan edges

Edges not reachable from genesis, shown separately.

```
*   f03da82
│↑  2025-03-10T0900_add-comments
*   abc1234
│↑  2025-01-15T1022_add-users
*   (empty)

⚠ Orphan edges (not reachable from genesis):

  *   cc91fa2
  │↑  2025-02-20T1400_orphaned-migration
  *   44de017
```

### 24. Long chain (truncated)

```
*   f03da82
│↑  2025-06-10T0900_add-reactions
*   c44b1e9
│↑  2025-06-01T0800_add-likes
*   9a3fe02
│↑  2025-05-15T1400_add-comments
│
  ... 12 more migrations ...
│
*   abc1234
│↑  2025-01-15T1022_add-users
*   (empty)
```

---

## Open questions

1. **Multi-hop back-edge**: When a `↓` rollback skips intermediate nodes (scenario 10), we annotate with `(→ target-hash)` after the migration name. Is this clear, or should we draw a connector line through the intermediate nodes?
2. **Parallel edges vs convergence**: Scenario 12 shows parallel edges as multiple `↑` under the same source. Scenario 15 (baseline alongside regular) is similar. Should convergence (multiple paths arriving at the same node) look different from parallel edges (same from/to)?
3. **Action path without DB marker**: If no DB is connected, do we fall back to the contract target as the top anchor, or show the graph purely by ref ordering?
4. **Hash length**: 7 chars like git? Full hash with `--no-abbrev`?
5. **Color vs text**: Labels, markers, pending/applied state — distinguished purely by color, or also by text for accessibility?
