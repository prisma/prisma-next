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

### Item 1 — Schema verifier issues carry namespace coordinates; delete `effectiveSchemaForTable` / `locateTable` / `findSqlTable`

**Problem.** The SQL family schema verifier walks `storage.namespaces[nsId].tables[name]` to find drift, but writes only `name` into the `SchemaIssue` it produces — destroying the namespace coordinate it already knew. The Postgres planner then has to re-derive the coordinate by walking `storage.namespaces` again via `locateTable`. This is the structural cause of:

- F01 — `effectiveSchemaForTable` silent fallthrough to `ctx.schemaName` (correctness gap; wrong-schema DDL in multi-namespace contracts when `locateTable` returns `undefined`).
- F06 — four independent reimplementations of the same "walk namespaces, find table by name" loop across planner-strategies, sql-renderer, issue-planner, emitter.
- F03 partial — the planner needs `instanceof PostgresSchema` checks to decide where the unbound bucket projects, because the issue doesn't carry enough context to make that decision intrinsically.

**Architectural insight surfaced during scoping.** `BaseSchemaIssue.table?: string` lives in `packages/1-framework/1-core/framework-components/src/control/control-result-types.ts` — i.e. at the **framework layer**. Mongo schema issues don't have a `table` (they have collections); their issue shape happens to share the same type by coincidence of vocabulary, not by structural alignment. The framework-level shape is a layering smell on its own. **Decision:** the table coordinate is family-specific (SQL); the SchemaIssue shape needs to split between framework-shared fields (kind, message, severity, etc.) and family-specific fields (SQL's table-coordinate, Mongo's collection-coordinate). This slice does that split.

**Fix shape.**

1. Split `BaseSchemaIssue` into:
   - A framework-shared base carrying `kind`, `message`, and any other genuinely target-agnostic fields.
   - A family-shaped extension per family — `SqlSchemaIssue` (in the SQL family) with `{ table: { namespaceId, name }, column, … }`; `MongoSchemaIssue` (in the Mongo family) with its own collection-coordinate shape.
2. Update the SQL family schema verifier (`packages/2-sql/9-family/src/core/schema-verify/`) to populate `{ namespaceId, name }` at every issue construction site. The verifier already has the `nsId` in scope from its outer walk — change is one-line per construction site.
3. Update the Mongo family schema verifier analogously for its coordinate shape.
4. Update Postgres planner consumers (`planner-strategies.ts`, `issue-planner.ts`) to read `issue.table.namespaceId` directly. Replace every `locateTable(...)?.table` pattern with the direct lookup `storage.namespaces[issue.table.namespaceId].tables[issue.table.name]`.
5. Update SQLite planner consumers analogously.
6. Delete `effectiveSchemaForTable`. Layer 3 (the FR16c "where does the unbound bucket project?" logic) promotes to a polymorphic method on the namespace concretion (`PostgresSchema#ddlSchemaName(): string` / `PostgresUnboundSchema#ddlSchemaName(): string`), called by the planner once per namespace it touches. No more `instanceof PostgresSchema` in planner code.
7. Delete `locateTable` (planner-strategies.ts), the inline equivalents in `sql-renderer.ts` and `issue-planner.ts`, and `findSqlTable` (emitter). All four were F06's "same walk reinvented four times."
8. Update tests (Mongo schema-diff, schema-verify; Postgres planner tests).

**Acceptance criteria.**

- **AC1.1.** `SchemaIssue` lives at the framework layer as a shape that contains only target-agnostic fields. `SqlSchemaIssue` (SQL family) and `MongoSchemaIssue` (Mongo family) carry the family-specific coordinate fields.
- **AC1.2.** Every SQL schema-issue construction site populates `{ namespaceId, name }` for the table coordinate. Grep gate: no `issue.table: '...'` (bare-string) construction sites remain in the SQL family.
- **AC1.3.** Every Postgres planner site that previously called `locateTable(...)?.table` reads from the issue's coordinate directly. Same for SQLite. Grep gate: zero references to `locateTable` / `effectiveSchemaForTable` / `findSqlTable` in `packages/**`.
- **AC1.4.** Layer 3 of the old `effectiveSchemaForTable` is preserved behaviour-equivalently as a polymorphic method on `PostgresSchema` / `PostgresUnboundSchema`. No `instanceof PostgresSchema` in planner-strategies.ts.
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

