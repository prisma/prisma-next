# Slice: `migrate --show` — preview the path and ordered migrations `migrate` will run

_Parent project `projects/migration-graph-rendering/`. Outcome: a user about to run `migrate` can first ask **"what will this do?"** and get a faithful, graph-shaped answer — building the mental model that the system is a contract graph, not a linear stack._

## At a glance

`migrate --to <ref>` today just applies — there's no way to preview the path it will take. This slice adds `migrate --show`: a **read-only** preview that runs `migrate`'s own path-finder from the live DB marker (default) to the target, then renders (1) the Tier-3 graph with the chosen path highlighted bright green and off-path nodes dimmed, and (2) a linear, ordered list of the migrations that will execute. It supersedes TML-2771's proposed `migration path --from --to` read command (see `decisions.md` § `migrate --show`, D-MS1).

## Chosen design

`migrate --show [--from <ref>] [--to <ref>] [--db <url>]` — a preview qualifier on `migrate`; never writes.

**From-state (D-MS4):**
- Default (`--from` omitted): **read the live DB marker, read-only** (requires `--db`), so the preview starts from the *exact* state the real `migrate` would. No write ⇒ "no impact."
- Explicit `--from X`: a **labelled offline hypothetical** ("if you were at X…"), no connection. `X` accepts the existing contract-reference grammar.
- **`--from`/`--to` are app-space-scoped.** They override only the **app** member's from-state / target. **Extension** members are always previewed exactly as real `migrate` plans them — from their own live marker (or greenfield when offline) to their own head ref — never retargeted by the app-space `--from`/`--to`. (Feeding the app refs to an extension is the bug behind "No migration path … in space pgvector".)

**Live-marker token (D-MS5) — decided `@db`, plus symmetric `@contract` (D-MS7):** add reserved reference tokens **`@db`** and **`@contract`** to `parseContractRef` (`migration-tools/src/refs/contract-ref.ts`), usable anywhere the contract-reference grammar is accepted — so `migrate --show --from @db --to prod` is the explicit form of the default. `@db` = "the live DB marker," resolved via `readAllMarkers()` (**requires a connection**); `@contract` = "the working/desired contract the app carries" (**offline-resolvable**; also `migrate --to`'s implicit default). The spike confirmed `db` is **not** a `--from` resolver token today (it exists only as the file-backed `db` ref `refs/db.json` and the renderer's `DB_MARKER_NAME='db'` label), so the `@`-sigil introduces **no collision and needs no rename** — the parser distinguishes it on the first character.

**Render-vocabulary unification (D-MS7):** the shared Tier-3 overlay draws the reserved markers with the **`@`-sigil — `@contract @db` — dropping the angle-bracket form** `<contract, db>` (`migration-list-styler.ts:91-94`); user refs keep parens. The **`--legend`** output moves in lockstep: its example markers (`formatLegendExampleMarkers`, `migration-graph-tree-render.ts:744`) drop the `<…>` form, and its explanatory text teaches `@db`/`@contract` *and* that they're typeable `--from`/`--to` tokens. Both overlay and legend are shared by `graph` / `status` / `list` (legend via `utils/legend.ts`), so the change ships as this slice's **vocabulary-foundation dispatch** ahead of the preview — the preview can't render `@db`-highlighted while siblings still print or legend `<db>` (snapshot regen across all three).

**Output (D-MS3, revised per operator visual review):** two artifacts, one invocation:
1. The **Tier-3 graph tree** (shared renderer with `graph`/`status`), rendering the **whole** graph — nothing omitted. **Colour model — path-highlight mode is a DISTINCT colour scheme, not an overlay on the normal one.** In this mode the renderer classifies every glyph/migration/node as **on-path** or **off-path** — it does **NOT** use the normal by-branch rotating-colour logic (`LANE_COLOR_CYCLE`); branch rotation is **suppressed entirely**. There are exactly **two styles, defined in ONE place** (so the on-path/off-path colours are trivially tweakable in future):
   - **On-path:** migration name **white/bold**, contract hashes the neutral single-path colour (cyan, same as a single-path section like `pgvector`), and the **lane/branch glyphs (`│ ├ ╯ ↑` + on-path node markers) GREEN** — the green branch traces the path and distinguishes it from the off-path (which is dim, not green). (Name/hashes are neutral; only the branch is green.)
   - **Off-path = dimmed grey** on every cell (marker, hash, name, edge `from → to` hashes incl. destination, lane segments).
   Classification is on-path/off-path **per glyph**, following the actual traversed path — never by branch column index. Marker placement: **`@contract` marks the app's working-contract node and is rendered only in the app space — never in an extension space**; `@db` marks the live-marker node; the `--to` ref marks its own node in parens. (`@contract` is the working contract, *not* the `--to` target.)
