# Slice: Converging back-arcs (multiple rollbacks to one target)

Tracking ticket: **[TML-2793](https://linear.app/prisma-company/issue/TML-2793)**.
Follow-up to [TML-2773](https://linear.app/prisma-company/issue/TML-2773).

## Problem

`migration graph --tree`'s routed back-arc layer handles co-**sourced**
node-skipping rollbacks (several arcs teeing off a single node) but has **no**
handling for **converging** back-arcs — two or more node-skipping rollbacks whose
targets are the **same** node. When that happens the render collapses.

A single node-skipping rollback renders correctly; adding a second rollback that
converges on the same target breaks two things at once:

1. **Landing** — only one of the converging arcs actually closes onto the target
   node (`◂╯`); the other never lands. Its landing corner is clobbered into an
   `arc-crossing` and its body keeps running past the node.
2. **Vertical ordering** — the tip (newest contract) is pushed out of topological
   order, ending up near the bottom; the source nodes of the converging rollbacks
   are scattered.

## Repro

Forward chain `∅ → n0 → … → n6`, plus two node-skipping rollbacks converging on
`n1`: `n3 → n1` and `n5 → n1`.

A **single** skip-rollback `n5 → n1` is correct (baseline):

```
○       n6
│↑      m6               n5 → n6
○─╮     n5
│ │↓    rb_b             n5 → n1
│↑│     m5               n4 → n5
○ │     n4
│↑│     m4               n3 → n4
○ │     n3
│↑│     m3               n2 → n3
○ │     n2
│↑│     m2               n1 → n2
○◂╯     n1
```

Add `n3 → n1` so two arcs converge on `n1` — **broken**:

```
○───╮       n4
│   │↓      m5           n4 → n5
│↑  │       m4           n3 → n4
○─────╮     n3
│   │ │↓    rb_a         n3 → n1
│↑  │ │     m3           n2 → n3
○   │ │     n2
│↑  │ │     m2           n1 → n2
○◂────╯     n1          ← only one arc lands; rb_b never closes onto n1
├─╮ │
│↑│ │       m1           n0 → n1
│ │↑│       rb_b         n5 → n1
○ │ │       n0
│↑          init         ∅       → n0
∅ │ │
○ │ │       n6          ← tip dumped to the bottom, out of order
│↑│ │       m6           n5 → n6
├─╯ │
○◂──╯       n5
```

(Reproduced through `renderMigrationGraphTree` over a synthetic graph; the single
vs. converging contrast isolates convergence as the trigger.)

## Root cause (starting point)

`applySkipRollbackRouting` in
`packages/1-framework/3-tooling/cli/src/utils/formatters/migration-graph-layout.ts`.

The **source (tee-off) row** builds a `coSourcedLanes` set so several arcs leaving
one node share a tee row — each inner lane reads `┬` and only the outermost gets
the closing `╮`. The **target (landing) row** has **no analogous co-landing
handling**: each route independently paints `cells[targetCol] = node(arcLand)` and
its own `arc-land-corner` at its back-lane. So when a second converging route runs,
its bridge loop sees the first route's landing corner as "occupied" and overwrites
it with an `arc-crossing` (`┼`) — the inner arc never closes onto the node, and its
body keeps running.

The vertical-ordering scramble (tip pushed down) is a **separate, co-occurring**
symptom in the row-model ordering (`computeVerticalOrder` /
`buildMigrationGraphRows`) when a node is the source of a converging rollback. It
must be confirmed / root-caused as part of the fix — it may share a cause or be
independent.

## Design of record (sketch — to be firmed up at implementation)

- Mirror the co-sourced tee logic on the landing side: collect the back-lanes of
  all routes that share a target node (`coLandingLanes`), paint the target row once
  so the inner converging arcs read as a landing junction (`┴` / `◂┴`-style) and
  only the outermost closes the corner (`╯` / `◂─╯`), and ensure **every**
  converging arc's body terminates at the target rather than crossing past it.
- Confirm and, if needed, fix vertical ordering so the tip stays at the top when a
  node is the source of a converging rollback.

Pure layout/routing + (if needed) ordering. No change to glyph palette, lane
colours, `--legend`, or `--json` / `--dot`.

## Scope

**In:**
- `migration-graph-layout.ts` — co-landing handling in `applySkipRollbackRouting`
  (and any ordering fix in the row model if confirmed in scope).
- Renderer regression tests (`test/utils/formatters/`) covering converging
  back-arcs (landing + ordering), including the minimal repro above.
- A fixture that exercises convergence — extend an existing `examples/` fixture or
  add a small dedicated one — so the case is demoable and golden-covered.

**Out:**
- Colour resolution (`resolveConnectorLaneColors` / `resolveRowLaneColors`) — the
  hues are correct once the glyphs land in the right cells.
- `--legend`, `--json` / `--dot`, the dagre renderer / `migration status`.

## Done when

- Two (and three+) node-skipping rollbacks converging on one target render with
  every arc closing cleanly onto the node, and the tip stays at the top in correct
  topological order.
- A converging-back-arc fixture + renderer regression tests are committed and green;
  full CLI formatter suite green with no other snapshot regressions.

## Notes

- Branch for the fix: `tml-2793-…` (see ticket). Commit `-s`; stage only changed
  files by explicit path. No `git add -A` / stash / restore / clean.
