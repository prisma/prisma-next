# Target Resolution for `migration status`

## Problem

`migration status` needs a **target hash** to render the spine — the path from the root (∅) through the graph that represents "what `migration apply` would do." Today it computes this target via `findLeaf(graph)`, which throws `MIGRATION.AMBIGUOUS_LEAF` when the graph has multiple leaves (divergent branches). This is the wrong behavior for `status`: it should never hard-fail on a valid graph shape.

The deeper issue is that **target resolution differs between `migration status` and `migration apply`**, and neither has a principled default for all graph shapes.

## How each command resolves its target today

### `migration apply`

```
destination = options.ref
  ? resolveRef(refs, refName)          // explicit ref
  : readContractEnvelope().storageHash // current contract hash
```

Apply never calls `findLeaf`. It targets the contract hash by default, or a ref hash if `--ref` is specified. If the contract hash isn't reachable from the DB marker, apply fails with a path error.

### `migration status`

```
target = activeRefHash ?? findLeaf(graph)
```

Status falls back to `findLeaf` when no ref is active. `findLeaf` throws on divergent graphs (multiple leaves), which propagates as a hard error to the user. This is the problematic path.

## Graph shapes and their target resolution challenges

### 1. Linear (single path, single leaf)

```
∅ → A → B → C
```

Trivial. One leaf, one path. `findLeaf` returns `C`. Contract hash is (usually) `C`. No ambiguity.

### 2. Diamond / convergent (multiple paths, single leaf)

```
∅ → A → B → D
         ↘ C ↗
```

One leaf (`D`), multiple paths. `findLeaf` returns `D`. Path choice is cosmetic — BFS picks one deterministically. No ambiguity in target; only in route.

### 3. Divergent (branches at the end, multiple leaves)

```
∅ → A → B → C
         ↘ D
```

Two leaves (`C` and `D`). `findLeaf` throws `AMBIGUOUS_LEAF`. This is the problem case.

**Sub-cases for offline status:**

- **Contract hash == `C`**: There is a meaningful target — `C` is the contract, so the spine is `∅ → A → B → C`. But we only know this if we check the contract hash against the graph.
- **Contract hash == `D`**: Same, but the other branch.
- **Contract hash == `E` (not in graph)**: Neither leaf matches the contract. The graph is divergent and the contract is ahead of both branches. No principled spine target.
- **Contract hash == `B`**: Contract matches a non-leaf node. Both branches are "ahead" of the contract. No principled spine target.

**Sub-cases for online status (with marker):**

- **Marker at `C`**: The DB is on the `C` branch. Spine = `∅ → A → B → C`. The other branch (`D`) is off-spine. This is unambiguous because the marker anchors us.
- **Marker at `B`**: The DB is at the fork point. Two possible apply paths (`B→C` and `B→D`). Need the contract hash or a ref to disambiguate.
- **Marker at `A`**: Entire graph is "pending." Still need to pick a branch.

### 4. No migrations (empty graph)

```
∅
```

No target needed. Display "no migrations found" with contract-ahead diagnostic if contract has changed.

### 5. Contract not in graph (contract ahead)

```
∅ → A → B    (contract hash = X, not in graph)
```

One leaf, but the contract is ahead. Today we show the spine to `B` and a detached node for the contract. This works regardless of leaf count — the issue is only about which leaf to pick as the "graph target."

## Resolution

The contract hash is the right default target. `migration apply` already uses it, and the whole point of `migration status` is to preview what `apply` would do.

Target resolution order:

1. **`--ref` flag active** → ref hash
2. **Contract hash is a node in the graph** → contract hash
3. **Contract hash is not in the graph** (contract ahead) → fall back to `findReachableLeaves`:
   - **Single leaf** → use it; detached contract node shows the gap
   - **Multiple leaves** → ambiguous; fall back to full-graph view with `MIGRATION.DIVERGED` diagnostic
4. **Contract hash is `∅`** → no meaningful target; show "no migrations found"

### Why the multi-leaf fallback is still needed

When the contract hash isn't in the graph (the user changed their schema and emitted a new contract, but hasn't run `migration plan` yet), we can't route to it. We need a graph-internal target. If there's one leaf, it's unambiguous — it's the node that `migration plan` would use as its `from` hash.

If there are multiple leaves, we genuinely don't know which branch the user intends to continue from. `migration plan` would face the same question. Showing the full graph with a diagnostic is the honest answer:

```
⚠ Migration graph has diverged — multiple branches with no default target
  Use '--ref <name>' to select a branch, or 'migration ref set <name> <hash>' to create one
```

