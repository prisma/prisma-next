# Project 1 — Searchable-encryption MVP — Plan

> Plan for [Project 1](spec.md) of the [cipherstash-integration umbrella](../spec.md). The umbrella plan ([../plan.md](../plan.md)) sequences the three components; this document sequences the work *inside* Project 1.
>
> **Rebased onto contract spaces (TML-2397).** Project 1 now branches off `tml-2397-cipherstash-contract-space` rather than `main`. The contract-space mechanism owns the cipherstash control plane (descriptor, codec lifecycle hook, contract-space artefacts, EQL bundle install). Project 1 delivers the runtime layer on top: envelope, SDK interface, codec encode/decode, bulk-encrypt middleware, PSL constructor, TS factory, operator lowering, end-to-end tests. See `spec.md` § Foundation for the architectural context.

# Strategy

Five **value-slice milestones** — each milestone produces a concrete, testable end-to-end slice. The cuts are by *user-visible function*, not by task spec. The milestone shape collapsed substantially from the pre-rebase plan because TML-2397 already shipped the contract-space mechanism and the cipherstash control plane (descriptor, codec lifecycle hook, baseline migration with the EQL bundle).

```
M0: rebase onto tml-2397-cipherstash-contract-space          ✅ DONE
    + cherry-pick framework SPIs (raw-sql-ast-node, mw-mutator)
M1: framework SPI                                            ✅ DONE (cherry-picked)
M2: cipherstash runtime layer (PSL/TS authoring + envelope
    + codec encode/decode + bulk-encrypt middleware)
M3: operator lowering (eq, ilike) + decryptAll + e2e
M4: close-out
```

**Critical path.** M0 → M1 → M2 → M3 → M4. M0 + M1 are complete. M2 is the bulk of remaining work; M3 wires the user-visible search surface on top; M4 is lifecycle close-out.

# Tests-first guidance

Per the repo rule "always write tests before creating or modifying implementation," each milestone leads with a failing-test step before its implementation step. Per-feature acceptance criteria (`AC-AST*`, `AC-LOW*`, `AC-MUT*`, `AC-CODEC*`, `AC-ENV*`, `AC-MW*`, `AC-CTOR*`, `AC-OP*`, `AC-DEC*`) live in the corresponding task specs; this plan points at them.

# What survives, what dies, what's already done — relative to PR #416

