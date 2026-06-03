# Slice: `migration list` renders the graph tree in human output

_Parent project `projects/migration-graph-rendering/`. Outcome this slice contributes to: `migration list`'s flat, lexicographically-ordered text is unreadable for a branching history. This slice routes `list`'s human (pretty/TTY) output through the shared tree renderer — package-annotated — while keeping its machine output flat for tooling. It also **introduces the shared edge-annotation overlay** (D11) that `status` (TML-2748) then extends. Tracking: [TML-2768](https://linear.app/prisma-company/issue/TML-2768)._

## At a glance

Human (TTY) — `list` draws the shared tree; migration (edge) rows carry op count + `{invariants}`; refs ride the node overlay:

```
$ prisma-next migration list
app:
○   3b2d98d                      (main)
│↑  20260303_add_phone     ef9de27 → 3b2d98d   2 ops  {phone_present}
○   ef9de27
│↑  20260301_init          ∅ → ef9de27         5 ops
○   ∅
```

Machine (`--json`, or any pipe) — unchanged flat package array:

```
$ prisma-next migration list --json
{ "ok": true, "spaces": [ { "spaceId": "app", "migrations": [ … ] } ], "summary": "…" }
```

## Chosen design

Per project decisions D1/D2/D3/D11:

- **Pretty/TTY path** → render via the shared tree engine (`buildMigrationGraphRows` → `buildMigrationGraphLayout` → `renderMigrationGraphTree`), one disconnected tree per space (D4 — all on-disk spaces, `spaceId:` heading when multi-space; `--space` already narrows). `list` builds the per-space graph from the same `aggregate.space(id)` it already enumerates.
- **Edge annotations (D11)** → `list` populates `edgeAnnotationsByHash: Map<migrationHash, { operationCount, invariants }>` from each `MigrationListEntry` (which already carries `operationCount` + `providedInvariants`). **Refs are a node overlay** (`refsByHash`, keyed by each migration's `to` contract hash) — the same channel `graph` uses — not an edge annotation.
- **This slice introduces `edgeAnnotationsByHash` + `MigrationEdgeAnnotation`** on `RenderMigrationGraphTreeOptions` (D11), populating only the `operationCount`/`invariants` keys. `status` (TML-2748) later adds the `status` key. The renderer renders whichever keys are present; absent ⇒ plain row.
- **`--json` and future text-only** → unchanged flat package array (`MigrationListResult`). The tree never appears in a machine format. Free of pipe-safety concerns: `resolveOutputFormat` already returns `json` for non-TTY stdout, so the human renderer only runs interactively.

`list` and `graph` share the renderer but differ in annotations and JSON (D2): `list` is package-centric (every on-disk package is an edge row, including parallel/duplicate/disconnected edges); `graph` is contract-centric (deduplicated nodes + `(contract)`/`(refs)` overlays).

### Description-wording fix (no behaviour change to flat order)

`migration list`'s description claims "latest first"; the flat sort is `compareDirNamesDescending` — lexicographic by dir name, not chronological. **The flat/`--json` order is unchanged** (kept byte-identical, lexicographic-descending by `dirName`); only the misleading "latest first" wording in the command description is corrected. (Tree order is topological regardless of the flat sort.)

## Scope

**In:**

- Route `migration list` pretty/TTY output through the shared tree renderer with edge annotations (op count, invariants) + refs node overlay, per space.
- Introduce `edgeAnnotationsByHash` + `MigrationEdgeAnnotation` on `RenderMigrationGraphTreeOptions` (the D11 shared field) and render the `operationCount`/`invariants` keys.
- Keep `--json` flat and byte-identical. `--space` narrowing and `--ascii` glyph mode drive the tree.
- Correct the "latest first" description wording.
- Tests: pretty render across linear + branching + multi-space; `--json` shape byte-identical to today; `--space` narrowing; `--ascii` glyph mode on the tree.

**Out:**

- `migration graph` (separate command, separate JSON) — untouched here.
- The `MigrationListResult` JSON shape (stays the flat package array).
- The `status` overlay key on `edgeAnnotationsByHash` (TML-2748 adds it).
- Any flat-order change (explicitly unchanged).

## Pre-decided edge cases

| Edge case | Disposition |
|---|---|
| Parallel / duplicate edges (N packages, same `from → to`) | Each is its own edge row — `list` is package-faithful, unlike `graph`'s deduplicated nodes. The tree engine already renders parallel edges. |
| Disconnected packages (orphan `from`) | Rendered as a disjoint tree component (the renderer already handles disjoint forests). |
| A migration with no invariants / zero `ops` | Annotation shows `N ops`; `{invariants}` omitted when the set is empty. |
| Two migrations sharing a `to` that a ref points at | Ref renders once on the shared `to` node (node overlay dedups by hash). |
| `--ascii` | Drives the tree's glyph mode (box-drawing → ASCII), same as `graph --ascii`. |
| Empty space (no migrations) | Existing per-space empty-state line, unchanged. |
| `--space <id>` unknown | Existing `errorSpaceNotFound` (enumerates available ids), unchanged. |

## Dispatch plan

1. **Renderer: introduce the shared edge-annotation overlay (D11).** Add `MigrationEdgeAnnotation` + `edgeAnnotationsByHash` to `RenderMigrationGraphTreeOptions`; render `operationCount` (`N ops`) and `{invariants}` on the migration row when present. Pure renderer change + unit tests (snapshot rows with/without annotations). *Hands to 2 + 3; this is the field `status` rebases onto.*
2. **`list` → tree wiring.** In `migration-list.ts`, replace `renderMigrationListHumanOutput`'s flat path with the tree pipeline per space; build `edgeAnnotationsByHash` from `MigrationListEntry` (`operationCount`, `providedInvariants`) and `refsByHash` from entries' `to`+`refs`. Keep `--json` untouched. *Builds on 1.*
3. **Description fix + tests.** Correct "latest first" wording; add command tests (linear/branching/multi-space pretty render, `--json` byte-identical, `--space`, `--ascii`). *Builds on 2.*

## Slice-specific done conditions

- `migration list` (TTY) renders the package-annotated tree per space (op count + invariants on edges, refs on nodes); `migration list --json` is byte-identical to today; `--space` and `--ascii` behave; description no longer claims "latest first"; `edgeAnnotationsByHash`/`MigrationEdgeAnnotation` exist on the renderer for `status` to extend.

## Sequencing

Runs in parallel with `status` (TML-2748) and `log` (TML-2770). **Land this slice first** where schedules allow (D11): it introduces `edgeAnnotationsByHash`, which `status` extends with the `status` key — landing first means `status` rebases onto an existing field rather than both introducing it. No hard blocker either way (the field is additive).

## References

- Project decisions: `projects/migration-graph-rendering/decisions.md` (D1–D4, D11).
- Linear: [TML-2768](https://linear.app/prisma-company/issue/TML-2768); lineage [TML-2697](https://linear.app/prisma-company/issue/TML-2697).
- Shared renderer: `cli/src/utils/formatters/migration-graph-{rows,layout,tree-render}.ts`.
- `list` command + flat renderer: `cli/src/commands/migration-list.ts`, `cli/src/utils/formatters/migration-list-render.ts`, `migration-list-types.ts`.
