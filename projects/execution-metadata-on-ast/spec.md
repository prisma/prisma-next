# Summary

Implement [ADR 205](../../docs/architecture%20docs/adrs/ADR%20205%20-%20Execution%20metadata%20lives%20on%20AST.md): make the SQL AST the single source of truth for execution metadata. Remove the `refs`, `paramDescriptors`, `annotations.codecs`, and `projectionTypes` sidecars from `PlanMeta`; promote `Insert/Update/Delete.returning` from `ColumnRef[]` to `ProjectionItem[]`; add an optional `codecId` to `ProjectionItem`; and migrate the runtime decoder, lints, and budget heuristics to read from the AST.

# Description

Today, two channels carry execution metadata: the AST (richer, used for lowering and some middleware) and a flat sidecar on `PlanMeta` (alias→codec maps, parameter descriptors, table/column/index refs). Both builder paths populate the sidecar by walking the AST they just constructed and flattening per-node information. This duplicates state and makes AST-rewriting middleware brittle: a `beforeCompile` rewriter that renames an alias, swaps a projection, reorders parameters, or adds a join silently invalidates every alias-keyed or index-keyed sidecar map. The `beforeCompile` hook now ships in the SQL runtime ([PR #373](https://github.com/prisma/prisma-next/pull/373)), and the workaround on top of it (`fix(sql-runtime): re-derive paramDescriptors after middleware AST rewrite`) is exactly the kind of patch ADR 205 retires by removing the divergence at the source.

ADR 205 resolves it by collapsing the two channels into one: the AST. The runtime walks the AST once at decode setup to build the alias→codec lookup; the encoder continues to read `ParamRef.codecId` (already on the AST). Raw plans, which have no AST, lose per-parameter codec encoding and per-alias codec decoding — consistent with the "escape hatch" character of raw SQL. Lints and budget heuristics that depended on `refs` either move to the AST or fall back to the SQL-string heuristics that already exist for raw plans.

The change has bounded surface area but touches several layers — AST node definitions and visitors in relational-core, the SQL builder lane and SQL ORM client producers, the SQL runtime decoder/encoder/middleware, the Postgres adapter's RETURNING lowering, the raw plan API in `relational-core`, and a set of test fixtures that hand-construct codec maps.

# Requirements

## Functional Requirements

### AST changes (relational-core)

- **F1.** `ProjectionItem` gains an optional `codecId?: string` field, threaded through its constructor and `static of(...)` factory. When `codecId` is undefined, decoders pass the wire value through unchanged (no warn/throw); the field may be promoted to required in a future change.
- **F2.** `InsertAst.returning`, `UpdateAst.returning`, and `DeleteAst.returning` change type from `ReadonlyArray<ColumnRef> | undefined` to `ReadonlyArray<ProjectionItem> | undefined`. Constructors, builder methods (`withReturning`, etc.), and ref-collection methods (`collectRefs`, `collectParamRefs`) update accordingly.
- **F3.** Mutation AST `rewrite` methods (and any visitor/folder traversals) descend into each `ProjectionItem.expr` of `returning`, mirroring how `SelectAst.projection` is already traversed.

### Producers (builder lane and ORM client)

- **F4.** `buildQueryPlan` (`packages/2-sql/4-lanes/sql-builder/src/runtime/builder-base.ts`) stops emitting `refs`, `paramDescriptors`, `annotations.codecs`, and `projectionTypes` on `PlanMeta`. It stamps `codecId` onto each emitted `ProjectionItem` for SELECT projections, using the same scope-field lookup it currently uses to populate `projectionTypes`.
- **F5.** `buildOrmQueryPlan` (`packages/3-extensions/sql-orm-client/src/query-plan-meta.ts`) stops emitting the same fields. For mutation plans, it stamps `codecId` onto each `ProjectionItem` in the AST's `returning` list, using the codec resolution logic that today populates `projectionTypes` (see `resolveProjectionCodecs`).
- **F6.** Both producers pass through unchanged: `target`, `targetFamily`, `storageHash`, `profileHash`, `lane`, and the policy-routing `annotations` subset retained per ADR 018 (`intent`, `isMutation`, `hasWhere`, `hasLimit`, `sensitivity`, `budget`, `ownerTag`, `ext`).

### Type definitions (contract)

- **F7.** `PlanMeta` (`packages/1-framework/0-foundation/contract/src/types.ts:159-177`) drops `refs`, `paramDescriptors`, `projection`, `projectionTypes`, and `annotations.codecs`. The `annotations` shape is narrowed to the policy-routing fields per ADR 018.
- **F8.** `ParamDescriptor` and `PlanRefs` interfaces are removed from `@prisma-next/contract/types` along with their fields. Any in-repo importer is updated at the point of change (no compat re-exports).

### Runtime consumers (sql-runtime)

- **F9.** The row decoder (`packages/2-sql/5-runtime/src/codecs/decoding.ts`) builds its alias→codec lookup by walking the AST's projection list (or `returning` list for mutation plans). For plans without an AST (raw), the decoder hands wire-level row values to the caller without codec-based transformation.
- **F10.** The parameter encoder (`packages/2-sql/5-runtime/src/codecs/encoding.ts`) reads `codecId` from each `ParamRef` on the AST. For raw plans, parameters pass through to the driver as supplied by the caller (no per-parameter codec encoding).
- **F11.** The lints middleware (`packages/2-sql/5-runtime/src/middleware/lints.ts`) runs structural lints (e.g. unindexed-predicate) only against the AST. Where a lint cannot be supported without an AST, it does not run on raw plans; the existing SQL-string heuristics (select-star, missing LIMIT, mutation-without-WHERE) remain available. The runtime emits no advisory or warning when raw plans skip structural lints — silence is intentional, consistent with the escape-hatch contract.
- **F12.** The budgets middleware (`packages/2-sql/5-runtime/src/middleware/budgets.ts`) derives row-count estimates from the AST for AST-backed plans. The `refs.tables[0]` heuristic for raw plans is removed; the existing SQL-string fallback is the only path for raw plans.

### Adapter (Postgres)

- **F13.** The Postgres SQL renderer (`packages/3-targets/6-adapters/postgres/src/core/sql-renderer.ts`) RETURNING lowering walks `ProjectionItem[]` instead of `ColumnRef[]`. It emits `<table>.<column>` when the projection alias matches the underlying column name, and `<table>.<column> AS <alias>` when they differ. Non-`ColumnRef` projection expressions render through the existing expression renderer with `AS <alias>`.

### Raw plan API

- **F14.** `RawTemplateOptions` (`packages/2-sql/4-lanes/relational-core/src/types.ts:246-250`) drops `refs` and `projection`. `annotations` (the minimal ADR 012 schema) remains. `RawFunctionOptions` inherits the change.
- **F15.** Raw plan factories no longer accept or forward the removed fields. Documentation for the raw helper is updated to state that callers are responsible for parameter serialization and row interpretation.

### Tests and fixtures

- **F16.** Test fixtures that hand-construct `PlanMeta` with `annotations.codecs`, `paramDescriptors`, `projectionTypes`, or `refs` migrate to construct `ProjectionItem` with `codecId` and/or `ParamRef` with `codecId` directly on the AST. The migration is mechanical and per-file.
- **F17.** End-to-end and integration tests covering the SELECT, INSERT, UPDATE, and DELETE paths (including RETURNING) continue to pass with no behavioral regression for AST-backed plans.

### Documentation

- **F18.** ADR 012's "optional structured annotations" branch is marked retired by ADR 205, with a back-link from the relevant ADR 012 sections. The minimal annotation schema (`intent`, `isMutation`, `hasWhere`, `hasLimit`) is documented as unchanged.
- **F19.** The raw helper's API docs and any onboarding examples drop references to `refs`, `paramDescriptors`, `projection`, and codec-map options.

## Non-Functional Requirements

- **N1. No regressions for AST-backed plans.** Decoded values, encoded parameters, lint output, and budget evaluations for any AST-backed plan must match pre-change behavior, modulo the small RETURNING SQL-text difference (`AS alias` when alias differs from column).
- **N2. Decode-path performance.** Walking the AST projection list once at decode setup must not regress p99 decode latency for representative plans (SELECT with 5–50 columns, mutations with RETURNING). The pre-ADR sidecar lookup is `O(1)` per alias; the AST walk is `O(projection-count)` once per query and produces an `O(1)` lookup map. No additional allocations per row.
- **N3. Plan size shrinks.** `PlanMeta` payload size (when serialized) drops by the size of the removed fields. No new fields are added to `PlanMeta`.
- **N4. Type safety preserved.** No `any`, no `@ts-expect-error`, no `as unknown as` casts introduced. New `ProjectionItem.codecId` is typed as `string | undefined`.
- **N5. Layering rules preserved.** SQL runtime gaining an import on the SQL AST module is acceptable per ADR 205; `pnpm lint:deps` must still pass.
- **N6. Telemetry unchanged.** Timing, row counts, and error codes flow through paths independent of the removed sidecars (per ADR 205 Not-in-scope).

## Non-goals

- **NG1.** The ADR 012 minimal annotation schema (`intent`, `isMutation`, `hasWhere`, `hasLimit`, `sensitivity`, `budget`, `ownerTag`, `ext`) is unchanged.
- **NG2.** Plan-identity hashing rules (ADR 013) are unchanged — the removed fields were already excluded from identity.
- **NG3.** Cross-family work (Mongo etc.) is out of scope. The AST-as-source invariant applies family-wide, but Mongo-family migration is a separate piece of work.
- **NG4.** Restoring the lints/budgets that depended on `refs` for raw plans. ADR 205 accepts this as a known degradation.
- **NG5.** Adding new lints on top of the AST. Lint coverage stays at parity (or strictly degrades for raw plans only).
- **NG6.** Backward-compat shims, deprecation aliases, or transitional dual-population. Per repo policy, call sites update at the point of change.

# Acceptance Criteria

## AST surface

- [ ] `ProjectionItem` carries an optional `codecId?: string` accessible via construction and `static of(alias, expr, codecId?)`.
- [ ] `InsertAst.returning`, `UpdateAst.returning`, `DeleteAst.returning` are typed `ReadonlyArray<ProjectionItem> | undefined`. Constructing one with `ColumnRef[]` no longer compiles.
- [ ] `rewrite()` on each mutation AST descends into every `ProjectionItem.expr` in `returning` and reconstructs the AST with the rewritten items.
- [ ] `collectRefs()` / `collectParamRefs()` on mutation ASTs continue to surface refs/params from the (rewritten) `returning` items.

## Producers

- [ ] `buildQueryPlan` and `buildOrmQueryPlan` produce `PlanMeta` objects without `refs`, `paramDescriptors`, `projection`, `projectionTypes`, or `annotations.codecs`.
- [ ] Every `ProjectionItem` emitted by either producer carries `codecId` whenever the producer's existing scope-field machinery has type information for that alias. (Items without a known codec leave `codecId` undefined.)
- [ ] The same codec-stamping logic applies to RETURNING items in INSERT/UPDATE/DELETE plans built by the ORM client.

## Type definitions

- [ ] `PlanMeta` exports the reduced shape.
- [ ] `ParamDescriptor` and `PlanRefs` interfaces are removed from `@prisma-next/contract/types`; no in-repo imports remain.

## Runtime

- [ ] The row decoder resolves codecs by walking the AST projection list; for raw plans it returns wire-level row values without codec transformation.
- [ ] The parameter encoder encodes from `ParamRef.codecId`; for raw plans, parameter values pass through to the driver unchanged.
- [ ] The lints middleware runs structural lints only on AST-backed plans; raw plans get only the SQL-string heuristics.
- [ ] The budgets middleware estimates row counts from the AST for AST-backed plans; the `refs.tables[0]` raw-plan path is gone.

## Adapter

- [ ] Postgres RETURNING lowering produces `<table>.<column>` when alias matches column name, `<table>.<column> AS <alias>` when alias differs, and `<expr> AS <alias>` for non-`ColumnRef` projection expressions.
- [ ] Snapshot tests for INSERT/UPDATE/DELETE … RETURNING are updated to reflect the new SQL text where aliases differ; output is otherwise unchanged for the alias-matches-column case.

## Raw plan API

- [ ] `RawTemplateOptions` and `RawFunctionOptions` no longer accept `refs` or `projection`.
- [ ] Raw helper documentation reflects the removed options and states caller responsibilities for serialization and row interpretation.
- [ ] Existing raw plan tests (excluding ones intentionally exercising removed fields) still pass.

## Tests

- [ ] All package tests, e2e tests, and integration tests pass under `pnpm test:all`.
- [ ] Test fixtures that constructed plans with hand-written codec maps now construct `ProjectionItem` / `ParamRef` with `codecId`.
- [ ] At least one new test asserts that an AST rewrite (alias rename) propagates correctly through codec resolution at decode time — i.e. the decoder reads the rewritten alias and codec from the AST, not a stale sidecar.
- [ ] At least one new test asserts that a `beforeCompile` rewriter that swaps a projection alias produces correctly decoded rows end-to-end.
- [ ] At least one new test asserts that RETURNING with a codec (e.g. UUID, JSONB) decodes correctly via `ProjectionItem.codecId`.

## Layering and lint

- [ ] `pnpm lint:deps` passes with the new SQL AST import in the SQL runtime decoder.
- [ ] `pnpm lint` passes across all packages.
- [ ] `pnpm typecheck` passes across all packages.

## Documentation

- [ ] ADR 012 has a back-link or note referencing ADR 205 as retiring its optional structured-annotations branch.
- [ ] Raw helper docs and onboarding examples reflect the new option surface.

# Other Considerations

## Security

No new security surface. The change does not affect authentication, authorization, or how parameters are sent to the driver. Raw plans now bypass codec encoding — callers must supply driver-compatible parameter values, which is consistent with the escape-hatch contract and does not introduce a new injection vector (parameters are still parameterized, not concatenated into SQL).

## Cost

No infrastructure cost impact. Plan payloads are slightly smaller, decode-path work is comparable. Engineering cost is bounded; expected size is one branch with a series of commits, low-tens of files.

## Observability

No change to telemetry schema or metric names. If any internal logs mention `paramDescriptors` or `refs` in plan-snapshot dumps, those references should be removed during implementation. No alert/SLO change.

## Data Protection

No change. The system continues to handle the same data; codec resolution moves source-of-truth but does not alter what data is read or how it is stored.

## Analytics

Not applicable.

# References

- [ADR 205 — Execution metadata lives on AST](../../docs/architecture%20docs/adrs/ADR%20205%20-%20Execution%20metadata%20lives%20on%20AST.md)
- [ADR 011 — Unified Plan Model](../../docs/architecture%20docs/adrs/ADR%20011%20-%20Unified%20Plan%20Model.md)
- [ADR 012 — Raw SQL Escape Hatch](../../docs/architecture%20docs/adrs/ADR%20012%20-%20Raw%20SQL%20Escape%20Hatch.md)
- [ADR 013 — Lane Agnostic Plan Identity](../../docs/architecture%20docs/adrs/ADR%20013%20-%20Lane%20Agnostic%20Plan%20Identity.md)
- [ADR 018 — Plan Annotations Schema](../../docs/architecture%20docs/adrs/ADR%20018%20-%20Plan%20Annotations%20Schema.md)
- [ADR 030 — Result decoding & codecs registry](../../docs/architecture%20docs/adrs/ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md)
- [ADR 162 — Kysely lane emits PN SQL AST](../../docs/architecture%20docs/adrs/ADR%20162%20-%20Kysely%20lane%20emits%20PN%20SQL%20AST.md)
- PR #373 (`feat(sql-runtime): add beforeCompile middleware hook`) and follow-ups — the `beforeCompile` rewrite hook is merged. The `re-derive paramDescriptors after middleware AST rewrite` fix on top of it is the workaround that this project removes by making the AST authoritative.

# Implementation Strategy

- **Single bundled PR.** All AST, producer, runtime, adapter, raw-plan API, test fixture, and documentation changes land together. Consistent with the repo's no-compat-shim policy. Commit structure within the PR follows the layering: AST → producers → runtime → adapter → raw API → tests → docs.
- **`beforeCompile` is already merged.** The motivating consumer is in main. After this project lands, the `re-derive paramDescriptors after middleware AST rewrite` workaround in `sql-runtime` is removed (the encoder reads from the AST directly, so there is nothing to re-derive).
- **Lints/budgets degradation for raw plans is silent.** No one-time advisory is emitted when structural lints are skipped — the escape-hatch contract takes precedence.
- **`ProjectionItem.codecId` is optional.** Decoder passes wire values through when the field is absent. A future change may promote it to required once all in-repo producers stamp it; that is not part of this project.
- **`ParamDescriptor` and `PlanRefs` are deleted outright.** They are inner shapes of removed fields; no compat re-exports.
- **Postgres RETURNING snapshot tests are updated** to reflect the `AS <alias>` output where aliases differ. Output is unchanged where alias matches the underlying column name.

# Open Questions

None. All shaping-stage questions have been resolved (see Implementation Strategy). Implementation-time decisions — e.g. exact commit boundaries, snapshot diff size, whether any deep-copy helper needs adapting for the new `returning` shape — are deferred to the plan and the PR.
