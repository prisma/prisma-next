# Dispatch plan — m1-scaffold-and-skeleton

Slice spec: [`spec.md`](spec.md) — the spec pins the package layout, the contract's models/columns, the `Profile` shape, the `db.ts` shape, and the gating. Dispatches below execute it; where a dispatch says "per spec," the concrete shape is there. 7 dispatches.

## Conventions for the build loop

- **Model tiers** (repo override — `CLAUDE.local` / drive model-tier memory): **sonnet-mid for every implementer dispatch; opus-high for the reviewer pass.**
- **Always-run gates** per dispatch: `pnpm --filter @prisma-next/extension-supabase typecheck` **and** `pnpm --filter @prisma-next/extension-supabase lint` (biome `--error-on-warnings` is a *separate* gate from typecheck). Typecheck must also cover the package's `test` project.
- **Conditional gates**: `pnpm lint:deps` (new package + import boundaries — **required**), `pnpm fixtures:check` (touches `packages/3-*-extensions/**` — **required**), `pnpm test:integration` (PGlite path — D5).
- **New-package obligation**: registering `packages/3-extensions/supabase/` in `architecture.config.json` (Domain→Layer→Plane) is part of D1, or `pnpm lint:deps` fails.
- **The external-handling proof is the centerpiece.** The example test migrates the composed contract against a shim-seeded DB and asserts the framework treats `auth.*`/`storage.*` as `external` — **no DDL emitted, verifier passes**. Mirror `test/integration/test/cli.control-policy.postgres.e2e.test.ts`. Confirmed mechanics: `external` → no DDL (`packages/2-sql/9-family/src/core/migrations/control-policy.ts`); a **missing** external table → verify **FAIL** (`packages/1-framework/1-core/framework-components/src/control/verifier-disposition.ts:41-62`) — which is *why* the shim must seed the tables.
- **Out of scope — do not build** (full rationale in spec § Alternatives): `/contract` handles, roles, the **roles + `auth.uid()`/`jwt()`/`role()` functions** of the shim, and the real `/runtime`. The **schemas + tables** increment of `bootstrapSupabaseShim` IS in scope (D5). A dispatch reaching for an out-of-scope item has drifted — halt.

## Dispatches

### Dispatch 1 — Package scaffold + build config + architecture registration

- **Outcome:** `packages/3-extensions/supabase/` exists per spec § A: `package.json` (`name: @prisma-next/extension-supabase`; `exports` = `./pack`, `./runtime`, `./package.json`; dep set modelled on `pgvector`, using the contract-psl `prismaContract` provider, not `typescriptContract`), `tsconfig.json`, `tsconfig.test.json`, `tsdown.config.ts` (entries `src/exports/{pack,runtime}.ts`), `biome.jsonc`, and `prisma-next.config.ts` wiring `prismaContract('src/contract/contract.prisma', { target: postgres, defaultControlPolicy: 'external' })`. `src/exports/pack.ts` re-exports `src/pack` (compiling placeholder); `src/exports/runtime.ts` is an empty stub. The package **builds**; `architecture.config.json` registers it; `pnpm lint:deps` green.
- **Builds on:** the spec + `packages/3-extensions/pgvector/` as the template.
- **Hands to:** a buildable skeleton whose `./pack` + `./runtime` subpaths resolve (runtime stubbed), layering registered.
- **Satisfies:** the scaffold/registration half of "`/pack` resolves; `lint:deps` green."

### Dispatch 2 — Author `contract.prisma` (PSL) + emit `contract.json` + `contract.d.ts`

