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

### D7 — Restructure the ledger into a readable per-migration journal (TML-2769)

Every target writes an append-only ledger on apply, but nothing reads it — and
its shape is wrong for `status`/`log`. Investigation found it records **one
collapsed row per space-apply** (origin→destination spanning the whole walked
path), and the three target schemas have diverged (PG/SQLite have no `space`
column; Mongo has no `operations`). Both consumers need **one row per migration
edge**: `status` matches `migration_hash` exactly; `log` shows one row per apply
event.

So restructure (it's simpler than today's): one row per applied edge, each
carrying `space` + `migration_name` (dirName) + `migration_hash` + per-edge
`from`/`to` + the edge's `operations` (slice of `plan.operations` by
`operationCount`) + `applied_at`. The edge's `operations` are kept on
every row — they make the journal a high-value audit record (exactly what ran).
`contract_json_before/after` stays too (nullable; only the apply's endpoints are
materialised — multi-edge interiors are null; no consumer reads them yet). Both
`operations` and `contract_json` are non-essential to `status`/`log` (which need
only name/hash/from/to/count) — if storage ever bites, drop them or give users
an opt-in/out control for non-essential ledger storage rather than removing the
audit value by default. Writes happen per-edge inside the per-space
transaction, in walk order, by threading `PerSpacePlan.migrationEdges` to the
runner. Add `readLedger({ driver, space })` to `ControlFamilyInstance` (beside
`readMarker`/`readAllMarkers`) returning `LedgerEntryRecord[]` in apply order
with cross-target parity, plumbed through the control client + a control-api
operation. Prototype — no back-compat migration of existing rows.

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

### D11 — One shared edge-annotation overlay on the tree renderer (TML-2748 + TML-2768)

D1 said `list`/`graph`/`status` share the tree and diverge only in annotations.
This pins the *mechanism*. The tree renderer already carries **node** overlays
(`refsByHash`, `contractHash`, `dbHash`, `activeRefName` on
`RenderMigrationGraphTreeOptions`). The commands that annotate **migrations**
(`list`'s package facts, `status`'s applied/pending) add **one** new optional
input, keyed by the join key every migration already has — `ClassifiedEdge.migrationHash`:

```ts
interface MigrationEdgeAnnotation {
  readonly status?: 'applied' | 'pending';        // status overlay
  readonly operationCount?: number;               // list package fact
  readonly invariants?: readonly string[];         // list package fact
}
// new field on RenderMigrationGraphTreeOptions:
readonly edgeAnnotationsByHash?: ReadonlyMap<string, MigrationEdgeAnnotation>;
```

The renderer draws whatever is present: `status: 'applied'` → green `✓` on the
migration row; `'pending'` → yellow `⧗`; `operationCount`/`invariants` → appended
to the migration row's data column; absent ⇒ plain. `refs` stay **node** overlays
(`refsByHash`) for every command (`list` shows refs today and keeps them).

Each command populates only its own keys, so the field is **additive** and the two
slices that touch it (`list`→tree TML-2768, `status` TML-2748) don't collide:
whichever lands first introduces `edgeAnnotationsByHash` + `MigrationEdgeAnnotation`
with the full type above; the other rebases onto it. To minimise even that, **land
TML-2768 first** where schedules allow — it's the slice that naturally introduces
edge annotations (package facts), and `status` then only adds the `status` key.

Overlay ownership per command (refining D1): `list` → `operationCount` +
`invariants` (edge) and `refs` (node); `graph` → `refsByHash` + `contractHash`
(node); `status` → `status` (edge) + `dbHash` (node, the real DB marker, shown
iff a DB is connected). No command shows the `(db)` marker offline.

### D12 — `log` is a single flat table across all spaces, not per-space sections (TML-2770)