### Implementation sketch

In `executeMigrationStatusCommand`, replace the `findLeaf` try/catch:

```typescript
let targetHash: string | undefined;

if (activeRefHash) {
  targetHash = activeRefHash;
} else if (graph.nodes.has(contractHash)) {
  targetHash = contractHash;
} else {
  const leaves = findReachableLeaves(graph, EMPTY_CONTRACT_HASH);
  if (leaves.length === 1) {
    targetHash = leaves[0];
  } else {
    // Ambiguous: multiple leaves, contract not in graph, no ref.
    // targetHash stays undefined — triggers full-graph fallback.
    diagnostics.push({
      code: 'MIGRATION.DIVERGED',
      severity: 'warn',
      message: 'Migration graph has diverged — multiple branches with no default target',
      hints: [
        "Use '--ref <name>' to select a branch",
        "Or 'migration ref set <name> <hash>' to create one",
      ],
    });
  }
}
```

When `targetHash` is undefined, the action handler renders the full graph (no spine), shows the diagnostic, and skips the applied/pending summary (meaningless without a target).

## Long-term fix: implicit default ref

The root cause is that there's no default target. `migration apply` sidesteps this by using the contract hash, but that only works when the contract hash is reachable from the marker.

An implicit default ref (e.g. `local`) would:

- Always point to a concrete hash (set by `migration plan` when it creates a new migration)
- Give `migration status` a target in all cases (online or offline)
- Give `migration apply` a consistent default (apply to `local` ref target)
- Make the spine view always well-defined

This is a product decision — it changes the mental model from "apply to contract" to "apply to ref." It needs PM input and is out of scope for the current graph renderer work, but it's the clean solution.

### How `migration plan` would maintain the implicit ref

When `migration plan` creates a new migration (say `∅ → A → B`, creating `B→C`):
- It writes the migration package to disk
- It also writes `refs.json` with `{ "local": "<hash-of-C>" }`
- This gives `status` and `apply` a target without any manual `ref set` step

### Open questions for the implicit ref approach

- What's the right name? `local`? `head`? `default`?
- Should it be visible in `refs.json` or tracked separately?
- What happens when two developers both `plan` from the same starting point? They'd each set `local` to their branch's leaf, but only one `refs.json` makes it into version control. The merge conflict in `refs.json` would surface the divergence.
- Should `migration apply` default to the implicit ref or to the contract hash? If the ref, then apply behavior changes. If the contract hash, then apply and status disagree on what "default target" means.

## Relationship to `resolveDisplayChain`

`resolveDisplayChain` handles the question of *how to route* through the graph once a target is known. It's responsible for:
- Routing through the marker (online): `∅ → marker → target`
- Falling back to `∅ → target` (offline or marker not reachable)
- Handling marker-ahead-of-target (inverse path)

It does *not* handle target selection — that's done before it's called.

The target resolution problem described here is upstream of `resolveDisplayChain`. Once resolved, `resolveDisplayChain` still handles routing correctly. But if the target resolution moves to using `findReachableLeaves` + contract hash + fallback, `resolveDisplayChain` may need to handle the "no target" case (where we fall back to full-graph view and skip the chain/entry logic entirely).

## Affected code

| File | What changes |
|---|---|
| `cli/src/commands/migration-status.ts` | Replace `findLeaf` call with `findReachableLeaves` + contract-hash check + fallback |
| `cli/src/commands/migration-status.ts` | Action handler: when no target, render full graph + diagnostic |
| `migration-tools/src/dag.ts` | `findReachableLeaves` already exported; no changes needed |
| `cli/src/utils/formatters/graph-migration-mapper.ts` | May need to handle undefined `spineTarget` in options |

## Decision log

| Decision | Status | Notes |
|---|---|---|
| Contract hash is the default target (same as `apply`) | **Decided** | The spine target is the contract hash. This is the primary target, not a fallback. |
| `findReachableLeaves` as secondary fallback | **Decided** | Only when contract hash is not in the graph. Single leaf → use it. Multiple → full-graph view. |
| Fall back to full-graph view when ambiguous | **Decided** | Shows all branches; user can decide |
| Emit `MIGRATION.DIVERGED` diagnostic | **Decided** | Guides user to use `--ref` |
| Drop `findLeaf` from `migration status` | **Decided** | `findLeaf` stays in `migration-tools` for other commands; `status` no longer calls it |
| Implicit default ref (`local`) | Deferred | Product decision, needs PM input. Would eliminate the multi-leaf ambiguity entirely. |
