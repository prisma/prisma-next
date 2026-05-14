# Summary

Make `prisma-next migration status` multi-space aware along the two dimensions that the M6 of TML-2397 deliberately left for follow-up: the `--graph` and `--limit` flags, plus a new `--space <id>` selector. The data shape (`MigrationStatusResult.spaces[]`, `totalPendingAcrossSpaces`) and the per-space summary block have already shipped; this spec re-anchors the command's default view on its load-bearing question — "what happens when I run `migration apply`?" — and makes `--graph` / `--limit` / `--space` behave consistently across single- and multi-space layouts.

# Context

## At a glance

`migration status` exists to answer one question fast: **what will `migration apply` do?** Everything else is on-demand. The default view stays focused on the application contract space (the surface every developer touches) and surfaces extension spaces only when there is pending work to act on. When the user wants more — a graph, a specific space's history, a longer chain — flags scope into a single space at a time.

```
# Default view — app has extensions but only `audit` has pending work
$ prisma-next migration status

⧗ 2 pending migration(s) — run 'prisma-next migration apply' to apply
applied  (none)
missing  (none)

⧗ [ext] audit — 2 pending (marker sha256:7a3c…, head sha256:9f02…)

# Default view — app with all extensions up to date
$ prisma-next migration status

✔ Database is up to date (3 migrations applied)
# (no extension lines — byte-identical to a no-extensions app)

# Inspect one extension's history in full
$ prisma-next migration status --space audit

[ext] audit
2 pending migration(s) — run 'prisma-next migration apply' to apply
…app-space-style migration list scoped to `audit`…

# Inspect one extension's graph
$ prisma-next migration status --graph --space audit
…dagre-rendered graph for the `audit` space, capped by --limit if given…
```

The shape that this spec pins:

- `--graph` always renders **one** space's migration graph. Without `--space` it's the app. With `--space <id>` it's the named space.
- `--limit N` caps the rendered history of whichever space is selected. There is no "limit across spaces" semantic to argue about — only ever one space is rendered.
- `--space <id>` selects which space `--graph` / `--limit` / the in-detail history listing operate on. Without it, the command's default view is the app-focused summary above.
- `--ref <name>` stays app-space-only (extensions advance to their own `headRef`, unchanged).

The JSON envelope (`migration status --json`) is unchanged structurally: it always serialises the full `spaces[]` aggregate so agents see every space regardless of which one the human view focused on.

## Problem

M6 of TML-2397 (`projects/extension-contract-spaces/specs/migration-cli-aggregate.spec.md` on branch `tml-2397-migration-cli-aggregate`) made `migration status`'s **data** multi-space aware. `MigrationStatusResult.spaces[]` now enumerates every on-disk contract space with its marker, head, and pending count; the formatter renders a per-space summary block when extension spaces exist. That closed the e2e finding F4 (status output silently omitting extension spaces).

What M6 deliberately did not ship is per-space behaviour for the optional `--graph` and `--limit` flags. Today both flags continue to operate as if there is only one space — the application's. `--graph` renders the app-space migration graph; `--limit N` caps that one graph. Users debugging cross-space history have no way to see an extension space's graph and no way to scope the history listing to one space at a time. The original sub-spec was silent on flag semantics: the data + formatter rewrite was the load-bearing AC2 work, and flag semantics were triaged to a follow-up rather than expanding M6 scope.

The other M6 deferral that surfaced during shaping is the default view itself. M6 ships a per-space block that lists every loaded space — including ones that are up to date. That works as a "first time you see the multi-space shape" reveal, but it bloats the default output for users whose extensions are quiescent. The natural anchoring question for `migration status` is "what happens when I run apply?" — so the default view should foreground pending work and treat up-to-date extension spaces as silent until the user asks.

## Approach

Anchor on the apply-preview question. Drive every flag's semantics off "which space are we focusing on?" — defaulting to the app, with one flag (`--space <id>`) to switch the focus.

