# Slice: render-polish-and-ledger-tests

_Parent project `projects/migration-graph-rendering/`. Outcome: close the four follow-ups on the just-merged read-command family in one PR — unify pretty rendering across `list`/`status`/`graph` (D1 enforcement, locked trunk-choice rule), align migration data columns, color the gutter + add `--legend`, and close the two open test-coverage gaps in the ledger journal._

_Tracking: [TML-2812](https://linear.app/prisma-company/issue/TML-2812) (lead) + [TML-2811](https://linear.app/prisma-company/issue/TML-2811) + [TML-2773](https://linear.app/prisma-company/issue/TML-2773) + [TML-2774](https://linear.app/prisma-company/issue/TML-2774) (open items only). Supersedes the on-disk slice drafts `unify-pretty-rendering` and `lane-colors-and-legend`._

## At a glance

```
$ migration list                                   $ migration status                                  $ migration graph

app:                                               app:                                                app:
  ○  1375f13                          (contract)     ○  1375f13                  (db, contract)         ○  1375f13                          (contract)
  │↑ 20260603_migration  ∅       → 1375f13  10 ops   │↑ 20260603_migration  ∅       → 1375f13  ✓ applied │↑ 20260603_migration  ∅       → 1375f13  10 ops
  │  ○  f7a8eb5                       (prod)         │  ○  f7a8eb5               (prod)                 │  ○  f7a8eb5                       (prod)
  │  │↑ 20260518_bookend  6cee614 → f7a8eb5  0 ops   │  │↑ 20260518_bookend  6cee614 → f7a8eb5  ⧗ pending │  │↑ 20260518_bookend  6cee614 → f7a8eb5  0 ops
  │  …                                               │  …                                                │  …
  ├──╯                                               ├──╯                                                ├──╯
  ∅                                                  ∅                                                   ∅

pgvector:                                          pgvector:                                           pgvector:
  ○  29059df                  (head, db, contract)    ○  29059df                  (head, db, contract)    ○  29059df                  (head, db, contract)
  │↑ install_vector_v1  ∅ → 29059df  1 ops  {pgvector:install-vector-v1}   │↑ install_vector_v1  ∅ → 29059df  1 ops  {pgvector:install-vector-v1}  ✓ applied   │↑ install_vector_v1  ∅ → 29059df  1 ops  {pgvector:install-vector-v1}
  ∅                                                  ∅                                                   ∅

7 migrations across 2 contract spaces              up to date                                          7 nodes, 6 edges
```

Same input, three commands, byte-identical per-space sections — modulo `status`'s applied/pending overlay column and per-command footer. Three column-aligned migration rows per space; lane glyphs (`│ ├ ╯`) carry per-column color; the `○` node glyph takes its lane color while direction arrows (`↑ ↓ ⟲`) stay bright. `migration graph --legend` prints a key to stderr; `--ascii` / `NO_COLOR` / piped output stay text-clean.

## What this slice closes

Five independent follow-ups, all surfaced after the read-command-family slices ([#704](https://github.com/prisma/prisma-next/pull/704) `log` / [#705](https://github.com/prisma/prisma-next/pull/705) `status` / [#706](https://github.com/prisma/prisma-next/pull/706) `list`→tree) merged. Bundled because the first three touch the same three rendering modules (`migration-graph-rows.ts`, `migration-graph-tree-render.ts`, `migration-list-data-column.ts`), the fourth is a small test-coverage gap that should not orphan its own PR, and the fifth is two coupled one-liner edits in `migration-status.ts` that surfaced during QA. One reviewer holds them in one sitting.

1. **Unify pretty rendering** ([TML-2812](https://linear.app/prisma-company/issue/TML-2812)) — same DB state, same on-disk migrations: `list` / `status` / `graph` produce **byte-identical** pretty rendering of the per-space sections, modulo `status`'s overlay column and per-command footer. Closes the gap between project decision D1 ("one shared graphical renderer, command-specific annotations") and the on-disk reality where the three commands diverge in (a) **trunk choice** (live-contract chain vs historical-ref chain), (b) **per-row data** (full vs overlay-only vs none), and (c) **space iteration** (`graph` silently scopes to one space).
2. **Column alignment** ([TML-2811](https://linear.app/prisma-company/issue/TML-2811)) — pad the tree-prefix to a consistent visible width per render block so `dirName` starts at the same column on every migration row, regardless of how deep that row sits in the tree drawing.
3. **Colored lanes + `--legend`** ([TML-2773](https://linear.app/prisma-company/issue/TML-2773)) — `git log --graph`-style per-column coloring of the gutter; routed back-arcs colored as one hue per arc; node glyph `○` colored by lane; direction arrows stay bright; opt-in `--legend` block on `migration graph`.
4. **Ledger op-count test coverage** ([TML-2774](https://linear.app/prisma-company/issue/TML-2774) items 3 + 5, the two open follow-ups) — one cross-target table-driven harness asserting SQL + Mongo emit the same `operationCount` per applied edge for the same plan (including a skipped-op apply); covers the Postgres op-count-mismatch throw path that's currently uncovered.
5. **`migration status` default target + no-path wording** (D21, surfaced during QA) — fix `resolveTargetHashForSpace` so the default target is the live contract whenever there is one (matching `migrate`'s default and preventing the "(db, contract) ... cannot reach the selected target" contradiction); reword the no-path summary to name the actual missing thing (a migration path), name both endpoints, and lead with `migration plan` as the fix.

## Locked decisions

### D14 — Trunk-choice rule: live-contract chain (carried from project decisions)

The trunk is the chain containing the **live contract** — the contract emitted from the on-disk schema, the same contract `migrate` defaults to advancing toward when no `--to` is passed. Disconnected sub-graphs render as side-branches indented one level. `list` already implements this via its `contractHash` argument to `buildMigrationGraphRows`; `status` and `graph` adopt it by passing the same value at their call sites. The trunk-choice algorithm itself is not parametrised by command — there's one rule, one input, three call sites that pass the same input.

### D15 — Per-row data shape, with one overlay knob

Every migration row, in every command, renders `dirName · from → to · N ops · {invariants}` (the full shape `list` uses today). `status` appends one overlay column at the right end — `✓ applied` / `⧗ pending` / blank. The shared `edgeAnnotationsByHash` contract introduced in D11 already carries the surface needed; `graph` adopts the list overlay verbatim, and `status` extends it (rather than replacing it) by composing a "list overlay + status column" annotation builder.

### D16 — Space iteration: all spaces by default in all three commands

`graph` adopts the all-spaces-by-default policy `list` and `status` already use (D4). `--space <id>` narrows uniformly. Each space renders as a per-space section with a `<spaceId>:` heading when more than one space is present.

### D17 — Column alignment: per-render-block, not global

Within a single render block (one space's per-space section, or a single-space rendering), compute the maximum visible width of the tree-prefix across all migration rows in the block, then right-pad each row's tree-prefix to that width before appending the data block. **Per-render-block, not global** — each space's tree depth may differ; alignment across spaces is not asserted (call it out if a future spec wants it). Visible-width calculation operates on rendered glyphs, not raw byte length, so wide / dim characters don't drift; padding is plain whitespace, not styled. Non-migration rows (contract nodes, blank/connector rows) are unaffected — only migration data rows participate in the alignment.

### D18 — Lane coloring rules (locked from the start; no post-D1 refinement dispatch)

Six rules, all locked, all implemented in one dispatch:

1. **Vertical lanes (`│`) and structural connectors (`├ ┤ ╮ ╯ ┴ ┬ ┼`)** are colored by their column index, using a rotating palette over `colorette` hues.
2. **Column 0 stays uncolored** (default neutral / dim lane style); the palette rotates over columns ≥ 1. The single-lane linear case is therefore effectively monochrome.
3. **Routed back-arcs render in a single hue** (their owning back-lane color) across the whole arc — vertical back-lane, horizontal bridges, corners, `◂` landing. **Crossings (`┼`) stay dim/neutral** so neither overlapping arc "steals" the cell.
4. **Contract node glyph (`○`)** takes its column's lane color (column-0-neutral rule applies). In the `○◂` / `○─` arc-pair node markers, the `○` half takes the node's lane color and the connector half follows rule 3.
5. **Direction arrows (`↑ ↓ ⟲`) stay bright** — they encode direction, not branch identity, so they pop against the colored gutter.
6. **Data columns (`dirName`, `from → to`, `(refs)`)** are unchanged — color is a gutter / node-marker concern only.

The palette is a 6-hue rotating `colorette` cycle (implementer's choice of hues; constraint: legible on both light and dark terminals, no clash with the green `(refs)` overlay or cyan hashes that would render adjacent tokens indistinguishable). Color is fully gated on the existing `colorize` flag — `--no-color` / `NO_COLOR` / non-TTY / piped output emits zero ANSI and existing plain-text goldens stay byte-identical.

### D19 — `--legend` placement and gating

A `--legend` boolean option on `migration graph` only (not `list`, not `status`). When set: print a legend block to **stderr** so stdout stays pure graph output and `migration graph | …` pipes cleanly. The legend honors the active glyph palette (unicode vs `--ascii`) and `colorize` state — the lane-color key only renders when `colorize` is true. `--legend` does **not** auto-enable any other flag (the original draft proposed auto-enabling `--tree`; that flag was already retired in the `status` slice, so there's nothing to auto-enable).

### D21 — `migration status` default target is the live contract; no-path wording is path-shaped, not marker-shaped

Two coupled fixes on `migration status`'s no-path failure mode, both surfaced during QA of this slice and folded in rather than spilled to follow-up tickets (the wording change is a one-line edit; the picker change is a 4-line edit; neither warrants a separate PR).

**Picker (D14 alignment, radically simplified).** `migration status` has exactly **one** target per invocation. If the user passed `--to <ref-or-hash>`, that's it. Otherwise it's the application's contract (`contractHash`). End of story. The picker collapses to a one-liner:

```ts
function resolveTarget(
  contractHash: string,
  activeRefHash: string | undefined,
): string {
  return activeRefHash ?? contractHash;
}
```

That deletes today's "graph membership" guard (`graph.nodes.has(activeRefHash)` / `graph.nodes.has(contractHash)`) and the single-leaf / head-ref fallbacks. The contract envelope can fail to read; the existing `CONTRACT.UNREADABLE` diagnostic already covers that case and `contractHash` defaults to `EMPTY_CONTRACT_HASH` when it does — the simplified picker returns that value and the no-path summary fires naturally, no special-casing needed.

This also kills the dead `'Multiple valid migration paths — select a target with --to'` summary branch, the `MIGRATION.DIVERGED` diagnostic, and the `hasAmbiguousTarget` guard in `executeMigrationStatusCommand`'s loop. They are unreachable once the picker is total. Imports of `requireHeadRef` and `findReachableLeaves` in `migration-status.ts` are no longer used and get removed (other callers in the framework are unaffected — those helpers stay in their home modules).

**Wording (no-path summary).** "Database marker cannot reach the selected target" mis-frames the failure: markers don't reach, paths exist or don't; "selected" implies the user picked. Three context-aware variants:

- No `--to` (default = live contract): `No migration path from the database state (sha256:abc1234) to the application's contract (sha256:def5678). Run \`prisma-next migration plan --name <name>\` to author one.`
- `--to <ref>`: `No migration path from the database state (sha256:abc1234) to the target (sha256:def5678 via \`prod\`). Run \`prisma-next migration plan --name <name>\` to author one, or pass \`--to <contract>\` to pick a reachable target.`
- `--to <hash>`: same as the ref variant minus `via \`<ref>\``.

Lead-fix is `migration plan` — the most common cause of the failure is "no migration has been authored from the DB state to the live contract yet", and `plan` is what the user needs. The `--to <contract>` alternative only appears when `--to` was explicit (telling someone who didn't pick a target to "pick a different target" is incoherent).

### D20 — Op-count parity is a cross-target obligation, asserted by one harness

The SQL family and Mongo target both emit a `LedgerEntryRecord.operationCount` per applied edge. The contract: for the same plan applied successfully, every backend records the same `operationCount` per edge (including a skipped-op apply path, where the SQL adapter records `executedOperations` after idempotency skip-records and Mongo records planned ops). One table-driven harness in a shared test surface drives a representative plan through every backend (Postgres, SQLite, Mongo, family-sql synth) and asserts per-edge `operationCount` equality. The Postgres op-count-mismatch throw path (currently uncovered; SQLite + Mongo are covered) gains a targeted unit test in the same dispatch.

## Acceptance

- For any single input (same DB state, same on-disk migrations), `migration list`, `migration status`, and `migration graph` produce **byte-identical** pretty rendering of the per-space sections, modulo `status`'s overlay column and per-command footer. Asserted by a shared snapshot test that pipes the same fixture through all three renderers and diffs only the overlay column + footer.
- Trunk choice in all three commands: the chain containing the live contract is the trunk; historical-ref chains render as indented side-branches.
- Space iteration: all three commands render every on-disk space by default; `--space <id>` narrows uniformly; multi-space renderings carry `<spaceId>:` headings; the demo's `pgvector` space appears in `migration graph` output (regression test for the silent-elision bug surfaced during QA).
- Per-row data: `dirName · from → to · N ops · {invariants}` appears on every migration row in every command; `status` appends `✓ applied` / `⧗ pending`.
- Column alignment: in any rendering, the migration data block (dirName onward) starts at the same column offset for every migration row in that per-space section, including non-linear graphs (branches, rollback peels) and `--ascii` mode.
- Lane coloring: a colorized snapshot over a multi-lane fixture (kitchen-sink: diamond + routed back-arc + 3-way fan) asserts (a) lane color rotates by column index, (b) column 0 stays neutral, (c) each routed back-arc is one hue across all its owned cells while crossings stay neutral, (d) node `○` matches its lane color while arrows stay bright. Plain-text (`colorize: false`) goldens for every existing fixture remain byte-identical.
- `--legend`: snapshot coverage for `migration graph --legend` in unicode + `--ascii` × color on/off (4 cases), printed to stderr; stdout unchanged. `--json` / `--dot` paths reject `--legend` cleanly (legend is human-only).
- Op-count parity harness: one table-driven test exercises the same plan through Postgres, SQLite, Mongo, and the family-sql synth path and asserts per-edge `operationCount` equality. The Postgres op-count-mismatch throw path has a unit test covering the throw.
- `migration status` default target + no-path wording (D21): when `--to` is not provided, the picker returns the live contract for any non-empty `contractHash`. With the demo state (DB at live contract `1375f13`, disconnected historical chain ending at `f7a8eb5` reachable via `prod`), `migration status` (no flags) reports `up to date`. With `--to prod` against the same state, the no-path summary reads "No migration path from the database state (sha256:1375f13) to the target (sha256:f7a8eb5 via `prod`). Run `prisma-next migration plan --name <name>` to author one, or pass `--to <contract>` to pick a reachable target." Unit tests pin all three wording variants. The two existing e2e tests in `migration-status-diagnostics.e2e.test.ts` that assert the old wording are updated to assert the new wording (and the post-`db update` scenario is updated to assert `up to date`, since the picker now correctly defaults to the live contract).
- CI green: full `pnpm test:packages` plus `pnpm test:integration` plus `pnpm test:e2e`. `pnpm fixtures:check` clean. The demo (`migration list` / `status` / `graph` against the disconnected-historical-chain demo state) renders consistently across the three commands.

## Out of scope

- **JSON shape unification.** `graph`'s `{ nodes, edges }` stays; `list` / `status` per-space arrays stay. JSON consumers diverge by design (project decisions D2 / D3).
- **Retiring or aliasing `migration graph`.** After this slice, `graph` and `list` produce identical pretty output; their JSON shapes still differ. Whether `graph` should remain a separate top-level command is a future call — deferred per operator. File a follow-up if/when the answer is clear.
- **`edges-on-plan` and `empty-origin-as-null`.** The two on-disk slice drafts under `projects/migration-graph-rendering/slices/` are explicitly **not** in this slice. Neither is in TML-2774's tracked scope. The empty-origin work is also genuinely heavy — `EMPTY_CONTRACT_HASH` is wired into the `MigrationGraph` node-keying, walk algorithms, integrity checks, and ref parsing — and the operator already ruled in the TML-2769 review that the constant's value is "not our fight." File standalone tickets if either is picked up.
- **Trunk-choice extensibility.** This slice locks one rule (live-contract spine). A future `--trunk <ref>` flag is conceivable but not asked for here.
- **Cross-space alignment.** Column alignment is per-render-block; aligning data columns across per-space sections is not asserted. File a follow-up if the operator wants global alignment.

## Pre-investigated edge cases

| Edge case | Disposition |
|---|---|
| `--no-color` / `NO_COLOR` / non-TTY / piped | No lane colors; legend prints plain. `colorize` already short-circuits to the identity styler. Existing plain-text goldens stay byte-identical. |
| `--ascii` | Lane coloring still applies (color is orthogonal to glyph palette); the legend uses the ASCII glyph palette and reads `paletteFor(glyphMode)` from the same source as the renderer. |
| Lane freed and reused by a later branch | Keeps its column's color — `git log --graph` style; no per-branch identity tracking. The only exception is routed back-arcs (rule 3 above). |
| Single-space rendering | No `<spaceId>:` heading (existing convention preserved). |
| Single-lane linear graph | Effectively monochrome (column 0 stays neutral). |
| Demo's stale historical-ref chain (the `prod` ref pointing at `f7a8eb5`, disconnected from the live `1375f13` chain) | Renders as a side-branch in all three commands. Pinned by a snapshot over the demo state. |

## References

- Project: `projects/migration-graph-rendering/` (decisions D1/D2/D3/D4/D11/D14).
- Source modules touched: `packages/1-framework/3-tooling/cli/src/utils/formatters/{migration-graph-rows,migration-graph-tree-render,migration-graph-layout,migration-graph-lane-colors,migration-list-data-column,migration-list-render}.ts`, `packages/1-framework/3-tooling/cli/src/commands/{migration-list,migration-status,migration-graph}.ts`.
- Test surface for op-count parity: a new shared harness in `packages/1-framework/3-tooling/migration/test/` driving Postgres + SQLite (via the SQL family), Mongo (target), and the family-sql synth path; the PG op-count-mismatch throw test lives in `packages/3-targets/3-targets/postgres/test/`.
- Linear: TML-2812 (lead, project), TML-2811, TML-2773, TML-2774. TML-2767 closed as superseded by TML-2812.

## Dispatch plan

Six dispatches. D1–D4 sit on the rendering surface (`packages/1-framework/3-tooling/cli/src/utils/formatters/`) and serialise — D2 builds on the unified pipeline D1 establishes, D3's lane-color selector is reused by D4's legend renderer. D5 sits on a different surface (`packages/1-framework/3-tooling/migration/test/` + the per-target test directories) and parallelises with the rendering work. D6 sits on `cli/src/commands/migration-status.ts` (no overlap with D1–D5's surfaces) and parallelises freely.

### Dispatch 1: unify the rendering pipeline across `list` / `status` / `graph`

- **Outcome:** All three commands route through the same `buildMigrationGraphRows` → `buildMigrationGraphLayout` → `renderMigrationGraphTree` pipeline with the same trunk-choice input (live-contract chain, D14), the same per-row data overlay shape (`dirName · from → to · N ops · {invariants}`, D15), and the same space iteration policy (all on-disk spaces by default, `--space <id>` to narrow, D16). `migration graph` now renders the demo's `pgvector` space; `migration status` adopts the live-contract trunk; `migration status`'s overlay column composes onto the list overlay (rather than replacing it). A shared snapshot test pipes one fixture through all three renderers and asserts byte-identical per-space sections modulo `status`'s overlay column + per-command footer.
- **Builds on:** This spec; the existing shared pipeline (already called from all three commands today) + the `edgeAnnotationsByHash` contract from D11.
- **Hands to:** A unified call-site shape that the next dispatches build on. Trunk + per-row + space-iteration tests green; existing per-command goldens regenerated mechanically; D11 overlay extended in `cli/src/commands/migration-status-overlay.ts` to compose the list overlay with the status column.
- **Focus:** Behavioral unification only. No styling change (lane color is D3); no alignment change (D2); no test-coverage work (D5).

### Dispatch 2: align migration data columns per render block

- **Outcome:** In any per-space section produced by `list` / `status` / `graph`, the migration data block (dirName onward) starts at the same column offset on every migration row, regardless of how deep that row sits in the tree drawing. Computed per render block (D17): max visible width of the tree-prefix across migration rows in that block, right-padded with plain whitespace. Operates on visible glyph width, not raw byte length, so wide / dim / ANSI-styled glyphs don't drift. Non-migration rows (contract nodes, blank/connector rows) are unaffected. A new test over a deliberately non-linear fixture (rollback peel + diamond) asserts alignment in default + `--ascii` modes.
- **Builds on:** Dispatch 1's unified pipeline. The padding logic lives at the row→string join point in `migration-graph-tree-render.ts` (or its data-column helper).
- **Hands to:** Aligned data columns in all three commands; existing goldens regenerate mechanically (whitespace-only diffs); the kitchen-sink fixture pins the rule.
- **Focus:** Whitespace padding. No semantic change, no styling change. Only the join point between tree-prefix and data block changes.

### Dispatch 3: per-column lane coloring with all six rules locked

- **Outcome:** When `colorize` is true, the tree gutter renders per D18 — vertical lanes + connectors colored by column index over a 6-hue rotating palette (column 0 neutral, columns ≥ 1 colored), routed back-arcs single-hue per arc, crossings dim/neutral, node `○` matching its lane color, direction arrows staying bright, data columns unchanged. Plain-text (`colorize: false`) output is byte-identical to today across every existing fixture. A colorized snapshot over a kitchen-sink fixture asserts each of the six rules explicitly.
- **Builds on:** Dispatch 2 (same files, same join point — the alignment-padded layout is what the colorizer wraps). The existing `migration-graph-lane-colors.ts` module.
- **Hands to:** Colored gutter behind `colorize`; a column→color selector + a per-arc-id color resolver exported from the lane-colors module for D4's legend renderer to reuse. Plain-text goldens unchanged.
- **Focus:** Lane + node-marker coloring. No legend (D4); no layout-model change; no new flag.

### Dispatch 4: `--legend` flag on `migration graph`

- **Outcome:** `migration graph --legend` prints a palette-aware, color-aware legend block to **stderr** (D19), describing the glyph language (`○ ↑ ↓ ⟲ ∅ → (refs)`) and the lane-color cycle (only when `colorize` is true, reusing dispatch 3's selector). `--legend` is rejected with a clear error on `--json` / `--dot` (legend is human-only). `--ascii` swaps the legend's glyph palette to match. Snapshot coverage for the four cases (unicode + ascii × color on / off). `--help` examples and the reference doc mention `--legend`.
- **Builds on:** Dispatch 3's exported color selector. The existing `createMigrationGraphCommand` flag plumbing in `cli/src/commands/migration-graph.ts`.
- **Hands to:** New flag + legend renderer landed; legend goldens green; plain-text + colorized graph goldens from D3 unchanged; `--json` / `--dot` regression-green.
- **Focus:** Flag + legend block + docs. No change to lane-color mechanics.

### Dispatch 5: cross-target op-count parity harness + Postgres throw test

- **Outcome:** One table-driven harness drives a representative plan (greenfield baseline + a multi-edge apply, including a path that exercises an idempotency-skipped op) through Postgres, SQLite, Mongo, and the family-sql synth strategy, and asserts per-edge `LedgerEntryRecord.operationCount` equality across every backend (D20). A separate unit test in the Postgres adapter covers the op-count-mismatch throw path that's currently uncovered (SQLite + Mongo are covered).
- **Builds on:** This spec + the merged ledger journal (TML-2769). No dependency on D1–D4.
- **Hands to:** TML-2774 items 3 + 5 closed; ledger-journal cross-target invariant pinned in CI.
- **Focus:** Test coverage on the migration runners' ledger writes. No production-code change unless the harness surfaces a real parity bug, in which case the dispatch reports back rather than fixing in-line (a parity bug is its own ticket).

### Dispatch 6: `migration status` default target + no-path wording

- **Outcome:** Two coupled fixes per D21, both in `cli/src/commands/migration-status.ts`. (a) Picker collapses to `activeRefHash ?? contractHash` — explicit `--to` wins, otherwise the application's contract. The dead `MIGRATION.DIVERGED` diagnostic + `hasAmbiguousTarget` guard + `'Multiple valid migration paths'` summary branch are removed. Unused imports (`requireHeadRef`, `findReachableLeaves`) drop out. (b) The no-path summary is replaced by a context-aware builder `buildNoPathSummary({ markerHash, targetHash, explicitTarget, refName })` exported alongside `buildStatusHeadline`, with three variants: no `--to` (default → "the application's contract (…)"), `--to <ref>` ("the target (… via \`<ref>\`)"), `--to <hash>` ("the target (…)"). Lead-fix is `migration plan --name <name>`; the `--to <contract>` alternative appears only when `--to` was explicit.
- **Builds on:** This spec. No dependency on D1–D5; touches `migration-status.ts` only, which D1 already adapted but does not re-enter for this fix.
- **Hands to:**
  - Picker change locked behind unit tests for the simplified two-line semantics: (i) `activeRefHash` non-undefined → returned regardless of `contractHash`; (ii) `activeRefHash` undefined → `contractHash` returned (including the `EMPTY_CONTRACT_HASH` case).
  - Wording change locked behind unit tests for all three variants (`buildNoPathSummary({...})` exposed alongside `buildStatusHeadline` for direct testing).
  - The two e2e assertions in `test/integration/test/cli-journeys/migration-status-diagnostics.e2e.test.ts` updated: the post-`db update` scenario (line ~286) now asserts `up to date` (picker correctly defaults to the live contract; DB matches it); the marker-on-wrong-branch + `--to production` scenario (line ~536) now asserts the new wording with the `via \`production\`` ref name. Any tests relying on the deleted `MIGRATION.DIVERGED` diagnostic / `'Multiple valid migration paths'` summary are deleted (the operator is comfortable removing the diagnostic; the simplified picker makes it unreachable).
- **Focus:** Picker simplification and message clarity in `migration-status.ts`. No change to overlay computation, no change to render pipeline, no new flags. Do **not** introduce a new ticket for either change — both land in this PR.
