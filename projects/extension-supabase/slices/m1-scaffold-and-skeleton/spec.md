# Slice: m1-scaffold-and-skeleton

_In-project slice of `projects/extension-supabase/`. M1 — the keystone of the Supabase integration: it stands up the walking skeleton every later constituent grows into._

## Decision

Build exactly two things:

1. **The package `@prisma-next/extension-supabase`** at `packages/3-extensions/supabase/`, modelled on `packages/3-extensions/pgvector/`. It exports **`/pack`** (a real `ExtensionPack` value) and **`/runtime`** (an empty stub, filled in M2). It carries a **PSL-authored** Supabase contract describing the `auth` and `storage` namespaces, emitted to `contract.json` + `contract.d.ts` with `defaultControl: 'external'`.
2. **The example app `examples/supabase`** — a runnable Prisma Next app that composes the Supabase contract (`extensionPacks: [supabasePack]`), defines a `Profile` model in `public`, **migrates against a database pre-seeded with the external `auth.*`/`storage.*` tables**, and runs a `public.profile` round-trip on the **stock** `@prisma-next/postgres/runtime`. This is the *walking skeleton*, and it proves the package's core claim end-to-end: the framework treats the Supabase tables as `external` — emits **no DDL** for them and **verifies they exist** — while the app's own `public` schema migrates and queries normally.

