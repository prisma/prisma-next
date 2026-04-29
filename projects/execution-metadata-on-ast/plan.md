# Execution Metadata on AST — Project Plan

## Summary

Implement [ADR 205](../../docs/architecture%20docs/adrs/ADR%20205%20-%20Execution%20metadata%20lives%20on%20AST.md) by making the SQL AST the single source of truth for execution metadata. Add an optional `codecId` to `ProjectionItem`, promote `Insert/Update/Delete.returning` to `ProjectionItem[]`, stop emitting `refs` / `paramDescriptors` / `annotations.codecs` / `projectionTypes` from `PlanMeta`, and migrate the runtime decoder, encoder, lints, budgets, and Postgres RETURNING lowering to read from the AST. Success: AST-rewriting middleware (`beforeCompile`) is correct-by-construction with no sidecar to patch, and the `re-derive paramDescriptors after middleware AST rewrite` workaround is gone.

**Spec:** [`spec.md`](./spec.md)

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Serhii Tatarintsev | Drives execution; owns ADR 205. |
| Reviewer | SQL runtime / framework area owners | Architectural review of AST/runtime coupling and PlanMeta surface. |
| Reviewer | Postgres adapter area owners | Review of RETURNING lowering change. |
| Collaborator | TML-2143 follow-up owners | Caching / annotation DSL track downstream of `beforeCompile`; the cleaner AST-as-source world simplifies their work. |

## Milestones

