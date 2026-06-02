# Slice: Fix dropped node marker when a non-trunk node lands a ≥2-lane merge

## Problem

`prisma-next migration graph --tree` drops a contract node's `○` marker (and its
trailing pass-through lanes), emitting an orphaned hash row, when the node is the
landing point of a multi-lane merge **and** lands in a non-trunk lane (column ≥ 1).

Observed in the `showcase` fixture after planning a new migration
`935a023 → f660984` (which gave the branch contract `935a023` a second forward
child, so two lanes — `merge_bob → 83a1ded` and the new `→ f660984` — both want
`935a023`). The `935a023` node row renders as:

```
│ ├─╯ │ │ │
│               935a023            ← BROKEN: no ○ marker, lanes dropped
│ │↑  │ │ │     20260601T0725_bob_avatar  419c099 → 935a023
```

It should render the marker in the bob lane (column 1), e.g.:

```
│ ○   │ │ │     935a023
```

(The healthy pre-regression render had `│ ○ │ │ │     935a023`.)

## Root cause

`renderMigrationGraphTree` in
`packages/1-framework/3-tooling/cli/src/utils/formatters/migration-graph-tree-render.ts`.

For a `node` row it computes `laneSpan`:

```ts
if (row.kind === 'node') {
  const contractHash = row.contractHash ?? EMPTY_CONTRACT_HASH;
  if (prevRow?.kind === 'merge-connector' || contractHash === EMPTY_CONTRACT_HASH) {
    laneSpan = 1;                       // assumes merge always lands on the trunk
  } else {
    laneSpan = row.cells.length;
  }
}
```

then truncates the gutter to that span:

```ts
} else if (row.kind === 'node' && laneSpan < row.cells.length && !nodeHasArcDecoration(row)) {
  gutter = row.cells.slice(0, laneSpan).map(...).join('');   // slice(0, 1) → keeps only column 0
}
```

The `prevRow?.kind === 'merge-connector'` shortcut forces `laneSpan = 1`,
assuming a merged node always lands on column 0 (the trunk). When the node lands
in a non-zero column (a branch contract that is the convergence of ≥ 2 lanes,
i.e. has ≥ 2 consumers), `slice(0, 1)` discards the node-marker cell (at the
node's actual column) and every active pass-through lane to its right — hence the
orphaned hash with no glyph.

The grid model is **correct** — `buildNodeCells` (in `migration-graph-layout.ts`)
already places the `node` cell at the node's column with `vertical-pass` cells on
the other active lanes. The defect is purely in the render-time gutter shortcut.

Secondary: in graphs **without** skip-rollback arcs, `labelColumn` for a node
falls back to `laneSpan * 2 + LABEL_GAP`, so the same wrong `laneSpan = 1` would
also place the hash too tight for a non-trunk landing. (In `showcase`,
`wideLabelColumn` is set because skip-rollback arcs are present, so the hash
column happens to stay aligned — but the fix must be correct for both paths.)

## Design of record

Stop assuming a post-merge node lands on the trunk. Derive the node row's gutter
span from the node's **actual** landing column and the row's **active** cells, not
from `prevRow`:

- The gutter must always include the node-marker cell **and** every active lane
  (`node` + `vertical-pass` cells), i.e. span at least up to the last non-`empty`
  cell. Trailing `empty` cells may still be trimmed.
- Preserve the genuine "tight hash after a trunk merge" behaviour for the real
  trunk-landing case: a node at column 0 whose only active cell is the marker
  (everything merged away) still collapses to `laneSpan = 1`. Deriving the span
  from "last active cell + 1" yields exactly this for the trunk case and the full
  span for the non-trunk case, so a single rule covers both.
- Keep the existing dedicated `EMPTY_CONTRACT_HASH` (∅ baseline) handling intact.
- Do not regress arc-decorated node rows (`nodeHasArcDecoration`), the
  empty-source edge-row special case, or the `wideLabelColumn` alignment.

Leave the exact implementation to the implementer, but the simplest correct
approach is: for a non-empty node row, set `laneSpan = (index of last non-empty
cell) + 1` instead of branching on `prevRow`. Verify the `labelColumn` math then
stays correct on both the `wideLabelColumn` and the fallback paths.

## Scope

**In:**
- `packages/1-framework/3-tooling/cli/src/utils/formatters/migration-graph-tree-render.ts`
  — fix the node-row `laneSpan` / gutter-span logic.
- `packages/1-framework/3-tooling/cli/test/utils/formatters/migration-graph-tree-render.test.ts`
  — add a regression test (see below).

**Out:**
- `migration-graph-layout.ts` and the grid model (already correct).
- Lane colouring / legend behaviour (must remain unchanged).
- Any example fixture, demo config, or anything under `examples/`.
- The untracked worktree pollution from the manual repro
  (`examples/prisma-next-demo/prisma-next.config.ts` modification,
  `fixtures/showcase/migrations/app/20260602T1233_migration/`,
  `fixtures/showcase/migrations/pgvector/`) — DO NOT stage, commit, revert, or
  otherwise touch these. Stage and commit ONLY your two files with explicit
  `git add <paths>`. Do NOT run `git add -A`, `git commit -am`, `git stash`,
  `git restore .`, `git checkout -- .`, or `git clean`.

## Regression test

Add a unit test to `migration-graph-tree-render.test.ts` using the existing
`edge()` / `tree()` harness (no fixture needed). Build a topology where a
non-trunk contract node is the convergence of ≥ 2 lanes (≥ 2 consumers) and has
no arc decoration, and assert its node row renders the `○` (and `*` in ascii)
marker in its lane with trailing pass-through lanes preserved — not an orphaned
hash.

Candidate topology (replicates the `showcase` shape around `935a023`; **verify it
actually reproduces the dropped marker before fixing**, and adjust until it does):

```
∅ → A
A → B   (alice)
A → C   (bob)
B → D   (merge_alice)
C → D   (merge_bob)
C → E   (bob_extra)     ← gives the bob branch node C a 2nd forward child
D → E   (promote)       ← E converges from D and C
```

Here `C` should land on a branch lane (column ≥ 1) as a 2-lane merge with no arc
decoration. If this exact shape does not land `C` non-trunk, expand toward the
full `showcase` topology (init → add_name → {alice_phone, bob_avatar};
`bob_avatar`'s target has `merge_bob` plus a forward edge to the top convergence;
add the alice + fast_forward sibling branches) until the marker is dropped on the
unfixed renderer, then lock the fixed output in.

Assert against the **plain (uncolored)** render at minimum; an ascii assertion is
a bonus. The fixed node row must contain the marker glyph in the node's column.

## Done when

- The reproducing topology's node row renders the `○` marker in its lane (no
  orphaned hash line); trailing pass-through lanes are preserved.
- New regression test added and passing; it fails on the pre-fix renderer.
- Full CLI formatter test suite green
  (`pnpm --filter @prisma-next/cli test` or the repo's standard test command),
  including the existing tree-render, lane-colour, and legend tests — no
  snapshot/behaviour regressions.
- No changes outside the two in-scope files; no example/fixture/config files
  staged or committed.

## Notes

- Branch off `tml-2773-migration-graph-lane-colors-legend` (the current branch);
  this is a follow-up fix to the lane-colours work. Commit with a `Signed-off-by`
  trailer (use `git commit -s`).