**Default view (no flags).** Render today's app-space output unchanged (summary line, applied / missing invariants, diagnostics, migration table). Below that, append one line per **extension space with pending work**: `⧗ [ext] <id> — N pending (marker …, head …)`. Extension spaces with `pendingCount === 0` produce no output. If no extension space has pending work, the output is byte-identical to today's pre-M6 single-space app output. The cross-space pending total line (`⧗ N pending migration(s) across M space(s) …`) is dropped from the default view — it duplicates information the focused-on-pending entries already carry.

**`--space <id>` selects the focus space.** When provided, the rest of the command (history listing, `--graph`, `--limit`) targets that space instead of the app. Validation: unknown `<id>` returns a structured error whose hints list the loaded space IDs. `--space app` is accepted as an explicit no-op (matches default behaviour). `--space` interacts only with the command's focused-on-one-space rendering; the JSON envelope is unaffected (always full aggregate).

**`--graph` renders the focused space's graph.** Today's renderer (`graph-render.ts` + `graph-migration-mapper.ts`) operates over a single `MigrationGraph` + per-edge `EdgeStatus[]` + `markerHash` / `contractHash`. With `--space <id>` the inputs come from the selected member of the contract-space aggregate; without `--space`, they're the app-space data the renderer already consumes today. The renderer itself does not change — only the data feeding it.

**`--limit N` caps the focused space's rendered history.** Per-space because only one space's history is ever rendered. Today's behaviour is preserved when no `--space` is given.

**`--ref <name>` remains app-space-only.** Extensions always target their `headRef.hash` — this is the boundary established in [ADR 212 — Contract spaces](../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md) and the sub-spec's `migration apply` semantics. `--ref` combined with `--space <ext-id>` returns a structured error (refs are not loaded for extension spaces).

**JSON envelope.** Unchanged. `--json` always serialises the full `spaces[]` aggregate and `totalPendingAcrossSpaces`; the human-view filtering (hiding up-to-date extension lines) is a rendering-side concern. The internal-detail strip block (`graph`, `bundles`, `edgeStatuses`, `activeRefHash`, `activeRefName`, `diverged`) continues to apply.

**Data plumbing.** `executeMigrationStatusCommand` gains a `space?: string` input. When set, it routes the top-level `graph` / `bundles` / `edgeStatuses` / `markerHash` / `targetHash` / `contractHash` fields off the selected space's member of the contract-space aggregate (already loaded today for the per-space summary via `buildContractSpaceAggregate`). When unset, today's app-space-only loader path runs unchanged. This keeps the renderer code path single — it always reads from the top-level fields — and confines multi-space awareness to data assembly.

# Requirements

## Functional Requirements

