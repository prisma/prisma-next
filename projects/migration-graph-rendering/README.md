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
   `--json` and future text-only formats stay flat for tooling. Completes the
   intent of TML-2697.

The project has broadened from the `graph` renderer into the whole **migration
read-command family** (`list` / `graph` / `status` / `log`). Cross-cutting design
decisions (the command-family model, shared renderer, space policy, `list`/`graph`
split, the ledger foundation) live in [`decisions.md`](./decisions.md).

Further slices, all sequenced after TML-2748 unless noted:

5. **Ledger foundation** ([TML-2769](https://linear.app/prisma-company/issue/TML-2769), blocks 6–7) —
   make the on-apply ledger readable; store migration hash + name; add
   `readLedger`. Control-plane (all targets).
6. **`status` = `list` + DB-state overlay** ([TML-2748](https://linear.app/prisma-company/issue/TML-2748)) —
   applied/pending overlay, `--from`/`--to`, delete dagre, `--tree` becomes default.
7. **`log` reads the ledger** ([TML-2770](https://linear.app/prisma-company/issue/TML-2770)) —
   flat executed history (no tree), real order + timestamps + rollbacks.

Future siblings (not core): `migration path --from X --to Y`
([TML-2771](https://linear.app/prisma-company/issue/TML-2771)) and `ref show`
invariants ([TML-2772](https://linear.app/prisma-company/issue/TML-2772)).

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