2. A **linear, ordered list** of the migrations that will execute — rendered through the **IDENTICAL on-path row renderer as the tree's migration rows** (same code path / on-path style), with the graph gutter glyphs omitted but **left-padded by the graph's data-column offset (`globalMaxEdgeTreePrefixWidth`) so the list's data columns — dirName, source hash, `→`, destination hash — align EXACTLY with the graph rows above**. The source-hash column must be padded (`padFromHashColumn`) so `∅`-source and full-hash-source rows put their `→` at the same column. Net: **every `→` in the whole output (graph + list) lines up.** Printed directly (no Clack `│` gutter).

   The summary + list header are **one consolidated line**: `The following <N> migration(s) will run:` (NOT a separate "`<N> migrations will run`" line plus a "`Will run, in order:`" header). **Column alignment is shared across ALL sections: the `app:` graph section, every extension graph section (e.g. `pgvector:`), AND this run-list must align their data columns (migration name, `from → to` hashes, `N ops`) to the same offsets** — compute the dirName/hash column widths GLOBALLY across all spaces and the list, not per-space. (Today each space self-aligns and the list uses a separate width → mismatch.) **The order MUST be the runner's canonical cross-space schedule order — extension spaces (alphabetically by space id) FIRST, then the app space — sourced from the SAME ordering mechanism the runner uses (`concatenateSpaceApplyInputs` / the runner's `applyOrder`), NOT reconstructed from a per-space loop.** The preview's run order must be byte-for-byte the order `migrate` actually applies (extensions before app) — this is part of the faithfulness constraint (D-MS6), not just presentation. Script/loop-friendly.

**Faithfulness constraint (D-MS6) — confirmed by spike.** `migrate --show` computes its path through the **same seam the real `migrate` runs**: `readAllMarkers()` (read-only) for the from-state, then `graphWalkStrategy()` (`@prisma-next/migration-tools/aggregate`, `strategies/graph-walk.ts:51`) — a pure, no-write function that returns the ordered `PerSpacePlan` / `pathDecision.selectedPath`. The preview simply **stops before `runMigration()`** (the write boundary, `operations/migrate.ts:284`). No parallel reimplementation. The Tier-3 renderer is shared with `graph`/`status`. `status --from` already calls the same core path-finder (`findPathWithDecision`, `migration-graph.ts:300`) that `graphWalkStrategy` wraps, so the two commands are deterministically consistent **with no convergence refactor required** (an optional shared `previewMigrationPath` wrapper is a nicety, not a blocker).

Worked sketch (DB one migration behind prod):

```
$ prisma-next migrate --show --to prod --db $DATABASE_URL

app:
  ○   a94b7b4   @contract            ← app working contract (grey: off-path here)
  │↑  add_posts        ef9de27 → a94b7b4   1 ops     ← GREEN: node, name, AND lane lines
  ○   ef9de27   @db (prod)
  │   old_change       3c1d0a2 → ef9de27   1 ops     ← dim GREY: fully drawn, off-path
  ○   3c1d0a2
  ∅

  add_posts        ef9de27 → a94b7b4   1 ops              ← list: graph row format, GREEN, no gutter
```

Green covers the whole on-path run (nodes, hashes, names, lanes); everything off-path is uniform grey but fully drawn. `@contract` sits on the working-contract node (app space only). Reserved markers use the `@`-sigil — the spelling you type into `--from`/`--to` (D-MS7), not `<contract, db>`. User refs keep parens (`(prod)`). The ordered list reuses the graph's migration-row formatter without the gutter, in the same green — not Clack `ui.log`.

