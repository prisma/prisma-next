# ADR 227 — Migration read commands share one graphical renderer with command-specific annotations

## Status

Accepted. Builds on [ADR 039 — Migration graph path resolution & integrity](./ADR%20039%20-%20Migration%20graph%20path%20resolution%20%26%20integrity.md) and [ADR 218 — Refs with paired contract snapshots](./ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md).

## Decision

The three migration read commands that visualize on-disk state — `migration list`, `migration graph`, and `migration status` — all draw the same condensed tree renderer. They diverge only in the per-edge annotations they feed into `edgeAnnotationsByHash`:

```ts
// packages/1-framework/3-tooling/cli/src/utils/formatters/migration-graph-labels.ts
export interface MigrationEdgeAnnotation {
  readonly status?: 'applied' | 'pending';
  readonly operationCount?: number;
  readonly invariants?: readonly string[];
  readonly pathHighlight?: 'on-path' | 'off-path';
}
```

Each command populates only the keys it owns and passes a `ReadonlyMap<string, MigrationEdgeAnnotation>` — keyed by `migrationHash` — to `renderMigrationGraphSpaceTree`:

- `migration list` → `operationCount` + `invariants` (per-package facts) and `refsByHash` node overlays.
- `migration graph` → `refsByHash` + `contractHash` node overlays; no edge annotations.
- `migration status` → `status: 'applied' | 'pending'` edge annotation + `dbHash` node overlay.
- `migrate --show` → `pathHighlight: 'on-path' | 'off-path'` edge annotation (focus mode).

The renderer (`renderMigrationGraphCommand`) derives lane geometry and gutter from the graph topology alone; label text and styling come from the annotations. An absent annotation means the row renders plain.

`migration list` and `migration graph` stay distinct commands. Their machine output (`--json`) differs: `list` emits a flat package array; `graph` emits `{ nodes, edges }`. The shared tree is human/TTY output only — `resolveOutputFormat` auto-switches to JSON on non-TTY, so the tree never runs in pipes or scripts.

The trunk in every space tree is always the chain containing the live contract — the contract the app currently emits (`liveContractHash` in `RenderMigrationGraphSpaceTreeInput`). Disconnected sub-graphs render as side-branches. All three commands use the same `liveContractHash` for trunk resolution, supplied by the contract-space aggregate loader.

The `@contract` marker (the live working contract node) renders only in the app space. Extension spaces do not show a floating `@contract` node. This is enforced by threading `isAppSpace` through to `renderMigrationGraphSpaceTree`:

```ts
// packages/1-framework/3-tooling/cli/src/utils/formatters/migration-graph-space-render.ts
export interface RenderMigrationGraphSpaceTreeInput {
  readonly liveContractHash: string;
  readonly isAppSpace?: boolean;   // default true; false suppresses @contract in extensions
  // …
}
```

The `@db` marker (the live database position) is per-space and appears in every space that has a connected database.

Reserved markers use sigil form (`@contract`, `@db`) in both the graph and the `--legend` output. These are also the tokens accepted by `--from`/`--to` flags — the graph shows exactly what you can type.

The dagre renderer and the Tier-2 list-graph gutter have been deleted. The condensed tree is the default; there is no `--tree` flag.

## Context

`migration graph` originally had two renderers: a dagre force-directed graph and a condensed tree behind an experimental `--tree` flag. `migration status` used the dagre renderer. `migration list` had its own flat list view.

Maintaining two renderers meant every visual improvement needed duplicate work. More concretely: `status` used dagre while `graph --tree` existed in parallel, so the two had different trunks and annotation vocabularies. TML-2746 redesigned the renderer; TML-2748, TML-2768, TML-2812 brought all three commands onto it.

## Design

### Annotation map

The `edgeAnnotationsByHash` field on `RenderMigrationGraphSpaceTreeInput` carries all per-migration annotations as a sparse map. The renderer reads whatever keys are present and skips absent ones. This makes the field additive — commands that land in sequence do not collide because each writes only its own keys.

`migration status` merges its `statusOverlayByHash` with the list overlay before calling the renderer:

```ts
// packages/1-framework/3-tooling/cli/src/utils/formatters/migration-graph-space-render.ts
export function mergeMigrationEdgeAnnotations(
  listOverlay: ReadonlyMap<string, MigrationEdgeAnnotation>,
  statusOverlay: ReadonlyMap<string, MigrationEdgeAnnotation>,
): ReadonlyMap<string, MigrationEdgeAnnotation>
```

### Trunk selection

Every command calls `buildMigrationGraphRows` with the `liveContractHash`. The row builder places the chain containing that hash on the trunk and all other chains as side-branches. Trunk selection is not configurable.

`migration graph` detects the app space via `aggregate.app.spaceId` and passes `isAppSpace: spaceEntry.space === aggregate.app.spaceId` for each space section. `migration status` does the same.

### Machine output

`--json` output is command-specific and flat:

- `migration list --json` → package array.
- `migration graph --json` → `{ nodes, edges }`.
- `migration status --json` → list shape plus a per-migration `status` field.

The tree is never included in machine output.

### All spaces by default

All three commands render every on-disk contract space by default, each as its own per-space section/tree. `--space <id>` narrows to one space. Headings appear only when more than one space is present.

### Applied vs pending in `status`

`migration status` computes the overlay by reading the ledger (see [ADR 228](#)):

- **applied** — a ledger entry exists for this migration's `migrationHash`. Renders green `✓ applied`.
- **pending** — on the shortest path from the DB's current contract hash to the live contract, and not applied. Renders yellow `⧗ pending`.

All other migrations render plain (on-disk but neither applied nor pending relative to the current path).

## Consequences

- One renderer to maintain. Visual improvements to layout, gutter, lane colouring, and label formatting apply uniformly to all three commands.
- New annotations are additive. Adding a new `MigrationEdgeAnnotation` key does not affect commands that don't populate it.
- The trunk rule is fixed. Commands cannot diverge on trunk selection without editing the renderer.
- Machine output is per-command and stable. `--json` callers are not affected by graphical output changes.

## Alternatives considered

- **Keep dagre and tree in parallel.** Rejected. Two renderers diverged in practice (`list` chose the live-contract trunk, `status` chose the historical-ref trunk) and duplicated maintenance.
- **Merge `list` and `graph` into one command.** Rejected. Their machine output is durably different and their questions are distinct ("what packages are on disk?" vs "what contract topology do they describe?"). They may diverge further.
- **Per-command annotation types instead of a shared interface.** Rejected in favor of one additive map. Separate types would require the renderer to accept a union, making the sparse-map semantics harder to express.
- **Parametric trunk choice (`--trunk <ref>`).** Deferred. Locking one rule (live contract = trunk) was the priority; user-configurable trunk is an additive follow-on if needed.

## References

- [ADR 039 — Migration graph path resolution & integrity](./ADR%20039%20-%20Migration%20graph%20path%20resolution%20%26%20integrity.md) — graph model and path computation this renderer visualizes.
- [ADR 218 — Refs with paired contract snapshots and universal graph-node invariant](./ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md) — refs rendered as node overlays.
- [ADR 228 — Migration apply ledger is a per-migration journal](./ADR%20228%20-%20Migration%20apply%20ledger%20is%20a%20per-migration%20journal.md) — ledger that backs the `status` applied/pending overlay and `log`.
- Tickets: TML-2746 (renderer redesign), TML-2748 (`status` + dagre deletion), TML-2768 (`list` tree), TML-2812 (trunk-choice parity).
