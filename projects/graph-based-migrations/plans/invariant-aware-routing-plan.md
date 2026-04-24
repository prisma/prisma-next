# Invariant-aware routing — Plan

## Summary

Add invariant-aware path selection to the migration graph, end-to-end. Five slices, one per milestone; see spec §*Slices and dependencies* for the design-level narrative and dependency graph.

- **M0. Refs carry invariants.** *(Landed.)* Per-file `migrations/refs/<name>.json` directory layout; each ref is a typed `{ hash, invariants }`.
- **M1. The DB remembers applied invariants.** `prisma_contract.marker` grows `invariants text[]` (Mongo: a field on the marker doc). Column lives in the `CREATE TABLE IF NOT EXISTS` DDL from the start — no compat shim for pre-upgrade markers (consistent with the breaking `edgeId` change; consumers re-apply against a fresh database). Runner unions `manifest.providedInvariants` on apply; `readMarker` returns the set. No new SPI.
- **M2. Edges declare invariants.** `invariantId?: string` on `DataTransformOperation` is the opt-in routing key; `migration.json` carries `providedInvariants` (attestation-covered aggregate); `MigrationChainEntry.invariants` propagates from the manifest.
- **M3. Invariant-aware pathfinder primitive.** `findPathWithInvariants(graph, from, to, required)` returns the shortest path whose edges collectively cover `required`, or `null`.
- **M4. CLI integration.** `migration apply --ref` and `migration status --ref` compute `effectiveRequired = ref.invariants − readMarker().invariants` and route through the new primitive. `NO_INVARIANT_PATH` surfaces when unsatisfiable; `status` displays required / applied / missing.

When no invariants are required, existing routing outcomes (same edges, same tie-break, same exit codes) are preserved; `findPathWithInvariants` is byte-identical *as a function* when `required = ∅`, but the CLI's `--ref` regime adds mode-annotation output.

**Spec:** `projects/graph-based-migrations/specs/invariant-aware-routing.spec.md`

**PR strategy.** Each milestone is a standalone PR. Spec §*Slices and dependencies* has the dependency graph: M1 and M2 are orthogonal; M3 waits for M2; M4 waits for M1, M2, and M3. This plan sequences them M1 → M2 → M3 → M4 as a reviewer-load preference (storage diff is smaller and self-contained; M2 adds types that ripple through fixtures) — flipping M1 and M2 would be equally valid.

**Prerequisites (P2, P3) land before M2.** Spec §Prerequisites records two renames as prereqs: `dag.ts → graph.ts` (P2) and `MigrationChainEntry → MigrationEdge` (P3). Each is a standalone, logic-free commit/PR; landing them first keeps the M2 (and M3) diff focused on routing work rather than rename churn.

**Breaking attestation change.** Adding `providedInvariants` to `migration.json`'s canonical form changes every existing migration's `edgeId` on re-verify. This is a knowing breaking change — all consumers today are prerelease/internal. No compat shim.

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Sævar | Drives execution on `feat/ledger-foundation` (branch name predates the marker pivot) |
| Reviewer | _TBD_ | Architectural review of pathfinder + CLI surface |
| Dependent work | data-migrations track | This spec amends the broader data-migrations spec's D2: `name` keeps retry/ledger identity; a new optional `invariantId?: string` on `DataTransformOperation` is the opt-in routing key. Data-transform authoring only needs to set `invariantId` where an op should be routing-visible; everything else stays path-dependent. |
| Affected layers | target-postgres, target-mongo, family-sql, family-mongo, CLI | Milestone 1 (marker-side storage) touches Postgres DDL (`prisma_contract.marker`), Mongo marker doc shape, `buildMarkerUpsertStatement` + `buildMarkerUpsertUpdate`, runner threading (`SqlMigrationRunnerExecuteOptions.invariants`), and both families' `readMarker`. Subsequent milestones are narrower (migration-tools + CLI). |

## Milestones

### Milestone 0: Ref file refactor *(completed — ships as PR #1)*

**PR scope:** `refactor(migration-tools): refs carry invariants, one file per ref` — the commit predates this spec; shipped as PR #1.

Refs moved from a monolithic `migrations/refs.json` to per-file `migrations/refs/<name>.json` with a typed `RefEntry = { hash, invariants: string[] }`. Validation is Arktype-backed. CLI commands that act on refs were updated to the per-file API. See spec §Prerequisites (P1) for the full contract.

