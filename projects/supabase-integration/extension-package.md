# `@prisma-next/extension-supabase` — the package itself

## Problem

The capabilities in the other notes ([control policy](../control-policy/spec.md), cross-contract refs, RLS) are mostly framework-domain. The Supabase extension is where they all land — the one place that ships:

- A `contract.json` describing Supabase's `auth`, `storage`, etc. schemas with `defaultControl: 'external'`.
- A runtime factory that knows how to bind a Supabase JWT to a Postgres session for RLS enforcement.
- Typed constants (role names, common claim accessors).
- An extension-pack descriptor for `prisma-next.config.ts`.

This is the user-visible npm package they install.

## Design intent

### Shape on disk

Subpath-only entrypoints per [`decisions.md` C6](decisions.md). Each subpath ships only what its name implies; no umbrella export from the package root.

```
@prisma-next/extension-supabase/
├── package.json                # exports field declares /pack, /contract, /runtime subpaths
├── src/
│   ├── pack/                   # → '@prisma-next/extension-supabase/pack'
│   │   └── index.ts            # ExtensionPack value (with optional factory wrapper for options)
│   ├── contract/               # → '@prisma-next/extension-supabase/contract'
│   │   ├── index.ts            # hand-authored typed authoring handles: `AuthUser`, `roles.anon`, …
│   │   ├── contract.json       # hand-authored, ~50 lines (the source-of-truth IR)
│   │   └── contract.d.ts       # emitted from contract.json (same pipeline as app contracts)
│   ├── runtime/                # → '@prisma-next/extension-supabase/runtime'
│   │   └── index.ts            # default-export `supabase({...})` factory + SupabaseRuntime class
│   └── schema.psl              # optional: PSL source the contract.json was emitted from (for human reading)
└── README.md
```

Tree-shaking discipline (C6): `/pack` must not transitively import runtime code; `/contract` must not transitively import SDK or runtime code. An app that only authors a contract pays for nothing else.

### The shipped contract

For v0.1, hand-authored. Sketch (abbreviated):

```jsonc
{
  "$schema": "https://prisma-next.io/contract.schema.json",
  "spaceId": "supabase",
  "target": "postgres",
  "defaultControl": "external",
  "namespaces": ["auth", "storage", "realtime", "extensions"],
  "models": {
    "AuthUser": {
      "namespace": "auth",
      "tableName": "users",
      "fields": {
        "id":         { "type": "uuid",        "primary": true },
        "email":      { "type": "text" },
        "createdAt":  { "type": "timestamptz", "columnName": "created_at" },
        "updatedAt":  { "type": "timestamptz", "columnName": "updated_at" }
      }
    },
    "AuthIdentity":  { /* … */ },
    "StorageBucket": { /* … */ },
    "StorageObject": { /* … */ }
    /* … */
  }
}
```

