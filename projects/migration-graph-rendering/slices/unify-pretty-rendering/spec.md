# Slice: unify pretty rendering across `list` / `status` / `graph`

_Parent project `projects/migration-graph-rendering/`. Outcome this slice contributes
to: D1 ("one shared graphical renderer, command-specific annotations") is the project's
thesis, but on disk the three commands still diverge in trunk choice, per-row data, and
space iteration. This slice closes that gap: same input ⇒ byte-identical pretty output
across `list`, `status`, `graph`, modulo `status`'s per-row applied/pending overlay
column and per-command footer phrasing. Tracking:
[TML-2812](https://linear.app/prisma-company/issue/TML-2812)._

## At a glance

Same DB state, same on-disk migrations, three commands today:

```
$ migration list                              $ migration status                            $ migration graph

app:                                          app:                                          (renders only `app:`; `pgvector` elided)
  ○ 1375f13                                   ○ f7a8eb5                  (prod)             ○ f7a8eb5                  (prod)
  │↑ 20260603_migration  ∅ → 1375f13 10 ops   │↑ 20260518_bookend  6cee614 → f7a8eb5         │↑ 20260518_bookend  6cee614 → f7a8eb5
  │ ○ f7a8eb5                  (prod)         …                                              …
  │ │↑ 20260518_bookend  …  0 ops             │ ○ 1375f13      (db, contract)                │ ○ 1375f13                (contract)
  …                                           │ │↑ … ∅ → 1375f13 ✓ applied                  │ │↑ … ∅ → 1375f13
  ├─╯                                         ├─╯                                            ├─╯
  ∅                                           ∅                                              ∅

pgvector:                                     pgvector:                                     (no pgvector section)
  ○ 29059df                                   ○ 29059df       (head, db, contract)
  │↑ … 1 ops {pgvector:install-vector-v1}     │↑ …  ✓ applied
  ∅                                           ∅

6 migration(s) across 2 contract space(s)     up to date                                    6 node(s), 5 edge(s)
```

Three independent divergences in the **pretty-output rendering layer**:

1. **Trunk choice differs.** `list` picks the live-contract chain (`∅ → 1375f13`) as
   the trunk; `status` and `graph` pick the historical-ref chain (`∅ → … → f7a8eb5`).
2. **Per-row data differs.** `list` shows `dirName · from → to · N ops · {invariants}`;
   `status` shows `dirName · from → to · applied/pending`; `graph` shows
   `dirName · from → to`.
3. **Spaces shown differs.** `list` and `status` render every on-disk space (`app:` +
   `pgvector:`). `graph` silently scopes to a single space (its banner reads
   `migrations: migrations/app`); the footer counts include the un-rendered `pgvector`
   nodes, so the data path knows about them — the renderer just isn't drawing them.

After this slice, the three commands produce **byte-identical** pretty rendering of
the per-space sections, with two well-defined exceptions that are command-specific by
design: `status`'s per-row applied/pending overlay column, and the per-command footer.

JSON shapes stay distinct — see [Out of scope](#out-of-scope).

## Chosen design

Per project decision D1 ("one shared graphical renderer, command-specific
annotations") — and refining it where the existing wording allowed drift. This slice
is the enforcement of D1.

**Single shared row-builder + trunk-chooser.** All three commands route through the
same `buildMigrationGraphRows` → `buildMigrationGraphLayout` →
`renderMigrationGraphTree` pipeline. Three command-specific knobs only:

| Knob | `list` | `status` | `graph` |
| -- | -- | -- | -- |
| Per-row overlay column (`✓ applied` / `⧗ pending`) | off | on | off |
| Footer | `N migration(s) across M contract space(s)` | `up to date` / `N pending — run …` / `Multiple valid migration paths — …` | `N node(s), M edge(s)` |
| Per-row data (`dirName · from → to · N ops · {invariants}`) | full | full | full |

**Trunk-choice rule (locked).** The trunk is the chain containing the **live
contract** — the contract emitted from the on-disk schema, the same contract
`migrate` defaults to advancing toward when no `--to` is passed. Disconnected
sub-graphs render as side-branches indented one level. Rationale: the live contract
is "where the app's code thinks the schema is"; historical refs are secondary,
possibly-stale artefacts. This is what `list` already does; `status` and `graph`
adopt it. (See D14 below.)

**Space iteration (locked).** All three commands iterate every on-disk space; `--space
<id>` narrows to one. `graph` adopts the same default `list` and `status` already use
(D4). Each space renders as a per-space section with a `<spaceId>:` heading when more
than one space is present.

**Per-row data (locked).** Every migration row, in every command, renders
`dirName · from → to · N ops · {invariants}`. `status` appends a single overlay
column at the right end (`✓ applied` / `⧗ pending` / blank when no DB is connected
/ `--from` is offline). The shared `edgeAnnotationsByHash` contract introduced in
D11 already carries the surface needed; this slice extends `graph`'s renderer to
**consume** it (instead of skipping ops + invariants) and extends `status`'s
renderer to **include** it (instead of replacing it with the overlay).

Non-migration rows (contract nodes, blank/connector rows) are unaffected and stay
as they are today.

## Acceptance

- For any single input (same DB state, same on-disk migrations), `migration list`,
  `migration status`, and `migration graph` produce **byte-identical** pretty
  rendering of the per-space sections, except for `status`'s overlay column. Asserted
  by a shared snapshot test that pipes the same fixture through all three renderers
  and diffs only the overlay column + footer.
- Trunk choice: live-contract chain is the trunk in all three commands; historical-ref
  chains render as indented side-branches.
- Space iteration: all three commands render every on-disk space by default; `--space
  <id>` narrows to one; multi-space renderings carry `<spaceId>:` headings.
- Per-row data: `dirName · from → to · N ops · {invariants}` appears on every
  migration row in every command. `status` adds the `✓ applied` / `⧗ pending` column
  at the right end.
- No regression to existing fixtures — the just-merged slices' goldens update
  mechanically; no semantics change.
- CI green; demo's `migration list` / `status` / `graph` against a non-trivial fixture
  (the disconnected-historical-chain demo state) renders consistently.

## Out of scope

- **JSON shape unification.** `graph`'s `{ nodes, edges }` stays; `list` / `status`
  per-space arrays stay. JSON consumers diverge by design (D2/D3).
- **Retiring or aliasing `migration graph`.** After this slice, `graph` and `list`
  produce identical pretty output; their JSON shapes still differ. Whether `graph` is
  worth keeping as a top-level command is a separate decision — deferred per operator
  ("Let's leave consolidation for a later task"). File later if/when the answer is
  clear.
- **Column alignment fix from
  [TML-2811](https://linear.app/prisma-company/issue/TML-2811).** Independent
  rendering issue; lands separately.
- **Trunk-choice algorithm extensibility.** This slice locks one rule (live-contract
  spine). A future slice could parametrise it (e.g. `--trunk <ref>`); not asked for
  here.

## References

- Project: `projects/migration-graph-rendering/`.
- Decisions: D1 (shared renderer), D2 (`list`/`graph` distinction), D4 (space policy),
  D11 (shared edge annotations), D14 (trunk-choice rule, added by this slice).
- Sibling slices (merged): TML-2746 (graph), TML-2768 (list→tree), TML-2770 (log),
  TML-2748 (status — in review at filing time).
- Source modules:
  `packages/1-framework/3-tooling/cli/src/utils/formatters/migration-graph-rows.ts`,
  `migration-graph-tree-render.ts`, `migration-list-data-column.ts`, plus the three
  command files (`migration-list.ts`, `migration-status.ts`, `migration-graph.ts`).