**Tasks:**

- [x] `RefEntry` interface with `{ hash, invariants }` shape
- [x] `readRef`, `readRefs`, `writeRef`, `deleteRef`, `resolveRef` in `packages/1-framework/3-tooling/migration/src/refs.ts`
- [x] `validateRefName`, `validateRefValue`; Arktype schema for ref file contents
- [x] Per-directory file layout with atomic-rename write path and empty-parent cleanup on delete
- [x] CLI command plumbing in `migration-apply.ts`, `migration-status.ts`, `command-helpers.ts` (switch from `refsPath` to `refsDir`)
- [x] Integration tests for `migration ref set/list/rm` + `--ref` flow on apply/status
- [x] Stale package-level test for the old flat-refs.json API removed

**Verification:** `pnpm --filter @prisma-next/migration-tools typecheck && test` green; CLI integration tests covering refs all pass.

### Milestone 1: Marker-side applied-invariants storage (both families)

The marker table is the single-row source of truth for current database state. After this milestone, `prisma_contract.marker` carries an `invariants text[]` column (and the Mongo marker doc an equivalent field); the runner unions `manifest.providedInvariants` into it on each successful apply; `readMarker` returns the set. No new SPI methods — `readMarker` was already on both families.

**No compat shim for existing markers.** The column sits in the `CREATE TABLE IF NOT EXISTS` DDL from the start. Consistent with the breaking `edgeId` change in F2, consumers re-apply against a fresh database rather than upgrading a live marker in place. A user who skips the re-apply gets a clear SQL error (`column "invariants" does not exist`) with a one-line manual ALTER as the fix.

**Semantics.** The stored set is "applied-at-least-once" (Definition A), not a live data-state claim. The CLI uses it to subtract from `ref.invariants` when computing `effectiveRequired` so multi-apply flows don't fail with `NO_INVARIANT_PATH` after an invariant is already covered.

**Schema evolution.** No compat shim. The column lives in the `CREATE TABLE IF NOT EXISTS` DDL and is written fresh when the marker is first created. Consumers upgrading from an older internal release re-apply against a fresh database per the F2 upgrade story — there is no existing marker to migrate in place. On Mongo the marker doc absorbs a new field naturally (no schema migration needed); absence-of-field reads as `[]` as a consequence of schemaless behaviour, not as a compatibility shim.

**PR scope:** one PR covering Postgres DDL, Mongo marker shape, runner threading, both families' `readMarker`, and `ContractMarkerRecord.invariants` propagation to CLI. No new SPI surface.

**Tasks:**

*Postgres schema + write path:*

- [ ] In `packages/3-targets/3-targets/postgres/src/core/migrations/statement-builders.ts`, add `invariants text[] not null default '{}'` to the `CREATE TABLE IF NOT EXISTS prisma_contract.marker` DDL
- [ ] Extend `MarkerUpsertInput` with `invariants: readonly string[]`
- [ ] Update `buildMarkerUpsertStatement` / `buildMarkerUpsertUpdate` to union the input set into the existing column value: `invariants = array(select distinct unnest(array_cat(marker.invariants, $N::text[])))` (or equivalent dedup). Order-insensitive; the stored value is a set.
- [ ] Unit test: upsert statement unions invariants rather than overwriting

*Postgres read path:*

- [ ] In `packages/2-sql/9-family/src/core/verify.ts`, extend `readMarkerSql` / `parseContractMarkerRow` to include the `invariants` column
- [ ] Add `invariants: readonly string[]` to `ContractMarkerRecord` in `packages/1-framework/0-foundation/contract/src/types.ts` — always present, default `[]`
- [ ] Unit test (family-sql): `readMarker` returns the stored set

*Mongo parity:*

- [ ] Add `invariants: string[]` to the Mongo marker document shape in `packages/2-mongo-family/9-family/src/core/`; default `[]` on first write
- [ ] Update the Mongo marker upsert to `$addToSet` / union invariants rather than overwriting
- [ ] `readMarker` on Mongo returns `invariants` from the doc, defaulting to `[]` when the field isn't present on older docs (natural schema-less fallback; no probe needed)
- [ ] Unit test (family-mongo): upsert unions invariants into the marker doc