To make that proof real, M1 also ships a **minimal `bootstrapSupabaseShim`** — `CREATE SCHEMA auth, storage` + the four tables, matching the contract — because the verifier **fails on a missing `external` table** (`verifier-disposition.ts:41-62`), so a migrate of the composed contract requires those tables present. This is the *first increment* of the shared fixture (C14); the **roles + `auth.uid()`/`jwt()`/`role()` functions** stay out (they serve RLS/role-binding, which M1 doesn't touch).

Otherwise out of scope, each landing with its consumer: the `/contract` typed handles, the roles+functions part of the shim, and the Supabase runtime. Rationale is collected under [Alternatives considered](#alternatives-considered).

## What we build

### A. The package `@prisma-next/extension-supabase`

```
packages/3-extensions/supabase/
├── package.json            # exports: "./pack", "./runtime", "./package.json"  (no "./contract")
├── tsdown.config.ts        # entry: src/exports/{pack,runtime}.ts
├── tsconfig.json / tsconfig.test.json
├── biome.jsonc             # extends "//"
├── prisma-next.config.ts   # prismaContract('src/contract/contract.prisma', { target: postgres, defaultControlPolicy: 'external' })
├── src/
│   ├── contract/
│   │   ├── contract.prisma # PSL source of truth (hand-written)
│   │   ├── contract.json   # emitted by `prisma-next contract emit`
│   │   └── contract.d.ts   # emitted
│   ├── pack/index.ts       # supabasePack (default) + supabasePackWith()
│   └── exports/
│       ├── pack.ts         # re-exports src/pack
│       └── runtime.ts      # empty stub (M2)
└── test/                   # /pack resolution + typecheck smoke test
```

**The contract.** Authored in PSL at `src/contract/contract.prisma`; `prisma-next contract emit` produces `contract.json` + `contract.d.ts` (same pipeline as `examples/retail-store/src/contract.prisma`). `defaultControl: 'external'` is supplied by the **config option**, not a PSL attribute: `prismaContract('src/contract/contract.prisma', { target: postgres, defaultControlPolicy: 'external' })`.

Pinned models. Columns are intentionally a minimal subset: under `external` control the verifier tolerates the real tables' extra columns, so we model only the columns the integration will reference. Wire names are snake_case via `@@map`/`@map`.

| Namespace | Model (table) | Columns (modelled) |
|---|---|---|
| `auth` | `AuthUser` (`auth.users`) | `id` uuid `@id`, `email`, `created_at`, `updated_at` |
| `auth` | `AuthIdentity` (`auth.identities`) | `id` uuid `@id`, `user_id` uuid, `provider`, `created_at`, `updated_at` |
| `storage` | `StorageBucket` (`storage.buckets`) | `id` text `@id`, `name`, `created_at`, `updated_at` |
| `storage` | `StorageObject` (`storage.objects`) | `id` uuid `@id`, `bucket_id` text, `name`, `created_at`, `updated_at` |

- **No roles.** Roles are not representable (no `PostgresRole` IR) — they are not in this contract. See Alternatives.
- **Only `auth` + `storage` namespaces.** `realtime`/`extensions` are **omitted in M1** — they would be empty (no models), and we declare a namespace when a model needs it. (Confirm at dispatch — see [To confirm](#to-confirm-at-dispatch).)

**`/pack`.** `src/pack/index.ts` default-exports `supabasePack: ExtensionPack` carrying the emitted `contract.json` + `spaceId: 'supabase'`, plus `supabasePackWith(options: { contractOverride?: unknown })`. Constraint: `/pack` must not transitively import runtime code (tree-shaking discipline, decision C6). Like pgvector, the pack ships a **zero-ops baseline migration** under `migrations/` so the migration aggregate loader can load its contract space — but it creates **no DDL** (the `auth.*`/`storage.*` tables are external, Supabase-managed; the baseline only establishes the head ref). _(Discovered at D6, 2026-06-05: D3's `migrations: []` pack couldn't be loaded by the migrate flow; pgvector ships migrations, so this aligns the pack with the canonical pattern the spec already mandated.)_

**`/runtime`.** `src/exports/runtime.ts` is a **minimal runtime descriptor** (no codec types, no query operations) — just enough that the stock postgres runtime's check "every composed `extensionPacks` entry has a matching runtime component" (`sql-context.ts`) passes when the example composes the pack. It is **not** the real `SupabaseRuntime` (no `asUser()`/`asAnon()` role-binding) — that is still M2. _(Discovered at D6: a `never` stub fails the runtime's pack-requirements check; pgvector ships a runtime export, so a minimal descriptor is the canonical shape.)_ There is **no `/contract` export** in M1.

### B. The example app `examples/supabase`

**Purpose.** The walking skeleton. It proves three seams end-to-end: (1) an app composes the Supabase contract via `extensionPacks` and **migrates correctly** — the planner emits no DDL for the `external` `auth.*`/`storage.*` tables and the verifier confirms they exist; (2) the app's own `public` schema migrates and the `public.profile` round-trip runs on the stock runtime; (3) all against a real (PGlite) database. Every later constituent grows *this* app.

**The Supabase tables are verified, not queried, in M1 — this is intentional.** The app declares `extensionPacks: [supabasePack]`, so `auth.*`/`storage.*` enter the app's emitted contract. M1 code never *queries* them, but the migrate **does exercise them**: the framework must recognise them as `external` (skip DDL) and confirm they exist (verify). That is the package's core claim, and it is what this skeleton proves. Each later feature then plugs in here — a FK to `auth.users`, RLS policies, an `auth.*` query.

```
examples/supabase/
├── prisma-next.config.ts   # extensionPacks: [supabasePack]
├── src/
│   ├── contract.prisma     # the app's own contract — a Profile model in `public`
│   ├── contract.json / .d.ts   # emitted
│   ├── prisma/db.ts        # client on the STOCK @prisma-next/postgres/runtime
│   └── handlers.ts         # one handler: write + read public.profile
└── test/                   # one hermetic PGlite integration test (active in CI)
```

**App contract (PSL):**

```prisma
namespace public {
  model Profile {
    id       String @id @default(uuid())
    username String
    @@map("profile")
  }
}
```

**Client (`src/prisma/db.ts`).** Built on the **stock** runtime — `postgres<Contract>({ contractJson })`, with **no `extensions` array** (the Supabase pack is consumed at contract/authoring time via `extensionPacks` in the config, *not* as a runtime extension; the `/runtime` subpath is a stub in M1). Connect via `db.connect({ url })`. Shape per `examples/paradedb-demo/src/prisma/db.ts`.

**Behaviour.** One handler that inserts a `Profile` and reads it back with a `public.profile` select. That single round-trip is the skeleton's "walk."

**The shared fixture — minimal `bootstrapSupabaseShim(client)`.** Mirrors `test/integration/test/postgres-bootstrap.ts`. M1's increment seeds **only**: `CREATE SCHEMA auth, storage` and the four tables (`auth.users`, `auth.identities`, `storage.buckets`, `storage.objects`) with columns matching the contract — **no roles, no `auth.uid()`/`jwt()`/`role()` functions**. It is the shared fixture later constituents extend (`postgres-rls` adds roles + functions; `cross-contract-refs` FKs into the already-seeded `auth.users`). Pin its on-disk home at dispatch (see [To confirm](#to-confirm-at-dispatch)).

**Test + gating.** One hermetic integration test, modelled on `test/integration/test/cli.control-policy.postgres.e2e.test.ts` (which pre-seeds an `external` table, runs `db init`, and asserts no DDL touched it + verify passes):
1. Start PGlite; seed the external tables via `bootstrapSupabaseShim`.
2. Run the framework migrate for the example's composed contract (`db init` / `db update`, per the control-policy e2e pattern). **Assert:** the plan emits DDL only for `public.profile` and **zero ops** against `auth.*`/`storage.*` (suppressed-subject warnings present); the verifier **passes** (external tables confirmed present); `public.profile` now exists.
3. Run the handler's `public.profile` insert + read; assert the row.
4. *(Optional bonus)* a raw read of the seeded `auth.users` to prove the external table is reachable. The ergonomic typed path (`db.sql.auth.users`) waits for `explicit-namespace-dsl` — do not depend on it.

The suite **runs in CI** (`test:examples` covers `examples/**`, and the example has a `test` script). It asserts the M1 walking-skeleton behaviour only (external-contract migrate/verify + the `public.profile` round-trip), which is green and stable; later constituents extend its assertions in place. _(Originally drafted as committed `.skip` "until green at M3"; once the proof was green the skip was removed — a skipped green test guards nothing, which defeats the walking skeleton's reason to exist as a continuous CI surface.)_

**What grows here later (context, not M1 work).** `cross-contract-refs` adds `Profile.userId` + a FK to `auth.users` (and seeds `auth.users` in the test); `postgres-rls` adds RLS policies + roles + `auth.uid()`; `explicit-namespace-dsl` adds a handler that queries `auth.users`; `extension-supabase` M2 swaps `db.ts` to the Supabase `/runtime` with `asUser()`/`asAnon()`.

## Requirements this design satisfies

| Design element | Slice-DoD condition it satisfies |
|---|---|
| Package scaffold + `/pack` export + `architecture.config.json` registration | `/pack` resolves + typechecks from an app contract; `pnpm lint:deps` green |
| PSL `contract.prisma` + emit | `contract.json` emits carrying `defaultControl: 'external'`; `contract.d.ts` validates |
| Minimal `bootstrapSupabaseShim` + the migrate/verify assertions | the framework treats `auth.*`/`storage.*` as `external` — no DDL emitted, verifier confirms them present |
| Example app contract + client + handler | `examples/supabase` migrates its `public` schema and runs a `public.profile` round-trip |
| The integration test runs in CI (`test:examples`) | the walking skeleton is a live regression surface for downstream constituents |
| Tree-shaking discipline + bundle measurement | `/pack` < 5 KB gzip; `/pack` imports no runtime code |

## Scope

**In:** the package (scaffold, PSL contract + emit, `/pack`, stub `/runtime`); the **minimal `bootstrapSupabaseShim`** (schemas + four tables); the example app (config, `Profile` contract, `db.ts`, handler); the gated migrate/verify + `public.profile` round-trip integration test; the `/pack` smoke test; and the `lint:deps` / `fixtures:check` / bundle gates — all as pinned above.

**Out** (each lands with its consumer; full reasoning in [Alternatives](#alternatives-considered) and `decisions.md`):
- `/contract` subpath, `ModelHandle`/`RoleRef` handles, roles → `cross-contract-refs` / `postgres-rls`.
- The **roles + `auth.uid()`/`jwt()`/`role()` functions** of the shim → `postgres-rls`. (M1 ships only the schemas + tables increment — the part the verifier needs.)
- Real `/runtime` → M2.
- Cross-contract FK, RLS policies, explicit `auth.*` queries → their respective constituents.

## Contract-impact

A **new, package-local** contract authored in PSL, emitted to `contract.json` + `contract.d.ts`. **No new PSL grammar** — it uses existing `namespace { … }` blocks and the landed `prismaContract({ defaultControlPolicy })` option. No `roles` in the emitted contract (no `PostgresRole` IR).

**One enabling framework change (operator decision, 2026-06-05).** The Supabase contract is multi-namespace (`auth` + `storage`), and the emitter's `assert-single-domain-namespace-for-emission.ts` currently **throws** on >1 domain namespace, so `prisma-next contract emit` produces nothing. That assert is purely defensive — the `.d.ts` generation flattens namespaces and would let the first bare name win on a collision, so it fails loudly rather than silently dropping. We **relax it now** so multi-namespace contracts emit (flatten the `.d.ts` model map, first-bare-name-wins); our skeleton has no colliding bare names, so the degradation is harmless, and `contract.json` carries every namespace correctly regardless. The proper per-namespace `.d.ts` redesign stays `explicit-namespace-dsl`'s (PR 720 / TML-2816 — multi-namespace `contract.json` emit is its AC6; the `.d.ts` redesign is its declared non-goal). **Single-namespace emission must stay byte-identical** (`fixtures:check` green). This is the slice's only shared-framework change; it ships as its own commit.

## Adapter-impact

**Postgres only** (`target: 'postgres'`). **No adapter code changes** — consumes the existing `@prisma-next/adapter-postgres` + control-policy planner dispatch. `pg_roles`/RLS verifier behaviour is out (lands with `postgres-rls`).

## Done conditions

- [ ] `/pack` resolves and typechecks when imported from an app contract declaring `extensionPacks: [supabasePack]`.
- [ ] `contract.prisma` emits a `contract.json` + `contract.d.ts`; `defaultControl: 'external'` is carried; `validateContract<Contract>` typechecks; no `roles` block.
- [ ] Against a `bootstrapSupabaseShim`-seeded PGlite DB, the migrate of the composed example contract emits **no DDL** for `auth.*`/`storage.*` (suppressed-subject warnings only) and the verifier **passes**; `public.profile` is created and the handler's round-trip returns its row.
- [ ] The integration test **runs in CI** (`test:examples`) and is green (the M1 external-contract + `public.*` proof).
- [ ] `pnpm lint:deps` green; `/pack` < 5 KB gzip; `pnpm fixtures:check` green.

## Pre-investigated edge cases

| Edge case | Disposition |
|---|---|
| `cipherstash` (referenced by older drafts) no longer exists | Model on `pgvector`. |
| An intentionally-WIP example redding CI | The M1 assertions are green, so the suite runs in CI. A future constituent that adds not-yet-green assertions gates *its own* additions, not the whole suite — so the M1 regression surface stays live. |
| `/pack` accidentally pulling in runtime code | Keep `src/exports/pack.ts`'s import graph clean; verify with `lint:deps` + the < 5 KB budget. |

## To confirm at dispatch

1. **`prismaContract` import specifier.** PSL emit is proven by `examples/retail-store`; pin the exact `prismaContract` specifier for a Postgres/SQL package (contract-psl provider — likely via `@prisma-next/postgres/config` or a sql-contract-psl `config-types` entry) and confirm the `contract.prisma` → `contract.json` output path. (Dispatch 2.)
2. **`realtime`/`extensions` namespaces.** Working decision: **omit** them in M1 (no models → nothing to declare). Confirm this is acceptable vs. declaring them empty as forward-looking markers. (Dispatch 2.)
3. **`bootstrapSupabaseShim` location + the migrate command.** Pin where the shim lives so both `examples/supabase`'s test and future constituents import it (working position: alongside `test/integration/test/postgres-bootstrap.ts`, or a small exported test util), and which CLI flow the test drives to migrate the composed contract (`db init` vs `db update` — mirror `cli.control-policy.postgres.e2e.test.ts`). (Dispatch 5/6.)

## Alternatives considered

- **Hand-write `contract.json`, or author via a TS `contract.ts` builder.** Rejected: multi-namespace + the intended Supabase DX are awkward or unexpressible in the TS builder, and hand-written JSON skips emit-time validation. PSL produces both artifacts through the proven pipeline and matches how a Supabase user authors.
- **Ship the `/contract` typed handles (`ModelHandle`/`RoleRef`) + roles in M1.** Rejected — not just early, but likely the wrong abstraction: it reinvents contract access (you reach a contract's models/roles through the composed contract you initialise the builder/ORM with, and via the PSL `supabase:auth.User` grammar — not a hand-shipped per-model/role constant). Defining cross-space references and roles is `cross-contract-refs`'/`postgres-rls`' job. Full rationale: `decisions.md` C5 (re-examined 2026-06-05).
- **Author the *full* `bootstrapSupabaseShim` (roles + `auth.uid()`/`jwt()`/`role()` functions) up front.** Rejected for the roles+functions part: M1 touches no RLS or role-binding, so those have no consumer and `postgres-rls` adds them. But the **schemas + tables** part is *not* deferred — the verifier fails on a missing `external` table (`verifier-disposition.ts:41-62`), so proving the package's core claim (the framework treats `auth.*` as external) requires them present. M1 ships that increment; the shim grows from there. `decisions.md` C14.
- **Skip the migrate/verify and just hand-create `public.profile`, query it (no shim).** Rejected — it sidesteps the verifier entirely and proves nothing about how the framework handles the `external` Supabase contract, which is the package's whole reason to exist. The stock runtime's `.connect()` doesn't verify (opt-in `verifyMarker`), so that path would pass *regardless* of whether `external` is honoured. The migrate path is what exercises it.
- **Build the real `/runtime` in M1.** Deferred to M2 — the skeleton runs on the stock runtime; role binding is not needed to walk.
- **Declare `realtime`/`extensions` as empty namespaces now.** Omitted — a namespace with no models is noise; declared when a model needs it.

## References

- Parent project: [`projects/extension-supabase/spec.md`](../../spec.md), [`plan.md`](../../plan.md) § M1.
- Umbrella decisions: [`decisions.md`](../../../supabase-integration/decisions.md) C5 / C6 / C13 / C14; [README](../../../supabase-integration/README.md) § "Walking skeleton".
- Linear: [TML-2834](https://linear.app/prisma-company/issue/TML-2834).
- Reference code: `packages/3-extensions/pgvector/` (package layout), `examples/retail-store/src/contract.prisma` (PSL authoring), `examples/paradedb-demo/src/prisma/db.ts` (`db.ts` shape), `test/integration/test/postgres-bootstrap.ts` (bootstrap-helper pattern to mirror for `bootstrapSupabaseShim`), `test/integration/test/cli.control-policy.postgres.e2e.test.ts` (the canonical "seed an external table → `db init` → assert no DDL + verify passes" pattern this slice's test follows).
- Control-policy mechanics confirmed in: `packages/2-sql/9-family/src/core/migrations/control-policy.ts` (`external` → no DDL), `packages/1-framework/1-core/framework-components/src/control/verifier-disposition.ts:41-62` (missing external table → fail; extras suppressed).
- ADRs: ADR 212 (Contract spaces), ADR 224 (Control Policy dispatch).
