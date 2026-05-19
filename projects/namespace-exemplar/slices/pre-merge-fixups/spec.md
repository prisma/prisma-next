# Slice: pre-merge fixups (within TML-2520 / PR #534)

**Slice within:** [`projects/namespace-exemplar/`](../../spec.md) — Namespace exemplar.
**Tracking ticket:** [TML-2520](https://linear.app/prisma-company/issue/TML-2520) (no extra ticket; this is part of the predecessor work, not a separate slice for delivery purposes).
**Branch / PR:** `tml-2520-namespace-exemplar` / [PR #534](https://github.com/prisma/prisma-next/pull/534).
**Status:** In flight.

## Purpose

This slice exists to anchor the additional work that **made the cut for PR #534** during the post-merge review + the [`contract-ir-planes`](../../../contract-ir-planes/spec.md) discussion (TML-2584).

The triage question for each item was: *"Is this a load-bearing completion of the namespace-exemplar work, or is it part of the broader IR-shape reshape that belongs to TML-2584?"* Items in this slice are completions — they finish what TML-2520 started; without them, the namespace exemplar ships with known information-loss bugs and known one-shot helper-function hacks that the next contributor will have to clean up before they can read the code.

Items not in this slice were deferred. They belong to TML-2584 because they're structural reshapes (plane split, namespace-keying of domain content, framework `Namespace` interface narrowing, IR constructor discipline). See § Deferred to TML-2584 below.

## Items in scope (must land before PR #534 merges)

### Item 1 — Schema verifier propagates namespace coordinate on issues; delete `effectiveSchemaForTable` and `locateTable` (planner duplications)

**Problem.** The SQL family schema verifier walks `storage.namespaces[nsId].tables[name]` to find drift, but writes only `name` into the `SchemaIssue` it produces — destroying the namespace coordinate it already knew. The Postgres planner then has to re-derive the coordinate by walking `storage.namespaces` again via `locateTable`. This is the structural cause of:

- F01 — `effectiveSchemaForTable` silent fallthrough to `ctx.schemaName` (correctness gap; wrong-schema DDL in multi-namespace contracts when `locateTable` returns `undefined`).
- F06 — four independent reimplementations of the same "walk namespaces, find table by name" loop across planner-strategies (Postgres + SQLite), sql-renderer, and emitter. This slice eliminates the two **migration-planner** duplications (Postgres + SQLite). The remaining two — `getInsertColumnOrder`'s fallback walk in `sql-renderer.ts` and the model-side callers of `findSqlTable` in the emitter — are deferred to TML-2584 (see § Deferred to TML-2584); their deletion requires structural carrier changes (`SqlModelStorage.namespaceId`, `InsertAst` carrying namespace) that overlap with TML-2584's plane reshape.
- F03 partial — the planner needs `instanceof PostgresSchema` checks to decide where the unbound bucket projects, because the issue doesn't carry enough context to make that decision intrinsically.

**Scope cut.** The minimal fix in this slice is to **add `namespaceId?: string` as a sibling field on the existing framework-layer `BaseSchemaIssue`**. The verifier populates it; the planner reads it. No type restructuring, no layering reshape. This is enough to fix F01 and to delete the four walks, which is what TML-2520 needs to ship cleanly.

The deeper architectural cleanup — splitting `BaseSchemaIssue` between framework-shared fields and family-specific extensions (`SqlSchemaIssue` with a structured `table: { namespaceId, name }` pair, `MongoSchemaIssue` with its collection-coordinate shape) — is **not** in this slice. Tracked separately as [TML-2585](https://linear.app/prisma-company/issue/TML-2585/split-schemaissue-into-framework-shared-base-family-specific) because it's cross-cutting refactor that bloats PR #534's review surface without adding behavioural value the namespace exemplar needs.

**Fix shape.**

1. Add `readonly namespaceId?: string` to `BaseSchemaIssue` in `packages/1-framework/1-core/framework-components/src/control/control-result-types.ts`. Sibling field; optional (Mongo just doesn't populate it).
2. Update the SQL family schema verifier (`packages/2-sql/9-family/src/core/schema-verify/`) to populate `namespaceId` at every issue construction site. The verifier already has `nsId` in scope from its outer walk — change is one assignment per construction site.
3. Update Postgres planner consumers (`planner-strategies.ts`, `issue-planner.ts`) to read `issue.namespaceId` directly. Replace every `locateTable(...)?.table` pattern with the direct lookup `storage.namespaces[issue.namespaceId].tables[issue.table]`.
4. Update SQLite planner consumers analogously.
5. Delete `effectiveSchemaForTable`. Layer 3 (the FR16c "where does the unbound bucket project?" logic) promotes to a polymorphic method on the namespace concretion (`PostgresSchema#ddlSchemaName(): string` / `PostgresUnboundSchema#ddlSchemaName(): string`), called by the planner once per namespace it touches. No more `instanceof PostgresSchema` in planner code.
6. Delete `locateTable` from `packages/3-targets/3-targets/postgres/src/core/migrations/planner-strategies.ts` and `packages/3-targets/3-targets/sqlite/src/core/migrations/planner-strategies.ts`. Where call sites still need typed access to a `StorageTable` given its coordinate, introduce a small 3-arg helper (`tableAt(storage, namespaceId, tableName): StorageTable | undefined`) that requires the coordinate explicitly — no scan, no silent fallthrough.
7. Replace the **FK-reference** `findSqlTable` call site in `packages/2-sql/3-tooling/emitter/src/index.ts` (line 210, the `fk.target.tableName` lookup) with direct access via `fk.target.namespaceId` — `ForeignKeyReference` already carries that coordinate. The two **model-side** `findSqlTable` callers (lines 118 and 283) stay as-is on this PR; their deletion is deferred to TML-2584 because `SqlModelStorage.table` is a bare string and adding `namespaceId` to `SqlModelStorage` is a domain-plane carrier change (TML-2584 § D2). Similarly the inline namespace walk inside `getInsertColumnOrder` (`packages/3-targets/6-adapters/postgres/src/core/sql-renderer.ts` line 633) stays — its deletion requires threading namespace through `InsertAst`, which is DSL-shape work outside this slice.
8. Update tests (Postgres planner tests, SQLite planner tests, SQL family schema-verify tests). Mongo verifier tests don't need changes (they don't populate `namespaceId`; the field stays absent).

**Acceptance criteria.**

- **AC1.1.** `BaseSchemaIssue` carries a `readonly namespaceId?: string` sibling field. Optional; populated by the SQL family verifier, absent in Mongo issues.
- **AC1.2.** Every SQL schema-issue construction site (in `packages/2-sql/9-family/src/core/schema-verify/`) populates `namespaceId` with the `nsId` from the verifier's outer walk. Grep gate: every place that builds an issue with `table:` also sets `namespaceId:`.
- **AC1.3.** Every Postgres planner site that previously called `locateTable(...)?.table` or `effectiveSchemaForTable(ctx, issue.table)` reads from `issue.namespaceId` / `issue.table` directly. Same for SQLite. Grep gate: zero references to `effectiveSchemaForTable` anywhere in `packages/**`; zero references to `locateTable` in `packages/3-targets/3-targets/{postgres,sqlite}/`; the FK-reference call to `findSqlTable(storage, fk.target.tableName)` in the emitter is gone (replaced by direct access via `fk.target.namespaceId`). The two model-side `findSqlTable` callers and `sql-renderer.ts`'s inline equivalent are explicitly **out of scope** for this AC — they're deferred to TML-2584.
- **AC1.4.** Layer 3 of the old `effectiveSchemaForTable` is preserved behaviour-equivalently as a polymorphic method on `PostgresSchema` / `PostgresUnboundSchema`. No `instanceof PostgresSchema` in `planner-strategies.ts`.
- **AC1.5.** Regression test for the previously-silent F01 path: an issue naming a table that isn't in any namespace of `toContract.storage` returns an explicit error (not silent wrong-schema DDL). Same multi-namespace setup that would have exhibited the bug.
- **AC1.6.** All existing tests pass: `pnpm typecheck`, `pnpm test:packages`, `pnpm fixtures:check`, `pnpm lint:deps` clean.

### Item 2 — Reference TML-2583 above the two historical migration-snapshot exclusions

**Problem.** F05 — two `if (rel.startsWith('examples/.../migrations/'))` exclusions in `snapshot-read-shapes.test.ts` carve out the historical migration snapshots that carry the old flat `storage.tables` shape. No ticket reference next to them; without one, the strict-validation gate has silent blind spots.

**Fix shape.** Add a code comment above each exclusion referencing [TML-2583](https://linear.app/prisma-company/issue/TML-2583) with a one-sentence rationale.

**Acceptance criteria.**

- **AC2.1.** Each exclusion has a `// TML-2583: …` comment above it stating *why* the path is excluded (historical migration snapshots carry the pre-namespace storage shape) and *what closes the exclusion* (re-baselining the historical migration snapshots against the post-namespace shape; requires `DATABASE_URL` for the cipherstash one).
- **AC2.2.** Logic unchanged; both paths still excluded; test still passes.

### Item 3 — Generic `deserializeContract<T>(json): T` at the family interface; drop the demo cast

**Problem.** Inline review comment #5 on PR #534: the demo's contract-loading site has an `as unknown as typeof contract` cast because the family-level `deserializeContract` returns the un-specialized base `Contract` type. The cast is a workaround for the missing type parameter.

**Fix shape.** Make `deserializeContract` generic with a default: `deserializeContract<T extends Contract = Contract>(json): T`. The default preserves all existing un-typed call sites; new call sites that know the precise contract type get `deserializeContract<typeof contract>(json)` and skip the cast.

**Acceptance criteria.**

- **AC3.1.** Family-level `deserializeContract` (in `sql-contract-serializer-base.ts`; sibling for Mongo if present) is generic with a default of `Contract`.
- **AC3.2.** The `as unknown as typeof contract` cast in `examples/prisma-next-demo/src/prisma-no-emit/context.ts` is gone; the call site becomes `deserializeContract<typeof contract>(json)` and type-checks.
- **AC3.3.** Every existing un-typed `deserializeContract(json)` call continues to type-check unchanged.
- **AC3.4.** `pnpm typecheck` clean across the workspace; no new `as unknown as` casts introduced.

### Item 4 — `hasForeignKey` unqualified-key format collides for identifiers containing `|`

**Problem.** F04 in the code review. The Postgres planner-schema-lookup helper encodes unqualified FK keys as `${cols}||${refTable}|${refCols}` — a double-pipe is used as the schema separator and a single-pipe as the column separator, deliberately distinct so qualified and unqualified keys can't collide. The trick works only for identifiers that don't contain `|`. Postgres quoted identifiers can carry arbitrary characters, so a column or table name containing `|` corrupts the key and `hasForeignKey` returns a false negative — the verifier then reports a phantom "missing FK" issue.

The blast radius is small in practice (standard Postgres identifiers are `[a-z_][a-z_0-9]*`), but the encoding is fragile and the fix is mechanical.

**Fix shape.** Replace the pipe-separator encoding with a structurally unambiguous key — JSON-encoded tuple (`JSON.stringify([qualifier, table, [...cols], [...refCols]])`) or a separator that can't appear in quoted identifiers (`\u0000`). Apply to both qualified and unqualified key construction in `packages/3-targets/3-targets/postgres/src/core/migrations/planner-schema-lookup.ts`.

**Acceptance criteria.**

- **AC4.1.** The qualified and unqualified FK key encodings are structurally unambiguous: no separator-character assumption about identifier contents.
- **AC4.2.** Unit test exercises `hasForeignKey` against a table with an identifier containing `|` (and `||` for paranoia); asserts the lookup returns true / false correctly without false negatives.
- **AC4.3.** All existing FK-lookup callers continue to type-check and pass tests.

### Item 5 — Add span assertion to the PSL-reserved-namespace diagnostic test (AC4 weak verification)

**Problem.** PR #534's code review § 6 flagged the AC4 verification as **WEAK**: the test for `namespace unbound { … }` alongside a sibling named namespace asserts the diagnostic `code` and `message` content but doesn't assert that `span` is populated. The implementation uses `...ifDefined('span', unboundBlock?.span)` so span is present when parsed; the test would silently pass even if a future refactor stopped emitting span.

**Fix shape.** Add an explicit `expect(diagnostic.span).toBeDefined()` (or stricter — assert the span has plausible line/column data) to the relevant test case in `packages/2-sql/2-authoring/contract-psl/test/interpreter.diagnostics.test.ts`.

**Acceptance criteria.**

- **AC5.1.** The PSL-reserved-namespace diagnostic test asserts the diagnostic carries a non-`undefined` `span`.
- **AC5.2.** No implementation change required; the test alone should pass with current code.

## Dispatches

Item 1 is L by `drive/calibration/sizing.md` (substrate field + every SQL-side consumer + helper deletions + new polymorphic method + multi-package). Decomposed below into 6 S/M dispatches. Items 2–5 are XS/S leaves and run as single dispatches. Execution order: Item 1 chain (1.a → 1.f) first to keep the structural fix contiguous for review continuity, then leaves (2 → 3 → 4 → 5).

Validation gates per dispatch use the standard harness — `pnpm typecheck`, `pnpm test:packages -- <pkg>`, scoped greps for the grep-gated ACs. The slice DoD (AC1.6 + analogues) runs the full workspace gate after dispatch 5.

### Dispatch 1.a — Add `namespaceId?: string` to `BaseSchemaIssue` (XS)

**Intent.** Type-only change. Field is optional, populated by family verifiers later in the chain. Mongo doesn't populate; the field stays absent for Mongo issues.

**Files in play.**
- `packages/1-framework/1-core/framework-components/src/control/control-result-types.ts` — add field with the doc-comment shape from AC1.1.

**Done when.**
- [ ] `pnpm typecheck` clean at the framework-components package and downstream consumers (Mongo verifier, SQL family verifier, both planners — all currently use only existing fields, so addition is purely additive).
- [ ] Grep gate: `rg "readonly namespaceId" packages/1-framework/1-core/framework-components/src/control/control-result-types.ts` returns the new field.

**ACs satisfied (partial).** AC1.1 (the field exists).

**Out of scope.** Populating the field; reading the field; restructuring `BaseSchemaIssue` (TML-2585 territory).

---

### Dispatch 1.b — SQL family verifier populates `namespaceId` at every issue construction site (M)

**Intent.** Every SQL-side `issues.push({ kind: …, table: tableName, … })` site stamps `namespaceId` from the verifier's outer namespace walk. `extra_table` (DB-side table not in any contract namespace) is the only exception — field stays absent because there's no contract coordinate to record.

**Files in play.**
- `packages/2-sql/9-family/src/core/schema-verify/verify-sql-schema.ts` — thread `namespaceId` through `verifyTableChildren`, `collectContractColumnNodes`, `appendExtraColumnNodes`, `verifyColumn` options. Stamp at every `issues.push({ kind: 'missing_table' | 'missing_column' | 'extra_column' | 'extra_primary_key' | 'type_mismatch' | 'nullability_mismatch' | 'default_missing' | 'default_mismatch' | 'extra_default', ... })` site.
- `packages/2-sql/9-family/src/core/schema-verify/verify-helpers.ts` — extend `verifyPrimaryKey`, `verifyForeignKeys`, `verifyUniqueConstraints`, `verifyIndexes` signatures with `namespaceId: string`; stamp at their construction sites (`primary_key_mismatch`, `foreign_key_mismatch`, `extra_foreign_key`, `unique_constraint_mismatch`, `extra_unique_constraint`, `index_mismatch`, `extra_index`).

**Done when.**
- [ ] `pnpm typecheck` clean.
- [ ] `pnpm test:packages -- packages/2-sql/9-family` green (existing schema-verify tests; no behaviour change in pass/fail outcomes, only `namespaceId` now present on issue objects).
- [ ] Grep gate: every `issues.push({ kind: 'X', table: ... })` site in `packages/2-sql/9-family/src/core/schema-verify/` also sets `namespaceId:`, except the `extra_table` site (which has no contract coordinate — verifier-side comment explains why).
- [ ] Mongo verifier tests untouched and still pass.

**ACs satisfied (partial).** AC1.2.

**Out of scope.** Anyone reading the field (planners — that's 1.d/1.e); the polymorphism promotion (1.c).

---

### Dispatch 1.c — Promote `effectiveSchemaForTable`'s Layer 3 to polymorphic `ddlSchemaName()` (S)

**Intent.** Replace the `instanceof PostgresSchema` + `public`-vs-sentinel projection logic from `effectiveSchemaForTable` (lines 165–182 of `planner-strategies.ts`) with a `ddlSchemaName(contract: Contract): string` instance method on `PostgresSchema` and `PostgresUnboundSchema`. Pattern is a sibling of the existing `qualifyTable` polymorphic dispatch. Existing `instanceof PostgresSchema` check in planner code (one site) goes away.

**Files in play.**
- `packages/3-targets/3-targets/postgres/src/core/postgres-schema.ts` — add `ddlSchemaName(contract)` method on `PostgresSchema` (returns own id) and on `PostgresUnboundSchema` (returns `'public'` if contract has a `public` namespace, else `UNBOUND_NAMESPACE_ID`).
- New tests for both concretions in `packages/3-targets/3-targets/postgres/test/postgres-schema.test.ts` covering the unbound→public projection and unbound→sentinel fallback.

**Done when.**
- [ ] `pnpm typecheck` clean.
- [ ] `pnpm test:packages -- packages/3-targets/3-targets/postgres` green; new tests cover both unbound projection paths.
- [ ] Grep gate: `rg "ddlSchemaName" packages/3-targets/3-targets/postgres/src/` shows the new method on both concretions.

**ACs satisfied (partial).** AC1.4 (the polymorphic method exists; the planner-side `instanceof` removal lands in 1.d).

**Out of scope.** Planner consumer rewrite (1.d).

---

### Dispatch 1.d — Postgres planner consumers + delete helpers + F01 regression test goes green (M)

**Intent.** Replace every `effectiveSchemaForTable(ctx, issue.table)` with `issue.namespaceId` (or `ddlSchemaName(toContract)` resolution when the namespace is `UNBOUND_NAMESPACE_ID`). Replace every `locateTable(ctx.toContract.storage, issue.table)?.table` with `tableAt(storage, issue.namespaceId, issue.table)` (a new 3-arg helper that requires the coordinate). The FK-ref site at line 411 carries `nsId` from its enclosing walk. Delete `effectiveSchemaForTable` and `locateTable`. Add the F01 regression test from AC1.5 (it's red until this dispatch; green after).

**Files in play.**
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-strategies.ts` — delete `effectiveSchemaForTable`; delete `locateTable`; introduce `tableAt(storage, namespaceId, tableName): StorageTable | undefined`; update the 7 `effectiveSchemaForTable` call sites and the ~13 `locateTable` call sites; update the FK-ref site in `enumRebuildCallRecipe` to carry `nsId` through the walk.
- `packages/3-targets/3-targets/postgres/src/core/migrations/issue-planner.ts` — drop the imports + update 11 caller sites (case branches all already have `issue.table` and now `issue.namespaceId` in scope).
- `packages/3-targets/3-targets/postgres/test/migrations/issue-planner.test.ts` — add the AC1.5 regression test (stale-namespace `missing_table` → explicit conflict) and a positive companion (correct `namespaceId` → correctly-qualified DDL).

**Done when.**
- [ ] `pnpm typecheck` clean.
- [ ] `pnpm test:packages -- packages/3-targets/3-targets/postgres` green, including the new F01 regression tests.
- [ ] `pnpm fixtures:check` clean (planner-strategies refactor should be byte-identical for single-namespace contracts because `issue.namespaceId === UNBOUND_NAMESPACE_ID` → `ddlSchemaName(contract)` returns the same result as the deleted Layer-3 logic).
- [ ] Grep gates: `rg "effectiveSchemaForTable|locateTable\b" packages/3-targets/3-targets/postgres/src/` returns zero matches; `rg "instanceof PostgresSchema" packages/3-targets/3-targets/postgres/src/core/migrations/` returns zero matches.

**ACs satisfied.** AC1.3 (Postgres half), AC1.4 (planner consumes `ddlSchemaName` instead of `instanceof`), AC1.5.

**Out of scope.** SQLite (1.e); emitter (1.f).

---

### Dispatch 1.e — SQLite planner consumers + delete SQLite `locateTable` (S)

**Intent.** Same shape as 1.d, narrower surface. SQLite has no `effectiveSchemaForTable` and no Layer-3 unbound-projection (single-schema engine), so the work is just `locateTable` → `tableAt` swap + helper deletion.

**Files in play.**
- `packages/3-targets/3-targets/sqlite/src/core/migrations/planner-strategies.ts` — delete `locateTable`; introduce or import `tableAt`; update 3 call sites.
- `packages/3-targets/3-targets/sqlite/src/core/migrations/issue-planner.ts` — update 4 call sites.

**Done when.**
- [ ] `pnpm typecheck` clean.
- [ ] `pnpm test:packages -- packages/3-targets/3-targets/sqlite` green.
- [ ] `pnpm fixtures:check` clean for SQLite fixtures.
- [ ] Grep gate: `rg "locateTable\b" packages/3-targets/3-targets/sqlite/src/` returns zero matches.

**ACs satisfied.** AC1.3 (SQLite half).

**Open decision for the implementer (surface, do not silently resolve).** Where does the shared `tableAt` helper live? Two reasonable answers: (i) duplicate the trivial 1-liner per target; (ii) lift to a small shared utility in `packages/2-sql/9-family/` and import from both targets. Default to (i) unless the implementer hits friction; either choice is acceptable per the slice spec — surface the call in the dispatch's heartbeat / report.

---

### Dispatch 1.f — Emitter FK-ref `findSqlTable` call site → direct access (S)

**Intent.** Replace `findSqlTable(storage, fk.target.tableName)` at line 210 of the emitter with `storage.namespaces[fk.target.namespaceId]?.tables[fk.target.tableName] as StorageTable | undefined` — `ForeignKeyReference.namespaceId` already exists. The two model-side `findSqlTable` callers (lines 118, 283) stay; they're tagged as deferred to TML-2584.

**Files in play.**
- `packages/2-sql/3-tooling/emitter/src/index.ts` — replace the FK-ref call site; leave `findSqlTable` defined for the two model-side callers; add a brief comment above `findSqlTable` referencing TML-2584 as the ticket that finishes the deletion.

**Done when.**
- [ ] `pnpm typecheck` clean.
- [ ] `pnpm test:packages -- packages/2-sql/3-tooling/emitter` green.
- [ ] Grep gate: `rg "findSqlTable.*fk\.target" packages/2-sql/3-tooling/emitter/src/index.ts` returns zero matches; `rg "findSqlTable" packages/2-sql/3-tooling/emitter/src/index.ts` shows only the function definition + the two model-side call sites + the TML-2584 comment.

**ACs satisfied.** AC1.3 (emitter portion of the gate).

---

### Dispatch 2 — TML-2583 reference comments above the two snapshot-read-shapes exclusions (XS)

**Intent.** Two `// TML-2583: …` comments per AC2.1.

**Files in play.**
- `packages/3-targets/3-targets/postgres/test/snapshot-read-shapes.test.ts` — annotate the two `if (rel.startsWith('examples/.../migrations/'))` lines.

**Done when.**
- [ ] `pnpm test:packages -- packages/3-targets/3-targets/postgres` green (no logic change).
- [ ] Grep gate: `rg "TML-2583" packages/3-targets/3-targets/postgres/test/snapshot-read-shapes.test.ts` returns 2 matches.

**ACs satisfied.** AC2.1, AC2.2.

---

### Dispatch 3 — Generic `deserializeContract<T>(json): T` + drop demo cast (S)

**Intent.** Make the family-level `deserializeContract` generic with a `Contract` default. Existing un-typed call sites stay typing-clean (default kicks in). Drop the demo's `as unknown as typeof contract` cast in favour of `deserializeContract<typeof contract>(json)`.

**Files in play.**
- `packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts` — add `<T extends Contract = Contract>` to `deserializeContract`; return `T`.
- (If Mongo has a sibling, mirror it for parity: `packages/2-mongo-family/.../mongo-contract-serializer-base.ts`.)
- `examples/prisma-next-demo/src/prisma-no-emit/context.ts` — replace the cast with `deserializeContract<typeof contract>(json)`.

**Done when.**
- [ ] `pnpm typecheck` clean across the workspace (cross-package: every existing un-typed `deserializeContract(json)` call must still resolve via the default).
- [ ] `pnpm test:packages` workspace-wide green.
- [ ] Grep gate: zero new `as unknown as` casts introduced; the existing demo cast is gone.

**ACs satisfied.** AC3.1, AC3.2, AC3.3, AC3.4.

---

### Dispatch 4 — `hasForeignKey` key-encoding fix + collision test (S)

**Intent.** Replace the pipe-separator key encoding in `planner-schema-lookup.ts` with a structurally unambiguous one (JSON tuple or `\u0000` separator). Add a unit test exercising an identifier containing `|` / `||`.

**Files in play.**
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-schema-lookup.ts` — replace both qualified + unqualified key construction.
- `packages/3-targets/3-targets/postgres/test/migrations/planner-schema-lookup.test.ts` (new or existing) — add the collision test.

**Done when.**
- [ ] `pnpm typecheck` clean.
- [ ] `pnpm test:packages -- packages/3-targets/3-targets/postgres` green, including the new collision test.
- [ ] `pnpm fixtures:check` clean (encoding change is internal to the lookup map — no fixtures touched).

**ACs satisfied.** AC4.1, AC4.2, AC4.3.

---

### Dispatch 5 — AC4 span assertion on the PSL-reserved-namespace test (XS)

**Intent.** Add `expect(diagnostic.span).toBeDefined()` to the existing `namespace unbound { … }` diagnostic test.

**Files in play.**
- `packages/2-sql/2-authoring/contract-psl/test/interpreter.diagnostics.test.ts` — single-line addition.

**Done when.**
- [ ] `pnpm test:packages -- packages/2-sql/2-authoring/contract-psl` green; the new assertion passes with current implementation (no source change).

**ACs satisfied.** AC5.1, AC5.2.

---

### Slice DoD (after dispatch 5)

The final dispatch is followed by a closing gate that confirms the slice is review-clean:

- [ ] `pnpm typecheck`
- [ ] `pnpm test:packages`
- [ ] `pnpm fixtures:check`
- [ ] `pnpm lint:deps`
- [ ] AC scoreboard in `reviews/code-review.md` shows every AC PASS.

That re-states AC1.6 + the analogous closing checks for Items 2–5. The slice closes only when this gate passes.

## Architectural insights surfaced during scoping

These don't change the slice's scope; they're recorded here so they don't get lost in chat:

1. **`SchemaIssue` is mis-located at the framework layer.** The `table?: string` field assumes a SQL vocabulary that Mongo doesn't share. This slice ships the minimum viable fix (sibling `namespaceId?: string`) without restructuring the type; the proper layering split (`SqlSchemaIssue` / `MongoSchemaIssue` peer families over a narrowed framework base) is tracked as [TML-2585](https://linear.app/prisma-company/issue/TML-2585/split-schemaissue-into-framework-shared-base-family-specific). Same layering pattern TML-2584 applies to the framework `Namespace` interface (`{ id, kind }` only at framework; `tables` / `collections` at the family layer).

2. **The "find by name across namespaces" walk has been reimplemented four times** (F06). The proliferation happened because every consumer was given the choice of *"do I look it up by name, or by coordinate?"* and the SchemaIssue API gave them only the name. Item 1 removes the choice — the coordinate is intrinsic to the issue (as an optional sibling field for now; structurally required after TML-2585) — and the four reimplementations disappear with `effectiveSchemaForTable`.

3. **Layer 3 of `effectiveSchemaForTable` is polymorphism deferred.** The `instanceof PostgresSchema` check is a missing method on the namespace concretion. Promoting it is mechanical given the existing polymorphic qualifier-dispatch pattern (`PostgresSchema#qualifyTable`, `PostgresUnboundSchema#qualifyTable`, etc., which PR #534's review § 2 already praised as clean). This is the only Layer-3-specific work; everything else collapses to direct lookups.

## Deferred to follow-up tickets

These items came up during the same scoping discussion but **do not** belong in this slice. They're tracked separately so the layering doesn't get lost:

### [TML-2585](https://linear.app/prisma-company/issue/TML-2585/split-schemaissue-into-framework-shared-base-family-specific) — Split `SchemaIssue` into framework base + family extensions

The minimal `namespaceId?: string` sibling added in Item 1 is a stopgap. The honest layering shape (`SqlSchemaIssue` with structured `table: { namespaceId, name }`, `MongoSchemaIssue` with its collection coordinate, framework base with only target-agnostic fields) is cross-cutting type refactor that would bloat PR #534's review surface. Tracked as TML-2585 to land in its own focused PR or fold into TML-2584's blast radius.

### [TML-2586](https://linear.app/prisma-company/issue/TML-2586/type-foreignkeyspecreferencesschema-as-namespaceid-not-string) — Type `ForeignKeySpec.references.schema` as `NamespaceId`, not `string`

The Postgres `ForeignKeySpec.references.schema` field is a namespace coordinate typed as a bare `string`. Should be `NamespaceId` (or the SQL family's narrowed equivalent). Cross-cutting type-discipline rewire across every `ForeignKeySpec` consumer; most natural home is folded into TML-2584 (which already touches every FK reference site for the cross-reference object-pair encoding rename) rather than landing as its own PR.

### [TML-2584](https://linear.app/prisma-company/issue/TML-2584/restructure-contract-ir-into-two-planes-domain-storage-with-uniform) — Contract IR planes

- **Two-plane IR reshape** (`contract.domain[ns].models` + `contract.storage[ns].tables`) — structural reshape of the contract IR itself; ripples through 93+ index sites. See [`projects/contract-ir-planes/spec.md`](../../../contract-ir-planes/spec.md).
- **Cross-model reference object-pair encoding** (`relation.to: { namespace, model }`, `model.base: { namespace, model }`, `roots[*]: { namespace, model }`) — generalises the FK reference shape; coordinated rename across emitter, serializer, validator, DSL.
- **Framework `Namespace` interface narrowing** (`{ id, kind }`-only at framework layer; family slots move to family-shaped namespace types).
- **IR constructor discipline** (`SqlStorage` / `MongoStorage` constructors accept only fully-constructed `Namespace` instances; delete `DEFAULT_NAMESPACES`, `normaliseNamespaceEntry`, `SqlNamespacePayload`, `stripNamespaceKinds`).
- **Serializer `kind` removal** — class identity resolved from `(targetFamily, target)` + position rather than emitted as a JSON discriminator.
- **F03 fully** — the `POSTGRES_ENUM_NAMESPACE_ID = 'public'` hardcoded fallback in the TS builder. Partial pressure relief lands in this slice (the polymorphic `ddlSchemaName` method makes the assumption easier to test) but the full fix needs the plane reshape or the [TML-2537](https://linear.app/prisma-company/issue/TML-2537) enum reshape.
- **Delete `findSqlTable` (emitter, model-side callers)** — the two callers at lines 118 and 283 of `packages/2-sql/3-tooling/emitter/src/index.ts` look up tables from `ContractModel.storage.table` (a bare string). `SqlModelStorage` carries no namespace coordinate, so the lookup is structurally necessary today. Once TML-2584 adds `namespaceId` to the domain plane's model storage (or moves models under namespace keys), both callers become direct accesses and `findSqlTable` deletes alongside `locateTable` (already gone in Item 1).
- **Collapse `getInsertColumnOrder`'s inline namespace walk** (`packages/3-targets/6-adapters/postgres/src/core/sql-renderer.ts` line 633) — the runtime INSERT-DEFAULT-VALUES fallback scans `contract.storage.namespaces` to find the target table by bare name. Deletion requires threading namespace through `InsertAst` so the renderer receives a coordinate, which is DSL-shape work that overlaps with TML-2584's cross-reference object-pair rename (D5).

## Out of scope entirely

- DCO sign-off on the 12 historical unsigned commits.
- Postgres `ECONNRESET` integration-test flake (reproduces on `origin/main`; pre-existing).
- Namespace-aware DSL surface ([TML-2581](https://linear.app/prisma-company/issue/TML-2581)) — independent successor work.
- Historical migration re-baselining ([TML-2583](https://linear.app/prisma-company/issue/TML-2583)) — orthogonal housekeeping.

## Working notes

This section accumulates discoveries during implementation. Append-only; don't rewrite history.

- **2026-05-19 — Item 1 scope narrowed at build time.** Territory map showed Item 1's literal "delete all four helpers" promise would pull in `SqlModelStorage.namespaceId` (a TML-2584 carrier change) and `InsertAst` namespace threading (a DSL-shape sweep), both deferred-project territory. Narrowed to the two migration-planner deletions (`effectiveSchemaForTable`, `locateTable` × Postgres + SQLite) plus the one deletable emitter site (FK ref). The two model-side `findSqlTable` callers and the `sql-renderer.ts` inline walk land with TML-2584. F01 (the silent fallthrough) is still fully fixed — it lives only in `effectiveSchemaForTable`, which still goes. Spec § Item 1 step 6/7 and AC1.3 narrowed; TML-2584 deferred-pickups list grew the two helpers.

## References

- [Code review § 3, finding F01](../../reviews/pr-534/code-review.md) — original framing of the silent-fallthrough as a tactical patch; superseded by the structural fix in Item 1.
- [Code review § 3, finding F05](../../reviews/pr-534/code-review.md) — origin of Item 2.
- [Code review § 3, finding F06](../../reviews/pr-534/code-review.md) — four reimplementations of the same walk, all removed by Item 1.
- [Code review § 7.3](../../reviews/pr-534/code-review.md) — architect concern about `instanceof PostgresSchema` in planner code; addressed by Item 1's Layer-3 polymorphism promotion.
- [contract-ir-planes spec](../../../contract-ir-planes/spec.md) — the larger reshape this slice's items were triaged against.