*Runner threading:*

- [ ] Extend `SqlMigrationRunnerExecuteOptions` in `packages/2-sql/9-family/src/core/migrations/types.ts` with optional `invariants: readonly string[]`
- [ ] Thread `options.invariants ?? []` through `runner.ts` into `buildMarkerUpsertStatement`. The runner is a sink; callers pass `manifest.providedInvariants` (M2 computes this) directly. For `db update` / marker-only flows, caller passes `[]`.
- [ ] Mirror the options shape on the Mongo runner
- [ ] Integration test (Postgres): apply a migration with `providedInvariants: ['phone-backfill']`; `readMarker` returns `invariants: ['phone-backfill']`
- [ ] Integration test (Postgres): apply a second migration with `providedInvariants: ['email-verified']`; `readMarker` returns the union `['phone-backfill', 'email-verified']`
- [ ] Integration test (Postgres): apply a migration re-declaring an already-stored invariant; result stays deduped
- [ ] Integration test (Mongo): equivalent union behavior on the Mongo marker doc

*CLI surface:*

- [ ] `ControlMarker` view in `packages/1-framework/3-tooling/cli/src/control-api/` surfaces `invariants` (straight pass-through from `readMarker`)
*Package build / downstream:*

- [ ] Rebuild `@prisma-next/contract`, `@prisma-next/family-sql`, `@prisma-next/target-postgres`, `@prisma-next/family-mongo`, `@prisma-next/target-mongo`, `@prisma-next/cli` so downstream typechecks see `ContractMarkerRecord.invariants`

### Milestone 2: Authoring, manifest, and edge-level invariants

`invariantId` on `DataTransformOperation`, `providedInvariants` on `migration.json`, verify-time checks, and graph reconstruction reading from the manifest. The migration-tools package typechecks and its tests go green. The two suggested refactors (optional) land as standalone, logic-free commits.

**PR scope:** one PR. Touches framework-components (type), migration-tools (verify, graph), and fixture helpers. Assumes prereqs P2 (`dag.ts → graph.ts`) and P3 (`MigrationChainEntry → MigrationEdge`) have landed; this PR targets the new names.

**Tasks:**

*Authoring type:*

- [ ] Add `invariantId?: string` to `DataTransformOperation` in `packages/1-framework/1-core/framework-components/src/control-migration-types.ts`. Document in a field-level JSDoc: presence opts the transform into routing; absence means the transform is path-dependent and not routing-visible. `name` stays retry/ledger identity only.

*Format validation + verify-time checks:*

- [ ] Validator function for `invariantId` (lowercase ASCII / digits / hyphens / slashes — mirror `REF_NAME_PATTERN` from `refs.ts`). Export from migration-tools.
- [ ] Wire validation into `migration verify` / attestation path: fail with `MIGRATION.INVALID_INVARIANT_ID` on a malformed id
- [ ] Wire duplicate detection into verify: fail with `MIGRATION.DUPLICATE_INVARIANT_IN_EDGE` when two ops in one migration declare the same `invariantId`
- [ ] Add `INVALID_INVARIANT_ID`, `DUPLICATE_INVARIANT_IN_EDGE`, and `PROVIDED_INVARIANTS_MISMATCH` to `migration-tools/src/errors.ts` with `code`, `why`, `fix`, `details`

*Manifest aggregate (emit/verify split):*

- [ ] Add `providedInvariants: readonly string[]` to `AttestedMigrationManifest` (and `DraftMigrationManifest` — draft manifests can carry an empty array)
- [ ] **Emit** derives `providedInvariants` from the ops (filter `operationClass === 'data'` + `invariantId !== undefined`, collect, sort, dedupe) and writes it into `migration.json`. Every migration gets the field — no code path tolerates its absence at reconstruct-time.
- [ ] **Verify** re-derives `providedInvariants` from `ops.json`; on mismatch with the manifest's stored copy, fail with `MIGRATION.PROVIDED_INVARIANTS_MISMATCH` (new error code — details include `stored`, `derived`, `difference`)
- [ ] Confirm `providedInvariants` is covered by the `edgeId` / migration-id hash; add a test that hand-editing the manifest field breaks verification via either the hash check or the re-derivation check
- [ ] Update any fixture helpers that construct manifests to include `providedInvariants: []` by default
- [ ] Note (non-task): because `providedInvariants` joins the canonical manifest form, every existing attested migration's `edgeId` changes on re-verify. Breaking change — all consumers are prerelease/internal. Document in the M2 PR description.