## Architectural insights surfaced during scoping

These don't change the slice's scope; they're recorded here so they don't get lost in chat:

1. **`SchemaIssue` is mis-located at the framework layer.** The `table?: string` field assumes a SQL vocabulary that Mongo doesn't share. Item 1 splits this between framework-shared base + family-specific extension. The instinct that *cross-cutting type shapes should be family-aware* is a recurring theme — it's the same insight that drives TML-2584's framework `Namespace` narrowing (`{ id, kind }` only at the framework layer; `tables` / `collections` at the family layer).

2. **The "find by name across namespaces" walk has been reimplemented four times** (F06). The proliferation happened because every consumer was given the choice of *"do I look it up by name, or by coordinate?"* and the SchemaIssue API gave them only the name. Item 1 removes the choice — the coordinate is intrinsic to the issue — and the four reimplementations disappear with `effectiveSchemaForTable`.

3. **Layer 3 of `effectiveSchemaForTable` is polymorphism deferred.** The `instanceof PostgresSchema` check is a missing method on the namespace concretion. Promoting it is mechanical given the existing polymorphic qualifier-dispatch pattern (`PostgresSchema#qualifyTable`, `PostgresUnboundSchema#qualifyTable`, etc., which PR #534's review § 2 already praised as clean). This is the only Layer-3-specific work; everything else collapses to direct lookups.

## Deferred to TML-2584 (contract-ir-planes)

These items came up during the same scoping discussion but **do not** belong in this slice:

- **Two-plane IR reshape** (`contract.domain[ns].models` + `contract.storage[ns].tables`) — structural reshape of the contract IR itself; ripples through 93+ index sites. See [`projects/contract-ir-planes/spec.md`](../../../contract-ir-planes/spec.md).
- **Cross-model reference object-pair encoding** (`relation.to: { namespace, model }`, `model.base: { namespace, model }`, `roots[*]: { namespace, model }`) — generalises the FK reference shape; coordinated rename across emitter, serializer, validator, DSL.
- **Framework `Namespace` interface narrowing** (`{ id, kind }`-only at framework layer; family slots move to family-shaped namespace types).
- **IR constructor discipline** (`SqlStorage` / `MongoStorage` constructors accept only fully-constructed `Namespace` instances; delete `DEFAULT_NAMESPACES`, `normaliseNamespaceEntry`, `SqlNamespacePayload`, `stripNamespaceKinds`).
- **Serializer `kind` removal** — class identity resolved from `(targetFamily, target)` + position rather than emitted as a JSON discriminator.
- **F03 fully** — the `POSTGRES_ENUM_NAMESPACE_ID = 'public'` hardcoded fallback in the TS builder. Partial pressure relief lands in this slice (the polymorphic `ddlSchemaName` method makes the assumption easier to test) but the full fix needs the plane reshape or the [TML-2537](https://linear.app/prisma-company/issue/TML-2537) enum reshape.

## Out of scope entirely

- DCO sign-off on the 12 historical unsigned commits.
- Postgres `ECONNRESET` integration-test flake (reproduces on `origin/main`; pre-existing).
- Namespace-aware DSL surface ([TML-2581](https://linear.app/prisma-company/issue/TML-2581)) — independent successor work.
- Historical migration re-baselining ([TML-2583](https://linear.app/prisma-company/issue/TML-2583)) — orthogonal housekeeping.

## Working notes

This section accumulates discoveries during implementation. Append-only; don't rewrite history.

- *(empty — first entries land as Item 1 implementation begins.)*

## References

- [Code review § 3, finding F01](../../reviews/pr-534/code-review.md) — original framing of the silent-fallthrough as a tactical patch; superseded by the structural fix in Item 1.
- [Code review § 3, finding F05](../../reviews/pr-534/code-review.md) — origin of Item 2.
- [Code review § 3, finding F06](../../reviews/pr-534/code-review.md) — four reimplementations of the same walk, all removed by Item 1.
- [Code review § 7.3](../../reviews/pr-534/code-review.md) — architect concern about `instanceof PostgresSchema` in planner code; addressed by Item 1's Layer-3 polymorphism promotion.
- [contract-ir-planes spec](../../../contract-ir-planes/spec.md) — the larger reshape this slice's items were triaged against.