Notes:
- `spaceId: 'supabase'` is the contract-space identifier the aggregate uses for resolution.
- `defaultControl: 'external'` is the contract-level default; each model inherits it. Per-model overrides allowed (we likely won't need any in v0.1). See [`projects/control-policy/spec.md`](../control-policy/spec.md) for the framework primitive.
- We don't model every column of `auth.users` — only the columns app code is likely to reference (`id`, `email`, timestamps). The verifier under `control: 'external'` tolerates extra columns, so we can ship a minimal slice and grow it as user needs surface.
- `contract.d.ts` is emitted from `contract.json` via the same pipeline used for app contracts (no special path for extensions).

### Public API surface

Three subpaths, three concerns. None of them is the package root — `import 'something' from '@prisma-next/extension-supabase'` deliberately resolves nothing.

#### `/pack` — extension-pack descriptor (consumed by `prisma-next.config.ts`)

```ts
// @prisma-next/extension-supabase/pack
import type { ExtensionPack } from '@prisma-next/config';

export interface SupabaseOptions {
  /** Override the contract.json shipped in this package (e.g., to add custom auth.* tables). */
  contractOverride?: unknown;
  // … other knobs as we discover need
}

/** No-options form: value-imported. */
declare const supabasePack: ExtensionPack;
export default supabasePack;

/** With-options form: factory invoked at config time. */
export function supabasePackWith(options: SupabaseOptions): ExtensionPack;
```

Usage:

```ts
// prisma-next.config.ts
import supabasePack from '@prisma-next/extension-supabase/pack';

export default {
  extensionPacks: [supabasePack],   // value form
  // or: extensionPacks: [supabasePackWith({ contractOverride })],
};
```

#### `/contract` — typed authoring handles (consumed by `contract.ts`)

Pre-built typed handles for every model + role the extension ships. Hand-written for v0.1 (extension authors write this submodule themselves); emitter-generated as a roadmap item ([C7](decisions.md)).

```ts
// @prisma-next/extension-supabase/contract
import type { ModelHandle, RoleRef } from '@prisma-next/contract-core/authoring';

export const AuthUser: ModelHandle<'supabase', { id: string; email: string; /* … */ }>;
export const AuthIdentity: ModelHandle<'supabase', { /* … */ }>;
export const StorageBucket: ModelHandle<'supabase', { /* … */ }>;
// …

export const roles: {
  authenticated: RoleRef<'supabase'>;
  anon:          RoleRef<'supabase'>;
  serviceRole:   RoleRef<'supabase'>;
};
```

Usage:

```ts
// app/contract.ts
import { AuthUser, roles as supabaseRoles } from '@prisma-next/extension-supabase/contract';

const Profile = model('Profile', { /* fields */ })
  .relations({ user: rel.belongsTo(AuthUser, { from: 'userId', to: 'id' }) })
  .sql(({ cols, constraints }) => ({
    foreignKeys: [
      constraints.foreignKey(cols.userId, AuthUser.refs.id, { onDelete: 'cascade' }),
    ],
  }))
  .rls([
    { name: 'profiles_select', operation: 'select', roles: [supabaseRoles.anon], using: 'true' },
  ]);
```

The handles are branded by `spaceId: 'supabase'`. Cross-contract refs are detected at the call site by handle brand — no separate `refIn` method, no consumer-side mapped-type machinery. ([C5, C6, C7](decisions.md), closes [`example/design-holes.md` #17](example/design-holes.md).)

#### `/runtime` — the `SupabaseRuntime` factory

See the next section.

### Runtime facade

One factory, one returned object. The user never touches the underlying Postgres runtime — the facade *is* one (via subclass; see [`decisions.md` C12](decisions.md)).

```ts
// @prisma-next/extension-supabase/runtime
import type { Db, PoolOptions } from '@prisma-next/postgres/runtime';
import type { SqlMiddleware } from '@prisma-next/sql-runtime';

export interface SupabaseRuntimeOptions {
  contractJson: unknown;
  url: string;
  /** Supabase project's JWT signing secret. Required if you call asUser() with a JWKS-validated key. */
  jwtSecret?: string;
  /** Alternative to jwtSecret: a JWKS endpoint to fetch the signing key from. Warmed up at factory time. */
  jwksUrl?: string;
  /** Pool knobs forwarded to the underlying Postgres runtime. */
  pool?: PoolOptions;
  /** User middleware. Forwarded to the underlying Postgres runtime constructor. SET LOCAL is NOT visible to these — see "Why `SET LOCAL` is below middleware" below. */
  middleware?: readonly SqlMiddleware[];
}

export interface SupabaseDb<TContract, TTypeMaps> {
  /** Bind the connection to the `authenticated` role with the user's JWT claims. */
  asUser(jwt: string): RoleBoundDb<TContract, TTypeMaps>;
  /** Bind the connection to the `anon` role. */
  asAnon(): RoleBoundDb<TContract, TTypeMaps>;
  /** Bind the connection to the `service_role` (bypasses RLS). */
  asServiceRole(): RoleBoundDb<TContract, TTypeMaps>;
}

export interface RoleBoundDb<TContract, TTypeMaps> extends Db<TContract, TTypeMaps> {
  /**
   * Run multiple statements under a single transaction with `SET LOCAL` issued once at transaction open.
   * The `tx` handle is itself a role-bound Db pinned to one connection across the closure.
   */
  transaction<R>(
    fn: (tx: RoleBoundDb<TContract, TTypeMaps>) => Promise<R>,
  ): Promise<R>;
}

export default function supabase<TContract, TTypeMaps>(
  options: SupabaseRuntimeOptions,
): Promise<SupabaseDb<TContract, TTypeMaps>>;
```

#### Why the factory is async

`supabase({...})` is uniformly `Promise<SupabaseDb>`. The async signature accommodates the JWKS-warmup path (`jwksUrl` requires an HTTP fetch on initialization) without splitting the API into sync-when-`jwtSecret` / async-when-`jwksUrl`. JWT validation on `asUser(jwt)` is then **eager and synchronous** — the signing key is already in hand when `asUser` runs, and a malformed / expired / mis-signed JWT throws a typed `InvalidJwtError` *before* any connection is acquired. (Design hole #13.)

#### Why `SET LOCAL` is below the middleware chain (security, not policy)

Two design points worth being explicit about:

- **`SupabaseDb` is not a `Db`.** It does not extend `Db`; there's no `db.sql.from(...)` at the top level. A user must pick a role before they can build a query. In a Supabase app there's no meaningful "no role" execution context — the alternative (defaulting to whatever Postgres role the connection authenticated as, typically a privileged one) is exactly the silent-RLS-bypass footgun the design is trying to make impossible.
- **No `serviceRoleKey` option.** Supabase's `service_role` *key* is a JWT identity used by the `@supabase/supabase-js` client to authenticate to PostgREST as service_role. We're below PostgREST — connecting directly to Postgres with a privileged URL, the runtime just emits `SET LOCAL role = 'service_role'`. The only Supabase-issued secret we need is `jwtSecret` (or `jwksUrl`) to validate *user* JWTs.

`SET LOCAL role = '...'` and `SET LOCAL request.jwt.claims = '...'` are issued by `SupabaseRuntime.execute()` (the subclass override) — **below** the user-middleware chain, against the raw `RuntimeConnection` returned by the base runtime's `connection()`. User middleware never sees the SET LOCAL statements:

- **Telemetry/log middleware** observes the user-issued logical query, not the role-binding plumbing.
- **Lint/budget middleware** evaluates against the logical query — no risk of `BEGIN` / `SET LOCAL` showing up in query counts or budget checks.
- **A custom middleware cannot prevent the role binding from happening.** This matters: the user *cannot* configure away their RLS enforcement by accident or by misconfigured middleware. The role binding is structural, not policy.

This is security-by-architecture: the only way to bypass `SET LOCAL role` on a `SupabaseRuntime` is to subclass `SupabaseRuntime` itself, which is an obvious red-flag in code review. (Design holes #7, #8.)

#### Implicit transaction

`SET LOCAL` requires an open transaction — without one, the SET has session scope and survives into the next pool checkout (the RLS-bypass footgun the design exists to eliminate). The subclass therefore always wraps role-bound work in a transaction:

- **Single-statement call** (`db.asUser(jwt).sql.from(...)...build()` executed via the runtime's `execute()`): wrapped in `BEGIN; SET LOCAL role; SET LOCAL request.jwt.claims; <query>; COMMIT;` — one implicit transaction per execute.
- **Multi-statement transaction** (`db.asUser(jwt).transaction(async (tx) => { ... })`): one `BEGIN; SET LOCAL …;`, the closure body runs against `tx` (pinned to the same connection), then `COMMIT` / `ROLLBACK` on closure exit.

`SET LOCAL` never outlives its transaction; transaction commit/rollback resets it before the connection returns to the pool. (Design hole #14, #11.)

#### How the subclass hierarchy is wired

```
abstract class RuntimeCore<…>                         // framework-components (already exported)
   ↑
class SqlRuntime extends RuntimeCore<…>               // sql-runtime (NEW: was internal `SqlRuntimeImpl`, now exported and renamed)
   ↑
class PostgresRuntime extends SqlRuntime              // @prisma-next/postgres/runtime (NEW: thin subclass)
   ↑
class SupabaseRuntime extends PostgresRuntime         // @prisma-next/extension-supabase/runtime (NEW: override execute() / transaction())
```

The cost in the postgres + sql-runtime packages: one rename (`SqlRuntimeImpl` → `SqlRuntime`) + one export + one new near-empty `class PostgresRuntime` + `postgres()` factory updated to instantiate `PostgresRuntime`. Roughly 50 LOC. `PostgresRuntime` is initially identity-like — its purpose is to *exist* as the target-layer extension point so any future Postgres-specific runtime behaviour (`COPY`, `LISTEN`/`NOTIFY`, prepared-statement caching) lands there and flows transparently into `SupabaseRuntime` without further refactor. Detailed rationale in [`specs/adr-runtime-target-layer.md`](specs/adr-runtime-target-layer.md).

### Pool considerations

RLS + connection pooling has a known footgun: if you `SET ROLE` and don't reset it, the next pool checkout inherits the role. The design eliminates this by construction:

- **Always `SET LOCAL`, never bare `SET`.** Transaction-scoped, automatic reset at COMMIT/ROLLBACK.
- **Always in a transaction.** The subclass `execute()` override guarantees this; no execute path on a `SupabaseRuntime` runs outside a transaction.
- **Document the pool requirements** (must reset session state between checkouts) for users running a custom pool — this is a defense-in-depth note, not the primary mitigation.

### Extension pack descriptor

The `ExtensionPack` interface (defined by `@prisma-next/config` — likely already exists from TML-2459's contract spaces work) carries:

- The extension's contract source (a contract.json bundled with the package).
- The extension's `spaceId`.
- Optional: target-specific behaviour the framework should install (planner hooks, verifier hooks, etc.). For Supabase v0.1, none of these are needed — the framework's control-policy dispatch + RLS support handles everything.

Loading happens at `prisma-next` CLI invocation time. The pack contributes its contract to the aggregate; the aggregate is what verifier/planner/runtime see.

## Open questions

- **What about Supabase storage?** The `storage.*` tables exist but app code rarely references them directly. We declare them in the shipped contract with `control: 'external'` and don't add any custom DSL for them. If user feedback pushes towards "ergonomic storage uploads," that's a future iteration.
- **Migration path for a user already running Supabase migrations.** They probably have hand-rolled `auth.*` modifications, custom roles, custom policies. The "adopt existing schema" workflow is broader than this project; cross-link to [`developer-experience.md`](developer-experience.md).
- **Custom auth schemas.** Some Supabase users extend `auth.*` with extra columns or tables. `contractOverride` is the v0.1 escape hatch; an introspection-based emit is the future polish.
- **Multi-extension stacking.** The Supabase runtime is itself an extension (a `PostgresRuntime` subclass). Apps that want to compose **additional** runtime-layer behaviour beyond Supabase (telemetry, query caching, custom retry policies) reach for the `middleware` option — that's the supported escape hatch for cross-cutting concerns. Apps that need *another* target-layer subclass on top of Supabase (rare) fall back to the lower-level `postgres()` factory and lose the `asUser`/`asAnon`/`asServiceRole` ergonomics. Working assumption: **middleware covers 95% of stacking needs; document the fallback for the 5% case.**
