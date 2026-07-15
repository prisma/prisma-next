# Slice 06 — config-failure surfacing + last-good retention

**Project:** [`../../spec.md`](../../spec.md) · **Project plan:** [`../../plans/plan.md`](../../plans/plan.md) § M5 · **Linear:** TML-2984
**Depends on:** nothing new (server-internal); slices 01–05 merged. Final build slice before close-out.

## Design (settled — project spec § At a glance, tsserver + rust-analyzer precedents)

All changes in `packages/1-framework/3-tooling/language-server/src/server.ts` (the
project-load lifecycle):

1. **Config-failure diagnostics.** Any failure thrown from the project-load flow
   (`resolveConfigInputs` — i.e. `loadConfig` or `createControlStack` or input
   resolution: opaque runtime errors from executed TypeScript, no spans) surfaces as
   **one** diagnostic on the **config-file URI** (`pathToFileURL(configPath)`) at
   range **(0,0)–(0,1)**, message carrying the error text (precision lives in the
   message — no spans into executed TS, per spec non-goals). Published via the
   **push channel unconditionally** — even for pull-capable clients, because the
   config file belongs to the TypeScript language service and pull never reaches us
   for it (tsserver `configFileDiag` precedent). Published once per failed load, not
   once per awaiter. **Cleared** (empty publish) on the next successful load of the
   same config, and when the server stops managing that config.
2. **Last-good retention.** Today `startProjectLoad` replaces the entry with
   `loading` (keeping only a `hadLoadedProject` boolean) and a failed load funnels
   every awaiter into `stopManagingProject` — dropping the project and clearing all
   schema diagnostics. New behavior: the `loading` entry retains the previous
   `ProjectState` (`lastGood`); on **reload** failure the entry is restored to
   `loaded` with the last-good project — schema documents keep being served (parse,
   symbol-table, interpreter diagnostics from the retained context) — with the
   config diagnostic shown alongside. On **first-load** failure (no last-good)
   today's behavior stands: no project, documents unmanaged, config diagnostic
   shown. (rust-analyzer `switch_workspaces` precedent: "it only makes sense to
   switch to a partially broken workspace if we don't have any workspace at all
   yet.")
3. **The success path adds only an unconditional clear** — every current-load
   success (and every settled-entry drop) publishes `[]` on the config URI,
   fire-and-forget. _(Amended by operator, 2026-07-15: publish-tracking bits
   (`configFailed`) removed — LSP clients keep per-server diagnostic collections,
   so empty publishes are harmless; the `failed` status alone carries the
   no-servable-project state and keeps broken configs on the watched-refresh
   radar.)_

## Coherence rationale

One reviewable PR: "config failures become visible and non-destructive." The two
behaviors are one lifecycle change in one function cluster
(`startProjectLoad`/`loadProject`/`stopManagingProject`); splitting them would ship
either a diagnostic for a state we still destroy, or retention nobody can observe.

## Slice Definition of Done (beyond CI / reviewer / project-DoD)

- [x] SDoD1 (TC-13) — push diagnostic on the config URI at (0,0)–(0,1)
      (`PRISMA_NEXT_CONFIG_LOAD_FAILED`, error message); exactly-once is structural
      (single shared load promise); published for pull-capable clients; cleared on
      next successful load. ✓ `353e5d4e7`
- [x] SDoD2 (TC-14) — break→retain→fix cycle pinned: last-good serves full schema
      diagnostics incl. interpreter findings, config diagnostic alongside;
      successful reload swaps + clears. Reload-failure resolves with last-good
      (funnels untouched). ✓
- [x] SDoD3 — first-load failure = today's behavior (217 existing tests untouched;
      1 test re-pinned by charter — it encoded the destroy-on-reload behavior this
      slice replaces; reviewer confirmed everything it legitimately protected
      survives in other pins). ✓
- [x] SDoD4 — zero casts; no new edges; `lint:framework-vocabulary` at threshold. ✓

**Slice-close ritual (2026-07-14):** single dispatch SATISFIED R1, zero findings;
4/4 SDoD PASS; clear-site relocated from the brief's letter (`stopManagingProject` —
whose only callers are the failure funnels) to the genuine stops-caring seam
(`dropProjectWithoutManagedDocuments`), reviewer-blessed. Accepted residual for M6
QA: after a failed *first* load with all schema docs closed, the marker persists
until a doc reopens (lazy lifecycle by design) — QA script must exercise break→fix
with and without open documents. Pre-existing superseded-failed-awaiter hazard
recorded for backlog (blast radius narrowed by this slice). Manual QA: config
break/fix cycle is in the M6 playground script by project DoD.

## Edge cases (pre-investigated)

- **Failure classes**: `loadConfig` throw (TS error in config), `createControlStack`
  throw (bad component wiring), schema-input resolution throw — all reach the
  `loadProject` promise rejection; one catch site suffices.
- **Concurrent/superseded loads**: `isCurrentLoad` already guards stale loads; a
  superseded failed load must not publish (only the current load's outcome speaks).
- **`stopManagingProject`** must clear a previously published config diagnostic
  (a config whose last document closes shouldn't leave a zombie marker), and the
  retention change must not break its existing push-clear of schema documents in
  the genuinely-dropped case.
- **Config edited to broken → fixed cycle** exercises: fail (diagnostic) → retained
  last-good serves → fix → reload succeeds → clear + new project serves. The watched
  `prisma-next.config.ts` change handler (`changedConfigPaths` → `refreshProject`)
  is the trigger path; tests drive it through the existing harness.

## Dispatch plan

Single dispatch (one lifecycle, one function cluster, heavily test-pinned).

### S6-D1 — failure surfacing + retention in the project-load lifecycle

- **Outcome:** the § Design list; SDoD1–4 green.
- **Builds on:** slice 05 (interpreter diagnostics observable through retention).
- **Hands to:** M6 (playground QA exercises the config break/fix cycle manually).
- **Focus:** `language-server/src/server.ts` + tests.
- **Gate:** `pnpm --filter @prisma-next/language-server test` + typecheck + lint,
  `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps`.
