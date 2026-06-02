# Slice: Render `┼` where a pass-through lane crosses a fan connector span

## Problem

When an unrelated active lane passes vertically **through the middle of a
fork/merge connector's span**, the connector renders that column as a junction
tee (`┬` / `┴`) instead of a crossing (`┼`). The lane being crossed is silently
absorbed into the fan, so the connector looks like it has one more branch than it
really does, and the crossed lane visually disappears for that row.

Reproduced in the `showcase` fixture after adding the forward edge
`935a023 → f660984` (so `f660984` fans a new lane down to `935a023`, which then
threads through the `83a1ded` convergence fan). `83a1ded` has **three** producers
(`merge_alice`, `merge_bob`, `fast_forward`), so its downward fan should be a
3-way `├─┬─╮`, but with the new lane crossing the span it renders:

```
○     │       83a1ded
├─┬─┬─╮ │             ← BROKEN: 2nd ┬ is the crossed pass-through lane, should be ┼
```

Expected (the crossed lane reads as a crossing, not an extra branch):

```
○     │       83a1ded
├─┬─┼─╮ │             ← the pass-through column is ┼
```

(The exact column of the `┼` depends on which lane the pass-through occupies —
verify against the live render; the point is a crossed-through active lane inside
a connector span must be `┼`, not `┬`/`┴`.)

## Root cause

`packages/1-framework/3-tooling/cli/src/utils/formatters/migration-graph-layout.ts`.

`buildBranchConnectorCells(startLane, endLane, activeLanes, gridWidth)` sets every
inner lane (`startLane < lane < endLane`) to `{ kind: 'branch-tee' }`
unconditionally — it has no way to distinguish a real fan-target lane from an
unrelated active lane that merely passes through the span, because the actual
branch-target lane indices are not passed in. `buildMergeConnectorCells` has the
analogous gap (inner active lanes become `merge-tee`).

The fan-target lanes are known at the call site: `processNode` builds
`laneForGroup` (the lanes the fork creates) and calls `emitBranchConnector(node,
column, endLane, groups.length)` — but only `branchCount` is forwarded, not the
lane set. A non-target active lane inside the span is therefore indistinguishable
from a branch target inside the cell builder.

Separately, `renderConnectorRow` in
`packages/1-framework/3-tooling/cli/src/utils/formatters/migration-graph-tree-render.ts`
has no `case 'arc-crossing'` (or equivalent crossing kind) in its connector cell
switch — it only handles `branch-tee`, `merge-tee`, the corners, `vertical-pass`,
and `horizontal-pass`. So even if the layout emitted a crossing cell, the
connector renderer would fall through to the `default` (`'  '`).

## Design of record

A connector span must distinguish three inner-column roles:
1. **fan-target lane** → junction tee (`├`/`┬`/`┴` as today),
2. **unrelated active pass-through lane** → crossing `┼`,
3. **bare horizontal run** (no lane) → horizontal dash (as today).

Implementation outline (implementer may refine):

- Thread the fan's actual branch-target lane indices from `processNode`
  (`laneForGroup`) through `emitBranchConnector` (and the merge path through
  `emitMergeConnector` / `lanesWanting` for the merge case) into
  `buildBranchConnectorCells` / `buildMergeConnectorCells`.
- In the cell builders, for an inner lane that is in `activeLanes` but is **not** a
  fan-target lane, emit a crossing cell (reuse the existing `arc-crossing` kind, or
  add a dedicated connector-crossing kind if cleaner) instead of a tee.
- Add the crossing case to `renderConnectorRow`'s switch so it renders
  `palette.arcCrossing` (`┼─` / `+-`). Honour glyph mode (unicode + ascii) and the
  `colorize` gate.
- Extend `resolveConnectorLaneColors` to give the crossing a sensible single hue
  (consistent with how `resolveRowLaneColors` colours `arc-crossing`: the fan/owning
  run's colour, with the crossed vertical occluded for that one cell). Do not leave
  it an uncoloured gap.

Do **not** change vertical ordering, lane allocation, or which edges fan where —
only the glyph chosen for an already-correct crossed column, plus the plumbing to
identify it.

## Scope

**In:**
- `migration-graph-layout.ts` — pass branch/merge target lanes into the connector
  cell builders; emit crossing cells for crossed pass-through lanes.
- `migration-graph-tree-render.ts` — render the crossing glyph in
  `renderConnectorRow`; colour it in `resolveConnectorLaneColors`.
- Tests:
  - `test/utils/formatters/migration-graph-layout.test.ts` — assert the connector
    row's cells contain a crossing (not a tee) for the crossed lane.
  - `test/utils/formatters/migration-graph-tree-render.test.ts` — assert the
    rendered connector row shows `┼` (and `+` in ascii) at the crossed column.

**Out:**
- Lane allocation / vertical ordering / adjacency classification.
- Node-marker rendering (already fixed in `6aa0b2dc8`).
- Any `examples/` fixture or demo config (handled by a separate slice). Leave the
  untracked worktree pollution alone (see git discipline).

## Regression test

Build a topology (existing `edge()`/`tree()` harness, no fixture) where a
convergence/fork fan of ≥ 3 lanes has an unrelated active lane threading through
the middle of its span. The `showcase`-style shape works:

```
∅ → A
A → B   (alice)      A → C  (bob)
B → M   (merge_alice)
C → M   (merge_bob)
A → D   (fast_forward, third producer of M)   — gives M a 3-way fan
C → T   (promote)    D-or-spine → T            — T fans a lane that crosses M's fan
```

Confirm on the **pre-fix** layout/renderer that the crossed inner column is a tee
(`┬`/`┴`), then lock in `┼` after the fix. Adjust the topology until the crossing
actually lands inside a fan span (verify against the live render rather than
guessing column math).

## Done when

- A lane crossing the interior of a fork/merge connector span renders `┼` (`+` in
  ascii), not `┬`/`┴`; the fan's real branch count is unchanged.
- New layout + render regression tests added and passing; they fail pre-fix.
- Full CLI formatter suite green (tree-render, lane-colour, legend, layout) — no
  snapshot/behaviour regressions. The existing `83a1ded`-style fans with **no**
  crossing still render `├─┬─╮` exactly as before.

## Notes

- Branch off `tml-2773-migration-graph-lane-colors-legend`. Commit `-s` (sign-off);
  do not push.
- Git discipline: stage ONLY your changed source/test files by explicit path.
  Do NOT touch the untracked repro pollution
  (`examples/prisma-next-demo/prisma-next.config.ts`,
  `examples/prisma-next-demo/fixtures/showcase/migrations/app/20260602T1233_migration/`,
  `examples/prisma-next-demo/fixtures/showcase/migrations/pgvector/`). Never run
  `git add -A`, `git commit -am`, `git stash`, `git restore .`, `git checkout -- .`,
  or `git clean`.