The work lands as a **single bundled PR** (per the spec's Implementation Strategy). The milestones below are logical phases that map to the PR's commit structure and produce demonstrable intermediate states inside the working branch — not independently shippable releases.

### Milestone 1 — AST surface ready

Lay the groundwork: extend `ProjectionItem` with `codecId`, change the mutation ASTs' `returning` type, and update visitors. After this milestone, the type system enforces the new shape but no producer or consumer behavior has changed yet. Demonstrable: relational-core builds and its unit tests pass; constructing a mutation AST with `ColumnRef[]` for `returning` no longer compiles.

**Tasks:**

- [ ] Add optional `codecId?: string` to `ProjectionItem` (constructor, `static of(alias, expr, codecId?)`, `freeze`). Update unit tests for `ProjectionItem`.
- [ ] Change `InsertAst.returning` from `ReadonlyArray<ColumnRef> | undefined` to `ReadonlyArray<ProjectionItem> | undefined`. Update constructor, `withReturning`, and any builder helpers.
- [ ] Change `UpdateAst.returning` analogously.
- [ ] Change `DeleteAst.returning` analogously.
- [ ] Update `rewrite()` on `InsertAst`, `UpdateAst`, `DeleteAst` to descend into each `ProjectionItem.expr` of `returning` (mirroring `SelectAst.projection`).
- [ ] Update `collectRefs()` and `collectParamRefs()` on the mutation ASTs to walk the new `ProjectionItem[]` shape.
- [ ] Add a unit test asserting that an alias rename via `rewrite()` on a mutation AST propagates through `returning` correctly.
- [ ] Update any downstream call sites in `relational-core` (and any test fixtures inside that package) that construct mutation ASTs with `ColumnRef[]`. Fix typecheck errors locally; broader fixture migration is in M3.

### Milestone 2 — Authority shifts to the AST

Producers stamp codecs onto the AST and stop populating sidecars; runtime consumers (decoder, encoder, lints, budgets) read from the AST; the Postgres renderer emits the new RETURNING form. After this milestone, the AST is authoritative end-to-end for AST-backed plans, and `beforeCompile` rewrites no longer require any sidecar maintenance. Demonstrable: full e2e and integration tests pass for AST-backed SELECT and mutation plans without `PlanMeta` carrying any sidecar.

**Tasks:**

- [ ] In `buildQueryPlan` (`packages/2-sql/4-lanes/sql-builder/src/runtime/builder-base.ts`), stamp `codecId` onto each emitted `ProjectionItem` from `rowFields`. Stop emitting `paramDescriptors`, `projectionTypes`, `annotations.codecs`, and `refs` on the produced `PlanMeta`.
- [ ] In `buildOrmQueryPlan` (`packages/3-extensions/sql-orm-client/src/query-plan-meta.ts`), stamp `codecId` onto each SELECT `ProjectionItem` and each RETURNING `ProjectionItem`, reusing the codec resolution that today populates `projectionTypes` (`resolveProjectionCodecs`). Stop emitting the four sidecar fields.
- [ ] Update the row decoder (`packages/2-sql/5-runtime/src/codecs/decoding.ts`) to build its alias→codec lookup by walking the AST's projection list (or `returning` list for mutation plans). For raw plans, return wire-level row values without codec transformation. Add the new SQL AST import; verify `pnpm lint:deps` still passes.
- [ ] Update the parameter encoder (`packages/2-sql/5-runtime/src/codecs/encoding.ts`) to read `codecId` from each `ParamRef` on the AST. For raw plans, pass parameter values to the driver as supplied. Remove the `paramDescriptors` lookup.
- [ ] Update the lints middleware (`packages/2-sql/5-runtime/src/middleware/lints.ts`) so structural lints run only on AST-backed plans; raw plans get only the existing SQL-string heuristics. No advisory or warning when structural lints are skipped on raw plans.
- [ ] Update the budgets middleware (`packages/2-sql/5-runtime/src/middleware/budgets.ts`) to derive row-count estimates from the AST. Remove the `refs.tables[0]` raw-plan path.
- [ ] Remove the `re-derive paramDescriptors after middleware AST rewrite` workaround in the SQL runtime (the encoder reads the AST directly, so the post-rewrite re-derivation is no longer needed).
- [ ] Update the Postgres SQL renderer (`packages/3-targets/6-adapters/postgres/src/core/sql-renderer.ts`) RETURNING lowering to walk `ProjectionItem[]`. Emit `<table>.<column>` when alias matches column name, `<table>.<column> AS <alias>` when alias differs, and `<expr> AS <alias>` for non-`ColumnRef` projection expressions.
- [ ] Add a runtime test asserting that an AST rewrite (alias rename) propagates correctly through codec resolution at decode time.
- [ ] Add a runtime test asserting that a `beforeCompile` rewriter swapping a projection alias produces correctly decoded rows end-to-end.
- [ ] Add a Postgres adapter integration test asserting that RETURNING with a codec (e.g. UUID, JSONB) decodes correctly via `ProjectionItem.codecId`.

### Milestone 3 — Cleanup, docs, close-out

Prune the type surface, trim the raw plan API, migrate the remaining test fixtures, update snapshots, update documentation, and close the project. After this milestone, the PR is review-ready and the project workspace is deletable.

**Tasks:**

- [ ] Remove `refs`, `paramDescriptors`, `projection`, `projectionTypes`, and `annotations.codecs` from `PlanMeta` (`packages/1-framework/0-foundation/contract/src/types.ts:159-177`). Narrow the `annotations` shape to the policy-routing fields per ADR 018.
- [ ] Delete `ParamDescriptor` and `PlanRefs` interfaces from `@prisma-next/contract/types`. Verify no in-repo importers remain.
- [ ] Drop `refs` and `projection` from `RawTemplateOptions` and `RawFunctionOptions` (`packages/2-sql/4-lanes/relational-core/src/types.ts:246-264`). Update the raw plan factory implementations to stop accepting / forwarding the removed fields.
- [ ] Update raw helper JSDoc and any onboarding examples to state caller responsibilities for parameter serialization and row interpretation; remove references to `refs`, `paramDescriptors`, `projection`, and codec maps.
- [ ] Migrate test fixtures in `packages/2-sql/5-runtime/test/before-compile-chain.test.ts`, `packages/3-extensions/sql-orm-client/test/query-plan-meta.test.ts`, `packages/2-sql/5-runtime/test/codec-async.test.ts`, and `packages/2-sql/5-runtime/test/json-schema-validation.test.ts` to construct `ProjectionItem` / `ParamRef` with `codecId` directly on the AST instead of hand-writing `annotations.codecs` or `paramDescriptors`.
- [ ] Sweep for any remaining hand-constructed `PlanMeta` fixtures or test helpers across all packages; migrate or delete.
- [ ] Update Postgres adapter snapshot tests for INSERT/UPDATE/DELETE … RETURNING to reflect the new SQL text where aliases differ. Verify alias-matches-column outputs are unchanged.
- [ ] Add a back-link in [ADR 012](../../docs/architecture%20docs/adrs/ADR%20012%20-%20Raw%20SQL%20Escape%20Hatch.md) noting that ADR 205 retires its optional structured-annotations branch (`refs`, `projection`, `codecs`); confirm the minimal annotation schema (`intent`, `isMutation`, `hasWhere`, `hasLimit`) is documented as unchanged.
- [ ] Sweep internal logs / telemetry pluck points for any references to `paramDescriptors` or `refs` in plan-snapshot dumps; remove them.
- [ ] Run `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, and `pnpm test:all`. Resolve any remaining failures.
- [ ] Verify every acceptance criterion in the spec is met; tick the spec checklist boxes (or mirror the verification in the PR description).
- [ ] Open the PR with the layered commit history (AST → producers → runtime → adapter → raw API → tests → docs) and the summary linking to ADR 205 and the spec.
- [ ] **Project close-out (final commit on the PR or follow-up PR after merge):** Delete `projects/execution-metadata-on-ast/`. ADR 205 is already canonical under `docs/architecture docs/adrs/`; no doc migration into `docs/` is required beyond the back-link in ADR 012. Sweep the repo for any references to `projects/execution-metadata-on-ast/**` and remove them.

## Test Coverage

Every acceptance criterion from the spec maps to at least one test or verification. AC IDs reference the spec's grouped checklist sections.

| Acceptance Criterion | Test Type | Task / Milestone | Notes |
|---|---|---|---|
| `ProjectionItem` carries optional `codecId?: string` | Unit | M1: ProjectionItem unit tests | Construction + factory coverage. |
| Mutation `returning` is `ProjectionItem[]`; `ColumnRef[]` no longer compiles | Typecheck | M1: type-update tasks + `pnpm typecheck` (M3) | Verified by compile failure on legacy shape. |
| `rewrite()` descends into mutation `returning` | Unit | M1: rewrite unit test (alias rename) | Asserts new alias surfaces in the rewritten AST. |
| `collectRefs()` / `collectParamRefs()` work on rewritten `returning` | Unit | M1: collectRefs/collectParamRefs unit tests | Cover at least one ColumnRef + one ParamRef in returning. |
| Producers emit no sidecars | Unit | M2: producer tests in `query-plan-meta.test.ts`, builder lane tests | Assert `refs` / `paramDescriptors` / `projectionTypes` / `annotations.codecs` are absent. |
| Producers stamp `codecId` on every typed `ProjectionItem` | Unit | M2: producer tests | Cover SELECT projections and INSERT/UPDATE/DELETE RETURNING items. |
| ORM client stamps codec on RETURNING items | Unit | M2: query-plan-meta tests | Same path as SELECT projections. |
| `PlanMeta` exports the reduced shape | Typecheck | M3: typecheck task | Compile fails if a removed field is read. |
| `ParamDescriptor` and `PlanRefs` removed; no importers | Static + grep | M3: type removal task; `pnpm lint:deps` and `pnpm typecheck` | Manual grep + typecheck must show zero importers. |
| Decoder reads codecs from AST; raw plans pass through | Unit + Integration | M2: decoder rewrite test, raw-plan decode test | Includes the new alias-rewrite test. |
| Encoder reads `ParamRef.codecId`; raw plans pass through | Unit | M2: encoder unit tests | Covers AST-backed and raw-plan paths. |
| Lints run only on AST-backed plans | Unit | M2: lints middleware tests | Raw plan path asserts only SQL-string heuristics fire. |
| Budgets derive from AST; `refs.tables[0]` path gone | Unit | M2: budgets middleware tests | Raw plan path falls through to existing heuristics. |
| Postgres RETURNING lowering: alias-aware emission | Snapshot + Integration | M2 (renderer change) + M3 (snapshot updates) | Snapshots update for alias-differs cases; integration test covers UUID/JSONB codec on RETURNING. |
| Snapshots updated for alias-differs RETURNING | Snapshot | M3: snapshot update task | Verify alias-matches-column outputs unchanged. |
| `RawTemplateOptions` / `RawFunctionOptions` no longer accept `refs` / `projection` | Typecheck | M3: raw API trim + `pnpm typecheck` | Compile fails if removed fields are passed. |
| Raw helper docs reflect new surface | Manual | M3: docs task | Reviewer-verifiable in the PR. |
| Existing raw plan tests still pass | Integration | M3: `pnpm test:all` | Excludes any test deliberately exercising removed fields (delete or rewrite those). |
| All package / e2e / integration tests pass | Integration / E2E | M3: `pnpm test:all` | Final gate. |
| Test fixtures migrated to `ProjectionItem` / `ParamRef` codecs | Unit | M3: fixture migration task | Per-file mechanical migration. |
| Alias-rename via AST rewrite decodes correctly | Unit / Integration | M2: rewrite + decode test | Listed in spec as a required new test. |
| `beforeCompile` rewriter alias swap end-to-end | Integration | M2: e2e rewrite test | Runs through the live `beforeCompile` hook. |
| RETURNING with codec decodes correctly | Integration | M2: Postgres adapter integration test | Use UUID and/or JSONB. |
| `pnpm lint:deps` passes with new SQL AST import | Static | M2 (decoder change) + M3 (final run) | New SQL AST import in sql-runtime is the layering touchpoint. |
| `pnpm lint` passes | Static | M3 | Run before the PR is opened (per repo convention). |
| `pnpm typecheck` passes | Static | M3 | Final gate before PR open. |
| ADR 012 has back-link to ADR 205 | Manual | M3: docs task | Reviewer-verifiable. |
| Raw helper docs / onboarding examples reflect new surface | Manual | M3: docs task | Reviewer-verifiable. |

## Open Items

- **`ParamDescriptor` / `PlanRefs` external consumers.** The spec calls out deleting both interfaces "if no in-repo importers remain." Implementation must grep the full repo (including examples) before deleting, and call out any external-facing exports in the PR description.
- **Snapshot diff size.** The Postgres RETURNING change adds `AS <alias>` only when alias differs from the column name. If the diff is larger than expected (because many internal call sites use non-trivial aliases), surface this in the PR before reviewers see it cold.
- **Deep-copy / serialization helpers.** If any helper deep-copies AST nodes (e.g. for plan caching or telemetry), it must be checked against the new `ProjectionItem.codecId` and the new `returning: ProjectionItem[]` shape. Discover during M1 typecheck pass; resolve in M3 cleanup.
- **TML-2143 downstream coordination.** Caching / annotation DSL milestones (deferred from TML-2306) build on `beforeCompile`. After this project lands, surface the new "AST is authoritative" invariant to the TML-2143 owners so they can plan against it. Out of scope for this project.