- **FR1.** `prisma-next migration status` (no flags) renders the app-space view (today's summary, invariants, diagnostics, and migration table) and, below it, one line per **extension space with `pendingCount > 0`**: each line names the kind tag (`[ext]`), space ID, pending count, marker hash, and head hash.
- **FR2.** `prisma-next migration status` against an app whose extensions are all up to date renders output identical (modulo timestamps and hashes) to the same command against an app with no extensions configured at all.
- **FR3.** `prisma-next migration status --space <id>` scopes the entire human-readable output to the named space: summary line, diagnostics, migration table, and (if `--graph`) graph all reflect `<id>` instead of the app. `<id>` may be `app` (explicit no-op) or any extension space ID loaded from `prisma-next.config.ts`.
- **FR4.** `prisma-next migration status --graph` renders the migration graph of the focused space (default `app`). `--graph --space <id>` renders `<id>`'s graph. The renderer (dagre layout, node markers, edge status icons) is unchanged.
- **FR5.** `prisma-next migration status --limit N` caps the focused space's rendered history at `N` entries (table view) or `N` migrations (graph view). `--all` overrides `--limit`, same as today.
- **FR6.** `prisma-next migration status --ref <name>` continues to scope status to the app-space ref. Combined with `--space <ext-id>` (for any non-`app` ID), the command returns a structured error code `CLI.REF_INCOMPATIBLE_WITH_NON_APP_SPACE` whose hint explains that extension spaces always target their `headRef` and refs are an app-space concern.
- **FR7.** `prisma-next migration status --space <unknown-id>` returns a structured error whose hints include the list of loaded space IDs (sorted: extensions alphabetical, then `app`). Exit code is non-zero.
- **FR8.** `prisma-next migration status --json` always serialises the full `spaces[]` aggregate and `totalPendingAcrossSpaces` regardless of `--space` / `--graph` / `--limit`. Internal-detail fields (`graph`, `bundles`, `edgeStatuses`, `activeRefHash`, `activeRefName`, `diverged`) continue to be stripped from JSON output.
- **FR9.** When `--space <id>` selects an extension space whose on-disk migration graph is empty, the output is a single line stating that the space has no migrations on disk and exits zero (matches the analogous app-space empty case).

## Non-Functional Requirements

- **NFR1.** `migration status` cost is dominated by the aggregate loader and per-space marker reads, both of which already run unconditionally in the M6 path. Adding `--space` selection performs no additional I/O; it only routes which member of the already-loaded aggregate feeds the renderer.
- **NFR2.** The default view's render path produces no output for extension spaces with `pendingCount === 0`. This is a rendering filter; it does not affect the JSON envelope or the in-memory result shape.
- **NFR3.** Snapshot tests strip ANSI before comparison. Output remains stable across colorized and non-colorized terminals.

## Non-goals

- **Stacked-per-space graph rendering.** Initially considered; rejected during design in favour of single-space-at-a-time graph rendering driven by `--space <id>`. Aggregate visualisation of multiple spaces is left to a future ticket if user demand surfaces.
- **Refs for extension spaces.** Extensions own their own `refs/head.json` (managed by the extension author, not the CLI user). Surfacing extension refs via `--ref` is out of scope; status against an extension space always targets `headRef.hash`.
- **`migration apply --space <id>` parity.** `migration apply` continues to walk every space's graph as per M6. Scoping apply to one space is a separate concern not driven by this ticket.
- **A rolled-up "extensions up to date" reassurance line.** Decided against during shaping: the simpler "invisible when up to date" rule is preferred; a reassurance line can be added later if users ask.
- **`migration plan` / `migration show` / `migration ref` updates.** This ticket touches `migration status` only.

# Acceptance Criteria

- [ ] **AC1.** Running `prisma-next migration status` against a multi-extension app where exactly one extension space has pending migrations (e.g. `audit` ahead by two, `feature-flags` up to date) renders the app-space output plus one extension line for `audit`. The `feature-flags` space is not mentioned in the human-readable output. (Covers FR1.)
- [ ] **AC2.** Running `prisma-next migration status` against a multi-extension app where all extension spaces are up to date renders output structurally identical to the same command against an app with no extensions configured — no per-space block, no cross-space total line, no `[ext]` tags. (Covers FR2.)
- [ ] **AC3.** Running `prisma-next migration status --space <ext-id>` against an extension space with pending migrations renders an app-style migration table (summary, applied/missing invariants, diagnostics, history) scoped to `<ext-id>`. The migration history shown is `<ext-id>`'s, not the app's. (Covers FR3.)
- [ ] **AC4.** Running `prisma-next migration status --graph --space <ext-id>` renders a dagre graph identical in shape to today's app-space `--graph` output but plotted over `<ext-id>`'s migration graph and per-edge statuses. (Covers FR4.)
- [ ] **AC5.** Running `prisma-next migration status --graph --space <ext-id> --limit 1` renders a graph capped at 1 visible edge from `<ext-id>`'s history, plus the truncation indicator (`┊ (N earlier migrations)`). The same command with `--limit 5` shows all five edges when the space's history is exactly five long. (Covers FR5.)
- [ ] **AC6.** Running `prisma-next migration status --space audit --ref production` (where `production` is a ref defined under `migrations/refs/`) returns exit code non-zero with a structured error whose code is `CLI.REF_INCOMPATIBLE_WITH_NON_APP_SPACE` and whose hint references the app-space-only nature of refs. (Covers FR6.)
- [ ] **AC7.** Running `prisma-next migration status --space nonexistent` returns exit code non-zero with a structured error whose hints list every loaded space ID (extensions alphabetical, then `app`). (Covers FR7.)
- [ ] **AC8.** Running `prisma-next migration status --json` against a multi-extension app where extensions are all up to date includes `spaces[]` with one entry per loaded space (each carrying `markerHash`, `headHash`, `pendingCount`, `status`, `kind`, `spaceId`) and `totalPendingAcrossSpaces: 0`. The same fields are present whether `--graph` / `--space` were supplied to the command. (Covers FR8, NFR2.)
- [ ] **AC9.** Running `prisma-next migration status --space <ext-id>` against a space whose on-disk migration graph is empty (no migrations directory entries) exits zero and produces a single-line message indicating no migrations exist for that space. (Covers FR9.)
- [ ] **AC10.** A snapshot test at `test/integration/test/cli-journeys/migration-status-multi-space.e2e.test.ts` locks the terminal output (ANSI-stripped) for: (a) the default view with one pending extension; (b) the default view with all extensions up to date; (c) `--space <ext-id> --graph`. Subsequent renderer drift fails the test loudly. (Covers AC1, AC2, AC4 simultaneously.)

# Other Considerations

## Security

No new data is read or surfaced. `--space <id>` selection is purely a render-time filter over an already-loaded aggregate; it does not unlock any additional database read paths or marker rows.

## Observability

`migration status` writes to the terminal and produces a JSON envelope; no metrics, alerts, or logs are emitted. The structured-error envelope for `--space <unknown-id>` and `--ref` + non-app-space rejection follows the existing CLI error taxonomy (`CliStructuredError` with domain `CLI`).

## Data Protection

None — `migration status` reads contract markers and on-disk migration metadata only; nothing user-data-bearing crosses this surface.

# References

- TML-2475 — [Make `prisma-next migration status` flags multi-space aware (`--graph` / `--limit`)](https://linear.app/prisma-company/issue/TML-2475/make-prisma-next-migration-status-flags-multi-space-aware-graph-limit)
- TML-2397 — Contract spaces (parent project; M6 sub-spec is the data-shape predecessor of this work).
- [ADR 212 — Contract spaces](../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md) — establishes the per-space planner / runner / verifier and the app-space-only nature of refs.
- [ADR 021 — Contract Marker Storage](../../docs/architecture%20docs/adrs/ADR%20021%20-%20Contract%20Marker%20Storage.md) — per-space marker rows; what `status` reads to compute per-space pending counts.
- [ADR 208 — Invariant-aware migration routing](../../docs/architecture%20docs/adrs/ADR%20208%20-%20Invariant-aware%20migration%20routing.md) — `findPathWithDecision` primitive feeding per-space pending-count derivation.
- `packages/1-framework/3-tooling/cli/src/commands/migration-status.ts` — the command and result-builder modified by this work.
- `packages/1-framework/3-tooling/cli/src/utils/contract-space-aggregate-loader.ts` — the aggregate loader that already feeds `loadAggregateStatusSpaces`; per-space graph data routes through it.
- `packages/1-framework/3-tooling/cli/src/utils/formatters/graph-render.ts` + `graph-migration-mapper.ts` — the renderer is unchanged; only its data inputs route differently under `--space`.
- `test/integration/test/cli-journeys/migration-status-diagnostics.e2e.test.ts` — existing journey-test pattern the new multi-space file mirrors.

# Open Questions

1. **Exact wording of the focused-on-pending extension line.** The illustrative shape in *At a glance* (`⧗ [ext] audit — 2 pending (marker sha256:7a3c…, head sha256:9f02…)`) is a starting point; the implementer may settle the final wording during the snapshot pass. The pinned shape is: glyph (pending), kind tag, space ID, pending count, marker hash, head hash, in that order; truncation of hashes follows today's 8-char convention.
2. **Whether `--space app` produces a one-line `[app]` header above today's default output.** Default assumption: no header — output is byte-identical to the no-flag default. Add a header only if the snapshot test reveals readability concerns. The header is purely cosmetic; an implementer can flip this without changing data plumbing.
3. **Whether `--space <id>` with `--ref <name>` should accept the case `--space app --ref <name>`** (which is just the existing behaviour). Default assumption: yes, accept it as a no-op equivalent to `--ref <name>` alone. The rejection (FR6) fires only when `<id>` is not `app`.
