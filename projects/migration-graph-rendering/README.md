# migration-graph-rendering

Redesign of the `migration graph` (Tier 3) command's rendering: a condensed,
deterministic, annotated node-link diagram that draws **contracts as nodes and
migrations as edges**, with complete back-edges, replacing the current dagre
layout and its golden-path root/tip selection.

Tracking ticket: [TML-2746](https://linear.app/prisma-company/issue/TML-2746).
The tolerant graph source already ships — `migration graph` loads through the
ContractSpace aggregate and holds a multi-root / multi-tip / cyclic-tolerant
`MigrationGraph` (`aggregate.app.graph()`). This slice replaces only the
golden-path mapper + dagre renderer on top of that source; it is related to,
but not blocked by, the consolidation project (TML-2739).

## Slices

1. **Redesign the Tier-3 renderer** — [`spec.md`](./spec.md). The condensed
   annotated node-link diagram (shipped in PR #658).
2. **Retire `migration list --graph`** —
   [`slices/remove-list-graph-renderer/spec.md`](./slices/remove-list-graph-renderer/spec.md)
   ([TML-2765](https://linear.app/prisma-company/issue/TML-2765)). Now that the
   Tier-3 tree is compact and correct, the Tier-2 list-graph gutter is the
   redundant middle; this slice removes it, leaving one graph renderer.
3. **`migration graph` multi-space** —
   [`slices/migration-graph-space-flag/spec.md`](./slices/migration-graph-space-flag/spec.md)
   ([TML-2767](https://linear.app/prisma-company/issue/TML-2767)). Makes the read
   commands consistent: `graph` draws every on-disk space as a disconnected
   per-space tree by default, with `--space <id>` to narrow — matching
   `migration list`. Deferred — land after `--tree` becomes the default
   (TML-2748).
4. **`migration list` renders the tree (human output)** —
   [`slices/list-renders-tree/spec.md`](./slices/list-renders-tree/spec.md)
   ([TML-2768](https://linear.app/prisma-company/issue/TML-2768)). `list`'s
   pretty/TTY output adopts the shared tree renderer (package-annotated); its
   `--json` stays flat for tooling. Introduces the shared `edgeAnnotationsByHash`
   overlay (D11) that `status` extends. Completes the intent of TML-2697. Runs in
   parallel with slices 6–7; land first where possible (D11).

The project has broadened from the `graph` renderer into the whole **migration
read-command family** (`list` / `graph` / `status` / `log`). Cross-cutting design
decisions (the command-family model, shared renderer, space policy, `list`/`graph`
split, the ledger foundation) live in [`decisions.md`](./decisions.md).

5. **Ledger foundation** ([TML-2769](https://linear.app/prisma-company/issue/TML-2769)) —
   make the on-apply ledger readable; store migration hash + name; add
   `readLedger`. Control-plane (all targets). **Merged** (PR #665).
6. **`status` = shared tree + DB-state overlay** —
   [`slices/status-db-overlay/spec.md`](./slices/status-db-overlay/spec.md)
   ([TML-2748](https://linear.app/prisma-company/issue/TML-2748)). Renders the
   shared tree directly via the `graph --tree` engine + an applied/pending edge
   overlay (`status` key on D11's `edgeAnnotationsByHash`) + the `(db)` node
   marker; `--from`/`--to` (D9), `--space` (D4); applied comes from the ledger
   (resolves [TML-2130](https://linear.app/prisma-company/issue/TML-2130)); deletes
   dagre and makes the tree the default for `graph` (drops `--tree`).
7. **`log` reads the ledger** —
   [`slices/log-reads-ledger/spec.md`](./slices/log-reads-ledger/spec.md)
   ([TML-2770](https://linear.app/prisma-company/issue/TML-2770)). Flat,
   chronological, single-table apply history straight from the DB ledger (all
   spaces merged; no tree, no per-space sections); local-time human output with a
   `--utc` flag, ISO-UTC JSON.

Slices 4, 6, and 7 run **in parallel** off the merged ledger foundation, each on
its own branch/PR. The only shared surface is the tree renderer's
`edgeAnnotationsByHash` field (D11), touched by 4 and 6 (additively); `log` (7)
shares none of it.

8. **Unify pretty rendering across `list` / `status` / `graph`** —
   [`slices/unify-pretty-rendering/spec.md`](./slices/unify-pretty-rendering/spec.md)
   ([TML-2812](https://linear.app/prisma-company/issue/TML-2812)). Closes the gap
   between D1's promise ("one shared renderer") and what the merged slices actually
   produce on disk: same input ⇒ byte-identical pretty output across all three
   commands, modulo `status`'s overlay column and per-command footer. Locks the
   trunk-choice rule (D14: live-contract chain), the per-row data shape
   (`dirName · from → to · N ops · {invariants}` everywhere), and `graph`'s
   space iteration (all spaces by default, matching the others). JSON shapes stay
   distinct by design (D2/D3); the question of whether `graph` is worth keeping as
   a separate top-level command is **deferred** — surface a new slice if/when the
   answer is clear.

Future siblings (not core): `migration path --from X --to Y`
([TML-2771](https://linear.app/prisma-company/issue/TML-2771)) and `ref show`
invariants ([TML-2772](https://linear.app/prisma-company/issue/TML-2772)).

Presentation polish (independent of the sequence above):

- **Colored lanes + `--legend`** —
  [`slices/lane-colors-and-legend/spec.md`](./slices/lane-colors-and-legend/spec.md)
  ([TML-2773](https://linear.app/prisma-company/issue/TML-2773)). The Tier-3 tree gains a `git log --graph`-style
  per-column colored gutter and an opt-in `--legend` key. Presentation-only;
  touches the tree renderer + the `graph` command, behind unchanged layout and
  `--json`/`--dot`.

Ledger cleanups (follow-ups from the TML-2769 / PR #665 review; sequenced after the ledger foundation):

- **Consolidate the per-edge breakdown onto the plan** —
  [`slices/edges-on-plan/spec.md`](./slices/edges-on-plan/spec.md). The ledger
  foundation threads `migrationEdges` as a sibling of `plan` on the runner
  options, requiring a hand-maintained consistency guard. This slice moves the
  breakdown onto `MigrationPlan.edges` so the runner reads one object and the
  guard's reason to exist disappears.
- **Stop spelling the empty-contract origin as a fake hash** —
  [`slices/empty-origin-as-null/spec.md`](./slices/empty-origin-as-null/spec.md).
  ∅ is modelled as `null` at the read boundary but as `sha256:empty` (not a real
  hash) in storage/graph, bridged by a coercion helper. This slice gives ∅ one
  honest representation (cut chosen with the graph-layer owner at pickup).

## Contents

- [`spec.md`](./spec.md) — **slice 1's spec + dispatch plan.** Pins the
  implementation architecture (render pipeline, module placement, scope), the
  coherence rationale, edge cases, slice-DoD, and the six-dispatch decomposition.
- [`mockups.md`](./mockups.md) — **the locked visual language.** Hand-drawn
  layout mockups across the full fixture set plus synthetic pathologicals, with
  the layout rules the renderer must implement. This is the design of record.
- [`prototype/`](./prototype) — zero-build prototyping harness used to settle
  the design. `proto.mjs` loads every fixture under
  `examples/prisma-next-demo/migration-fixtures`, recomputes topology in plain
  JS, runs a pluggable `render()`, and writes `gallery.md`. Run from the repo
  root: `node projects/migration-graph-rendering/prototype/proto.mjs`.

The harness is throwaway exploration; the real renderer consumes the aggregate's
tolerant `MigrationGraph` and classifies edges with the shared Tier-2 topology
pass. `mockups.md` is the durable artifact — it carries the visual contract into
implementation, and `spec.md` turns it into a plan.