- **Outcome:** `src/contract/contract.prisma` authored per the spec's pinned model table (`auth`: `AuthUser`, `AuthIdentity`; `storage`: `StorageBucket`, `StorageObject`; columns + `@@map`/`@map` exactly as pinned; no `realtime`/`extensions` per the spec's working decision; **no roles**). `prisma-next contract emit` produces `src/contract/contract.json` (`spaceId: 'supabase'`, `target: 'postgres'`, the namespaces + models, `defaultControl: 'external'` from the config option) and `src/contract/contract.d.ts`; `validateContract<Contract>(contractJson)` typechecks.
- **First task:** resolve [To confirm #1 + #2](spec.md#to-confirm-at-dispatch) — pin the `prismaContract` specifier + the emit output path; confirm omitting `realtime`/`extensions`.
- **Builds on:** D1's `prismaContract(...)` config wiring.
- **Hands to:** the emitted, validated `contract.json` + `contract.d.ts` consumed by `/pack` (D3) and the example (D4).
- **Satisfies:** "`contract.json` emits with `defaultControl: 'external'`; `contract.d.ts` validates."
- **Halt** if emitting needs new PSL grammar or a roles IR — out of scope, route to discussion.

### Dispatch 3 — `/pack` ExtensionPack value + `supabasePackWith`

- **Outcome:** `src/pack/index.ts` default-exports `supabasePack: ExtensionPack` carrying `contract.json` + `spaceId: 'supabase'`, plus `supabasePackWith(options: { contractOverride?: unknown })`. `/pack` resolves and typechecks; usable as `extensionPacks: [supabasePack]`.
- **Builds on:** D2's `contract.json`.
- **Hands to:** the `/pack` surface the example (D4) and the smoke test (D6) consume.
- **Satisfies:** the build half of "`/pack` resolves + typechecks."
- **Focus:** `/pack` must not transitively import runtime (budget verified in D6).

### Dispatch 4 — `examples/supabase` walking-skeleton app

- **Outcome:** `examples/supabase/` per spec § B: `prisma-next.config.ts` with `extensionPacks: [supabasePack]`; `src/contract.prisma` with the pinned `Profile { id, username }` model in `public` (emitted); `src/prisma/db.ts` on the **stock** `@prisma-next/postgres/runtime` (`postgres<Contract>({ contractJson })`, **no `extensions`**); one handler doing the insert + `public.profile` read-back. Package typechecks/builds.
- **Builds on:** D3's `/pack`.
- **Hands to:** a runnable example app (sans test) — the skeleton's starting state.
- **Satisfies:** "`examples/supabase` boots and runs a `public.*` query" (the app half).
- **Focus:** stock runtime only. No Supabase `/runtime`, FK, RLS, `auth.*` query, or shim.

### Dispatch 5 — Minimal `bootstrapSupabaseShim` (schemas + tables)

- **Outcome:** a `bootstrapSupabaseShim(client)` helper (mirroring `test/integration/test/postgres-bootstrap.ts`) that seeds **`CREATE SCHEMA auth, storage`** + the four tables (`auth.users`, `auth.identities`, `storage.buckets`, `storage.objects`) with columns matching the contract's pinned model table (so the verifier passes). **No roles, no `auth.uid()`/`jwt()`/`role()` functions.** Documented as the shared fixture's first increment (later constituents extend it). Location pinned per [spec To-confirm #3](spec.md#to-confirm-at-dispatch).
- **Builds on:** D2's contract (the seeded columns must match the modelled columns).
- **Hands to:** the seeding fixture D6's test consumes.
- **Satisfies:** the "external tables exist" precondition of the external-handling proof.
- **Halt** if tempted to add roles or `auth.*` functions — that's `postgres-rls`'s increment.

### Dispatch 6 — Example integration test: migrate/verify + round-trip + CI gating

- **Outcome:** one integration test, modelled on `cli.control-policy.postgres.e2e.test.ts`: (1) start PGlite, seed via `bootstrapSupabaseShim`; (2) run the framework migrate for the example's composed contract (`db init`/`db update`) and **assert** the plan emits DDL only for `public.profile`, **zero ops** against `auth.*`/`storage.*` (suppressed-subject warnings present), the verifier **passes**, and `public.profile` exists; (3) run the handler's `public.profile` insert + read, assert the row; (4) *(optional bonus)* a raw read of seeded `auth.users`. Committed `describe.skip`-ped with a TODO (ungates at M3); demonstrated green locally. `pnpm fixtures:check` green.
- **Builds on:** D4's app + D5's shim.
- **Hands to:** the gated end-to-end proof — external-handling + the `public` round-trip — the CI surface downstream lanes grow.
- **Satisfies:** "`auth.*`/`storage.*` get no DDL and verify-present; `public.profile` round-trip; example gated out of default CI."

### Dispatch 7 — `/pack` smoke test + `lint:deps` + bundle budget (slice close)

- **Outcome:** a smoke test proving `import supabasePack from '@prisma-next/extension-supabase/pack'` resolves + typechecks **from an app contract declaring `extensionPacks: [supabasePack]`**. `pnpm lint:deps` green (tree-shaking: `/pack` pulls no runtime). `/pack` bundle measured `< 5 KB` gzip.
- **Builds on:** D3 (surface under test) + D1's layering registration.
- **Hands to:** slice-DoD satisfied.
- **Satisfies:** "`/pack` resolves + typechecks (proven)"; "`/pack` < 5 KB gzip"; "`lint:deps` green."

## Hand-off completeness → slice-DoD

| Slice-DoD condition | Delivered by |
|---|---|
| `/pack` resolves + typechecks from an app contract | D1 + D3 (built), D7 (proven) |
| `contract.json` emits from PSL with `defaultControl: 'external'`; `contract.d.ts` validates | D2 |
| `auth.*`/`storage.*` get no DDL and verify-present (external handling) | D5 (shim) + D6 (migrate/verify asserts) |
| `examples/supabase` migrates `public` + runs the `public.profile` round-trip, gated out of CI | D4 (app) + D6 (test + gate) |
| `pnpm lint:deps` green; `/pack` < 5 KB gzip; `pnpm fixtures:check` green | D7 (+ D6 for fixtures) |

Linearity: D1→D2→D3→D4; D5 builds on D2; D6 builds on D4 + D5; D7 builds on D3 (+ D1).
