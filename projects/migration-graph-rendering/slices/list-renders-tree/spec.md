# Slice: `migration list` renders the graph tree in human output

_Parent project `projects/migration-graph-rendering/`. Outcome this slice contributes to the project's purpose: `migration list`'s flat, lexicographically-ordered text is unreadable for a branching history. This slice routes `list`'s human (pretty/TTY) output through the shared Tier-3 tree renderer — package-annotated — while keeping its machine formats flat for tooling. Tracking: [TML-2768](https://linear.app/prisma-company/issue/TML-2768)._

## At a glance

Human (TTY) — `list` draws the shared tree, annotated with per-migration package facts:

```
$ prisma-next migration list
app:
○   3b2d98d
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

Per project decisions D1/D2/D3:

- **Pretty/TTY path** → render via the shared Tier-3 renderer (`buildMigrationGraphRows` → `buildMigrationGraphLayout` → `renderMigrationGraphTree`), one disconnected tree per space (D4 — all spaces, `spaceId:` heading when multi-space; `--space` already narrows). Edge rows carry `list`'s package annotations (op count, `{invariants}`, `(refs)`).
- **`--json` and future text-only** → unchanged flat package array (`MigrationListResult`). The tree never appears in a machine format.
- This is free of pipe-safety concerns: `resolveOutputFormat` already returns `json` for non-TTY stdout, so the human renderer only runs interactively.

`list` and `graph` share the renderer but differ in annotations and JSON (D2): `list` is package-centric (every on-disk package is an edge row, including parallel/duplicate/disconnected edges); `graph` is contract-centric (deduplicated nodes + overlays).

### Ordering / description fix

`migration list`'s description claims "latest first"; the sort is `compareDirNamesDescending` — lexicographic by dir name, not chronological, and the timestamp prefix records *creation* not application. In the tree, ordering is topological anyway. Fix the misleading "latest first" wording in the command description; the flat (`--json`/text) path keeps a deterministic order (consider `createdAt` over lexicographic, settled at pickup).

## Scope

**In:**

- Route `migration list`'s pretty/TTY output through the shared tree renderer with package annotations (op count, invariants, refs), per space.
- Keep `--json` flat (unchanged shape). Reserve a future text-only flat format (not built here unless trivial).
- Correct the "latest first" description; settle the flat-path sort key.
- Tests: pretty render across linear + branching + multi-space; `--json` shape unchanged; `--space` narrowing; `--ascii` glyph mode on the tree.

**Out:**

- `migration graph` (separate command, separate JSON).
- The `MigrationListResult` JSON shape (stays the flat package array).
- Multi-space policy mechanics (delivered by TML-2767; this slice consumes the same per-space enumeration).

## Pre-investigated edge cases

| Edge case | Disposition |
|---|---|
| Parallel / duplicate edges (N packages, same `from → to`) | Each is its own edge row — `list` is package-faithful, unlike `graph`'s deduplicated nodes. |
| Disconnected packages (orphan `from`) | Rendered as a disjoint tree component (the Tier-3 renderer already handles disjoint forests). |
| `--ascii` | Drives the tree's glyph mode (box-drawing → ASCII), same as `graph --ascii`. |
| Empty space | Existing empty-state line per space, unchanged. |

## Slice-specific done conditions

- [ ] `migration list` (TTY) renders the package-annotated tree per space; `migration list --json` shape is byte-identical to today; `--space` and `--ascii` behave; description no longer claims "latest first".

## Sequencing

Land after TML-2748 (shared renderer becomes the default; no `--tree` flag) so `list` calls the renderer directly, not a flagged variant.

## References

- Project decisions: `projects/migration-graph-rendering/decisions.md` (D1–D4).
- Linear: [TML-2768](https://linear.app/prisma-company/issue/TML-2768); lineage [TML-2697](https://linear.app/prisma-company/issue/TML-2697).
- Shared renderer: `cli/src/utils/formatters/migration-graph-{rows,layout,tree-render}.ts`.
- `list` command + flat renderer: `cli/src/commands/migration-list.ts`, `cli/src/utils/formatters/migration-list-render.ts`.
