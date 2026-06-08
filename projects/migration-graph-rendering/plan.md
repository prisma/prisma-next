# Project plan — migration-graph-rendering

Single source of truth for what's done and what's left. Slice specs live under
[`slices/`](./slices/); the older read-command-family roadmap is in [`README.md`](./README.md).

## Renderer redesign track (current focus)

The Tier-3 renderer was rebuilt on a line/plane/occlusion model so colouring is
correct-by-construction (no tees — corners + occlusion only).

| Slice | Status | What it delivers |
| ----- | ------ | ---------------- |
| [`render-redesign-core`](./slices/render-redesign-core/) | **Merged** (#762) | The line/plane/occlusion rewrite: lines as the primitive, z-ordered cells, occlusion projection. Retired the old `renderMigrationGraphTree` + the 14 `StructuralCell` kinds + all tee glyphs. |
| [`render-redesign-geometry`](./slices/render-redesign-geometry/) | **In progress** (#767) | Back-arc **convergence** (rollbacks to one target share a single back-lane); lift the `colsPerLane` spacing default to a named constant + a scaling test; hand-authored **convergence goldens**; the **converged showcase golden** candidate (real-world fixture, for operator review). |

After `render-redesign-geometry` lands, the renderer redesign is **effectively complete**.

## Deleted as dead (rewrite-obsoleted)

These were drafted as individual glyph-bug slices against the **old** renderer, then made
moot by the wholesale rewrite. They are deleted (recoverable from git history); the new
corner/occlusion model cannot produce the bugs they describe, and the showcase golden
exercises the same shapes:

- `converging-back-arcs` — "only one of N converging rollbacks lands" → convergence now lands all of them on one shared lane (delivered in `render-redesign-geometry`).
- `connector-crossing-glyph` — "a pass-through lane renders as a `┬`/`┴` tee instead of `┼`" → there are no tees; a crossing is two lines arbitrated by occlusion.
- `node-merge-landing-marker` — "a non-trunk merge landing drops the `○` marker" → a node is its own single-owner cell and is always drawn.

## Optional follow-ups (low priority, not started, no dedicated spec)

- **Sync the on-disk showcase demo fixture** (`examples/prisma-next-demo/fixtures/showcase/`) to the showcase golden so the live demo shows the multi-lane-merge + convergence shape. Demo polish only — the renderer behaviour is already covered by the showcase golden test. (Was the `showcase-multilane-merge` slice; touches `examples/`.)
- **Regenerate the `diamond` example fixture** with complete `end-contract.*` artifacts so it's loadable by path (today only an uncommitted demo-config edit reads it). (Was `diamond-fixture-regeneration`.)

## Read-command-family track (older, mostly merged)

A separate, largely-completed track — `migration list`/`status`/`log` rendering + the
ledger foundation. Sequenced in [`README.md`](./README.md) (slices 1–8). Not re-audited in
this cleanup.
