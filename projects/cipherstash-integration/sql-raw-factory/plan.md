# sql-raw-factory — Plan

> Plan for [`sql-raw-factory`](spec.md), the third component of the [cipherstash-integration umbrella](../spec.md). The umbrella plan ([../plan.md](../plan.md)) sequences the three components; this document sequences the work *inside* this component.
>
> **Hard upstream dependency.** [Project 1's M1 — Framework SPI](../project-1/plan.md#m1--framework-spi) ships the `RawSqlExpr` AST node, its Postgres lowerer arm for `'param-ref'` and inlined `Expression` args, and the `planFromAst` envelope helper. `sql-raw-factory` consumes that work — execution can be **shaped and prototyped** in parallel with Project 1's M1, but **merge-blocks** until M1 lands on the Project 1 branch (or `main`).

# Strategy

Three milestones. The component is small (one factory function, one sentinel class with a one-arm lowerer addition, one ergonomic re-export, plus type-level tests and integration tests) — five-milestone scaffolding doesn't fit.

```
M1: factory + param() — typed template literal producing SqlQueryPlan, no identifier escape hatch yet
M2: identifier(...) escape hatch + lowerer arm
M3: integration + close-out
```

Each milestone produces a usable surface — M1 alone covers the common case (parameterized values via `param()` or typed-builder expressions); M2 adds the identifier-quoting case; M3 verifies end-to-end including the cipherstash bulk-encrypt composition.

**Critical path.** M1 → M2 → M3. M1 requires Project 1's M1 to be merged. M2 requires this component's M1. M3 requires this component's M2.

**Parallelism with Project 1.** Spec is stable; the implementation can be drafted on a branch off Project 1's M1 work-in-progress branch. Merging that branch is gated on Project 1's M1 actually landing.

# Tests-first guidance

The spec enumerates ACs in three groups: factory (`AC-FAC1`–`AC-FAC5`), type-level (`AC-TYPE1`–`AC-TYPE6`), identifier escape hatch (`AC-ID1`–`AC-ID3`), and composition with existing surfaces (`AC-COMP1`–`AC-COMP3`). Each milestone's test-first step is drawn from those.

Type-level tests use vitest's `expectTypeOf` (the convention established by other projects in the repo, e.g. `orm-client-transaction-api`). Negative type tests (`AC-TYPE2`, `AC-TYPE3`) use `// @ts-expect-error` with a justifying comment, per the repo's "no `@ts-expect-error` outside negative type tests" rule.

# Open questions resolved at the start of M1

The spec lists six open questions. Three need resolution before M1 starts; three can defer.

| Question | Default | Resolution timing |
|---|---|---|
| 1. Public entry point | Dual-export from `@prisma-next/sql-relational-core` and `@prisma-next/sql-builder` | Resolve at M1 start |
| 2. Drop the second call signature | Drop confirmed (per non-goal in the spec) | Resolved — record in M1 commit |
| 3. Error messaging investment | Level 0 (TypeScript default) for the first ship | Resolved — record in M1 commit |
| 4. Contract acquisition | `createRaw(contract)` factory-of-factories | Resolve at M1 start |
| 5. `identifier(...)` lowerer-arm placement | Inline next to `RawSqlExpr` arm in the Postgres renderer | Defer to M2 |
| 6. Other SQL targets | Postgres only; document extension point | Defer to M2 — implicitly resolved by shipping Postgres-only |

Questions 1 and 4 are the load-bearing ones. The others have clear defaults.

# Milestones

## M1 — Factory + `param()` re-export

**Goal.** Land the `raw\`...\`` template factory producing `SqlQueryPlan`, plus the `param()` ergonomic re-export. Users can write `raw\`SELECT * FROM users WHERE id = ${param(42, { codecId: 'pg/int4@1' })}\`` and get a typed, codec-aware, SQL-injection-safe plan ready for `dataTransform` or runtime execution.

**Out of scope for M1.** `identifier(...)` and the corresponding lowerer arm — defers to M2 (a user wanting to interpolate a table name in M1 is blocked; M1 covers the much more common parameterized-value case).

**Visible value.** First public path to raw SQL the framework has ever shipped. The `RawFactory` interface declarations at `packages/2-sql/4-lanes/relational-core/src/types.ts:246-262` get a real implementation.

**Tests-first.** Drawn from spec ACs:

- Factory shape: `AC-FAC1` (empty template literal produces a plan), `AC-FAC2` (interpolated `param()` flows into `args` as a `ParamRef`), `AC-FAC4` (typed-builder `Expression` values flow into `args`), `AC-FAC5` (the resulting plan flows through `dataTransform({ run: () => raw\`...\` })`).
- Type-level: `AC-TYPE1` (parameter type), `AC-TYPE2` + `AC-TYPE3` (negative — bare values rejected), `AC-TYPE4` + `AC-TYPE6` (positive — `param()` and typed-builder expressions accepted). `AC-TYPE5` defers to M2 (depends on `identifier(...)`).

**Implementation sketch.**

- Replace the type-only declarations at `packages/2-sql/4-lanes/relational-core/src/types.ts:246-262` with the new shape (return type narrows to `SqlQueryPlan`; interpolation values narrow to `RawArg` minus the `RawSqlIdentifier` arm — added in M2).
- Add `packages/2-sql/4-lanes/relational-core/src/exports/raw-factory.ts`:
  - `param<T>(value, opts: { codecId: string }): ParamRef` — re-export of `ParamRef.of`.
  - `createRaw(contract: Contract<SqlStorage>): RawTemplateFactory` — the contract-bound factory of factories. The user gets `raw` from this; `currentContract()` plumbing isn't needed.
- Wire `createRaw` into the SQL builder construction so users get a contract-bound `raw` from the same place they get the typed builder.
- Re-export `raw` and `param` from `@prisma-next/sql-relational-core` and `@prisma-next/sql-builder` (open question 1 resolution).
- Update `packages/2-sql/5-runtime/test/sql-runtime.test.ts:244` and `packages/2-sql/5-runtime/test/codec-async.test.ts:94` only if the type-only change breaks them. (Per spec backward-compatibility note: those fixtures hand-construct `SqlExecutionPlan` and don't go through the factory; should continue to work.) The migration onto the new factory is a hygiene follow-up, not gated.

**Validation gate.**

- All M1-scoped ACs pass.
- `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps` clean.
- Negative type tests verified by attempting to compile each violating shape under a `// @ts-expect-error` directive.
- A new integration test in `packages/2-sql/5-runtime/test/raw-factory.test.ts` exercises a `raw\`...\`` plan against a mocked Postgres adapter — the lowered SQL matches the expected positional placeholder substitution.

**Done when.** M1 ACs green and the factory is callable from a contract-bound consumer.

**Commit.** Single PR; ~200 lines net new code, ~5 type-level tests, ~5 unit tests.

---

## M2 — `identifier(...)` escape hatch

**Goal.** Add `identifier(name)` for SQL identifier interpolation and the corresponding `'raw-sql-identifier'` lowerer arm in the Postgres renderer. Adversarial inputs (`name with "quote`, `name\u0000with null`, `name\nwith newline`) are quoted correctly and don't break out of the surrounding quotes.

**Visible value.** Users can write `raw\`SELECT * FROM ${identifier('user')}\`` to interpolate identifiers — table names, column names, schema names — without falling back to string concatenation. The factory's surface is now feature-complete.

**Tests-first.** Drawn from spec ACs:

- Identifier shape: `AC-ID1` (frozen sentinel from `identifier(name)`).
- Lowering: `AC-ID2` (Postgres double-quoting; internal double-quotes doubled).
- Adversarial fuzz: `AC-ID3` (a small fixture of attack-shaped inputs — quote, null byte, newline, repeated quotes — each lowered to a quoted form that round-trips through Postgres without breaking out).
- Type-level: `AC-TYPE5` (positive — `identifier(...)` typechecks as a `RawArg`).

The fuzz test (`AC-ID3`) is not random — it's a hand-curated table of adversarial inputs known to be problematic in naive escape implementations. Add inputs as a snapshot test for cheap maintenance.

**Implementation sketch.**

- Add `RawSqlIdentifier` class in `packages/2-sql/4-lanes/relational-core/src/exports/raw-factory.ts` (or a sibling module — implementation choice).
- Add `identifier(name: string): RawSqlIdentifier` next to it.
- Widen the `RawArg` union to include `RawSqlIdentifier`.
- Add the `'raw-sql-identifier'` arm to the Postgres renderer in the same module Project 1's M1 added the `'raw-sql'` arm. The arm renders the identifier as `"<escaped>"` text — Postgres rules: surround with double quotes; double internal double quotes. Use a small `escapePostgresIdentifier(name: string): string` helper.
- Update `toRawArgAst` in the factory to pass `RawSqlIdentifier` instances through to `RawSqlExpr.args` unchanged.

**Validation gate.**

- All M2-scoped ACs pass.
- The Postgres renderer's existing test suite continues to pass.
- The fuzz fixture passes — every adversarial input lowers to a form that doesn't terminate the surrounding quote.

**Done when.** `identifier(...)` works end-to-end; Postgres-target lowering is correct against adversarial inputs.

**Commit.** Single PR; ~80 lines net new code, ~3 unit tests + 1 fuzz fixture.

---

## M3 — Integration + close-out

**Goal.** Verify end-to-end that `sql-raw-factory` composes correctly with the rest of the framework — runtime execution, middleware composition, cipherstash bulk-encrypt — and close out the project per the lifecycle.

**Visible value.** All `sql-raw-factory` ACs green. Confidence the factory is production-ready.

**Tests-first.** Drawn from spec ACs:

- Composition: `AC-COMP1` (raw plan executes against real Postgres and returns rows), `AC-COMP2` (raw-plan `ParamRef`s visible to `RuntimeMiddleware.beforeExecute`'s `params.entries()` walk), `AC-COMP3` (cipherstash bulk-encrypt runs against a raw plan with a `cipherstash/string@1`-codec'd param).

`AC-COMP3` requires Project 1's M2 (cipherstash codec, bulk-encrypt middleware) to have landed. If `sql-raw-factory` ships before Project 1's M2 — which is unlikely given the umbrella sequencing but possible — `AC-COMP3` defers to a follow-up landing alongside Project 1's M2.

**Implementation sketch.**

- Integration test in `packages/2-sql/5-runtime/test/raw-factory.integration.test.ts` (or a similar location):
  - Real Postgres database (via the existing `withDevDatabase`-style harness).
  - Insert a row via typed builder; query it back via `raw\`SELECT * FROM ${identifier('user')} WHERE id = ${param(id, { codecId: 'pg/int4@1' })}\``; verify the row is returned.
- Middleware-composition test: register a no-op middleware that asserts `params.entries()` yields one entry with the expected `codecId`. Run a raw plan through it.
- Cipherstash composition test: in a test that mounts the cipherstash extension, write `raw\`INSERT INTO users (email) VALUES (${param(envelope, { codecId: 'cipherstash/string@1' })})\`` and verify the bulk-encrypt middleware ran (1 × `bulkEncrypt` mock-SDK call) before encode.

**Close-out tasks** (per `projects/README.md` lifecycle):

- **T3.1** Verify all `sql-raw-factory` ACs pass.
- **T3.2** Migrate long-lived docs to `docs/`. Candidates:
  - A short architecture-doc note about the raw factory as a public surface (one paragraph in `docs/architecture docs/subsystems/<sql>.md` or similar).
  - The `RawArg`-as-SQL-injection-defense rationale, if it warrants a standalone note. The threat-surface caveat (`identifier(...)` is for trusted input) belongs in the package README.
- **T3.3** Strip repo-wide references to `projects/cipherstash-integration/sql-raw-factory/**`. Replace with canonical `docs/` links or remove.
- **T3.4** Linear ticket cleanup. If the umbrella's Linear redesign produced sql-raw-factory tickets, close them; transfer survivors.
- **T3.5** Final sanity: `pnpm build`, `pnpm typecheck`, `pnpm test:packages`, `pnpm test:integration` (where applicable), `pnpm lint:deps` all green.
- **T3.6** Delete `projects/cipherstash-integration/sql-raw-factory/`.

**Validation gate.** All checks green; no references to `sql-raw-factory/**` remain in the tree (modulo umbrella plan cross-references that should be updated to point at `docs/` or removed).

**Done when.** `sql-raw-factory/` directory deleted; umbrella plan's status table updated to "shipped."

**Commit.** Two PRs natural: one for the integration tests; one for close-out (docs migration + directory deletion). Single PR also acceptable if the integration tests are clean.

---

# Status

| Milestone | Scope | Status |
|---|---|---|
| M1 — Factory + `param()` | `raw\`...\`` template factory; `param()` re-export; type-level rejection of bare values; `createRaw(contract)` plumbing | blocked on Project 1's M1 (`raw-sql-ast-node`) merging |
| M2 — `identifier(...)` escape hatch | `RawSqlIdentifier` sentinel + Postgres lowerer arm + adversarial fuzz | blocked on this component's M1 |
| M3 — Integration + close-out | End-to-end composition tests; lifecycle close-out per `projects/README.md` | blocked on this component's M2 + Project 1's M2 (for cipherstash composition test) |

# Open items

1. **Mongo `mongoRaw` parity.** Out of scope for this component (per spec non-goal). If Mongo grows demand for an analogous public surface, ships in a separate component / extension.
2. **Other SQL targets.** SQLite / MySQL / future SQL targets each need their own `RawSqlIdentifier` lowerer arm. Not scoped here. Document the extension point in M3's docs migration — a small note that adding a new SQL target requires (a) the `'raw-sql'` arm from Project 1's `raw-sql-ast-node` work and (b) the `'raw-sql-identifier'` arm with target-appropriate quoting rules.
3. **Sub-expression `rawExpr`.** Out of scope (per spec non-goal). A future consumer wanting raw SQL fragments inside a `WHERE` clause would motivate a follow-up project.
4. **Error messaging polish (Level 1).** Default ship is Level 0 (TypeScript's default error on `RawArg` union mismatch). If user feedback indicates confusion, follow up with Level 1 (branded-never custom message). Track as a follow-up; not in this component's milestones.
5. **Migration of existing `lane: 'raw'` test fixtures.** The `packages/2-sql/5-runtime/test/sql-runtime.test.ts:244` and `packages/2-sql/5-runtime/test/codec-async.test.ts:94` fixtures hand-construct `SqlExecutionPlan` objects. Migrating them onto the new factory is hygiene; not in this component's milestones.

# References

- [Component spec](spec.md)
- [Umbrella plan](../plan.md)
- [Project 1 plan — M1](../project-1/plan.md#m1--framework-spi) — the upstream dependency
- [raw-sql-ast-node task spec](../project-1/specs/raw-sql-ast-node.spec.md) — the spec for the framework SPI work this component consumes