For traceability while reviewing the rebase. Commits referenced are on `origin/tml-2373-project-1-searchable-encryption-mvp` (PR #416) or `origin/tml-2373-project-1-part-2`.

**Already cherry-picked onto this branch (M0 / M1):**

| Commit | Surface | Why kept |
|---|---|---|
| `b0cb6bbb7..d5db73f5e` (10 commits) | M1 framework SPIs: `RawSqlExpr` AST + lowerer arm, `planFromAst` helper, `SqlParamRefMutator` + Mongo counterpart, per-execute `signal` on `RuntimeMiddlewareContext`, boolean `AuthoringArgumentDescriptor` kind | Target-agnostic seams; reusable beyond cipherstash. |
| `ca1403a36` | Skill update — implementer mustn't change user-facing surfaces without authorization | Process guard, applies repo-wide. |
| HANDOVER.md / cipherstash-team-design.md / cipherstash-team-questions.md | Reference docs authored on the part-2 branch | Useful context for the team conversation; team-design + team-questions migration sections need rewriting against the codec-hook foundation (separate commit). |

**Already on the contract-spaces base (no need to bring forward):**

| Surface | Where on the base |
|---|---|
| `eql-install.generated.ts` (vendored EQL bundle, 5,751 lines) | Already in `packages/3-extensions/cipherstash/src/core/eql-install.generated.ts` (TML-2397 ported it from PR #416 commit `c38c83bae`). |
| Cipherstash control descriptor + `contractSpace` wiring | `packages/3-extensions/cipherstash/src/exports/control.ts` |
| Codec lifecycle hook (`onFieldEvent` for `cipherstash:string@1`) | `packages/3-extensions/cipherstash/src/core/cipherstash-codec.ts` |
| Cipherstash baseline migration (install bundle + structural ops) | `packages/3-extensions/cipherstash/src/core/migrations.ts` |
| Cipherstash contract IR (`eql_v2_configuration` + `meta.cipherstashFutureIR`) | `packages/3-extensions/cipherstash/src/core/contract.ts` |

**To re-author against the new package shape (M2):**

| PR #416 commit | What to bring forward | Notes |
|---|---|---|
| `473032f78` | `EncryptedString` envelope + `CipherstashSdk` interface | Add as `src/core/envelope.ts` + `src/core/sdk.ts`. The envelope will be re-exported via `./runtime` (not `./control`) for tree-shaking. |
| `fab159390` | `cipherstash:string@1` codec runtime (encode/decode) | Land as `src/core/codec-runtime.ts`. The control-plane codec hook on TML-2397 stays where it is; runtime encode/decode is a separate file consumed only via the runtime entry point. The control descriptor reuses both via internal imports. |
| `c38863d37` | PSL `cipherstash.EncryptedString({...})` constructor + pack-meta | Add as `src/core/authoring.ts` + `src/core/descriptor-meta.ts` + `src/exports/pack.ts`. Wires into the existing descriptor on TML-2397 alongside the codec hook. |
| `9cd526ffe` | TS `encryptedString({...})` contract factory | Add as `src/exports/column-types.ts`. Same shape as on PR #416. |
| `4ca63dced` | Bulk-encrypt middleware + routing-key derivation | Add as `src/middleware/bulk-encrypt.ts` + `src/core/routing.ts`; re-export via `./middleware` entry point. |
| `1bd1a3615` | Wire-format fix for `eql_v2_encrypted` composite type | Apply in the codec runtime decode path. |

**Discarded:**

| PR #416 commit | What | Why discarded |
|---|---|---|
| `2b2efbe75` | Original cipherstash package skeleton | TML-2397 has its own skeleton; we re-author onto it. |
| `2d05b90d3` | `databaseDependencies.init` EQL bundle stub + descriptor | TML-2397's `contractSpace` mechanism replaces `databaseDependencies` (project FR13). |
| `2d96d154c` (part-2 branch) | `feat(cli): non-strict schema verify in db init` | The regression workaround. Per-space verifier on TML-2397 makes it unnecessary (project NFR1 / AC1). |
| `f75a8d624` (part-2 branch) | Live-Postgres tests depending on `2d96d154c` | Authored against the regression; will be replaced by clean live-DB tests in M3 against per-space verifier. |
| `c38ba63ae` (part-2 branch) | Vendor EQL bundle (M2.c Slice B) | Already on TML-2397 verbatim. |
| `68351e5cd` (part-2 branch) | Real-Postgres test harness | TML-2397 has its own Postgres test infra; re-evaluate need during M3. |
| All `migration-factories.spec.md` content | `addSearchConfig` / `activatePendingSearches` factory design | Superseded by codec lifecycle hook on TML-2397. Sub-spec stays as a redirect. |

# Milestones

## M0 — Rebase onto contract spaces

**Status: ✅ DONE.** Branch `tml-2373-project-1-on-2397` based off `origin/tml-2397-cipherstash-contract-space`.

**Tasks completed:**

- Branched off TML-2397 cleanly.
- Cherry-picked 10 framework SPI commits (M1 work) — see M1 below.
- Cherry-picked the skill update.
- Brought forward HANDOVER.md / cipherstash-team-design.md / cipherstash-team-questions.md.
- Brought forward spec.md / plan.md / sub-specs from the part-2 branch baseline.
- Rewrote spec.md and plan.md against the contract-spaces foundation (this commit).

**Validation:** `pnpm typecheck` passes for `framework-components`, `sql-runtime`, `sql-relational-core`, `adapter-postgres`, `mongo-runtime` after a `pnpm --filter @prisma-next/utils @prisma-next/framework-components @prisma-next/family-sql @prisma-next/target-postgres build` to refresh `dist/*.d.mts` declarations.

## M1 — Framework SPI

**Status: ✅ SATISFIED via cherry-picks from PR #416.**

The 10 commits cherry-picked in M0 deliver the entire M1 surface:

- `RawSqlExpr` AST node + Postgres lowerer arm (`AC-AST1..5`, `AC-LOW1..6`).
- `planFromAst` helper for raw-SQL plans (`AC-PLAN1..3`).
- `SqlParamRefMutator` SPI in `@prisma-next/sql-relational-core/middleware` (`AC-MUT1..5`, `AC-EX1`, `AC-TYPE1..2`).
- `MongoParamRefMutator` SPI mirror in `@prisma-next/mongo-runtime` (`AC-FAM1..2`).
- Per-execute `signal` on `RuntimeMiddlewareContext` + abort-phase tagging on `beforeExecute` (`AC-ABT1..4`).
- `boolean` kind on `AuthoringArgumentDescriptor` (additive; required by the PSL constructor — see M2).

The `runWithMiddleware` orchestrator integrates the cherry-picked param-mutator + signal seams next to TML-2397's already-landed `intercept` + `contentHash` lifecycle additions; both feature sets coexist in the same lifecycle (intercept loop first, then beforeExecute with mutator + signal).

**One follow-up fix shipped on this branch:** the cherry-picked `run-with-middleware-signal.test.ts` was missing a `contentHash` stub on its mock `RuntimeMiddlewareContext` (TML-2397 added that requirement). One-line fix added to satisfy the type contract without coupling the test to the content-hash implementation.

**Validation gate.** Already passed: `pnpm --filter @prisma-next/framework-components typecheck` + `pnpm --filter @prisma-next/framework-components test` green; downstream consumers (`sql-runtime`, `sql-relational-core`, `adapter-postgres`, `mongo-runtime`) typecheck clean after rebuilding workspace `dist/*.d.mts` artefacts.

**Open items from M1 carried forward:**

- **Mongo runtime wiring** ([TML-2376](https://linear.app/prisma-company/issue/TML-2376)) — `middleware-param-transform` shipped the Mongo type seam in M1 but `MongoRuntime` does not yet construct and thread a `MongoParamRefMutator` through `beforeExecute`. End-to-end wiring requires deferring `resolveValue` past the middleware chain in `packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts`. Project 1 (Postgres-only) does not depend on it; framework-symmetry follow-up.

## M2 — Cipherstash runtime layer

**Status: ⏳ NOT STARTED.** Bulk of remaining work.

**Goal.** A user authors a contract that declares `cipherstash.EncryptedString({ equality: true, freeTextSearch: true })` (PSL) or `encryptedString({...})` (TS), runs `prisma-next migrate` (which produces app-space + cipherstash-space migrations including the codec-hook-emitted `add_search_config` ops), runs `db apply`, then can `db.insert(User, { email: EncryptedString.from('alice@example.com') })`. The wire row is `eql_v2_encrypted` JSONB. `findUnique` returns an `EncryptedString` envelope; `await envelope.decrypt()` returns the plaintext.

**Visible value.** Encrypted columns work end-to-end for storage (read + write). Search operators come in M3.

**Task specs touched.** [`envelope-codec-extension`](specs/envelope-codec-extension.spec.md) (envelope + codec runtime + middleware portions); [`psl-encrypted-string-constructor`](specs/psl-encrypted-string-constructor.spec.md). The bundle-install + `databaseDependencies.init` portions of envelope-codec-extension are obviated (TML-2397 owns).

**Tests-first.**

- Envelope: AC-ENV1, AC-ENV2, AC-ENV4.
- Codec runtime: AC-CODEC1–AC-CODEC5.
- Bulk-encrypt middleware: AC-MW1, AC-MW2, AC-MW3, AC-MW4, AC-MW5.
- PSL constructor: full constructor registration, inline + named-type-alias usage, all three argument shapes (`EncryptedString({})`, `({ equality })`, `({ equality, freeTextSearch })`), nullable + non-nullable variants, parity test against the TS contract factory.
- One umbrella-level integration test (subset of [AC-UMB1](spec.md)) covering only the storage round-trip — no `findMany({ where: { email: { equals: ... } } })` yet.

**Tasks.**

- [ ] **T2.1 — Package skeleton extension.** Add `./runtime` and `./middleware` (and possibly `./column-types`, `./pack`) entry points to `packages/3-extensions/cipherstash/package.json`'s `exports` map. Today only `./control` is exposed (TML-2397 stub). Update `tsdown.config.ts` to emit the new entry points. Confirms tree-shakable control-vs-runtime split (AC-UMB9).
- [ ] **T2.2 — `EncryptedString` envelope + `CipherstashSdk` interface.** Add `src/core/envelope.ts` + `src/core/sdk.ts`. Re-author from PR #416 commit `473032f78`; same WeakMap-backed handle pattern, same `from(plaintext)` / `fromInternal({ ciphertext, table, column, sdk })` constructors, same `decrypt()` semantics (synchronous return on the write-side cached plaintext path; SDK round-trip on the read-side ciphertext path). Re-export via `./runtime`. Clears AC-ENV1, AC-ENV2, AC-ENV4.
- [ ] **T2.3 — Codec runtime (encode/decode).** Add `src/core/codec-runtime.ts`. Re-author from PR #416 commit `fab159390`. The codec is constructed via `codec({ ... })` from `@prisma-next/sql-relational-core/ast` with `typeId: 'cipherstash/string@1'`, `targetTypes: ['eql_v2_encrypted']`, `traits: ['equality']`. `decode(wire, ctx)` requires `ctx.column` and constructs an `EncryptedString.fromInternal(...)`; `encode(envelope, ctx)` reads the ciphertext from the envelope's handle and surfaces a clear error if the bulk-encrypt middleware did not run before encode. Apply the wire-format fix from PR #416 commit `1bd1a3615` (correct `eql_v2_encrypted` composite-type round-trip). Re-export via `./runtime`. Clears AC-CODEC1..5.
- [ ] **T2.4 — Bulk-encrypt middleware + routing-key derivation.** Add `src/core/routing.ts` + `src/middleware/bulk-encrypt.ts`. Re-author from PR #416 commit `4ca63dced`. Consumes M1's `SqlParamRefMutator.entries()` + `replaceValues()`; groups envelopes by `(table, column)` routing key (resolved 2026-05-06 — see § Open items 5); issues one `bulkEncrypt` call per group; rewrites ciphertexts back via the mutator. Per the spec's `bulkEncryptMiddleware(sdk: CipherstashSdk)` shape. Re-export via `./middleware`. Clears AC-MW1..5.
- [ ] **T2.5 — PSL constructor + pack-meta.** Add `src/core/authoring.ts` + `src/core/descriptor-meta.ts` + `src/exports/pack.ts`. Re-author from PR #416 commit `c38863d37`. PSL `cipherstash.EncryptedString({ equality, freeTextSearch })` registered via the pack-meta surface (rides on M1's boolean `AuthoringArgumentDescriptor` kind). The cipherstash descriptor in `src/exports/control.ts` extends to wire pack-meta alongside the existing codec-hook block. Clears AC-CTOR1..4, AC-LOWER1..3, AC-ALIAS1..2.
- [ ] **T2.6 — TS contract factory.** Add `src/exports/column-types.ts`. Re-author from PR #416 commit `9cd526ffe`. Same `ColumnTypeDescriptor` shape as the PSL constructor → byte-identical `contract.json` (parity guarantee).
- [ ] **T2.7 — PSL↔TS parity test.** Add fixture under `test/integration/test/authoring/parity/cipherstash-encrypted-string/` mirroring pgvector's parity test. Asserts byte-identical `contract.json` from PSL-source and TS-source. Clears AC-PARITY1..2.
- [ ] **T2.8 — Storage round-trip integration test (PSL-driven).** Live Postgres + EQL test (PGlite via `@prisma/dev` or `withRealPostgresDatabase`). Insert via `db.insert(User, { email: EncryptedString.from('alice@example.com') })`; verify the wire row is `eql_v2_encrypted` JSONB; `findUnique` returns an envelope; `await envelope.decrypt()` returns the plaintext. Bulk-call counter: inserting 10 rows × 1 column issues exactly one `bulkEncrypt` call. Clears the storage half of AC-UMB1, AC-UMB3.
- [ ] **T2.9 — Codec hook flag-name alignment.** TML-2397's stub codec hook hardcodes a single `'match'` index when emitting `add_search_config` (`packages/3-extensions/cipherstash/src/core/cipherstash-codec.ts:53`). Extend it so each enabled flag in `typeParams` (`equality`, `freeTextSearch`) maps to its corresponding EQL index name (`'unique'`, `'match'`) — emitting either two separate ops or one op with multi-statement `execute[]` (decision deferred to implementation; see spec § Open Question 2). Update the stub's existing tests; add a test covering both flags enabled.

**Validation gate.**

- All M2-scoped ACs pass.
- `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps`, `pnpm build` clean.
- Bulk-call counter verified.
- `dbInit` against the resulting database succeeds in strict mode (no `strictVerification: false`); inherits TML-2397 AC1 — clears AC-UMB8.
- Tree-shaking confirmed: a build importing only `@prisma-next/extension-cipherstash/control` does not pull in envelope/codec-runtime/middleware/SDK; a build importing only `/runtime` does not pull in contract-space artefacts (clears AC-UMB9).

**Done when.** Storage round-trip works end-to-end against live Postgres + EQL; control-vs-runtime tree-shaking verified.

**Commit.** Likely 3-4 PRs depending on review size. Natural splits: T2.1 + T2.2 + T2.3 (envelope + codec runtime); T2.5 + T2.6 + T2.7 (authoring); T2.4 + T2.8 + T2.9 (middleware + storage e2e + codec-hook alignment).

## M3 — Search operators + decryptAll + full e2e

**Status: ⏳ NOT STARTED.** Blocked on M2.

**Goal.** Complete the user-facing surface: `findMany({ where: { email: { equals: 'x' } } })` works; `findMany({ where: { email: { contains: 'foo' } } })` works; `decryptAll(rows)` materializes plaintext for batches of envelopes. All `AC-UMB*` green.

**Visible value.** Searchable encryption is real — equality + free-text search on encrypted columns works end-to-end against live Postgres + EQL.

**Task specs touched.** Remaining portions of [`envelope-codec-extension`](specs/envelope-codec-extension.spec.md) — operator lowering for `eq` and `ilike`, `decryptAll`.

**Tests-first.**

- Operator lowering: AC-OP1, AC-OP2 (snapshot tests verifying SQL shape for `eq` and `ilike`).
- Nullable handling: AC-OP3, AC-OP4 — `WHERE email IS NULL` short-circuits, doesn't hit `eql_v2.eq` / `eql_v2.ilike`.
- `decryptAll`: AC-DEC1–AC-DEC4.

**Tasks.**

- [ ] **T3.1 — `eq` operator lowering.** Implement a `queryOperations` handler for `eq` against `cipherstash/string@1` columns. Lowering produces `eql_v2.eq("col", eql_v2.encrypt($1, ...))` (or the EQL canonical form — confirm against `reference/cipherstash/stack/packages/stack/src/prisma/core/operation-templates.ts`). Clears AC-OP1.
- [ ] **T3.2 — `ilike` operator lowering.** Same shape, via `eql_v2.ilike(...)`. Clears AC-OP2.
- [ ] **T3.3 — Nullable short-circuit.** `WHERE email IS NULL` and `WHERE email IS NOT NULL` lower without involving the EQL operators. Clears AC-OP3, AC-OP4.
- [ ] **T3.4 — `decryptAll` walker.** Implement at `src/exports/decrypt-all.ts`. Walks rows recursively, collects envelopes by routing key, issues one `bulkDecrypt` call per routing key. Re-export via `./runtime`. Clears AC-DEC1..4.
- [ ] **T3.5 — Full umbrella e2e.** Live Postgres + EQL test covering AC-UMB1 in full: PSL contract → migrate → apply → insert → equality query → contains query → `decryptAll`. Clears AC-UMB1.
- [ ] **T3.6 — Bulk-call counter for read side.** Assert `decryptAll` over 10-row result set issues exactly one `bulkDecrypt` call. Clears the read half of AC-UMB3.
- [ ] **T3.7 — Nullable umbrella e2e.** Mix of null and non-null rows in a `findMany({ where: { email: null } })`. Clears AC-UMB4.
- [ ] **T3.8 — Cancellation umbrella test.** Aborted `signal` at every phase surfaces `RUNTIME.ABORTED { phase }`. Clears AC-UMB5.
- [ ] **T3.9 — Example app.** Add `examples/cipherstash-demo` (or extend an existing example) demonstrating the pattern with realistic shapes. Clears AC-UMB7.
- [ ] **T3.10 — TS-driven umbrella e2e.** Same scenario as T3.5 but driven from TS contract; asserts byte-identical `contract.json` (covered already by T2.7 parity test, but also exercise the runtime path end-to-end). Clears AC-UMB2.

**Validation gate.**

- Every umbrella AC (AC-UMB1..9) passes.
- `pnpm typecheck`, `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm lint:deps`, `pnpm build` clean.

**Done when.** All AC-UMB* green; Project 1 functionally complete.

**Commit.** One or two PRs depending on review size — operator lowering, `decryptAll`, and e2e tests reuse the same harness.

## M4 — Close-out

**Status: ⏳ NOT STARTED.** Blocked on M3.

**Scope.** Project lifecycle close-out per `projects/README.md`.

**Tasks.**

- [ ] **T4.1** Verify all umbrella ACs (AC-UMB1..9) and per-task-spec ACs are green.
- [ ] **T4.2** Migrate long-lived docs to `docs/`. Candidates: the envelope-codec extension pattern as an architecture-doc note (does not need a full ADR; documented in the package README is acceptable for the first KMS-backed extension). The `RawSqlExpr` AST node behavior is already covered under the SQL family architecture doc by TML-2397's M5 doc-pass; cross-reference if needed.
- [ ] **T4.3** Strip repo-wide references to `projects/cipherstash-integration/project-1/**`. Where references are needed, replace with canonical `docs/` links (or with package READMEs).
- [ ] **T4.4** Delete the obsolete `specs/migration-factories.spec.md` redirect (post-close-out housekeeping).
- [ ] **T4.5** Close [TML-2373](https://linear.app/prisma-company/issue/TML-2373) ("Project 1: Searchable-encryption MVP"). [TML-2374](https://linear.app/prisma-company/issue/TML-2374) (`sql-raw-factory`) and [TML-2375](https://linear.app/prisma-company/issue/TML-2375) (Project 2) continue under the umbrella.
- [ ] **T4.6** Final sanity: `pnpm build`, `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps` all green.
- [ ] **T4.7** Delete `projects/cipherstash-integration/project-1/`. The umbrella's `spec.md` and `plan.md` continue to track the remaining components (Project 2, `sql-raw-factory`).

**Validation gate.** All checks green; no references to `project-1/**` remain in the tree (modulo umbrella-level cross-references that should be updated to point at `docs/` or removed).

**Done when.** `project-1/` directory deleted; umbrella plan's status table updated to "shipped."

**Commit.** Single close-out PR.

# Status

> Last updated 2026-05-08 (post-TML-2397-rebase). Branch: `tml-2373-project-1-on-2397`.

| Milestone | Scope | Status |
|---|---|---|
| **M0 — Rebase onto contract spaces** | Branch off TML-2397; cherry-pick framework SPIs + skill update; bring forward project docs; rewrite spec + plan against contract-spaces foundation | ✅ DONE |
| **M1 — Framework SPI** | `RawSqlExpr` + lowerer; `planFromAst`; `SqlParamRefMutator` + Mongo mirror; per-execute `signal`; boolean `AuthoringArgumentDescriptor` kind | ✅ DONE (cherry-picked; 28 ACs PASS at PR #416 review time) |
| **M2 — Cipherstash runtime layer** | Envelope + SDK + codec encode/decode + bulk-encrypt middleware + PSL/TS authoring + parity + storage e2e + codec-hook flag-name alignment | ⏳ NOT STARTED |
| **M3 — Operators + decryptAll + full e2e** | `eq` + `ilike` operator lowering; `decryptAll` walker; full AC-UMB suite | ⏳ NOT STARTED |
| **M4 — Close-out** | Lifecycle close-out per `projects/README.md` | ⏳ NOT STARTED |

# Open items

1. **PSL parity test location.** The umbrella spec defers to "same convention as pgvector" by default. Confirm during M2 implementation whether `test/integration/test/authoring/parity/cipherstash-encrypted-string/` (the pgvector-mirrored shape) or `test/integration/test/authoring/cipherstash/` (a cipherstash-grouped subdir) is preferred.
2. **Operator lowering source of truth.** [Open question 1 of the envelope-codec task spec](specs/envelope-codec-extension.spec.md#open-questions) — confirm against `reference/cipherstash/stack/packages/stack/src/prisma/core/operation-templates.ts` whether the lowering matches that file's templates byte-for-byte. Resolve in M3.
3. **Codec hook flag-name shape.** Whether the cipherstash codec hook emits one op per flag (`equality` → unique-index op; `freeTextSearch` → match-index op) or one op per `(table, field)` with multi-statement `execute[]`. Spec § Open Question 2; resolve in M2 T2.9.
4. ~~**Migration factory naming — single vs split.**~~ OBSOLETE — superseded by codec lifecycle hook on TML-2397.
5. **Routing-key derivation — RESOLVED (2026-05-06).** Routing key is `{ table, column }`, derived from the envelope handle's `(table, column)` slots. Middleware groups envelopes by `(table, column)` and issues one `bulkEncrypt` call per group. The shape matches the reference SDK's `bulkEncrypt(plaintexts, { column, table })` call (`reference/cipherstash/.../ffi/index.ts:386-391`) and was already locked into the `CipherstashSdk` interface shipped on PR #416's M2.a — being re-authored as part of T2.2.
6. **Plaintext-zeroing default — RESOLVED (2026-05-06).** Project 1 does **not** zero the envelope handle's plaintext slot post-encrypt. Rationale: zeroing in JS is best-effort (strings are immutable), and as a side effect a write-side envelope's `decrypt()` returns the original plaintext synchronously without a round-trip. The M2 envelope re-author (T2.2) does not include the `handle.plaintext = undefined` line that the original PR #416 envelope shipped pre-decision.
7. **Mongo middleware param-mutator runtime wiring — deferred out of Project 1.** [TML-2376](https://linear.app/prisma-company/issue/TML-2376) tracks the follow-up. M1 cherry-picks shipped the type seam + helpers + unit tests; full runtime wiring requires deferring `resolveValue` past the middleware chain in Mongo's adapter. Project 1 (Postgres-only) does not depend on it.
8. **Codec-SDK binding refactor — deferred out of Project 1.** [TML-2388](https://linear.app/prisma-company/issue/TML-2388) (Medium-priority framework-symmetry follow-up). The runtime codec captures `CipherstashSdk` in its `decode` closure, which collides with pack-meta consumers that read codec metadata at contract-emit time before any SDK binding exists. The clean fix is to thread SDK (or per-call context) through `CodecCallContext` rather than capturing it at codec construction; that refactor touches every codec in the repo and is outside Project 1 scope.
