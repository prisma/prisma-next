# Slice: retire `migration list --graph` (Tier-2 list-graph renderer)

_Parent project `projects/migration-graph-rendering/`. Outcome this slice contributes to the project's purpose: now that the Tier-3 `migration graph` tree renderer draws the whole history compactly and correctly, the Tier-2 list-graph gutter is the redundant middle — this slice removes it, leaving exactly one graph renderer to maintain._

## At a glance

Remove the `--graph` flag from `migration list` and delete its ASCII list-graph engine (`migration-list-graph-render.ts` + `migration-list-graph-layout.ts`), keeping plain `migration list` (chronological, all spaces) and `migration graph` (topological tree). The shared edge classifier (`migration-list-graph-topology.ts`) stays — the tree depends on it.

## Chosen design

`migration list --graph` overlays a `git log --graph`-style branch gutter on the chronological (latest-first) migration list. For a linear history it reads fine; for anything with merges + rollbacks the two orderings fight and the output degrades: back-edges collapse to flat `↩` rows with no connection to where they land, merge nodes float detached from their labels (`o │`), and the `├─┬─┐` / `├─┘` gutter reads as noise. The Tier-3 tree renderer now covers that job — topologically ordered, routed back-arcs, refs/db/contract overlays, disjoint components — strictly better.

The two views that earn their keep are the **chronological log** (`migration list`, flat) and the **topological shape** (`migration graph`, tree). The hybrid is the one to drop.

**Removed:**

- `migration list`'s `--graph` flag and the `graph` branch of `renderMigrationListHumanOutput`.
- `migration-list-graph-render.ts`, `migration-list-graph-layout.ts`, and their tests/fixtures (`migration-list-graph-render.test.ts`, `migration-list-graph-layout.test.ts`, `migration-list-graph-fixtures.ts`).
- The Tier-2 reference doc `docs/reference/migration-list-graph-rendering.md` and its links from `docs/README.md`.

**Kept:**

- `migration list` (flat) — unchanged, including `--ascii`, which still selects the glyph mode for the flat list's kind column (`* ↩ ⟲` → ASCII). `--ascii` is **not** removed; its help text drops the "for --graph" qualifier.
- `migration-list-graph-topology.ts` — the forward/rollback/self classifier, shared with the Tier-3 tree (`migration-graph-rows.ts`). The `GlyphMode` type, currently re-exported through the deleted `migration-list-graph-render.ts`, is re-sourced from its real home (`../glyph-mode`).

Before → after for `migration list`:

| Surface | Before | After |
|---|---|---|
| `migration list` | flat list, all spaces | unchanged |
| `migration list --graph` | ASCII branch gutter | flag removed (errors as unknown option) |
| `migration list --ascii` | ASCII glyphs (flat + graph) | ASCII glyphs (flat) — unchanged behaviour for the flat list |
| `migration graph` | topological tree | unchanged |

## Coherence rationale

One reviewer holds this in one sitting: it deletes one renderer and the single flag that reaches it, behind an unchanged flat-list path and an unchanged Tier-3 tree. The call-site grep is the acceptance surface — after the removal, nothing imports `migration-list-graph-{render,layout}` and `migration list --graph` is gone. Rolls back as one unit.

## Scope

**In:**

- Delete the Tier-2 list-graph renderer + layout modules and their tests/fixtures.
- Remove the `--graph` flag, its render branch, and `MigrationListHumanRenderOptions.graph` from `migration-list.ts`; re-source `GlyphMode`; fix the command description/examples.
- Delete `docs/reference/migration-list-graph-rendering.md`; delink from `docs/README.md`; scrub any Tier-2 cross-reference in `docs/reference/migration-graph-rendering.md`.
- Drop `--graph` cases from `migration-list.test.ts` and any CLI-journey/e2e coverage that drives `list --graph`.

**Out:**

- `migration-list-graph-topology.ts` (shared classifier) — kept.
- The flat `migration list` output and its `--ascii` glyph behaviour — kept.
- The Tier-3 tree renderer — untouched.
- Teaching `migration graph` to render non-app contract spaces (see Open Questions) — not folded in unless the operator says so.
- The dagre renderer + `migration status` — that's TML-2748, independent.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| `--ascii` looks like a `--graph`-only flag | Keep `--ascii`; it drives the flat-list kind glyphs too | `renderMigrationListWithStyle` consumes `glyphMode`; only the help text's "for --graph" qualifier is wrong. |
| `GlyphMode` imported from the deleted renderer | Re-source from `../glyph-mode` | `migration-list.ts` imports `GlyphMode` via `migration-list-graph-render.ts`; that re-export disappears with the file. |
| `migration-list-graph-fixtures.ts` | Delete with the render test | Imported only by `migration-list-graph-render.test.ts`; the topology test does not use it. |

## Slice-specific done conditions

- [ ] `rg "migration-list-graph-(render|layout)"` over `src/` + `test/` returns zero hits, and `migration list --graph` exits as an unknown option; the shared topology classifier and its test remain green.

## Open Questions

1. **Multi-space graph visibility.** `migration list --graph` iterated every on-disk contract space; `migration graph` renders only the app space. Removing Tier-2 drops the only per-space *graph* view (flat `list` still shows all spaces). Working position: **accept the loss in this slice** — extension/non-app spaces rarely need a topology view, and a `migration graph --space <id>` follow-up can restore it if users ask. Fold a `--space` flag into this slice only if the operator prefers.

## References

- Parent project: `projects/migration-graph-rendering/spec.md` (Tier-3 redesign — this slice's predecessor).
- Linear issue: _to be filed (standalone, related to TML-2746 and TML-2748)._
- Surfaces removed: `cli/src/utils/formatters/migration-list-graph-{render,layout}.ts` (+ tests/fixtures), `cli/src/commands/migration-list.ts` (`--graph`), `docs/reference/migration-list-graph-rendering.md`.
- Surfaces kept: `migration-list-graph-topology.ts` (shared with `migration-graph-rows.ts`), flat `migration list`, the Tier-3 tree renderer.

## Dispatch plan

### Dispatch 1: remove the `--graph` flag and delete the Tier-2 renderer

- **Outcome:** `migration list --graph` is gone; `migration-list-graph-{render,layout}.ts` and their tests/fixtures are deleted; `migration-list.ts` drops the `graph` option/branch, re-sources `GlyphMode`, and fixes its description/examples; `migration-list.test.ts` drops `--graph` cases. Flat `list` (incl. `--ascii`) and the shared topology classifier stay green.
- **Builds on:** This spec; the grounded footprint (only `migration-list.ts` imports the deleted modules).
- **Hands to:** A green workspace where the call-site grep returns zero and `migration list` behaves identically except the removed flag.
- **Focus:** Code + test removal only. Docs in dispatch 2.

### Dispatch 2: docs cleanup

- **Outcome:** `docs/reference/migration-list-graph-rendering.md` deleted; `docs/README.md` delinked; any Tier-2 cross-reference in `docs/reference/migration-graph-rendering.md` scrubbed. Reference-link lint (if any) green.
- **Builds on:** Dispatch 1.
- **Hands to:** Slice-DoD: zero dangling references to the removed surface across docs + code.
- **Focus:** Docs only. No behaviour change.
