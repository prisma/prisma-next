# Project 1 — Searchable-encryption MVP — Plan

> Plan for [Project 1](spec.md) of the [cipherstash-integration umbrella](../spec.md). The umbrella plan ([../plan.md](../plan.md)) sequences the three components; this document sequences the work *inside* Project 1.
>
> **Independent of in-flight framework PRs.** [#404](https://github.com/prisma/prisma-next/pull/404) (invariant-aware ref routing) and [#409](https://github.com/prisma/prisma-next/pull/409) (middleware `intercept` hook + `contentHash`) are both open and both touch surfaces Project 1 also touches, but Project 1 does not consume either. See the *External PRs — non-dependency* section below.

# Strategy

Five **value-slice milestones** — each milestone produces a concrete, testable end-to-end slice. The cuts are by *user-visible function*, not by task spec, so the framework SPI work (`raw-sql-ast-node`, `middleware-param-transform`) lands in milestones that consume it rather than in a separate "framework prerequisites" phase. The trade-off: milestones span multiple task specs, but each is independently demoable.

```
M1: framework SPI (raw-sql-ast-node + middleware-param-transform)  ─┐
M2: store-only round-trip (psl + envelope-codec storage path)       ├─ M5: close-out
M3: eq operator + addSearchConfig manual migration                  │
M4: ilike + activatePending + decryptAll                            ─┘
```

**Critical path.** M1 → M2 → M3 → M4 → M5. M1 is pure framework work and can be parallelized internally (the two task specs touch disjoint files). M2 depends on M1's middleware seam. M3 and M4 each extend M2's working extension with more user-facing surface.

Two task specs, both pure framework SPI work, can be **executed in parallel inside M1** by two different drivers — the `raw-sql-ast-node` task touches `packages/2-sql/4-lanes/relational-core/src/ast/types.ts` and the Postgres lowerer; `middleware-param-transform` touches `packages/1-framework/1-core/framework-components/` and the SQL/Mongo runtimes. They do not collide.

# Tests-first guidance

Per the repo rule "always write tests before creating or modifying implementation," each milestone leads with a failing-test step before its implementation step. The task specs already enumerate per-feature acceptance criteria (`AC-AST*`, `AC-LOW*`, `AC-MUT*`, `AC-CODEC*`, etc.); each milestone's tests are drawn from the corresponding ACs. The plan does not duplicate AC inventories; it points at them.

# External PRs — non-dependency

Two PRs are open against `main` that touch surfaces this project also touches. Project 1 is independent of both:

## #409 — middleware `intercept` hook + `contentHash`

**What it adds:** `intercept?(plan, ctx)` hook on `RuntimeMiddleware`; `source: 'driver' | 'middleware'` on `AfterExecuteResult`; **required** `contentHash(exec)` method on `RuntimeMiddlewareContext`.

**What we consume from it:** Nothing. Our `bulkEncryptMiddleware` only uses `beforeExecute(plan, ctx, params)` — none of `intercept`, `contentHash`, or `source` is referenced anywhere in our task specs.

**Coordination:** Both PRs edit `RuntimeMiddleware` / `RuntimeMiddlewareContext` and their construction sites. Whichever lands on `main` first, the other rebases — small, mechanical: add your fields next to the other PR's already-merged fields; update construction sites to populate both sets.

**Rebase plan:** if #409 lands first, our `middleware-param-transform` task adds its `signal` and `params` fields to a `RuntimeMiddlewareContext` shape that already has `contentHash`. If our PR lands first, #409 adds its fields to a shape that already has ours. Either order is fine.

## #404 — invariant-aware ref routing (M4) + self-edge support

**What it adds:** Routes downstream migration operations across `DataTransformOperation`s by `invariantId`. Reads `invariantId` from `operationClass: 'data'` ops via `deriveProvidedInvariants`.

**What we consume from it:** Nothing at execute time. Our migration-factories produce `DataTransformOperation`s carrying `invariantId` fields (per the [migration-factories task spec](specs/migration-factories.spec.md)). The `invariantId` is data the operation carries; nothing reads it until #404 lands. Project 1's own integration tests don't exercise cross-migration ref routing, so the field-being-set-but-unread behavior is invisible at the AC level.

**Coordination:** None. Project 1 ships with `invariantId`-carrying ops; the routing benefit becomes effective when #404 lands on `main`, retroactively.

# Milestones

## M1 — Framework SPI

**Status: ✅ SATISFIED.** All 28 M1-owned ACs PASS; reviewed across two rounds; `AC-AST1..5`, `AC-LOW1..6`, `AC-PLAN1..3`, `AC-MUT1..5`, `AC-EX1`, `AC-ABT1..4`, `AC-FAM1..2`, `AC-TYPE1..2` all promoted with file:line evidence. AC-E2E1/AC-E2E2 from `raw-sql-ast-node` are migration-factories-coupled and stay M3-scoped. Mongo runtime wiring deferred to [TML-2376](https://linear.app/prisma-company/issue/TML-2376) — see § Open items 7. Commits: `1d8b70943..9425690fa` (raw-sql-ast-node + AC-ABT1) and `314011400..33a6e5ad5` (param-mutator + AC-ABT2..4 + family + types).

**Goal.** Land the two framework-side prerequisites (`RawSqlExpr` AST node + lowerer arm; `beforeExecute` mutator + `MiddlewareContext.signal`) on `main`. No cipherstash surface yet.

**Visible value.** Other extensions immediately benefit from the seams. After M1, any extension author can write a bulk-pattern middleware following the [middleware-param-transform task spec](specs/middleware-param-transform.spec.md)'s grounding example, and any caller can construct a `RawSqlExpr`-bearing `SqlQueryPlan` for `dataTransform` consumption.

**Task specs.** [`raw-sql-ast-node`](specs/raw-sql-ast-node.spec.md), [`middleware-param-transform`](specs/middleware-param-transform.spec.md). Both can land in either order; can also land as separate PRs.

**Tests-first.**

- `raw-sql-ast-node`: AC-AST1–AC-AST5, AC-LOW1–AC-LOW5, AC-PLAN1–AC-PLAN3 all enumerated in the task spec; write the failing tests first.
- `middleware-param-transform`: AC-MUT1–AC-MUT5, AC-ABT1–AC-ABT4, AC-FAM1–AC-FAM2 from the task spec.

**Implementation sketch.**

- `raw-sql-ast-node`:
  - Add `RawSqlExpr` class in `packages/2-sql/4-lanes/relational-core/src/ast/types.ts`; extend `AnyQueryAst` union and `queryAstKinds`.
  - Add lowerer arm in the Postgres SQL renderer.
  - Add `planFromAst` helper in `relational-core/plan.ts` (open question 2 of the task spec — confirm location during implementation).
- `middleware-param-transform`:
  - Add `MiddlewareContext.signal` to `packages/1-framework/1-core/framework-components/`.
  - Add `SqlParamRefMutator` interface in `packages/2-sql/4-lanes/relational-core/`; analogous `MongoParamRefMutator` in the Mongo family.
  - Update `RuntimeMiddleware.beforeExecute` to accept the third `params` argument; preserve trailing-arg bivariance for back-compat.
  - Wire the lazy mutator construction in the `runWithMiddleware` orchestrator (no allocation when no middleware mutates).

**Validation gate.**

- All ACs above pass.
- `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps` clean.
- No regression in `packages/2-sql/5-runtime/test/sql-runtime.test.ts` or `packages/1-framework/1-core/framework-components/test/run-with-middleware.test.ts`.

**Done when.** Both task specs' ACs are green and merged on `main` (or on the project branch). M2 unblocks.

**Commits.** Two PRs (one per task spec) is cleanest. Single PR is acceptable if scheduling makes that easier — they don't share files.

---

## M2 — Store-only round-trip

**Status: 🟡 PARTIALLY SHIPPED.** Split into three sub-rounds during execution; M2.a + M2.b SATISFIED; M2.c remaining. Full breakdown:

- **M2.a — package skeleton + envelope + codec — ✅ SATISFIED** (12 ACs PASS: `AC-PKG1..3`, `AC-ENV1/2/4`, `AC-CODEC1..5`, `AC-INSTALL1`). Bootstraps `packages/3-extensions/cipherstash/`; `EncryptedString` envelope with module-scoped `WeakMap` handle storage; `cipherstash/string@1` codec; `RuntimeParameterizedCodecDescriptor` with arktype `{equality, freeTextSearch}` schema; `databaseDependencies.init` shape with placeholder install SQL; `CipherstashSdk` interface (`decrypt`/`bulkEncrypt`/`bulkDecrypt`). Commits: `2b2efbe75..2d05b90d3` + `6bbbee20f..0d558b1b2` (F3+F4 cleanup).
- **M2.b — PSL constructor + TS factory + parity — ✅ SATISFIED** (12 ACs PASS: `AC-CTOR1..4`, `AC-LOWER1..4`, `AC-ALIAS1..2`, `AC-PARITY1..2`). PSL constructor `cipherstash.EncryptedString({ equality, freeTextSearch })`; TS factory `encryptedString({...})`; PSL↔TS parity fixture at `test/integration/test/authoring/parity/cipherstash-encrypted-string/`; `dbInit` DDL snapshot (no live DB). Required a framework-level addition: `kind: 'boolean'` arm on `AuthoringArgumentDescriptor` (additive, three-file change, zero impact on existing extensions). Commits: `584bbcda6..c48d4d7ad`. Codec-SDK binding refactor deferred to a follow-up Linear ticket — see § Open items 8.
- **M2.c — bulk-encrypt middleware + live integration — ⏳ NOT STARTED.** Remaining M2 work; entry conditions and task list documented below.

**Goal.** `EncryptedString` works as a column type for *storage* — encrypt on write, decode-into-envelope on read, retrieve plaintext via `await envelope.decrypt()`. No search operators yet (queries are key-lookup or full-table scan only). No migration factories yet (the test suite uses hand-written DDL fixtures).

**Visible value.** End-to-end-demoable encrypted column. A test inserts plaintext, the SDK is hit once via bulk-encrypt middleware, the row lands in Postgres as encrypted JSONB, a `findUnique` decodes it back to an envelope, `await envelope.decrypt()` returns the plaintext.

**Task specs touched.** [`envelope-codec-extension`](specs/envelope-codec-extension.spec.md) (storage portion), [`psl-encrypted-string-constructor`](specs/psl-encrypted-string-constructor.spec.md). Operator lowering and migration factories are explicitly deferred to M3/M4.

**Tests-first.**

- Envelope: AC-ENV1, AC-ENV2, AC-ENV4.
- Codec: AC-CODEC1–AC-CODEC5.
- Bulk-encrypt middleware: AC-MW1, AC-MW2, AC-MW3, AC-MW4, AC-MW5.
- EQL bundle install: AC-INSTALL1, AC-INSTALL2, AC-INSTALL3.
- PSL constructor: enumerate from the task spec — full constructor registration, inline + named-type-alias usage, all three argument shapes (`EncryptedString({})`, `({ equality })`, `({ equality, freeTextSearch })`), nullable + non-nullable variants, the parity test against the TS contract factory.
- One umbrella-level integration test (subset of [AC-UMB1](spec.md)) covering only the storage round-trip — no `findMany({ where: { email: { equals: ... } } })` yet.

**Implementation sketch.**

- Bootstrap `packages/3-extensions/cipherstash/` mirroring `packages/3-extensions/pgvector/`. Subpath exports per the spec's "Subpath exports" layout.
- `EncryptedString` envelope + handle in `core/envelope.ts`. Handle as `WeakMap<EncryptedString, Handle>` or `#`-prefixed field — implementation choice; pin in the eventual implementation PR's design comment.
- `cipherstashStringCodec` in `core/codecs.ts`. `RuntimeParameterizedCodecDescriptor<P>` registration following pgvector's post-#402 shape.
- `bulkEncryptMiddleware` factory in `middleware/bulk-encrypt.ts`. Consumes M1's mutator + signal.
- PSL constructor registration in `core/authoring.ts` mirroring `packages/3-extensions/pgvector/src/core/authoring.ts`. Both inline and `types {}` alias paths supported.
- TS contract factory `encryptedString({ ... })` in `exports/column-types.ts`.
- EQL bundle vendor: copy `eql-bundle.ts` from `reference/cipherstash/stack/packages/stack/src/prisma/core/eql-bundle.ts`. Wire `databaseDependencies.init` per the spec's example.
- Parity test under `test/integration/test/authoring/parity/cipherstash-encrypted-string/` (mirrors pgvector's parity test).

**Validation gate.**

- All M2-scoped ACs pass.
- Integration test against live Postgres + EQL: insert encrypted value via `db.insert(User, { email: EncryptedString.from('alice@example.com') })`; verify the wire row is `eql_v2_encrypted` JSONB; `findUnique` returns an envelope; `await envelope.decrypt()` returns the plaintext.
- Bulk-call counter: inserting 10 rows × 1 column issues exactly **one** `bulkEncrypt` call.
- `pnpm lint:deps` passes for `packages/3-extensions/cipherstash/`.

**Done when.** Storage round-trip works end-to-end; bulk amortization on the write side verified.

**Commit.** One or two PRs depending on review size. The PSL constructor (and its parity test) and the runtime/codec/middleware/install can naturally split.

### M2.c remaining work — concrete task list

> Picked up by the developer continuing this project. Each task has the AC(s) it clears.

- [ ] **T2.c.1 — Vendor real EQL bundle.** Replace the placeholder string in `packages/3-extensions/cipherstash/src/core/eql-bundle.ts` (~17 lines today, marked `TODO M2.c`) with the real `EQL_INSTALL_SQL` constant copied from `/Users/wmadden/Projects/prisma/prisma-next-ws/worktrees/cipherstash-integration/reference/cipherstash/stack/packages/stack/src/prisma/core/eql-bundle.ts` (untracked file in the adjacent worktree, ~170 KB inlined SQL). Confirms `AC-INSTALL1` against the real bundle.
- [ ] **T2.c.2 — `bulkEncryptMiddleware` factory.** Implement at `packages/3-extensions/cipherstash/src/middleware/bulk-encrypt.ts`. The stub at `src/exports/middleware.ts` (currently `export {}`) becomes the public re-export. Uses M1's `SqlParamRefMutator.entries()` + `replaceValues()` to rewrite cipherstash envelope plaintexts to ciphertexts in one bulk call per routing key. Per the spec's `bulkEncryptMiddleware(sdk: CipherstashSdk)` shape and § Bulk-encrypt middleware code in `specs/envelope-codec-extension.spec.md`. Plaintext-zeroing default per § Open items 6 (overwrite handle plaintext with `undefined` post-encrypt). Clears `AC-MW1..5`.
- [ ] **T2.c.3 — Routing-key derivation.** Implement `groupByRoutingKey(targets)` per § Open items 5 — default "always derived from `(table, column)`". Confirm with CipherStash team; if CS confirms a different default, escalate as a deferral / spec amendment.
- [ ] **T2.c.4 — Live-Postgres + EQL integration test (storage round-trip).** Hand-write a `migration.ts` test fixture under `test/integration/` that exercises the M2 storage round-trip: insert via `db.insert(User, { email: EncryptedString.from('alice@example.com') })`; verify the wire row is `eql_v2_encrypted` JSONB; `findUnique` returns an envelope; `await envelope.decrypt()` returns the plaintext. Uses a mock `CipherstashSdk` (counter-instrumented) so the bulk-call assertion in the next bullet is clean. Clears the live-DB portion of `AC-E2E1` (storage subset).
- [ ] **T2.c.5 — Bulk-call counter test.** Add an integration assertion: inserting 10 rows × 1 column issues exactly **one** `bulkEncrypt` call. Clears the storage half of `AC-E2E2` (the read-side `bulkDecrypt` half is M4-scoped via `decryptAll`).
- [ ] **T2.c.6 — `dbInit` against a fresh Postgres database.** Verify `eql_v2` schema is reachable; `cs_configuration_v2` table exists; re-running `dbInit` is idempotent (hits the precheck short-circuit). Clears `AC-INSTALL2` + `AC-INSTALL3`.
- [ ] **T2.c.7 — Project 1 (PSL-driven) end-to-end test.** A second integration test driven entirely from PSL (the `psl-encrypted-string-constructor` task spec's `AC-E2E1`) covering the same storage round-trip. Should reuse most of T2.c.4's harness with a different contract source.
- [ ] **T2.c.8 — Validate gates.** `pnpm typecheck`, `pnpm test:packages`, `pnpm test:integration` (or its scoped equivalent), `pnpm lint:deps` all green. The cipherstash package gains `@prisma-next/sql-relational-core` as a runtime dep (for `SqlParamRefMutator` + `ParamRefHandle` types) if not already present.

**Entry conditions.** Live Postgres database with EQL extension installed (or installable by `dbInit`) reachable from the test runner. The CI `test:integration` scripts spin up Postgres in containers; confirm the EQL bundle install works against that setup before expanding the harness.

---

## M3 — `eq` operator + manual `addSearchConfig` migration

**Status: ⏳ NOT STARTED.** Blocked on M2.c. No commits, no ACs promoted.

**Goal.** A `findMany({ where: { email: { equals: 'alice@example.com' } } })` against a cipherstash column works against live Postgres + EQL. The user authors a hand-written migration calling `cipherstash.addSearchConfig({ table, column, equality: true })`; the migration installs the EQL search-config row; the query works.

**Visible value.** Searchable encryption is real. Equality search on encrypted columns — the headline cipherstash feature — works end-to-end on the framework.

**Task specs touched.** [`envelope-codec-extension`](specs/envelope-codec-extension.spec.md) (operator lowering portion); [`migration-factories`](specs/migration-factories.spec.md) (`addSearchConfig` for `equality`). `activatePendingSearches` is included if the EQL protocol requires it for `equality` mode (open question 1 of the migration-factories task spec — confirm against EQL).

**Tests-first.**

- Operator lowering: AC-OP1, AC-OP2 (snapshot tests verifying SQL shape).
- Nullable handling: AC-OP3, AC-OP4 — `WHERE email IS NULL` short-circuits, doesn't hit `eql_v2.eq`.
- Migration factories: AC-FACT1–AC-FACT4 (factory shape), AC-SQL1–AC-SQL4 (SQL shapes, parameterization correctness — adversarial table/column names flow through unchanged), AC-MIG1–AC-MIG6 (migration plan integration), AC-E2E1, AC-E2E2 (end-to-end with `dataTransform`).

**Implementation sketch.**

- Operator lowering: implement `queryOperations` handlers for `eq` against `cipherstash/string@1` columns. Lowering produces `eql_v2.eq("col", eql_v2.encrypt($1, ...))` (or the EQL canonical form — confirm against `reference/cipherstash/stack/packages/stack/src/prisma/core/operation-templates.ts`, the spec's open question 1).
- `addSearchConfig({ ... })` factory in `exports/migration.ts`. Constructs `RawSqlExpr` instances directly via the package-internal API delivered by M1's `raw-sql-ast-node`. Each entry produces a `SqlQueryPlan` via `planFromAst(ast, contract)` and is wrapped by the user via `this.dataTransform(...)` in their `migration.ts`.
- The `equality` mapping → EQL `'unique'` index (the spec's table). For M3 only the `equality` flag is exercised; `freeTextSearch` defers to M4.
- Hand-author the integration test's `migration.ts` — the M3 test fixture is a real migration file under `test/integration/`.

**Validation gate.**

- All M3-scoped ACs pass.
- Integration test against live Postgres + EQL: M2's storage round-trip continues to work; `findMany({ where: { email: { equals: 'alice@example.com' } } })` returns the inserted row; SQL snapshot matches the EQL operator form.
- `cs_configuration_v2` ends with one row for `(user, email)` with `'unique'` index in the post-migration state.
- Re-applying the migration is a no-op (idempotency test).

**Done when.** `eq` search round-trips end-to-end against live EQL.

**Commit.** One PR likely covers M3 cleanly — operator lowering and the factory are tightly coupled.

---

## M4 — `ilike` + `activatePendingSearches` + `decryptAll`

**Status: ⏳ NOT STARTED.** Blocked on M3.

**Goal.** Complete the Project 1 user-facing surface: `findMany({ where: { email: { contains: 'alice' } } })` works (free-text search via EQL `ilike`); `decryptAll(rows)` materializes plaintext for batches of envelopes; the migration factories cover both `equality` and `freeTextSearch` modes plus the `activatePendingSearches` final step.

**Visible value.** All Project 1 acceptance criteria (UMB1–UMB7) green. The umbrella's "ship a coherent searchable-encryption slice" promise is met.

**Task specs touched.** Remaining portions of [`envelope-codec-extension`](specs/envelope-codec-extension.spec.md) (`ilike` operator, `decryptAll`); remaining portions of [`migration-factories`](specs/migration-factories.spec.md) (`freeTextSearch` mode, `activatePendingSearches`).

**Tests-first.**

- `ilike` operator: AC-OP2, AC-OP3, AC-OP4 (already enumerated under M3 — overlap; the `ilike`-specific cases land here).
- `decryptAll`: AC-DEC1–AC-DEC4.
- Migration factories: AC-FACT1 + AC-SQL2 for the `freeTextSearch` path; AC-MIG1 / AC-E2E1 expanded to exercise both modes; `activatePendingSearches` covered by AC-FACT4 / AC-SQL3.

**Implementation sketch.**

- Add the `ilike` arm to the operator lowering implemented in M3.
- Implement `decryptAll(rows, opts?)` walker in `exports/decrypt-all.ts`. Bulk amortization — one `bulkDecrypt` per routing key.
- Extend `addSearchConfig` to emit the `freeTextSearch` → EQL `'match'` index entry alongside `equality`.
- Implement `activatePendingSearches()` as a single-entry factory.
- Update the integration migration `migration.ts` fixture from M3 to call `addSearchConfig({ ..., freeTextSearch: true })` and `activatePendingSearches()`.

**Validation gate.**

- Every umbrella AC (UMB1–UMB7) passes:
  - UMB1: full PSL round-trip with both `equality` and `freeTextSearch`; `findMany` for both `equals` and `contains` returns rows; `decryptAll(rows)` materializes plaintext.
  - UMB2: parity test (PSL vs TS contract produces byte-identical `contract.json`).
  - UMB3: bulk amortization on both write and read sides verified by counters (1 × `bulkEncrypt` for 10 inserts; 1 × `bulkDecrypt` for `decryptAll` over 10 rows).
  - UMB4: nullable variant + `where: { email: null }` short-circuits.
  - UMB5: cancellation surfaces `RUNTIME.ABORTED` at every phase.
  - UMB6: `pnpm lint:deps` passes.
  - UMB7: `examples/` app exercises the pattern.

**Done when.** All UMB ACs green; Project 1 functionally complete.

**Commit.** One PR covers M4 cleanly — `ilike` lowering, `decryptAll`, `freeTextSearch` migration mode all reuse the patterns established in M3.

---

## M5 — Close-out

**Status: ⏳ NOT STARTED.** Blocked on M4.

**Scope.** Project lifecycle close-out per `projects/README.md`.

**Tasks.**

- **T5.1** Verify all umbrella ACs (UMB1–UMB7) and per-task-spec ACs are green.
- **T5.2** Migrate long-lived docs to `docs/`. Candidates: the envelope-codec extension pattern as an architecture-doc note (does not need a full ADR; documented in the package README is acceptable for the first KMS-backed extension); the `RawSqlExpr` AST node behavior as an addition to the existing SQL family architecture doc if relevant.
- **T5.3** Strip repo-wide references to `projects/cipherstash-integration/project-1/**`. Where references are needed, replace with canonical `docs/` links (or with package READMEs).
- **T5.4** Close [TML-2373](https://linear.app/prisma-company/issue/TML-2373) ("Project 1: Searchable-encryption MVP"). [TML-2374](https://linear.app/prisma-company/issue/TML-2374) (`sql-raw-factory`) and [TML-2375](https://linear.app/prisma-company/issue/TML-2375) (Project 2) continue under the umbrella.
- **T5.5** Final sanity: `pnpm build`, `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps` all green.
- **T5.6** Delete `projects/cipherstash-integration/project-1/`. The umbrella's `spec.md` and `plan.md` continue to track the remaining components (Project 2, `sql-raw-factory`).

**Validation gate.** All checks green; no references to `project-1/**` remain in the tree (modulo umbrella-level cross-references that should be updated to point at `docs/` or removed).

**Done when.** `project-1/` directory deleted; umbrella plan's status table updated to "shipped."

**Commit.** Single close-out PR.

---

# Status

> Last updated 2026-05-05. Detailed AC scoreboard lives in [`reviews/code-review.md`](reviews/code-review.md). Branch: `tml-2373-project-1-searchable-encryption-mvp`. AC totals at last update: **52 PASS / 0 FAIL / 48 NOT VERIFIED**.

| Milestone | Scope | Status |
|---|---|---|
| **M1 — Framework SPI** | `raw-sql-ast-node` + `middleware-param-transform` | **SATISFIED** (28 ACs PASS; reviewed across two rounds) |
| **M2.a — Cipherstash package skeleton + envelope + codec** | Bootstrap `packages/3-extensions/cipherstash/`; `EncryptedString` envelope + handle; `cipherstash/string@1` codec; `RuntimeParameterizedCodecDescriptor`; `databaseDependencies.init` shape (placeholder install SQL) | **SATISFIED** (12 ACs PASS; reviewed; F3+F4 cleanup) |
| **M2.b — PSL constructor + TS factory + parity** | `cipherstash.EncryptedString({ equality, freeTextSearch })` PSL constructor; `encryptedString({...})` TS factory; PSL↔TS parity fixture; dbInit DDL snapshot (no live DB) | **SATISFIED** (12 ACs PASS; reviewed; 0 findings) |
| **M2.c — Bulk-encrypt middleware + live integration** | `bulkEncryptMiddleware` factory consuming M1's mutator + signal; vendor real `EQL_INSTALL_SQL` from `reference/cipherstash/...`; live-Postgres + EQL integration test for storage round-trip; bulk-call counter | NOT STARTED — requires live Postgres + EQL infra (`AC-INSTALL2`/`AC-INSTALL3`/`AC-E2E1..3`) |
| **M3 — `eq` operator + manual `addSearchConfig`** | Operator lowering for `eq` against cipherstash columns; `addSearchConfig({ equality })` migration factory; integration test driving a real migration file | NOT STARTED |
| **M4 — `ilike` + `activatePending` + `decryptAll`** | `ilike` arm on operator lowering; `decryptAll(rows, opts?)` walker; `freeTextSearch` migration mode; `activatePendingSearches()` factory; full `AC-UMB1..7` | NOT STARTED |
| **M5 — Close-out** | Lifecycle close-out per `projects/README.md` (migrate long-lived docs, strip `projects/` references, delete `projects/cipherstash-integration/project-1/`) | NOT STARTED |

**M2 sub-round split rationale.** The plan describes M2 as a single milestone with the closing note "Commit. One or two PRs depending on review size." The orchestration cycle split it into three sub-rounds so each lands a coherent, reviewable slice without blocking on infrastructure that isn't yet configured: M2.a is unit-testable in isolation, M2.b adds the authoring surface and a parity test that runs without a live DB, M2.c adds the middleware and exercises the live-Postgres + EQL path. M2.a and M2.b are SATISFIED on the branch; M2.c is the remaining M2 work.

**M2.c entry conditions.** The implementer can land the bulk-encrypt middleware, vendor the real EQL bundle, and write the integration tests without infrastructure — but `AC-INSTALL2`, `AC-INSTALL3`, and `AC-E2E1..3` only clear once a live Postgres database with EQL installed is reachable from the test runner. The reference EQL bundle lives in an adjacent worktree at `/Users/wmadden/Projects/prisma/prisma-next-ws/worktrees/cipherstash-integration/reference/cipherstash/stack/packages/stack/src/prisma/core/eql-bundle.ts` (untracked there); the M2.c implementer copies it into `packages/3-extensions/cipherstash/src/core/eql-bundle.ts` and replaces the placeholder constant.

# Open items

1. **PSL parity test location.** The umbrella spec defers to "same convention as pgvector" by default. Confirm during M2 implementation whether `test/integration/test/authoring/parity/cipherstash-encrypted-string/` (the pgvector-mirrored shape) or `test/integration/test/authoring/cipherstash/` (a cipherstash-grouped subdir) is preferred.
2. **Operator lowering source of truth.** [Open question 1 of the envelope-codec task spec](specs/envelope-codec-extension.spec.md#open-questions) — confirm against `reference/cipherstash/stack/packages/stack/src/prisma/core/operation-templates.ts` whether the lowering matches that file's templates byte-for-byte or has minor differences (e.g. `eql_v2.encrypt` wrapping vs an EQL operator-class override). Resolve in M3.
3. **Migration factory naming — single vs split.** [Open question 2 of the migration-factories task spec](specs/migration-factories.spec.md#open-questions) — confirm whether `addSearchConfig` returns an array (current default) or a grouped op. Resolve in M3 implementation.
4. **EQL `activate_pending_searches` exact function name.** [Open question 1 of the migration-factories task spec](specs/migration-factories.spec.md#open-questions) — defer to first-attempt repo's name; confirm against the bundled EQL version. Resolve in M4.
5. **Routing-key derivation.** [Open question 4 of the umbrella spec / Project 1 spec](spec.md#open-questions) — does `encryptedString({ ... })` need an explicit per-column key id slot? Default is "always derived from `(table, column)`." Resolve at the start of M2; confirm with CipherStash team.
6. **Plaintext-zeroing default.** [Open question 5 of the envelope-codec task spec](specs/envelope-codec-extension.spec.md#open-questions) — does the bulk-encrypt middleware overwrite the handle's plaintext slot with `undefined` post-encrypt? Default yes (memory hygiene). Resolve in M2.
7. **Mongo middleware param-mutator runtime wiring — deferred out of Project 1.** [TML-2376](https://linear.app/prisma-company/issue/TML-2376) tracks the follow-up. `middleware-param-transform` shipped the Mongo type seam + `flattenMongoParamRefs` helper + unit tests (satisfying `AC-FAM1`/`AC-FAM2` at the AC-text level) in M1, but `MongoRuntime` does not yet construct and thread a `MongoParamRefMutator` through `beforeExecute`. End-to-end wiring requires deferring `resolveValue` past the middleware chain in `packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts`, which is an architectural change to Mongo's lowering contract and outside M1's scope. Project 1 (Postgres-only) does not depend on the Mongo runtime wiring; this is a framework-symmetry follow-up.
8. **Codec-SDK binding refactor — deferred out of Project 1.** Linear ticket pending (see `reviews/code-review.md § Orchestrator notes — M2.b R1` for the full accepted-deferral record + ticket body). M2.b needed an SDK-free pack-meta codec (`cipherstashStringCodecMetadata`) because cipherstash's runtime codec captures `CipherstashSdk` in its `decode` closure, which collides with pack-meta consumers that read codec metadata at contract-emit time before any SDK binding exists. The M2.b-shipped workaround is two codecs representing one logical codec — fine for Project 1's bounded scope but a framework-ergonomics gap every future network-backed codec extension will hit. The clean fix is to thread SDK (or per-call context) through `CodecCallContext` rather than capturing it at codec construction; that refactor touches every codec in the repo and is M3+ framework scope.

Each open item is targeted to the milestone where the answer is needed; none block the start of M1.
