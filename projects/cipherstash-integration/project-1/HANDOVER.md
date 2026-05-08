# Project 1 — Searchable-encryption MVP — Handover

> **STALE — kept for archaeology only.** Written 2026-05-05 by the previous driver of `tml-2373-project-1-searchable-encryption-mvp` (PR #416), to hand off to a successor. Project 1 was subsequently rebased onto `tml-2397-cipherstash-contract-space` on 2026-05-08 (this branch: `tml-2373-project-1-on-2397`). The rebase collapsed the original M2.a/M2.b/M2.c/M3/M4 milestones into the new M2/M3 against the contract-spaces foundation. **For current state, read [`plan.md`](plan.md) (rewritten) and [`spec.md`](spec.md) (rewritten) instead — the table below is a historical snapshot.** What survived the rebase: the M1 framework SPIs (cherry-picked clean) and the runtime layer (envelope, codec runtime, bulk middleware, PSL constructor, TS factory, wire-format fix) which is being re-authored onto the new package shape during M2. What died: the `databaseDependencies.init` EQL bundle install (replaced by the contract-space baseline migration) and the migration factories (`addSearchConfig` / `activatePendingSearches`, replaced by the codec lifecycle hook on TML-2397).

> Read this first only if you want the historical view of how things stood pre-rebase, then [`spec.md`](spec.md), [`plan.md`](plan.md), and [`reviews/code-review.md`](reviews/code-review.md) in that order.

## TL;DR

**Project 1 is ~60% shipped on `tml-2373-project-1-searchable-encryption-mvp`.** Three of five milestones (M1, M2.a, M2.b) are SATISFIED on the branch with **52 ACs PASS / 0 FAIL / 48 NOT VERIFIED**. The remaining work is **M2.c** (bulk-encrypt middleware + real EQL bundle + live Postgres + EQL integration tests), then **M3** (`eq` operator + manual `addSearchConfig` migration), then **M4** (`ilike` + `decryptAll` + `activatePending`), then **M5** (close-out). Two follow-up Linear tickets are filed: [TML-2376](https://linear.app/prisma-company/issue/TML-2376) (Mongo middleware param-mutator runtime wiring) and [TML-2388](https://linear.app/prisma-company/issue/TML-2388) (codec-SDK binding refactor).

## Where to start (5-minute orientation)

1. **This file** — sets the table.
2. **[`spec.md`](spec.md)** — the project's source of truth. § Status table now reflects current state.
3. **[`plan.md`](plan.md)** — milestone-by-milestone breakdown. Each milestone now carries an explicit `**Status:**` line; M2.c has a concrete task checklist (T2.c.1..T2.c.8) under `## M2 — Store-only round-trip → ### M2.c remaining work`.
4. **[`reviews/code-review.md`](reviews/code-review.md)** — full AC scoreboard with file:line evidence per PASS, plus § Orchestrator notes capturing accepted deferrals.
5. **[`reviews/system-design-review.md`](reviews/system-design-review.md)** + **[`reviews/walkthrough.md`](reviews/walkthrough.md)** — the previous reviewer's design overview and behavior-change narrative across rounds. Skim if you want the architectural framing in someone else's words.

The five task specs under [`specs/`](specs/) are the AC-text sources of truth; refer to them when adjudicating whether a given AC is met.

## What's done

### M1 — Framework SPI ✅ SATISFIED

Lands the two framework-side prerequisites the cipherstash extension consumes.

- **`raw-sql-ast-node`** — `RawSqlExpr` AST node + Postgres lowerer arm + `planFromAst` envelope helper. AC-AST1..5, AC-LOW1..6, AC-PLAN1..3 all PASS. AC-E2E1/E2E2 are migration-factories-coupled and stay M3-scoped. Commits `1d8b70943..9425690fa` (six commits including AC-ABT1 signal plumbing).
- **`middleware-param-transform`** — mutable `beforeExecute` seam (`SqlParamRefMutator`) + per-execute `MiddlewareContext.signal` + Mongo type-seam parity. AC-MUT1..5, AC-EX1, AC-ABT1..4, AC-FAM1..2, AC-TYPE1..2 all PASS. Commits `314011400..33a6e5ad5`.

**Defer in scope:** Mongo runtime wiring of the param mutator → [TML-2376](https://linear.app/prisma-company/issue/TML-2376) (filed). Project 1 is Postgres-only so this doesn't block; framework symmetry follow-up.

### M2.a — Cipherstash package skeleton + envelope + codec ✅ SATISFIED

Bootstraps `packages/3-extensions/cipherstash/` (mirrors `packages/3-extensions/pgvector/` structurally).

- `EncryptedString` envelope class with module-scoped `WeakMap<EncryptedString, Handle>` for handle storage.
- `CipherstashSdk` interface (3 async methods: `decrypt` / `bulkEncrypt` / `bulkDecrypt`, optional `AbortSignal` per call).
- `cipherstash/string@1` codec (target type `eql_v2_encrypted`, traits `['equality']`).
- `RuntimeParameterizedCodecDescriptor<{equality, freeTextSearch}>` with arktype paramsSchema.
- `databaseDependencies.init` shape with **placeholder install SQL** (real EQL bundle vendored in M2.c).
- AC-PKG1..3, AC-ENV1/2/4, AC-CODEC1..5, AC-INSTALL1 all PASS. Commits `2b2efbe75..2d05b90d3` + `6bbbee20f..0d558b1b2` (F3+F4 cleanup).

### M2.b — PSL constructor + TS factory + parity ✅ SATISFIED

Authoring surface — both PSL and TS produce byte-identical `contract.json` for cipherstash columns.

- `cipherstash.EncryptedString({ equality, freeTextSearch })` PSL constructor.
- `encryptedString({...})` TS factory.
- PSL↔TS parity fixture at `test/integration/test/authoring/parity/cipherstash-encrypted-string/`.
- `dbInit` DDL snapshot proving the column renders as `eql_v2_encrypted` (no live DB; pure in-process).
- Required a small framework addition: `kind: 'boolean'` arm on `AuthoringArgumentDescriptor` (commit `584bbcda6`). Three-file additive change; zero impact on existing extensions.
- AC-CTOR1..4, AC-LOWER1..4, AC-ALIAS1..2, AC-PARITY1..2 all PASS. Commits `584bbcda6..c48d4d7ad`.

**Defer in scope:** Codec-SDK binding refactor (cipherstash needed two codecs — SDK-free for pack-meta, SDK-bound for runtime). The clean fix is to thread SDK per-call via `CodecCallContext` rather than capturing it at codec construction. M3+ framework scope. Filed as [TML-2388](https://linear.app/prisma-company/issue/TML-2388); the original accepted-deferral record lives in `reviews/code-review.md § Orchestrator notes — M2.b R1`.

## What remains

### M2.c — Bulk-encrypt middleware + live integration ⏳ NOT STARTED

Concrete task list lives in [`plan.md → ### M2.c remaining work`](plan.md). Summary:

- **T2.c.1** — vendor real EQL bundle (replace placeholder in `packages/3-extensions/cipherstash/src/core/eql-bundle.ts` with content from the adjacent worktree at `/Users/wmadden/Projects/prisma/prisma-next-ws/worktrees/cipherstash-integration/reference/cipherstash/stack/packages/stack/src/prisma/core/eql-bundle.ts`)
- **T2.c.2** — `bulkEncryptMiddleware` factory in `src/middleware/bulk-encrypt.ts` (clears AC-MW1..5)
- **T2.c.3** — routing-key derivation (default `(table, column)`; confirm with CipherStash team)
- **T2.c.4** — live-Postgres + EQL storage round-trip integration test (clears AC-E2E1 storage subset)
- **T2.c.5** — bulk-call counter test (10 inserts → 1 `bulkEncrypt`; clears AC-E2E2 write half)
- **T2.c.6** — `dbInit` against fresh + already-installed DB (clears AC-INSTALL2/3)
- **T2.c.7** — second integration test driven entirely from PSL (clears `psl-encrypted-string-constructor` AC-E2E1)
- **T2.c.8** — full validation gate sweep

**Entry condition:** live Postgres + EQL reachable from the test runner. The repo's `pnpm test:integration` script spins up Postgres in containers; confirm the EQL bundle install works against that setup before expanding the harness.

### M3 — `eq` operator + manual `addSearchConfig` migration ⏳ NOT STARTED

Implements the headline cipherstash feature: `findMany({ where: { email: { equals: 'alice@example.com' } } })` against an encrypted column round-trips against live Postgres + EQL.

- Operator-lowering for `eq` against `cipherstash/string@1` columns (clears AC-OP1, AC-OP3, AC-OP4 partial)
- `addSearchConfig({ ..., equality: true })` migration factory in `exports/migration.ts` — constructs `RawSqlExpr` from M1, wraps via `planFromAst(ast, contract)`, consumes via `dataTransform(...)` (clears AC-FACT*, AC-SQL*, AC-MIG*, AC-E2E1/E2E2 from `migration-factories.spec.md`)
- Hand-author the integration migration `migration.ts`
- See `plan.md § M3` for the full sketch + validation gate

### M4 — `ilike` + `activatePending` + `decryptAll` ⏳ NOT STARTED

Completes the Project 1 user-facing surface. After M4 the seven umbrella ACs (AC-UMB1..7) are all green.

- `ilike` arm on the operator lowerer (AC-OP2)
- `decryptAll(rows, opts?)` walker — bulk-decrypt amortized (AC-DEC1..4)
- `addSearchConfig` extended to emit `freeTextSearch` → EQL `'match'` index entry
- `activatePendingSearches()` factory
- Update integration migration fixture
- See `plan.md § M4` for the full sketch + validation gate

### M5 — Close-out ⏳ NOT STARTED

Project lifecycle close-out per `projects/README.md`. T5.1..T5.6 documented in `plan.md § M5`. The expected ending state: `projects/cipherstash-integration/project-1/` directory deleted; long-lived docs migrated to `docs/`; final PR merges.

## Operating context

### Branch + worktree

- **Branch:** `tml-2373-project-1-searchable-encryption-mvp` (pushed to origin; up-to-date)
- **Worktree:** `/Users/wmadden/Projects/prisma/prisma-next-ws/worktrees/tml-2373-project-1-searchable-encryption-mvp`
- **Main repo path:** `/Users/wmadden/Projects/prisma/prisma-next` (different worktree, possibly on a different branch)
- **Reference (untracked, adjacent worktree):** `/Users/wmadden/Projects/prisma/prisma-next-ws/worktrees/cipherstash-integration/reference/cipherstash/` — the first-attempt cipherstash repo. Used for: (i) vendoring `eql-bundle.ts` in M2.c, (ii) operator-template lookups in M3, (iii) SDK shape reference. Read-only; never copy wholesale.

### Validation gates (run from the worktree root)

```sh
pnpm typecheck                                    # repo-wide; expect 125/125 green at HEAD
pnpm test:packages                                # 111+ tasks; cipherstash package contributes 47/47
pnpm lint:deps                                    # 0 violations expected
pnpm --filter @prisma-next/extension-cipherstash test
pnpm --filter @prisma-next/extension-cipherstash lint
pnpm --filter @prisma-next/integration-tests test -t 'cipherstash-encrypted-string'  # parity fixture
pnpm test:integration                             # live-DB suite — needed for M2.c onwards
```

**Known transient:** `pnpm test:packages` first parallel run sometimes shows a flake in `@prisma-next/cli` + `@prisma-next/adapter-postgres` that's green when re-run individually. Pre-existing turbo-scheduling / DB-resource contention; not introduced by this branch.

### Key files

| Surface | File |
|---|---|
| Cipherstash package | `packages/3-extensions/cipherstash/` |
| Envelope class | `packages/3-extensions/cipherstash/src/core/envelope.ts` |
| Codec | `packages/3-extensions/cipherstash/src/core/codecs.ts` |
| Pack-meta + parameterized descriptor | `packages/3-extensions/cipherstash/src/core/{descriptor-meta,parameterized}.ts` |
| PSL constructor registration | `packages/3-extensions/cipherstash/src/core/authoring.ts` |
| Control descriptor + EQL install | `packages/3-extensions/cipherstash/src/exports/control.ts` |
| EQL bundle (PLACEHOLDER) | `packages/3-extensions/cipherstash/src/core/eql-bundle.ts` ← replace in M2.c T2.c.1 |
| TS contract factory | `packages/3-extensions/cipherstash/src/exports/column-types.ts` |
| Middleware (STUB) | `packages/3-extensions/cipherstash/src/exports/middleware.ts` ← populate in M2.c T2.c.2 |
| Parity fixture | `test/integration/test/authoring/parity/cipherstash-encrypted-string/` |
| dbInit DDL snapshot | `test/integration/test/authoring/cipherstash-dbinit-snapshot.test.ts` |
| Framework param-mutator | `packages/2-sql/4-lanes/relational-core/src/middleware/param-ref-mutator.ts` |
| Framework `RawSqlExpr` | `packages/2-sql/4-lanes/relational-core/src/ast/types.ts` (search for `RawSqlExpr`) |
| Per-execute signal plumbing | `packages/1-framework/1-core/framework-components/src/execution/runtime-middleware.ts` + `run-with-middleware.ts` |

### Repo conventions to know

- **`pnpm` only**, never `npm`. Never `npx`.
- **No backward-compat shims** unless explicitly requested. Update call sites instead.
- **Tests-first.** Every AC pushed should have a green test on disk before the implementation lands.
- **Explicit-staging commits.** Never `git add -A` or `git add .` (see [`.cursor/rules/git-staging.mdc`](../../../.cursor/rules/git-staging.mdc)).
- **No transient-project links in user-facing docs.** Use `DEVELOPING.md` for contributor notes (see `packages/3-extensions/cipherstash/DEVELOPING.md` precedent).
- **Use `ifDefined()` from `@prisma-next/utils/defined`** for optional-property forwarding (see [`.cursor/rules/use-if-defined.mdc`](../../../.cursor/rules/use-if-defined.mdc)).
- **No `any`, no `@ts-expect-error` outside negative type tests, no `@ts-nocheck`.**
- **Check [`AGENTS.md`](../../../AGENTS.md)** for the full ruleset; it's well-organized.

## Follow-up tickets

### TML-2376 (filed) — Mongo middleware param-mutator runtime wiring

`MongoRuntime` doesn't yet construct/thread a `MongoParamRefMutator`. The Mongo type seam + `flattenMongoParamRefs` helper + unit tests landed in M1 (sufficient for AC-FAM1/FAM2 per the AC text), but end-to-end runtime wiring requires deferring `resolveValue` past `beforeExecute` in `packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts`. Architectural change to Mongo's lowering contract; outside Project 1 (Postgres-only).

### TML-2388 (filed) — Codec-SDK binding refactor

Cipherstash's runtime codec captures `CipherstashSdk` in its `decode` closure, which collides with pack-meta consumers that read codec metadata at contract-emit time before any SDK exists. M2.b shipped a two-codec workaround (`cipherstashStringCodecMetadata` + `createCipherstashStringCodec(sdk)`); the clean fix threads SDK per-call via `CodecCallContext` and touches every codec in the repo, so it's M3+ framework scope. Filed as [TML-2388 — Codec-SDK binding refactor](https://linear.app/prisma-company/issue/TML-2388) (Medium, parent TML-2373). Original accepted-deferral record: `reviews/code-review.md § Orchestrator notes — M2.b R1`.

### Smaller observations not yet ticketed

These were surfaced under § Anything surprising in M2.b R1 but are infrastructure / build-tool issues outside Project 1's spec — file separately or drop:

1. **`tsdown build` rewrites `package.json`** with `main`/`module`/`types` fields. The previous implementer reverted twice during commits. Possibly a workspace-config regression; likely an `@prisma-next/tsdown` config issue. Worth a separate ticket if it recurs in M2.c work.
2. **Vitest `testNamePattern` × `UPDATE_AUTHORING_PARITY_EXPECTED=1`** doesn't generate `expected.contract.json` reliably. Workaround: run against the explicit test-file path. Documented in commit `8ea4a1b8b`.
3. **Pre-existing flake** in `@prisma-next/cli` + `@prisma-next/adapter-postgres` parallel test runs (mentioned under Validation gates above).

## Open spec questions still unresolved

These appear in `plan.md § Open items` as items 1-6. Most are still relevant for the remaining milestones:

- Item 1 — PSL parity test location → **resolved** during M2.b: pgvector-mirrored shape (`test/integration/test/authoring/parity/cipherstash-encrypted-string/`).
- Item 2 — operator lowering source-of-truth → **pending; resolve in M3**. Confirm against `reference/cipherstash/.../operation-templates.ts`.
- Item 3 — migration factory naming (single vs split) → **pending; resolve in M3**.
- Item 4 — EQL `activate_pending_searches` exact function name → **pending; resolve in M4**.
- Item 5 — routing-key derivation → **resolved (2026-05-06)**. Routing key is `{ table, column }`; no per-column override in Project 1. CipherStash team will be consulted post-delivery — see `cipherstash-team-questions.md`.
- Item 6 — plaintext-zeroing default → **resolved (2026-05-06)**. Project 1 does not zero plaintext post-encrypt. M2.c implementer removes the existing `handle.plaintext = undefined` line in `setHandleCiphertext` (`packages/3-extensions/cipherstash/src/core/envelope.ts:44-48`) and flips `AC-MW5`. Question for the CipherStash team is in `cipherstash-team-questions.md`.

## Subagent / orchestration context

The previous driver used the [`drive-orchestrate-plan`](/Users/wmadden/.agents/skills/drive-orchestrate-plan/SKILL.md) skill to drive milestones to a SATISFIED state via an iterate-implement-review loop with two persistent subagent personas (one implementer per milestone, one reviewer across all milestones). If you want to continue with that workflow:

- **Reviewer subagent ID** (resume across rounds): `4d37df98-53a6-4eab-8e80-653a03253145`. Persists the AC scoreboard and review artifacts. Resume on every new round; do not spawn fresh.
- **M2.a/M2.b implementer ID** (retired): `58bc641c-8950-41ce-af00-afe216eab421`. Will need a fresh implementer for M2.c per the milestone-fresh-implementer protocol; resume the reviewer.

If you'd rather not use the skill — totally fine; the spec, plan, code-review, and AC scoreboard are self-contained. Drive the rounds yourself, or route through your own preferred workflow.

## Pre-flight checklist for the next driver

- [ ] Pull `tml-2373-project-1-searchable-encryption-mvp`; confirm HEAD is `cc99d503e` or later.
- [ ] `pnpm install` — confirm `pnpm-lock.yaml` matches.
- [ ] Run the validation gates above; expect green across the board.
- [ ] Skim `reviews/code-review.md` § Summary + § Acceptance criteria scoreboard.
- [ ] Read this file's [§ What remains](#what-remains) section + `plan.md § M2 → ### M2.c remaining work`.
- [ ] Confirm Postgres + EQL infra availability (or add it as a pre-T2.c.1 step).
- [ ] Read `cipherstash-team-questions.md` if you'll be talking to the CipherStash team. Two design defaults are queued for them to validate post-delivery (routing-key derivation; plaintext zeroing). Decisions are already baked into the spec/plan and don't gate M2.c — but if their answers diverge from our defaults, the doc explains exactly what changes.

Good luck — the foundation is solid, the codec/envelope/parity-test surfaces are well-tested, and the remaining work is well-scoped. Reach out to the previous driver via Linear if you hit unexpected blockers.
