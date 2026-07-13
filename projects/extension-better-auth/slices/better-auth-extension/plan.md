# Slice plan: better-auth-extension

**Slice spec:** `./spec.md` · **Parent project:** `projects/extension-better-auth/` · **Branch:** `tml-2994-better-auth-extension` (parent: `main`) · **PR:** single PR, title prefix `tml-2994:`

## Calibration references

- Failure modes threaded into briefs: [F5](../../../../drive/calibration/failure-modes.md#f5-destructive-git-operations-executed-by-subagents-without-orchestrator-approval) (destructive git ops forbidden — all dispatches), [F14](../../../../drive/calibration/failure-modes.md#f14-dispatch-reports-validation-green-but-ci-is-red-dispatch-gates-didnt-mirror-ci) (gates mirror CI: `lint` is a separate job; typecheck covers `test/`), [F16](../../../../drive/calibration/failure-modes.md#f16-self-acknowledged-layering-violation-shipped-through-review) (lint:deps, layering), [F17](../../../../drive/calibration/failure-modes.md#f17-dispatch-brief-frames-the-win-as-mechanics-implementer--reviewer-ship-wrong-shape-work-that-satisfies-it) (briefs carry property statements), [F21](../../../../drive/calibration/failure-modes.md#f21) (build the surface the slice exists to deliver, not option-bag wrappers), [F24/F25](../../../../drive/calibration/failure-modes.md#f24-stale-dist-makes-a-red-gate-look-like-a-broken-base) (stale `dist` / "pre-existing failure" claims verified on pristine main).
- Grep gates: `projects/`-reference scrub in long-lived files ([grep-library § Cross-cutting](../../../../drive/calibration/grep-library.md#cross-cutting-anti-patterns)); per-dispatch greps named in briefs.
- Test-dispatch briefs carry the [dod.md § Test-dispatch brief overlay](../../../../drive/calibration/dod.md#test-dispatch-brief-overlay) acceptance criterion (test fails iff the claimed behaviour breaks; right surface).

## Dispatches

Phases from the project plan (P1 scaffold+space → P2 adapter → P3 example+docs) decompose into 8 dispatches. Model tier per [model-tier.md](../../../../drive/calibration/model-tier.md): design-bearing dispatches on orchestrator tier, pattern-following on mid tier.

### P1 — package scaffold + managed contract space (TML-2994)

1. **D1 `scaffold-and-contract-space`** — tier: orchestrator
   - **Outcome:** `@prisma-next/extension-better-auth` builds at `packages/3-extensions/better-auth/` with `/pack` + `/contract` subpaths; the managed contract space (contract.json + contract.d.ts + baseline migration + refs/head.json) defines the four models per slice spec, such that the aggregate contract of a consuming app exposes them as typed ORM collections with navigable relations (property: managed control — framework owns DDL; space verifies clean at head).
   - **Builds on:** none. **Hands to:** D2 (lifecycle proof), D3 (handles), D4+ (adapter compiles against `contract.d.ts`).
   - **Focus:** package scaffold (package.json/tsconfig/tsdown/biome per supabase precedent), contract space, pack descriptor, `architecture.config.json` registration. No handles, no adapter, no better-auth dep.
   - **Gates:** `pnpm build` (package), `pnpm typecheck`, `pnpm --filter @prisma-next/extension-better-auth lint`, `pnpm lint:deps`, `pnpm fixtures:check`.

2. **D2 `managed-space-lifecycle-test`** — tier: mid
   - **Outcome:** integration test proving the managed extension-space path: fresh PGlite → `contract emit` + `db init` creates `user`/`session`/`account`/`verification`; `db update` no-op at head. Test fails iff the space's migration/verification path breaks.
   - **Builds on:** D1. **Hands to:** D6 (`runMigrations` reuses this path).
   - **Gates:** `pnpm test:integration` (new file), `pnpm typecheck`.

3. **D3 `branded-contract-handles`** — tier: mid
   - **Outcome:** `/contract` ships `extensionModel`-branded handles (`User`, `Session`, `Account`, `Verification`) usable in app contracts for cross-space FKs (property: `rel.belongsTo(User, …)` lowers to a cross-space FK, per supabase `handles.ts` precedent). Type-level test included.
   - **Builds on:** D1. **Hands to:** D8 (example's `Profile → User` FK).
   - **Gates:** package tests + typecheck, `pnpm lint:deps`.

### P2 — contract-typed adapter + conformance (TML-2995)

4. **D4 `adapter-core-crud`** — tier: orchestrator
   - **Outcome:** `/adapter` ships `prismaNextAdapter(db)` via `createAdapterFactory` covering `create`/`findOne`/`findMany`/`update`/`updateMany`/`delete`/`deleteMany`/`count` with the exhaustively-typed model map and where-operator translation, such that unknown models/fields/operators fail fast with typed errors and no stringly-typed passthrough reaches SQL (property: contract-derived typing; casts policy honoured). `better-auth` peer+dev deps land here.
   - **Builds on:** D1. **Hands to:** D5, D6.
   - **Focus:** adapter + package-level unit tests (mapping exhaustiveness, where-translation, error surfaces). No consumeOne/transaction/join yet.
   - **Gates:** package tests + typecheck (incl. `tsconfig.test.json`), package lint, `pnpm lint:deps`.

5. **D5 `adapter-consume-transaction-join`** — tier: orchestrator
   - **Outcome:** native `consumeOne` (via `Collection.delete()`'s atomic DELETE…RETURNING), `transaction` config wired onto the runtime transaction API, and native `join` on `findOne`/`findMany` via `Collection.include()` over the space's navigable relations, such that the adapter never falls back to BetterAuth's separate-queries path for joins and two concurrent `consumeOne` calls can't consume the same row.
   - **Builds on:** D4. **Hands to:** D6.
   - **Gates:** package tests + typecheck; a concurrency unit test for `consumeOne` semantics.

6. **D6 `conformance-and-e2e-integration`** — tier: mid
   - **Outcome:** BetterAuth's official suite (`@better-auth/test-utils/adapter` `testAdapter`, incl. join coverage) green over PGlite in `pnpm test:integration`, with `runMigrations` using the framework migrate path (D2's mechanism, no manual SQL); plus an end-to-end `betterAuth()` email/password sign-up → session retrieval test. Tests fail iff adapter conformance or the real consumer path breaks. **Carry-over from D4:** `Where.mode: 'insensitive'` is currently rejected with a typed error (ORM has `like`, no `ilike`) — if the conformance suite exercises insensitive matching, resolve there (finding); if not, the typed rejection stands as the documented posture.
   - **Carry-over from D5:** reverse joins (`user → sessions`) fail typed — the space declares no backrelations. If the conformance suite's join coverage expects one-to-many joins, that is a contract-space finding (add the backrelation), not an adapter one.
      - **Builds on:** D2, D5. **Hands to:** D7 (example patterns proven).
   - **Gates:** `pnpm test:integration`, `pnpm typecheck`, workspace `pnpm test:packages` (regression sweep).

### P3 — example + docs close-out (TML-2996)

7. **D7 `example-app`** — tier: mid
   - **Outcome:** `examples/better-auth` runs end-to-end (emit → migration plan → db init → sign-up → authenticated request) per its README, with a `Profile` model carrying a cross-space FK onto the branded `User` handle; no manual SQL in the setup path. README documents the real three-step schema flow — `contract emit` → `migration plan` → `db init` — not the spec's shorthand (D2 finding: the seed phase lives in `migration plan`; `db init` rejects `declaredButUnmigrated`).
   - **Builds on:** D3, D6. **Hands to:** D8.
   - **Gates:** example's own test/run script green; `pnpm typecheck`; `pnpm lint:deps`.

8. **D8 `docs-and-close-out-prep`** — tier: mid
   - **Outcome:** package README; extension-authoring doc references name this package as the managed-space (DDL-shipping) precedent; ADR authored for the "stringly-typed third-party interface over contract-typed collections" pattern (operator judges durability at review); **ADR 212 amended to legitimize the `src/contract/` PSL-authored layout** (operator decision E1(b), 2026-07-10 — supabase precedent + `regen-extension-migrations.mjs` dual-layout support become the documented rule); grep gate clean (`projects/extension-better-auth` absent from long-lived files). **Carry-over from D7:** document the consumer architecture explicitly — the emitted aggregate does NOT fold pack domain models (pack models are cross-space references only; `db.orm.public.User` doesn't exist on the aggregate client; cross-space relations typed `never`), so adapter consumers run two typed views over one shared pool (aggregate `db` + space-contract `authDb` with `verifyMarker: false` and its documented reason). This shapes every consumer's architecture; package README + extension docs must state it plainly.
   - **Builds on:** D7. **Hands to:** PR-open (slice DoD walk).
   - **Gates:** `pnpm lint:rules:symlinks`-class doc checks n/a; grep gates; full always-run set.

## Open items

- `@better-auth/test-utils` + `better-auth` versions pinned at D4 time against the workspace's peer-dep policy (catalog vs direct semver) — implementer surfaces the choice if the repo has no precedent for third-party peer deps in extensions (`jose` in supabase is the nearest precedent).
- Whether `contract.prisma` (PSL) can express the space or the contract.json is hand-authored — implementer resolves at D1 against the supabase/pgvector precedents; either is acceptable per slice spec.

## Validation-gate summary (slice close)

Always-run: `pnpm typecheck`, per-package lint. Slice close: `pnpm test:packages`, `pnpm test:integration`, `pnpm lint:deps`, `pnpm fixtures:check`, `pnpm build`, merge/rebase `origin/main` + re-run always-run gates before PR-open (dod.md slice-close ritual).
