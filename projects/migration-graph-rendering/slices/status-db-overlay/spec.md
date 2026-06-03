# Slice: `migration status` = the shared tree + a DB-state overlay; delete dagre

_Parent project `projects/migration-graph-rendering/`. Outcome this slice contributes to: `migration status` tells the user where their connected database sits relative to all on-disk migrations. It renders the **same tree** as `migration list`/`graph` (the shared engine) and overlays, per migration, **applied** or **pending**; everything else is plain. It also retires the dagre renderer (its last consumer) and makes the condensed tree the default for `migration graph` (drops the experimental `--tree` flag). Tracking: [TML-2748](https://linear.app/prisma-company/issue/TML-2748)._

## At a glance

```
$ prisma-next migration status
app:
○   3b2d98d                      (contract) (main)
│↑  20260305_add_avatar    73e3abe → 3b2d98d   ⧗ pending
○   73e3abe                      (db)
│✓  20260303_add_phone     ef9de27 → 73e3abe   ✓ applied
○   ef9de27
│✓  20260301_init          ∅ → ef9de27         ✓ applied
○   ∅

1 pending — run `prisma-next migrate --to 3b2d98d`
```

- **applied** (green `✓`) — a ledger entry exists for this migration (exact `migrationHash` match, D7). Literal "ever ran" — a rolled-back migration still reads applied here; the timeline lives in `log`.
- **pending** (yellow `⧗`) — on the shortest path from the DB marker to the target contract, and not applied (runs next on `migrate`).
- everything else — plain (full list, no subgraph pruning).
- `(db)` marks the DB's current contract; `(contract)`/refs ride the existing node overlays.

## Chosen design

Per D1/D6/D9/D11:

- **Render the shared tree directly** via the `graph --tree` engine (`buildMigrationGraphRows` → `buildMigrationGraphLayout` → `renderMigrationGraphTree`) — **not** dagre, **not** `list`'s flat renderer. `status` does not depend on `list` adopting the tree (TML-2768); it calls the engine itself.
- **Overlay via the shared edge-annotation field (D11):** `status` populates `edgeAnnotationsByHash: Map<migrationHash, { status: 'applied' | 'pending' }>`. The `(db)` marker uses the **existing** `dbHash` node overlay (already in `RenderMigrationGraphTreeOptions`). If TML-2768 has landed, `edgeAnnotationsByHash` already exists and `status` only adds the `status` key; if not, `status` introduces the field per D11's type.
- **applied set — from the ledger, not the graph.** Per space, `applied = { e.migrationHash | readLedger(space) has a row with that hash }` (exact match). This **replaces** `deriveEdgeStatuses`'s current `findPath(∅→marker)`-derived applied set and resolves TML-2130 (applied must come from the ledger, not a graph walk).
- **pending set — shortest path, minus applied.** `pending = edges on findPath(dbMarker → target) that are not applied`. `target` = `--to` ref/hash if given, else the app contract hash (existing target resolution).
- **Multi-space (D4):** render **every** on-disk space as its own tree section (`spaceId:` heading when >1 space), matching `list`/`graph`. Per space: marker from `readAllMarkers()` (space→`ContractMarkerRecord`), ledger from `readLedger(spaceId)`, graph from `aggregate.space(spaceId)`. `--space <id>` narrows (reuses `list`'s `errorSpaceNotFound`).
- **Origin/target controls (D9):** default origin = DB marker, default target = app contract. `--to X` retargets to ref/hash. `--from X` overrides the origin (offline-capable). **The applied overlay shows iff the origin is the real DB** (online, no `--from`); with `--from`, applied-ness is meaningless and the overlay drops (pending still computes from `X → target`). `status` requires a connected DB **unless** `--from` supplies the origin. `(db)` node marker shows iff a DB is connected.
- **Summary footer (D10):** one short footer — a headline (`up to date` / `N pending — run prisma-next migrate --to X` / a divergence warning) plus a `missing invariant(s): …` line **only** when targeting a ref that declares required invariants the DB lacks. Path-selection/tie-break detail is **not** here (→ future `migration path`, TML-2771); a ref's *declared* invariants are **not** here (→ `ref show`, TML-2772) — `status` shows only the actionable *missing* set.
- **`--json`** = `list`'s shape (`{ ok, spaces: [{ spaceId, migrations: MigrationListEntry[] }], summary }`) augmented with a per-migration `status: 'applied' | 'pending' | null` field, plus top-level `markerHash: string | null` and `targetHash: string` per space section (`{ spaceId, markerHash, migrations: [{ …entry, status }] }`). Tree never appears in JSON (D3).
- **Delete dagre (D5):** remove `graph-render.ts`, `graph-migration-mapper.ts`, `graph-types.ts`, the `@dagrejs/dagre` dependency, and their tests; make the tree the default for `migration graph` (drop the experimental `--tree` flag; keep `--ascii`/`--legend`/`--dot`/`--json`). `rg 'dagre|graphRenderer|migrationGraphToRenderInput'` over `cli/` returns empty.

## Scope

**In:**

- `migration status` renders the shared tree per space + applied/pending edge overlay + `(db)` node marker.
- applied from `readLedger` (exact hash); pending from `findPath(marker→target)` minus applied; per space.
- `--from`/`--to` per D9; `--space` per D4; the lean summary footer (headline + missing-invariants line).
- `--json` = list shape + `status` field + `markerHash`/`targetHash`.
- Delete dagre + mapper + types + dependency + tests; drop `migration graph`'s `--tree` flag (tree is default).
- Tests: online up-to-date / pending / divergence; `--from` (offline, applied dropped); `--to` ref+hash; multi-space; `--json` shape; `migration graph` default-is-tree; `rg dagre` empty.

**Out:**

- `migration list` / `migration graph` rendering themselves beyond dropping `--tree` (own tickets).
- The ledger read API (TML-2769, merged).
- `migration path` (TML-2771) and `ref show` invariants (TML-2772).
- Introducing package-fact edge annotations (that's TML-2768; `status` only adds the `status` key to the shared field).

## Pre-decided edge cases

| Edge case | Disposition |
|---|---|
| DB marker hash not in the on-disk graph (divergence) | Render the full tree, **no pending overlay** (no path computable), applied overlay still shown from the ledger; footer headline = divergence warning naming the marker hash. |
| Online, no DB connection and no `--from` | Hard error: a DB is required unless `--from` supplies the origin (D9). |
| `--from X` (offline) | Applied overlay drops; `(db)` marker not shown; pending = `findPath(X → target)` minus nothing (no applied set). |
| DB at the target already (at head) | No pending; footer = `up to date`. |
| A pending edge that is also applied (re-apply scenario) | applied wins (ledger is authoritative); never both — `applied` takes precedence in the overlay. |
| Migration hash applied but its package no longer on disk | The edge isn't in the on-disk graph, so it has no row to overlay; the ledger truth surfaces in `log`, not `status` (status is on-disk + overlay). |
| `--space <id>` unknown | `errorSpaceNotFound` (enumerates available ids), reused from `list`. |
| Empty space (no migrations) | Per-space empty-state line; no overlay. |
| `--to` ref with required invariants the DB lacks | `missing invariant(s): …` footer line; render proceeds. |

## Dispatch plan

1. **Renderer: `status` overlay key.** Ensure `edgeAnnotationsByHash`/`MigrationEdgeAnnotation` exist (rebase onto TML-2768, or introduce per D11) and render `status: 'applied'` → green `✓`, `'pending'` → yellow `⧗` on the migration row. `(db)` already works via `dbHash`. Renderer unit tests (applied/pending/plain rows; db marker). *Hands to 3.*
2. **Status computation (ledger-sourced).** Per space: build `applied` from `readLedger(space)` (exact `migrationHash` set), `pending` from `findPath(marker→target)` minus applied; honour `--from`/`--to` (applied dropped under `--from`). Replace the applied-from-graph path in `deriveEdgeStatuses` (resolves TML-2130). Pure-function unit tests (online/offline/divergence/at-head). *Hands to 3.*
3. **Command rewrite.** Rewrite `migration-status.ts` to: enumerate spaces (`readAllMarkers` + `aggregate.space`), render the shared tree per space with the overlays from 1+2, emit the lean footer, and emit the augmented `--json`. `--space` narrowing. *Builds on 1+2.*
4. **Delete dagre + flip `graph` default.** Remove `graph-render.ts`, `graph-migration-mapper.ts`, `graph-types.ts`, `@dagrejs/dagre` (package.json + lockfile via `pnpm install`), their tests + vitest refs; drop `migration graph`'s `--tree` flag (tree is default, keep `--ascii`/`--legend`/`--dot`); update graph command + tests. Verify `rg 'dagre|graphRenderer|migrationGraphToRenderInput'` over `cli/` is empty. *Independent of 1–3 except the final graph-command edit; sequence last to avoid churn.*

## Slice-specific done conditions

- `status` renders the full per-space tree + applied/pending overlay via the shared renderer; `--from`/`--to`/`--space` behave per D9/D4; applied comes from the ledger (exact hash), pending from shortest path minus applied; footer is headline + missing-invariants only; `--json` = list shape + `status` + `markerHash`/`targetHash`; dagre + mapper + types + dependency + tests are gone and `--tree` is the default (flag dropped); `rg 'dagre|graphRenderer|migrationGraphToRenderInput'` over `cli/` is empty; CI green.

## Sequencing

Parallel with `list`→tree (TML-2768) and `log` (TML-2770). Soft-depends on TML-2768 only for the `edgeAnnotationsByHash` field (D11) — rebase if TML-2768 lands first, else introduce the field here. The dagre deletion (dispatch 4) is self-contained.

## References

- Project decisions: `projects/migration-graph-rendering/decisions.md` (D1, D5, D6, D9, D10, D11).
- Linear: [TML-2748](https://linear.app/prisma-company/issue/TML-2748); resolves applied-from-ledger [TML-2130](https://linear.app/prisma-company/issue/TML-2130).
- Renderer: `cli/src/utils/formatters/migration-graph-{rows,layout,tree-render}.ts`.
- Current status + computation: `cli/src/commands/migration-status.ts` (`deriveEdgeStatuses`, `formatStatusSummary`).
- Ledger read: `ControlClient.readLedger(space)` (`cli/src/control-api/client.ts`), `readAllMarkers()`.
- Dagre to delete: `cli/src/utils/formatters/graph-render.ts`, `graph-migration-mapper.ts`, `graph-types.ts`.
