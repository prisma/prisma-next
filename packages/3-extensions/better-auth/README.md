# @prisma-next/extension-better-auth

[BetterAuth](https://www.better-auth.com) on Prisma Next: a managed contract space carrying BetterAuth's four core models, plus a fully typed BetterAuth database adapter over contract-typed collections. Auth data lives in the same database as the app, created by the same migration machinery, and read through the same typed ORM — no separate auth store, no schema drift.

Worked example: [`examples/better-auth`](../../../examples/better-auth/) — config, contract, server, and an integration test automating the whole story.

## Consuming it (read this first)

One client, one pool. The app constructs its `postgres()` client over its own emitted aggregate contract and hands the **same pool** to the adapter, which builds its space-scoped view internally:

```ts
import { prismaNextAdapter } from '@prisma-next/extension-better-auth/adapter';
import betterAuthRuntimeDescriptor from '@prisma-next/extension-better-auth/runtime';
import postgres from '@prisma-next/postgres/runtime';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: url });

// The app's client: the aggregate contract (your models). The aggregate
// records the pack requirement, so the runtime descriptor must be passed —
// without it, postgres() rejects the contract with "Contract requires
// extension pack(s) 'better-auth', but runtime descriptors do not
// provide matching component(s)."
const db = postgres<Contract>({
  contractJson, // your emitted aggregate
  pg: pool,
  extensions: [betterAuthRuntimeDescriptor],
});

// BetterAuth: the adapter takes the shared pool and constructs its own
// view over the pack's contract space internally. Pool only — the pool
// owner (your app) manages lifecycle.
const auth = betterAuth({
  database: prismaNextAdapter({ pg: pool }),
  emailAndPassword: { enabled: true },
});
```

### Why the adapter builds an internal view (background)

An app that lists the pack in its config gets an **aggregate contract** that records the pack's models as *cross-space references* — it does **not** fold them in as domain models:

- `db.orm.public.User` deliberately does not exist on the app's client; only the app's own models are collections there. Auth models are reached through BetterAuth's API.
- A cross-space relation (e.g. an app `Profile.user` pointing at the pack's `User`) is typed `never` in the emitted `contract.d.ts` — it is not `include()`-able. The FK it declares is still a real, enforced database constraint (cascade included); the type-level `never` is the framework telling you traversal across spaces is not part of the current query model.

The adapter therefore constructs a client over the pack's own space contract (typed collections for `User` / `Session` / `Account` / `Verification`) on your pool, with marker verification left to the app's client — the database marker names the aggregate, and the space view is a partial view of the same database. The structural `prismaNextAdapter(db)` form remains public for tests and advanced injection of a pre-built space client.

## Package surfaces

| Subpath | What it exports |
| --- | --- |
| `/pack` | The control-plane extension descriptor (default export `betterAuthPack`) carrying the managed contract space: contract JSON, one baseline migration, head ref. List it in `prisma-next.config.ts` — `extensions: [betterAuthPack]` with `defineConfig` from `@prisma-next/postgres/config` (as the example does), or `extensionPacks:` with the core `defineConfig`. |
| `/contract` | The space's `Contract` type and the four branded model handles (`User`, `Session`, `Account`, `Verification`). `User.refs.id` is a cross-space `TargetFieldRef` usable in app contracts: `rel.belongsTo(User, …)` + `constraints.foreignKey(cols.userId, User.refs.id, { onDelete: 'cascade' })`. |
| `/adapter` | `prismaNextAdapter({ pg })` (shared-pool form) / `prismaNextAdapter(db)` (structural form) — the BetterAuth database adapter — plus `PrismaNextAdapterError` and the model map. The only subpath that imports `better-auth` (a peer dependency), so apps that don't use the adapter never pull it in. |
| `/runtime` | `betterAuthRuntimeDescriptor` — the runtime-side pack component for `postgres({ extensions })`. Descriptor only (`codecs: () => []`); there is no wrapped client facade. |

## The contract space

Four models in the `public` namespace, mirroring BetterAuth's [core schema](https://www.better-auth.com/docs/concepts/database#core-schema): `User`, `Session`, `Account`, `Verification` over singular table names (`user`, `session`, `account`, `verification`). Text primary keys (BetterAuth generates string ids), timestamptz timestamps, uniques on `user.email` and `session.token`, and cascading FKs `session.userId → user.id` / `account.userId → user.id` (BetterAuth's canonical `ON DELETE CASCADE` semantics).

The space is **managed**: the framework owns these tables' DDL through the pack's shipped baseline migration. Consumers never write auth-table SQL.

### Schema flow in a consuming app

```bash
pnpm exec prisma-next contract emit            # 1. aggregate contract (your models + the pack's)
pnpm exec prisma-next migration plan --name …  # 2. plans your migrations, seeds migrations/better-auth/
pnpm exec prisma-next db init                  # 3. walks BOTH spaces to head — auth tables + yours
```

## The adapter

`prismaNextAdapter(db)` implements BetterAuth's adapter protocol on `createAdapterFactory`, routing every operation through the space's contract-typed collections.

- **Config posture is honest:** `adapterId: 'prisma-next'`, `supportsNumericIds: false` (the space's ids are text). `transaction` is real — the config opens `db.transaction(…)` and rebinds the adapter to the transaction scope's collections, so BetterAuth's multi-step flows (e.g. sign-up) are atomic with rollback.
- **Typed model surface:** `BETTER_AUTH_MODEL_BY_SPACE_MODEL` maps the space's models to BetterAuth's names, `as const satisfies Record<SpaceModelName, string>` — adding a model to the contract without a mapping (or vice versa) fails `pnpm typecheck`.
- **Fail-fast typed errors:** every rejection is a `PrismaNextAdapterError` with a code naming the offending surface — `UNKNOWN_MODEL` (plugin tables), `UNKNOWN_FIELD` (`additionalFields`), `UNSUPPORTED_OPERATOR`, `UNSUPPORTED_WHERE_MODE` (case-insensitive mode is not supported), `INVALID_OPERATOR_VALUE`, `UNKNOWN_JOIN_RELATION`. Schema-mutating BetterAuth surfaces are deliberate non-goals: the managed space is fixed.
- **Native capability mapping:** single-winner token consumption via the collection's atomic delete, and BetterAuth's `experimental.joins` served natively through `include()` on the space's declared relations (`User.session` / `User.account` backrelations for reverse joins; a join the contract cannot express fails fast with `UNKNOWN_JOIN_RELATION`).

## Development (this package)

`src/contract/contract.prisma` is the PSL source; `pnpm build:contract-space` re-emits `src/contract/contract.{json,d.ts}`; `prisma-next migration plan` regenerates the baseline migration under `migrations/` when the schema changes (storage-hash change), with `migrations/refs/head.json` pinning the head. The handle↔contract consistency test (`test/contract-handles.test.ts`) catches drift between `src/contract/handles.ts` and the emitted contract, per-column codec ids included.
