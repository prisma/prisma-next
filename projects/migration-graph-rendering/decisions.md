# Design decisions — migration read-command family

This project began as a redesign of `migration graph`'s renderer (TML-2746) but
has broadened into a coherent design for the whole family of **migration read
commands** — `list`, `graph`, `status`, `log` (and `show`). This file records
the cross-cutting decisions that span more than one slice. Slice-local detail
lives in each slice's `spec.md`.

## The command family

| Command | Question it answers | On/offline | Human (TTY) output | Machine output |
|---|---|---|---|---|
| `list` | "what migration packages are on disk?" | offline | shared tree, package-annotated | flat package array (`--json`, future text-only) |
| `graph` | "what contract topology do they describe?" | offline | shared tree, topology/overlay-annotated | `{ nodes, edges }` |
| `status` | "where is my DB relative to all on-disk migrations?" | online (offline with `--from`) | `list` + per-migration applied/pending overlay | `list`'s shape + a `status` field |
| `log` | "what actually ran, and when?" | online | **flat** `list`-format rows from the ledger (no tree) | ledger entries |
| `show` | "what's in this one package?" | offline | package detail | package detail |

`status`, `list`, and `graph` describe **on-disk state** and are tree-shaped.
`log` describes **what actually happened** (the DB ledger — real apply order and
timestamps, including rollbacks/re-applies) and is the one command that stays
flat, because the same edge can recur and a graph can't represent repetition.

Tickets: `list`→tree TML-2768, `graph` multi-space TML-2767, `status` TML-2748,
`log` TML-2770, ledger foundation TML-2769, and the future siblings `migration
path` TML-2771 / `ref show` invariants TML-2772.

## Decisions

### D1 — One shared graphical renderer, command-specific annotations

The condensed Tier-3 tree renderer (TML-2746) is the **single** human/graphical
rendering engine. `list`, `graph`, and `status` all draw the same tree; they
diverge only in the **annotations** they overlay:

- `list` → per-migration package facts (op counts, invariants, refs).
- `graph` → `(refs)` / `(contract)` node overlays.
- `status` → `(db)` marker + per-edge applied/pending/unreachable status glyphs.

This is the project's thesis: one renderer to maintain, fed different overlay
inputs. The dagre renderer and the Tier-2 list-graph gutter are both retired
(TML-2748, TML-2765).

### D2 — `list` and `graph` stay distinct commands

They are **not** merged. They answer different questions and their **machine
output differs significantly**: `list` emits a flat package array (the faithful
on-disk inventory — every package, including parallel / duplicate / disconnected
edges); `graph` emits `{ nodes, edges }` (the deduplicated contract topology).
Their human output happens to share the tree (D1, D3), but the commands' purpose
and tooling contracts are durably separate, and may diverge further.

### D3 — Graphical output is human-only; machine formats stay flat

The tree is rendered **only** in the pretty/TTY human path. `--json` and any
future text-only format omit the tree and emit each command's flat data, for
tooling. This is free: piping a read command already auto-switches to JSON
(non-TTY ⇒ `--json`, per `resolveOutputFormat`), so the human renderer never
runs for a pipe/script in the first place.

Rationale for putting the tree in `list`'s human output: `list`'s flat order is
**lexicographic by directory name**, not chronological (the timestamp prefix is
a naming convention recording *creation*, not application). For a branching
history that order shows no relationships and is close to unreadable, so in
practice you always need `list` + `graph` together — hence combine their
graphical output for humans.

### D4 — Space policy: all spaces by default, `--space <id>` to narrow (read commands)

Contract spaces are **independent histories** (no cross-space topology). All read
commands render **every** on-disk space by default, each as its own disconnected
per-space section/tree, with `--space <id>` to narrow to one. `migration list`
already does this; `migration graph` is brought into line (TML-2767). This gives
one mental model for `--space` across the family.

### D5 — `--tree` becomes the default; dagre is deleted

The condensed tree shipped behind an experimental `migration graph --tree` flag
to avoid disturbing `migration status` (which shared the dagre renderer). Once
`status` moves onto the shared renderer, `--tree` becomes the default (the flag
is dropped) and the dagre renderer + `@dagrejs/dagre` are deleted (TML-2748).

### D6 — `status` is `migration list` + a DB-state overlay (TML-2748)

`status` draws the **same** list as `migration list` (shared renderer, per-space
sections, policy B) and overlays, per migration, one of two states; everything
else is shown plain (it's the full list — no subgraph pruning):

- **applied** — a ledger entry exists for this migration (exact match on
  migration hash, D7). KISS: literal "ever ran"; a rolled-back migration still
  counts as applied here — the timeline lives in `log` (D8).
- **pending** — on the shortest path from the DB's current contract hash to the
  app contract, and not applied (runs next on `migrate`).

`status --json` is `list`'s shape plus a per-migration `status` field. This
retires dagre (the last consumer) and makes the condensed tree the default
(`--tree` flag dropped).

### D7 — Make the ledger readable; add migration hash + name (TML-2769)

Every target already writes an append-only ledger on apply (`from → to`,
`operations`, real timestamp) but nothing reads it. Add `migration_hash` +
`migration_name` to the ledger format (all targets; ignore back-compat), thread
them from the apply path, and add a `readLedger(space)` SPI with cross-target
parity + client plumbing. This is the foundation **both** `status` (applied =
ledger entry) and `log` consume.

### D8 — `log` reads the ledger; flat, no tree (TML-2770)

`log` reads the ledger (D7) and renders the real apply history in `list` row
format, **flat** — in apply order, with names + `appliedAt`, including rollbacks
and re-applies. It is online-only (the DB is the source) and the only read
command not sourced from on-disk state. Today's `findPath(∅→marker)`
reconstruction is discarded (it can pick the wrong branch and mislabels creation
time as apply time).

### D9 — `status` origin/target controls (`--from` / `--to`)

Default origin is the DB marker, default target is the current contract.
`--to X` retargets to a ref/hash ("can I move this DB to X? what path?").
`--from X` overrides the origin (offline-capable: "what would `migrate --from X
--to Y` do?"). The **applied** overlay shows iff the origin is the real DB —
overriding it makes applied-ness meaningless, so it drops. `status` requires a DB
unless `--from` supplies the origin.

### D10 — Path-decision and invariants live elsewhere, not in `status`

To keep `status`'s footer lean (headline + actionable `missing invariant(s)`
line only):

- **Which-path-and-why** (path selection, tie-break reasons) → a future
  `migration path --from X --to Y` command that draws the graph and highlights
  the chosen path, and dry-runs alternative pathfinding (TML-2771).
- **A ref's declared required invariants** → `ref show` (ref metadata); `status`
  surfaces only the *missing* set relative to the DB (TML-2772).

## Open / under discussion

- `status` multi-space rendering detail (N annotated per-space sections vs. a
  compact per-space summary) — settle at TML-2748 pickup.
- `log` name-mapping when the on-disk package is gone (show hashes) or ambiguous
  (parallel edges) — settle at TML-2770 pickup; the ledger's own migration name
  (D7) makes this largely moot.