*Graph reconstruction:*

- [ ] Add `invariants: readonly string[]` to `MigrationChainEntry` in `packages/1-framework/3-tooling/migration/src/types.ts`
- [ ] `reconstructGraph` reads `pkg.manifest.providedInvariants` directly into `MigrationChainEntry.invariants`. No re-derivation from ops at this layer — the manifest is source of truth.
- [ ] Update fixture helper `packages/1-framework/3-tooling/cli/test/utils/graph-helpers.ts` to populate `invariants: []` on constructed entries
- [ ] Update any test bodies that construct `MigrationChainEntry` literals (search workspace, patch with `invariants: []`)

*Renames land as prereqs, not in this milestone.* See spec §Prerequisites P2 and P3. Each is a standalone, logic-free commit/PR that lands before M2. Assuming prereqs are in before M2 starts, this milestone targets the new names (`graph.ts`, `MigrationEdge`) throughout.

*Housekeeping:*

- [ ] Rebuild `@prisma-next/migration-tools` + `@prisma-next/framework-components` so downstream consumers pick up the new type fields

### Milestone 3: Invariant-aware pathfinder primitive

`findPathWithInvariants` lands with full unit coverage, covering the common / failure / pathological shapes from the spec. `findPath` either becomes a thin shorthand or is reimplemented atop the new primitive. No CLI wiring yet.

**PR scope:** one PR, confined to migration-tools (`graph.ts`/`dag.ts`, BFS primitive, state-level dedup, neighbour ordering, unit tests). No downstream consumers change in this PR — it's purely additive.

**Tasks:**

- [ ] Add `findPathWithInvariants(graph, from, to, required: ReadonlySet<string>): readonly MigrationChainEntry[] | null` to `graph.ts` (or `dag.ts` if the rename is skipped)
- [ ] Implement BFS over `(node, covered-set)` states with a `Set<string>` covered-set representation
- [ ] Implement state-level dedup via `Map<node, Set<stableSubsetKey>>`; strict equality skip, no subset-dominance pruning
- [ ] Choose a stable subset key (e.g. sorted `join('\0')`); document the choice in a code comment
- [ ] Add neighbour-ordering adapter for the new BFS: primary key "edge covers at least one still-needed invariant", secondary key = existing `labelPriority → createdAt → to → migrationId`
- [ ] Make neighbour ordering fall back to today's ordering exactly when `required` is empty — preserves F8 (same routing outcome for existing callers)
- [ ] Reimplement `findPath` as `findPathWithInvariants(graph, from, to, new Set())`, OR keep as a thin shorthand — document the choice in the commit message
- [ ] Unit test: `findPathWithInvariants(..., new Set())` returns identical output to `findPath` across representative graphs (linear, diamond, branching, cycle)
- [ ] Unit test: one required invariant, two routes — pathfinder picks the providing route
- [ ] Unit test: no satisfying route → `null`
- [ ] Unit test: multiple same-length satisfying paths → deterministic tie-break selects the expected one
- [ ] Unit test (correctness counter-example): two edges out of `A` providing `{X}` / `{Y}` both converge at `D`; `D→E→F` with `E` also providing `X`; required `{X, Y}` returns the `Y` route (verifies state-level dedup is *not* collapsed to node-level)
- [ ] Unit test: neighbour ordering — with required non-empty, invariant-covering edges explored first; with required empty, today's order exact
- [ ] Unit tests for the "common shapes" panel from spec: linear spine, diamond detour, long free spine + detour, two invariants on different edges, multi-edge provision
- [ ] Unit tests for the "failure shapes" panel: unreachable target, invariant missing everywhere, invariant exists off-path, partial satisfaction
- [ ] Unit tests for the "pathological shapes" panel: dense graph with many required invariants, cycles on free edges, cycles on invariant-providing edges, invariant only via a cycle, disconnected invariant providers
- [ ] *(Deferred from unit tests)* Performance characterisation happens in the bench harness, not as an inline timing assertion — see Open Items / Deferred. We do not ship a flaky `expect(elapsed).toBeLessThan(50)` check.
- [ ] Walk-through review: before declaring the milestone done, run every shape in the "Graph shapes to evaluate" section of the spec against the pathfinder by hand (eyeballing test output)

