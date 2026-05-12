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

```
@prisma-next/extension-supabase/
├── package.json
├── src/
│   ├── index.ts                # the `supabase` namespace export (contract helper, role consts, pack factory)
│   ├── runtime.ts              # the supabase() runtime facade factory
│   ├── pack.ts                 # extension pack descriptor
│   └── roles.ts                # role constants
├── contract/
│   ├── contract.json           # hand-authored, ~50 lines
│   ├── contract.d.ts           # emitted from contract.json (same pipeline as app contracts)
│   └── schema.psl              # optional: a PSL source the contract.json was emitted from (for human reading)
└── README.md
```

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

```ts
// @prisma-next/extension-supabase
import type { ExtensionPack } from '@prisma-next/config';
import type { TypedContract } from '@prisma-next/contract-core';

export interface SupabaseOptions {
  /** Override the contract.json shipped in this package (e.g., to add custom auth.* tables). */
  contractOverride?: unknown;
  // … other knobs as we discover need
}

export const supabase = {
  /** Extension-pack factory. Used in prisma-next.config.ts → extensionPacks. */
  pack: (options?: SupabaseOptions): ExtensionPack => { /* … */ },

  /**
   * Wrap an imported contract.json with its typed shape. Returns a typed handle
   * exposing `.models.<Name>.refs.<field>` accessors for cross-contract FK
   * references. The handle is branded with `spaceId: 'supabase'` so the framework
   * detects cross-contract usage automatically when the handle is passed to
   * existing call sites like `constraints.foreignKey` and `rel.belongsTo`.
   */
  contract: <C>(json: unknown): TypedContract<C> => { /* … */ },

  /** Typed role constants for use in RLS policies. */
  roles: {
    authenticated: 'authenticated',
    anon: 'anon',
    serviceRole: 'service_role',
  },
};
```

The `supabase()` shorthand used in `extensionPacks: [supabase()]` is sugar for `supabase.pack()`.

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

- **JWT claim mapping into `auth.uid()` etc.** Postgres-side `auth.uid()` is a function defined in Supabase's `auth` schema that reads from the `request.jwt.claims` session var. We rely on Supabase's standard SQL functions; we don't reimplement them. They are not declared in the Supabase contract — predicate strings are opaque to the framework, and a missing function surfaces as a Postgres error at migration / query time. See [`decisions.md` C4](decisions.md).
- **What about Supabase storage?** The `storage.*` tables exist but app code rarely references them directly. We declare them in the shipped contract with `control: 'external'` and don't add any custom DSL for them. If user feedback pushes towards "ergonomic storage uploads," that's a future iteration.
- **Migration path for a user already running Supabase migrations.** They probably have hand-rolled `auth.*` modifications, custom roles, custom policies. The "adopt existing schema" workflow is broader than this project; cross-link to [`developer-experience.md`](developer-experience.md).
- **Custom auth schemas.** Some Supabase users extend `auth.*` with extra columns or tables. `contractOverride` is the v0.1 escape hatch; an introspection-based emit is the future polish.
- **Multi-extension composition.** The `supabase()` facade composes one Postgres runtime with one extension middleware stack. Apps that need to stack additional Postgres extensions (Supabase + observability + caching, say) currently fall back to the lower-level `postgres()` factory from `@prisma-next/postgres/runtime`, which accepts an explicit extension list. Whether to grow `supabase()` to accept extra middleware, or whether the lower-level fallback is the documented escape hatch, is unresolved. Working assumption: **document the lower-level fallback for v0.1; don't grow `supabase()`'s surface.** The risk is users who actually need the composed shape have to construct it themselves and lose the `asUser`/`asAnon`/`asServiceRole` ergonomics — acceptable v0.1 trade.