## Coherence rationale

One command, one engine: add a read-only preview mode to `migrate` that reuses the planner seam and the Tier-3 renderer. The reference-grammar token (D-MS5) ships with it because the feature needs an explicit way to name the live marker. A reviewer holds "preview = run the planner, render the path, stop" in one sitting.

## Scope

**In:** `migrate --show` flag + read-only preview path; default `--from` = live marker (read-only); explicit `--from X` offline hypothetical; the `@db` + `@contract` reference tokens; the **render-vocabulary unification** (reserved markers draw as `@db`/`@contract`, angle brackets dropped) across the shared Tier-3 overlay **and the `--legend` output** (example markers + explanatory text) — including the resulting `graph`/`status`/`list` snapshot regen; the green-path/dim rendering; the ordered-execution list; `--json` parity for the ordered list if the family convention requires it.

**Out:**
- Any change to `migrate`'s apply behaviour (preview is strictly additive + read-only).
- Refactoring `status --from` onto the shared seam **if** it already routes through it — touch only if it currently diverges (decide at dispatch time; may be a follow-up).
- `migration plan` (authoring) and `status`/`graph`/`log` semantics.
- Multi-path *comparison* / "show alternative routes" (a later exploration feature, not this sanity-check).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --- | --- | --- |
| No path from-state → target | Must render gracefully | Reuse the `status` no-path / wrong-grammar diagnostics; don't throw. |
| Already at target (empty path) | Show "nothing to run" | Green-highlight the single current node; empty ordered list. |
| Multi-space (`migrate` spans app + extensions) | Mirror `migrate`'s real behaviour | Render per-space path sections like `status`/`list` policy; the preview must match what the real multi-space `migrate` would do. |
| `--from db` (live token) with no `--db` connection | Structured error | "live marker needs a connection"; suggest an explicit `--from <contract>` for offline. |

## Slice-specific done conditions

- [ ] `migrate --show` is read-only — preview returns before the `runMigration()` call (`operations/migrate.ts`); no marker/ledger mutation, no DDL reachable.
- [ ] The path is computed via `graphWalkStrategy()` (+ `readAllMarkers()` for the from-state), the same seam `migrate` uses — not a reimplementation; reviewer confirms from the call site.
- [ ] `@db` resolves to the live marker through `parseContractRef` (errors clearly with no connection); `@contract` resolves offline to the working contract; the distinction from the `db` ref is documented (glossary + help text).
- [ ] Reserved markers render as `@db`/`@contract` (no angle brackets) everywhere the shared Tier-3 overlay is used — `graph`/`status`/`list`/`migrate --show` — with snapshots regenerated and consistent.
- [ ] `--legend` reflects the new vocabulary: its example markers use `@db`/`@contract` (no `<…>`) and its text notes they're typeable `--from`/`--to` tokens; verified across `graph`/`status`/`list`.

## Open Questions

**None — all three closed by the planner-seam spike (2026-06-04).**

1. ~~Clean read-only "compute path, don't execute" seam?~~ → **Yes.** `graphWalkStrategy()` returns the ordered `PerSpacePlan` with no writes; `runMigration()` (`operations/migrate.ts:284`) is the execution boundary the preview stops before. No extraction needed — stays a one-PR slice.
2. ~~Live-marker token spelling / `db`-ref collision?~~ → **`@db` sigil.** `db` is not a `--from` resolver token today, so there's no collision and no rename; add `@db` to `parseContractRef` (`refs/contract-ref.ts`), resolved via `readAllMarkers()`.
3. ~~Does `status --from` reimplement path-finding?~~ → **Shares the core.** `status --from` calls `findPathWithDecision` directly; `graphWalkStrategy` wraps the same function, so `migrate --show` is deterministically consistent with both `migrate` and `status`. No convergence refactor required.

## References

- Parent project: `projects/migration-graph-rendering/spec.md`; decision: `decisions.md` § `migrate --show` (D-MS1–D-MS6)
- Linear issue: TML-2771 (re-titled to `migrate --show`)
- Glossary: `docs/glossary.md` § Migrate (verb) / Marker / Ref / Contract Reference grammar