### Milestone 4: Decision surface, error, CLI integration with marker subtraction

Routing is consumed. `PathDecision` carries the new fields; `toPathDecisionResult` exposes per-edge invariants in JSON; `MIGRATION.NO_INVARIANT_PATH` is a real structured error; `migration apply`/`status` compute `effective_required = ref.invariants − readMarker().invariants` and route through the pathfinder. Status surfaces the required / applied / missing sets.

**PR scope:** one PR covering `findPathWithDecision` signature change, `PathDecision` extension, error wiring, and CLI integration. This PR is where the feature becomes user-visible end-to-end. Integration tests (including the multi-apply scenario that depends on M1's marker subtraction) live here.

**Tasks:**

*Decision surface:*

- [ ] Extend `PathDecision` in `dag.ts`/`graph.ts` with `requiredInvariants: readonly string[]` and `satisfiedInvariants: readonly string[]`, both always present (default `[]`)
- [ ] Update `findPathWithDecision`'s signature to accept `required: ReadonlySet<string>` and invoke `findPathWithInvariants` internally, replacing today's `findPath` call. This is the load-bearing routing change in the milestone — all other decision work composes on top.
- [ ] Decide where `NO_INVARIANT_PATH` is constructed: `findPathWithDecision` throws on unsatisfiable (detects `null` return from the primitive, runs a structural `findPath` to distinguish "no path at all" from "no path with invariants", throws the right error). CLI commands just propagate. Document this in the commit message.
- [ ] Update `findPathWithDecision` to populate the new fields — `satisfiedInvariants` derived from the intersection of `required` with every edge's `invariants` on the selected path
- [ ] Update `toPathDecisionResult` in `packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts`: include `invariants: string[]` on each edge in the slim view

*Error surface:*

- [ ] Add `MIGRATION.NO_INVARIANT_PATH` to `packages/1-framework/3-tooling/migration/src/errors.ts` — fields: `refName?`, `required`, `missing`, `structuralPath`
- [ ] Compute `structuralPath` as `findPath(graph, from, to)` slim-mapped (one extra BFS, cheap); each edge entry carries its own `invariants`
- [ ] Verify that `from`→`to` structurally unreachable triggers `NO_TARGET`/no-path (not `NO_INVARIANT_PATH`)
- [ ] Write error `fix` text that names a concrete action, e.g. "add a migration edge whose `dataTransform` declares `invariantId: 'X'`"

*CLI wiring (apply):*

- [ ] Wire `migration apply` (`packages/1-framework/3-tooling/cli/src/commands/migration-apply.ts`): when `--ref` resolves, run the `UNKNOWN_INVARIANT` pre-check against `graph.forwardChain`; fatal on unknown id (exit 1 before the pathfinder)
- [ ] Call `readMarker()`, read `marker.invariants`, compute `effectiveRequired = new Set(ref.invariants) − new Set(marker.invariants)`, thread `effectiveRequired` into the pathfinder
- [ ] Pass `manifest.providedInvariants` into `SqlMigrationRunnerExecuteOptions.invariants` for each applied edge so the runner unions into the marker
- [ ] Defensive re-check that the resolved path covers `effectiveRequired` (pathfinder already guarantees this; CLI re-asserts as a defensive check)
- [ ] Map `NO_INVARIANT_PATH` to exit code 1 with the structured error envelope

*CLI wiring (status):*

- [ ] Wire `migration status` (`packages/1-framework/3-tooling/cli/src/commands/migration-status.ts`): same effective-required computation as apply, via `readMarker().invariants`
- [ ] Run the `UNKNOWN_INVARIANT` pre-check before the pathfinder — same as apply, fatal on typo (exit 1, not a warning)
- [ ] Render per-edge `invariants` in the tree view output
- [ ] Display required / applied / missing invariant sets in both human and JSON output when `--ref` is used
- [ ] When `--ref` is used, annotate the regime (`ref: <name> (hash=…, required=[…])`) alongside the invariant-row output (D12); without `--ref`, output stays as-is

*Integration tests:*

- [ ] `migration apply --ref prod` with invariants that are satisfied by an available path → exit 0, applies correct path
- [ ] `migration apply --ref prod` with invariants that cannot be satisfied (structurally reachable, no covering path) → exit 1, `NO_INVARIANT_PATH` in error output with `structuralPath` populated
- [ ] `migration apply --ref prod` twice: first call applies a path that provides X; second call with ref `{hash: H2, invariants: [X, Y]}` routes from current state to H2 with `effectiveRequired = {Y}` only (X subtracted via `readMarker().invariants`), succeeds — the multi-apply scenario that motivated marker-side storage
- [ ] `migration status --ref prod` with invariants → tree view shows per-edge invariants; required / applied / missing sets shown
- [ ] `migration status --json --ref prod` with invariants → JSON payload includes `requiredInvariants`, `satisfiedInvariants`, `appliedInvariants`, `missingInvariants`, and per-edge `invariants` on `selectedPath` entries
- [ ] `migration apply --ref prod` with an unknown invariant id (none of the graph's edges declare it) → exit 1, `MIGRATION.UNKNOWN_INVARIANT` before any DB state changes
- [ ] `migration status --ref prod` with an unknown invariant id → exit 1 with the same `MIGRATION.UNKNOWN_INVARIANT` (fatal, not a warning — consistent with apply)
- [ ] F8 regression-guard: invocations without `--ref` (and refs whose `invariants` list is empty) select the same path, produce the same exit code, and don't gain new output rows beyond those needed to render the (empty) invariant state. Snapshot-based against fixtures from before this work. The mode annotation from D12 appears only when `--ref` is used.
- [ ] Regression: run existing CLI integration tests, confirm none break

### Milestone 5: Close-out

Verify acceptance, migrate durable documentation, and clean up this feature's transient artefacts. **Note**: `projects/graph-based-migrations/` contains other active specs (data-migrations, disk-sizing, etc.) — do **not** delete the whole folder. Only clean up the invariant-aware-routing artefacts.

**PR scope:** one PR — doc migration + spec/plan deletion + `data-migrations-spec.md` pruning. Lands after M4 is merged and we've had enough runtime on the feature to know the spec's decisions are durable.

**Tasks:**

- [ ] Walk through every acceptance criterion in the spec and confirm it's green — link each to the test that covers it (use the Test Coverage table below as the checklist)
- [ ] If the spec's decisions (especially D4 — the split between `name` for retry/ledger identity and `invariantId?: string` as the opt-in routing key) should be reflected in an ADR or subsystem doc under `docs/`, migrate the relevant content (candidate: update or create an ADR under `docs/architecture docs/adrs/` for invariant-aware routing)
- [ ] Search the repo for inbound references to `projects/graph-based-migrations/specs/invariant-aware-routing.spec.md` or `projects/graph-based-migrations/plans/invariant-aware-routing-plan.md`; if durable docs link to them, either migrate content into `docs/` or remove the link
- [ ] Delete `projects/graph-based-migrations/specs/invariant-aware-routing.spec.md` and `projects/graph-based-migrations/plans/invariant-aware-routing-plan.md` once the work is merged and any durable docs have absorbed the decisions
- [ ] *Do not* delete `projects/graph-based-migrations/` as a whole — other specs remain active
- [x] Prune `data-migrations-spec.md` to remove content now owned by this spec. *Done ahead of schedule to avoid the two specs contradicting each other while M1–M4 are in flight.* The amendment replaced the §"Graph integration (R7, R8)" design narrative with a pointer, added a one-line refinement pointer at the top of §D2, narrowed the §"Acceptance Criteria → Graph integration" items to only ledger-side semantics still in scope, updated the `dataTransform` builder comment and Observability entry to match the current split-identity model, and reframed the stale "Invariant management CLI" non-goal. Re-verify during close-out that no further contradictions have crept back in.

## Test Coverage

Every acceptance criterion from the spec maps to at least one test (or a manual walk-through where automated testing doesn't fit).

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| **— Ref file refactor (M0, done) —** | | | |
| `RefEntry = { hash, invariants }` shape | TypeScript compile | M0 | ✅ |
| `migrations/refs/<name>.json` per-file layout with atomic write + empty-parent cleanup | Unit + integration | M0 | ✅ |
| `migration ref set/list/rm` CLI flow | Integration | M0 | ✅ |
| `migration apply --ref <name>` and `migration status --ref <name>` use `refsDir` (not `refsPath`) | Integration | M0 | ✅ |
| **— Marker-side applied-invariants storage (M1, both families) —** | | | |
| `prisma_contract.marker` DDL includes `invariants text[]` column | Integration | M1 | Postgres; in `CREATE TABLE IF NOT EXISTS` from the start — no compat shim |
| Apply-time runner unions caller-supplied invariants into marker | Unit (upsert builder) + integration | M1 | Runner is a sink; union (not overwrite) semantics |
| Second apply with different invariants produces the union of both | Integration | M1 | Postgres + Mongo |
| Re-applying an already-stored invariant keeps the stored set deduped | Integration | M1 | Idempotent on re-apply |
| `ContractMarkerRecord.invariants: readonly string[]` always present | TypeScript compile | M1 | Default `[]` on first write; no fallback path for missing column |
| `readMarker` returns stored invariants | Unit | M1 | Postgres + Mongo |
| Mongo marker doc absent-field reads as `invariants: []` | Unit | M1 | Natural schema-less behaviour, not a compat shim |
| Mongo marker doc `invariants` field unioned via `$addToSet` on apply | Unit + integration | M1 | Parity with Postgres |
| `ControlMarker` CLI view surfaces `invariants` | Unit | M1 | Straight pass-through from `readMarker` |
| **— Authoring + manifest (M2) —** | | | |
| `DataTransformOperation.invariantId?: string` exists | TypeScript compile | M2 — type change | Opt-in; absence means not routing-visible |
| Verify fails with `INVALID_INVARIANT_ID` on malformed id | Unit | M2 | Uppercase, whitespace, starts-with-hyphen, etc. |
| Verify fails with `DUPLICATE_INVARIANT_IN_EDGE` on duplicate ids in one migration | Unit | M2 | Ledger + routing semantics collapse otherwise |
| **Emit** writes `providedInvariants` into `migration.json` derived from ops | Unit + integration | M2 | Sorted, deduped, only ops with `invariantId`; no code path tolerates absence |
| **Verify** re-derives from `ops.json`; mismatch with stored raises `PROVIDED_INVARIANTS_MISMATCH` | Unit | M2 | Independent of the edgeId hash check; both layers protect integrity |
| `providedInvariants` participates in attestation (tampering breaks edgeId hash) | Integration | M2 | Hash coverage check; fires independently of PROVIDED_INVARIANTS_MISMATCH |
| Data op without `invariantId` never contributes to `providedInvariants` | Unit | M2 | Path-dependent ops stay invisible |
| **— Edge-level invariants (M2) —** | | | |
| `MigrationChainEntry.invariants` populated from `manifest.providedInvariants` (no re-derivation) | Unit | M2 | Manifest is source of truth |
| `reconstructGraph` reads `invariants` directly from manifest | Unit | M2 | |
| `MigrationChainEntry.invariants` always defined, sorted, deduped | Unit | M2 | Verified at manifest level |
| Fixture helpers produce `MigrationChainEntry` with `invariants: []` by default | TypeScript compile | M2 | |
| P2 rename (`dag.ts` → `graph.ts`): logic-free, typecheck+tests green | CI + diff review | P2 prereq | Standalone commit, lands before M2 |
| P3 rename (`MigrationChainEntry` → `MigrationEdge`): logic-free, typecheck+tests green | CI + diff review | P3 prereq | Standalone commit, lands before M2 |
| Downstream consumers pick up new fields | Workspace typecheck | M2 | After migration-tools rebuild |
| **— Pathfinder primitive (M3) —** | | | |
| `findPathWithInvariants(..., new Set())` = `findPath` | Unit | M3 — equivalence test | Across multiple graphs |
| One required invariant, providing route chosen | Unit | M3 | |
| No satisfying route → `null` | Unit | M3 | |
| Same-length satisfying paths → deterministic tie-break | Unit | M3 | |
| State-level dedup (not node-only) | Unit | M3 — counter-example test | Specific graph from spec §Pathfinder algorithm |
| Neighbour ordering (D11) | Unit | M3 | With + without required-non-empty |
| Performance <50 ms on 10k linear with 3 invariants | *Deferred* | — | Runtime timing assertions are flaky; characterisation via bench harness only, and not required for v1 |
| Common shapes panel walk-through | Unit panel | M3 | 6 cases |
| Failure shapes panel | Unit panel | M3 | 4 cases |
| Pathological shapes panel | Unit panel | M3 | 5 cases |
| Critical evaluation step | Manual walk-through | M3 | Eyeball each named graph against results |
| **— Decision surface + CLI (M4) —** | | | |
| `PathDecision` always carries `requiredInvariants`, `satisfiedInvariants` | Unit | M4 | |
| `satisfiedInvariants` derived from `selectedPath` | Unit | M4 | Never independently computed |
| Slim JSON view carries per-edge `invariants` | Unit + integration | M4 | `toPathDecisionResult` + CLI `--json` |
| `NO_INVARIANT_PATH` error has required fields | Unit | M4 | |
| Structural-unreachable → existing no-path error | Unit | M4 | Not `NO_INVARIANT_PATH` |
| Error `fix` text names concrete action | Unit | M4 | String-match assertion |
| `--json` envelope includes full payload | Integration | M4 | CLI-level |
| `migration apply --ref` computes effective-required via marker subtraction | Integration | M4 | Verify the subtraction actually happens |
| `migration apply --ref` twice: second call subtracts first's applied invariants | Integration | M4 | The multi-apply scenario that motivated marker-side storage |
| `migration apply --ref <name>` exit 0 when covered, 1 when not | Integration | M4 | |
| `UNKNOWN_INVARIANT` fires at apply-time before any DB state changes | Integration | M4 | Ref references an id no migration declares; fatal, exit 1 |
| `UNKNOWN_INVARIANT` is fatal in `migration status --ref` as well (not a warning) | Integration | M4 | Same check, same severity in both commands — misconfigured refs surface loudly |
| `UNKNOWN_INVARIANT` vs `NO_INVARIANT_PATH` carve-up: unknown id = UNKNOWN_INVARIANT; declared-but-off-path = NO_INVARIANT_PATH | Integration | M4 | Two distinct tests verifying the semantic separation |
| Pathfinder never receives an unknown id in `required` (pre-check guarantee) | Unit | M4 | Enforced via the pre-check firing first |
| `migration status --ref <name>` tree view shows invariants + required/applied/missing | Integration (snapshot) | M4 | |
| `migration status --json --ref <name>` includes all invariant fields | Integration | M4 | |
| Empty effective required set (or no `--ref`) selects the same path, same exit code, no new output rows beyond the empty-invariant render | Integration (snapshot) | M4 | F8 regression guard; D12 mode annotation only in `--ref` regime |
| Existing integration tests pass unchanged | Regression | M4 | F8 guarantee |

## Open Items

- **Reviewer assignment.** Spec doesn't name one — to be decided before opening the routing PR.
- **Performance characterisation (deferred).** No runtime timing assertions ship with v1 — prior feedback flagged that pattern as flaky. If we want hard numbers later, add a bench case to the migration-tools bench harness; not blocking.
- **ADR for invariant-aware routing (close-out decision).** Whether D4–D12 deserve an ADR, or whether the spec + plan suffice until they need durable documentation. Defer until the work is merged.
- **Marker-side storage scope.** M1 touches Postgres DDL + runner, Mongo marker shape + runner, and both families' `readMarker` — smaller blast radius than the earlier ledger approach (no new SPI surface). If review still wants it split, the natural seam is per-family (Postgres in one PR, Mongo in the next).
- **TML-2130 (`deriveEdgeStatuses` via ledger)** is an independent follow-up. Not bundled here because marker-side applied-invariants storage doesn't need a ledger read path. See spec §References / Deferred.
- **Ledger per-invariant provenance.** If an audit need surfaces (which migration first applied invariant X), the ledger grows `(migrationId, invariants)` columns later. Orthogonal to this spec; not blocking.
- **`--graph` dagre rendering for invariants.** Deferred per the spec; tree view only in v1.
- **Draft/invariant-routing UX asymmetry.** Deferred per the spec; follow-up is a one-line hint in the `NO_INVARIANT_PATH` error or visual distinction for draft-provided invariants in the rendered tree.
- **CLI surface for editing `ref.invariants`.** Deferred per the spec; users edit JSON manually for v1.