`log` answers "what actually ran, and when?" from the DB ledger. The ledger is
**already one flat table** in storage — each row carries its `space`. The read API
was needlessly scoped per-space (`readLedger(space)`); this slice makes the space
argument **optional** so `readLedger()` (unscoped) returns the whole table directly
(adapters drop the space filter when it's omitted). `log` reads that flat table,
orders by `appliedAt` ascending (apply order), and shows a `space` column **only
when more than one space** contributes rows. It is **not** space-sectioned: no
`--space` flag, no per-space headings (KISS — "just render what's in the ledger"). Rows are
uniform: the same edge recurring (apply → rollback → re-apply) simply appears as
repeated rows; `log` does **not** semantically classify apply vs rollback vs
re-apply (that needs graph analysis a DB-sourced command shouldn't do). The
`from → to` direction and repetition reveal the timeline to the reader.

### D13 — Timestamp rendering: local in human output, UTC in machine output (TML-2770)

`appliedAt` renders in the **local timezone** in human/TTY output (with offset
for unambiguity, e.g. `2026-06-02 16:37:31 +02:00`); `--utc` switches human
output to UTC (`2026-06-02 16:37:31Z`). `--json` and any non-TTY/machine output
always emit ISO-8601 UTC (`2026-06-02T14:37:31.000Z`) regardless of `--utc`
(machine output is timezone-stable by contract; `--utc` only affects the human
renderer). Non-TTY already auto-switches to JSON, so a piped `log` is UTC by
construction.

### D14 — Trunk-choice rule: the live-contract chain is the trunk (TML-2812)

D1 commits the three commands to one shared renderer, but doesn't pin **which chain is the trunk** when the topology is disconnected. In practice the commands diverged on disk: `list` chose the live-contract chain, `status` and `graph` chose the historical-ref chain (often `f7a8eb5` for the demo fixture's `prod` ref). Same data, two different trunk picks — same rendering engine, different inputs to its trunk resolver.

The locked rule: **the trunk is the chain containing the live contract** — the contract emitted from the on-disk schema, i.e. the same contract `migrate` defaults to advancing toward when no `--to` is passed. Disconnected sub-graphs (historical-ref chains, abandoned branches, parallel work, etc.) render as side-branches indented one level.

Rationale: the live contract answers "where does the app's code think the schema is?" — it's the *current* anchor in every authoring workflow. Historical refs are secondary, possibly-stale artefacts. Picking the historical-ref chain as the trunk is misleading: it implies the historical state is "the main line" when the operator's actual reference frame is the live contract.

This rule applies uniformly to `list`, `status`, and `graph`. `list` already implements it; TML-2812 propagates it to the other two and asserts it via a shared snapshot. A parametrised trunk-choice (e.g. `--trunk <ref>`) is not in scope — locking one rule is the priority.

## Resolved open items (were under discussion)

- `status` multi-space rendering → **full annotated per-space sections** (each
  space its own tree + overlay), headings only when >1 space, matching `list`/
  `graph` policy D4 (D6 / S-decisions at TML-2748 pickup). Not a compact summary.
- `log` name-mapping → **use the ledger's own `migration_name`** (D7); no on-disk
  lookup, so the "package gone / ambiguous" question is moot (D12).

## Delivery: three parallel slices off the ledger foundation

With the ledger foundation (D7, TML-2769) merged, three slices run in parallel,
each its own branch/PR:

1. **`list` renders the tree** (TML-2768) — human output adopts the shared tree
   with package-fact edge annotations (D11); JSON stays the flat package array
   (D2/D3). Introduces `edgeAnnotationsByHash` on the renderer.
2. **`status` = tree + DB-state overlay** (TML-2748) — renders the shared tree
   directly via the `graph --tree` engine + the `status` edge annotation (D6,
   D11), `--from`/`--to` (D9), `--space` (D4); deletes dagre and makes the tree
   the default (`--tree` flag dropped, D5).
3. **`log` reads the ledger** (TML-2770) — flat single-table apply history (D8,
   D12, D13).

Each slice's `spec.md` carries the locked design + dispatch plan with **no open
questions** (every edge case pre-decided). `slices/edges-on-plan` and
`slices/empty-origin-as-null` remain deferred ledger cleanups (TML-2774).

## `migrate --show` answers "what will `migrate` do?" (supersedes TML-2771's `migration path` noun)

Discussion (2026-06-04, pm + architect) on TML-2771. The driving job: help users build a correct mental model of the **graph** migration system (vs linear) by answering *"what will happen when I `migrate` to the prod ref?"*

**D-MS1 — Ship `migrate --show`, not a new `migration path --from --to` read command.** The job is decision-support *at the moment of acting*, so it belongs on the verb the user already reaches for — zero discovery cost, reinforces the verb. A `migration path` noun aims at a different (offline exploration) moment and adds a command to learn. *Rejected:* the original `migration path` noun.

**D-MS2 — Flag name `--show`, not `--dry-run`.** "dry-run" connotes *step-through-every-op-and-halt*; the intent is *show the chosen path*. `--show` carries that. (`--plan` rejected too — collides with the `migration plan` authoring command.)

**D-MS3 — Output is three parts:** the Tier-3 graph tree with the chosen path (from-state → target) highlighted **bright green**, off-path nodes **dimmed and unlabelled**; plus a **linear, ordered list** of the migrations that will execute (unambiguous for scripts/loops).

**D-MS4 — From-state honesty.** Default `--from` = **the live DB marker, read read-only** (a connection, but no write ⇒ "no impact"). A preview that starts from a different state than the real `migrate` can *lie*, which is worse than no preview. Explicit `--from X` = a clearly-labelled **offline hypothetical** (no connection).

**D-MS5 — New reference-grammar token for "the live marker": `@db`.** Today nothing you can pass to `--from` means "go read the live DB marker." Add the `@db` sigil to `parseContractRef` (`migration-tools/src/refs/contract-ref.ts`), resolved via `readAllMarkers()`. The spike (below) confirmed `db` is **not** a `--from` resolver token today — it exists only as the file-backed `db` ref and the renderer's `DB_MARKER_NAME='db'` label — so `@db` introduces **no collision and no rename**. Reusable everywhere the contract-reference grammar is accepted.

**D-MS6 — Faithfulness constraint (architectural).** `migrate --show` runs `migrate`'s **exact** path-finder seam — no parallel reimplementation — and shares the Tier-3 renderer with `graph`/`status`. `status --from`'s offline path-preview routes through the same seam. A sanity check that runs different code than the action can disagree with reality.

**D-MS7 — Unify the reserved-marker render vocabulary with the reference tokens: draw `@db` / `@contract`, drop the angle brackets.** Today the shared overlay draws the reserved markers in angle brackets — `<contract, db>` (`migration-list-styler.ts:91-94`) — while user refs use parens — `(main, prod)` (lines 97-100). Now that `@db` (and, symmetrically, `@contract`) are *reference tokens* you can type into `--from`/`--to`, the graph should **draw them the same way you type them**: `@contract @db`, sigil-prefixed, no angle-bracket wrapper. User refs keep parens (they're not sigil'd). *Why:* what you see in the graph should be what you can type — the strongest version of the mental-model goal. This touches the **shared** Tier-3 overlay AND the **`--legend`** output — the legend's own example markers (`formatLegendExampleMarkers`, `migration-graph-tree-render.ts:744`) currently print the `<contract, db>` form, and its explanatory text must now teach the `@db`/`@contract` spelling *and* that those are the tokens you can type into `--from`/`--to`. Both surfaces are shared by `graph` / `status` / `list` (legend via `utils/legend.ts`), so the change moves as one vocabulary, not per-command (snapshot regen across all three). It ships as the **vocabulary-foundation dispatch** of the `migrate --show` slice (the preview can't render `@db`-highlighted while siblings still show `<db>` or legend it as `<db>`). `@db` resolves only with a connection (live marker); `@contract` is offline-resolvable (the working/desired contract the app carries, and `migrate --to`'s default).

**Command boundaries this locks in (the mental-model payoff):** `migrate --show` = *what this action will do* (planner's chosen path) · `status` = *where my live DB sits* (ledger: applied/pending, relative to the connected DB) · `graph` = *the whole map* · `log` = *what already ran* · `migration plan` = *authoring a new migration* (writes to disk — not a viewer).

**Assumption — VERIFIED by spike (2026-06-04).** The planner exposes a clean read-only "compute the path, don't execute" seam: `graphWalkStrategy()` (`migration-tools/src/aggregate/strategies/graph-walk.ts:51`) returns the ordered `PerSpacePlan` / `pathDecision.selectedPath` as a pure, no-write value; `runMigration()` (`cli/.../operations/migrate.ts:284`) is the execution boundary. `readAllMarkers()` is read-only. `migrate --show` = `readAllMarkers` + `graphWalkStrategy` + render, stopping before `runMigration`. **No extraction needed — stays a one-PR slice.** `status --from` already calls the shared core (`findPathWithDecision`, `migration-graph.ts:300`) that `graphWalkStrategy` wraps, so consistency holds with no convergence refactor.

**Rejected alternatives:** the offline `migration path --from --to` noun (wrong user moment + extra command); `migrate --dry-run` (wrong semantics); folding the feature entirely into `status` (loses the at-the-verb sanity check — though the two *share* the engine + renderer).

**D-MS3 revised (operator visual review of PR #735).** The preview renders the **whole** graph, not just the path: on-path = bright green across nodes/hashes/names **and lane lines**; off-path = **uniform dim grey, fully drawn** (not omitted/unlabelled). Two correctness rules the first cut got wrong: **`@contract` marks the app's working-contract node, not the `--to` target**, and **the floating `@contract` node renders only in the app space, never in an extension space** (e.g. `pgvector:` must not show a floating `@contract`). This second rule is **app-space-only and enforced structurally in the shared Tier-3 renderer** (an `isAppSpace` gate on the `@contract` marker + the floating working-contract node) — because it was a pre-existing bug in `migration graph` / `migration status` too (both passed the app `liveContractHash` to extension-space renders). `@db` is **not** app-gated — it's a per-space marker and legitimately appears in each space. The ordered list renders in the **graph's migration-row format + alignment, minus the gutter, in the same green**, printed directly — **not** via Clack `ui.log` (which injects the `│` gutter).
