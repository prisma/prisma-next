# `@prisma-next/extension-supabase` — the package itself

## Problem

The capabilities in the other notes (posture, cross-contract refs, RLS) are mostly framework-domain. The Supabase extension is where they all land — the one place that ships:

- A `contract.json` describing Supabase's `auth`, `storage`, etc. schemas as externally-managed.
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
│   ├── runtime.ts              # createSupabaseRuntime
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
  "defaultPosture": "externally-managed",
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
- `defaultPosture: 'externally-managed'` is the contract-level default; each model inherits it. Per-model overrides allowed (we likely won't need any in v0.1).
- We don't model every column of `auth.users` — only the columns app code is likely to reference (`id`, `email`, timestamps). The verifier under `externally-managed` posture tolerates extra columns, so we can ship a minimal slice and grow it as user needs surface.
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

  /** Wrap an imported contract.json with its typed shape; required for refIn() typing. */
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

### Runtime factory

```ts
// @prisma-next/extension-supabase/runtime
import type { Db } from '@prisma-next/postgres/runtime';

export interface SupabaseRuntimeOptions {
  serviceRoleKey?: string;
  // … connection-pool knobs, JWT validation options, etc.
}

export interface SupabaseRuntime<TContract, TTypeMaps> {
  asUser(jwt: string): Db<TContract, TTypeMaps>;
  asAnon(): Db<TContract, TTypeMaps>;
  asServiceRole(): Db<TContract, TTypeMaps>;
}

export function createSupabaseRuntime<TContract, TTypeMaps>(
  baseDb: Db<TContract, TTypeMaps>,
  options?: SupabaseRuntimeOptions,
): SupabaseRuntime<TContract, TTypeMaps> { /* … */ }
```

What `asUser` / `asAnon` / `asServiceRole` actually do at the connection level:

1. Acquire a connection (from the pool, typically per-request).
2. Run within a transaction or scoped session:
   ```sql
   SET LOCAL role = '<role>';
   SET LOCAL request.jwt.claims = '<jwt-claims-json>';
   ```
3. Execute the user's queries under that role context. RLS is enforced by Postgres because the role's grants + the policies' `USING` clauses do the work.
4. On scope exit (request complete), reset/return the connection.

The framework's middleware machinery (TML-2459 didn't touch this; existing infrastructure) is the natural place to hang the role-binding step. The Supabase runtime is essentially a middleware-installing wrapper around the base postgres runtime.

### Pool considerations

RLS + connection pooling has a known footgun: if you `SET ROLE` and don't reset it, the next pool checkout inherits the role. Mitigations:

- Prefer `SET LOCAL` (transaction-scoped) over `SET` (session-scoped). `SET LOCAL` automatically resets at COMMIT/ROLLBACK.
- Wrap every Supabase-runtime query in an implicit transaction. The framework already supports transactions; this just means the Supabase runtime always opens one.
- Document the pool requirements (must reset session state between checkouts) for users running a custom pool.

### Extension pack descriptor

The `ExtensionPack` interface (defined by `@prisma-next/config` — likely already exists from TML-2459's contract spaces work) carries:

- The extension's contract source (a contract.json bundled with the package).
- The extension's `spaceId`.
- Optional: target-specific behaviour the framework should install (planner hooks, verifier hooks, etc.). For Supabase v0.1, none of these are needed — the framework's posture + RLS support handles everything.

Loading happens at `prisma-next` CLI invocation time. The pack contributes its contract to the aggregate; the aggregate is what verifier/planner/runtime see.

## Open questions

- **Where does the JWT validation happen?** Two options: (a) the Supabase runtime validates the JWT signature itself (using the Supabase project's JWK or shared secret); (b) the app validates upstream and we trust the claims. Working assumption: **(a) — validate the JWT signature in the runtime, parameterised by JWT secret or JWKS URL in `SupabaseRuntimeOptions`.** It's safer by default and most apps will appreciate not having to wire this themselves.
- **JWT claim mapping into `auth.uid()` etc.** Postgres-side `auth.uid()` is a function defined in Supabase's `auth` schema that reads from the `request.jwt.claims` session var. We rely on Supabase's standard SQL functions; we don't reimplement them. The Supabase contract should declare those functions as externally-managed so users can call them in RLS predicates without them looking like unrecognised symbols. **Function-level posture isn't worked out yet (see [`posture.md`](posture.md) — current sketch is table/index/constraint-level only). May need to extend.**
- **What about Supabase storage?** The `storage.*` tables exist but app code rarely references them directly. We declare them in the shipped contract under `externally-managed` posture and don't add any custom DSL for them. If user feedback pushes towards "ergonomic storage uploads," that's a future iteration.
- **Migration path for a user already running Supabase migrations.** They probably have hand-rolled `auth.*` modifications, custom roles, custom policies. The "adopt existing schema" workflow is broader than this project; cross-link to [`developer-experience.md`](developer-experience.md).
- **Custom auth schemas.** Some Supabase users extend `auth.*` with extra columns or tables. `contractOverride` is the v0.1 escape hatch; an introspection-based emit is the future polish.
