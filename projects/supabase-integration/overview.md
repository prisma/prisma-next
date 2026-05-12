# Overview — Supabase integration end-to-end story

## At a glance

A Prisma Next app using Supabase is one where the app contract references Supabase-managed tables (notably `auth.users`), and the framework knows enough about those tables to typecheck FK references, verify they exist with the right shape, and emit RLS policies — but **does not migrate them**.

```ts
// app/contract.ts (the user's code)
import { defineContract, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import { supabase } from '@prisma-next/extension-supabase';
import supabaseContractJson from '../migrations/supabase/contract.json' with { type: 'json' };
import type { Contract as SupabaseContract } from '../migrations/supabase/contract.d';
import sqlFamily from '@prisma-next/family-sql/pack';
import postgresPack from '@prisma-next/target-postgres/pack';

const supabaseContract = supabase.contract<SupabaseContract>(supabaseContractJson);

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
    namespaces: ['public'],
    extensionPacks: { supabase: supabase.pack() },
  },
  ({ field, model }) => {
    const Profile = model('Profile', {
      namespace: 'public',
      fields: {
        id: field.id.uuidv4(),
        userId: field.uuid(),
        username: field.text(),
      },
    });

    return {
      models: {
        Profile: Profile.relations({
          // Cross-contract FK — model handle's brand tells the framework this
          // reference targets another contract space (no new TS syntax).
          user: rel.belongsTo(supabaseContract.models.AuthUser, { from: 'userId', to: 'id' }),
        })
          .attributes(({ fields, constraints }) => ({
            uniques: [ constraints.unique(fields.userId, { name: 'profile_userId_unique' }) ],
          }))
          .sql(({ cols, constraints }) => ({
            table: 'profile',
            foreignKeys: [
              constraints.foreignKey(cols.userId, supabaseContract.models.AuthUser.refs.id, {
                name: 'profile_userId_fkey',
                onDelete: 'cascade',
              }),
            ],
          }))
          // Postgres-only stage, target-gated by pack-aware typing.
          // Each policy carries its own name + operation + roles + predicate(s).
          // Multiple permissive policies per (target, op) are allowed (Postgres ORs them).
          .rls([
            {
              name: 'profiles_select_own',
              operation: 'select',
              roles: [supabase.roles.authenticated],
              using: 'user_id = (auth.uid())::uuid',
            },
            {
              name: 'profiles_update_own',
              operation: 'update',
              roles: [supabase.roles.authenticated],
              using:     'user_id = (auth.uid())::uuid',
              withCheck: 'user_id = (auth.uid())::uuid',
            },
          ]),
      },
    };
  },
);
```

```ts
// prisma-next.config.ts
import { defineConfig } from '@prisma-next/config';
import { typescriptContract } from '@prisma-next/contract-ts';
import { supabase } from '@prisma-next/extension-supabase';

export default defineConfig({
  contract: typescriptContract('./app/contract.ts'),
  extensionPacks: [supabase.pack()],
});
```

```ts
// app/db.ts
import supabase from '@prisma-next/extension-supabase/runtime';
import type { Contract, TypeMaps } from '../migrations/app/contract.d';
import contractJson from '../migrations/app/contract.json' with { type: 'json' };

export const db = supabase<Contract, TypeMaps>({
  contractJson,
  url: process.env['DATABASE_URL']!,
  jwtSecret: process.env['SUPABASE_JWT_SECRET']!,
});

// In a request handler:
//   db.asUser(jwt).sql.from(Profile).select({ ... }).build()
//   db.asAnon().sql.from(Profile).select({ ... }).build()
//   db.asServiceRole().sql.from(Profile).update({ ... }).build()
```

One facade, one factory call. There is no top-level `db.sql` — `db` requires a role first (`asUser` / `asAnon` / `asServiceRole`) before queries can be built. In a Supabase app there's no meaningful "no role" execution context; making it impossible by construction is intentional.

That's the user's surface. Everything below explains what the framework does to make this work and what we have to build.

## What "Supabase integration" actually means

We deliver six capabilities. Each has its own design note; this list is the map.

1. **Posture: modeled / tolerated / externally-managed / drift.** A generic, target-agnostic property on IR nodes that tells the framework how to relate to a database object's lifecycle. The Supabase contract declares `auth.users` as externally-managed; the verifier checks it exists with the expected shape, the planner emits no DDL for it. See [`posture.md`](posture.md).

2. **Cross-contract-space FK references.** Unified authoring surface (TS: existing `constraints.foreignKey` / `rel.belongsTo` with a model handle from another contract space; PSL: colon-prefixed dot-qualified type refs, e.g. `supabase:auth.User`); FK reference IR carries the foreign contract space ID; implicit resolution against the loaded contract aggregate built from `extensionPacks`; planner emits qualified `REFERENCES "auth"."users"("id")` for named target namespaces and unqualified `REFERENCES "users"("id")` for `__unspecified__` targets. See [`cross-contract-refs.md`](cross-contract-refs.md).

3. **RLS policies as first-class Postgres IR.** `PostgresRlsPolicy` as a target-only IR kind hanging off `PostgresTable`. TS authoring: `.rls([...])` — a fourth staged-builder method alongside `.attributes(...)` and `.sql(...)`, target-gated by pack-aware typing (no capability flag). Array of named descriptors, each carrying `{ name, operation, roles, using?, withCheck?, as? }`. PSL authoring: top-level `policy <name> { target, operation, roles, using, withCheck, ... }` named-block declarations. Both surfaces are lenient on multiplicity (Postgres ORs permissive policies for the same op). TS predicates accept `string | ((ctx) => string)` with `ref(modelHandle)` for canonical quoted identifiers; PSL predicates are verbatim strings in v0.1 (interpolation is a stretch goal). Migration ops via `OpFactoryCall`. Verifier diffs against `pg_policies`. See [`rls.md`](rls.md) and [`decisions.md`](decisions.md).

4. **The `@prisma-next/extension-supabase` package.** A hand-authored `contract.json` describing the `auth`, `storage`, `realtime`, `extensions` schemas as externally-managed. A `supabase()` runtime facade that composes the Postgres runtime internally and exposes `asUser` / `asAnon` / `asServiceRole` role helpers as top-level methods. RLS session-state injection (the request user's JWT becomes a session-scoped role + claim set). Typed role constants. Use `supabase.pack()` for the extension-pack ref and `supabase.contract<C>(json)` for the typed contract handle — there is no `supabase()` shorthand at the contract-side. See [`extension-package.md`](extension-package.md).

5. **Authoring DSL surface from TML-2459 (assumed).** Namespace declaration in PSL/TS, per-model namespace, cross-namespace FKs within a single contract. **This is already in scope of TML-2459 and is assumed available.** We're listing it here only because the Supabase example wouldn't make sense without it.

6. **Developer experience.** Scaffold (`prisma-next init --supabase` or equivalent), getting-started docs, a migration guide for users coming from the Supabase JS client. See [`developer-experience.md`](developer-experience.md).

7. **Working example app (`examples/supabase/`).** A committed, runnable example app that exercises cross-contract FK references to `auth.User`, RLS policies, the `supabase()` runtime facade, and all three role helpers. **Must-have** — this is the proof that the integration works end-to-end and the primary onboarding artifact.

### Stretch goals

These are desirable but not required for v0.1. The IR refactor from TML-2459 makes them easy to add once the foundation lands.

- **Postgres triggers and functions as first-class IR.** The canonical Supabase "create a profile when a user signs up" pattern uses `CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE PROCEDURE handle_new_user()`. Being able to author this trigger + the function it calls from the contract DSL (rather than dropping to raw SQL migrations) would close the last gap in the canonical Supabase onboarding story. For v0.1, functions are not contract elements at all — neither authored nor verified — because none of the four typical Supabase flows require it; see [`posture.md`](posture.md) § "Functions are not contract elements in v0.1." `auth.uid()` etc. live inside opaque RLS predicate strings, and column-default functions like `gen_random_uuid()` go through the existing `DefaultFunctionRegistry`.

## How a request flows through the stack

The runtime flow is worth tracing once because RLS makes it non-obvious.

1. A request arrives with a Supabase-issued JWT.
2. The app calls `db.asUser(jwt)` (or `.asAnon()` or `.asServiceRole()`).
3. The runtime opens (or checks out from a pool) a connection, then runs `SET LOCAL role = '<role>'` and `SET LOCAL request.jwt.claims = '<jwt-claims-json>'`. Postgres-side `auth.uid()` and friends read from those session vars.
4. The user's SQL plan executes under that role. RLS policies are enforced by Postgres because the role has limited privileges; the framework didn't have to do anything special at query time.
5. On request completion, the transaction commits (or the session is reset before returning to the pool).

The framework's job at runtime is **role binding** + **session-state injection**, not query rewriting. RLS enforcement is Postgres's job; we just have to make sure Postgres has the context it needs.

## What's *out* of this story

Items intentionally not covered (full list in [`deferred.md`](deferred.md)):

- **Realtime.** Out of v0.1 scope.
- **Storage API.** Not a database concern; out of scope.
- **Introspection-based emit of the Supabase contract.** We hand-author it for v0.1; an emitter that introspects a Supabase Postgres database is a follow-up.
- **Identity providers other than Supabase.** Auth0/Clerk/etc. follow the same pattern but aren't in v0.1.
- **Visibility / encapsulation between contract spaces.** All extension contract spaces are visible to app contracts. Tooling-level visibility rules are a future concern.

## Cross-cutting threads to keep in mind while reading the component docs

Three things show up in multiple component docs and are worth surfacing here:

- **Layering.** Posture is a *framework-domain* concept (every target needs it). Cross-contract refs are a *framework-domain* concept (the carrier shape is target-agnostic). RLS is a *Postgres-target-only* concept (the IR kind doesn't exist outside Postgres, and the authoring DSL only surfaces it under a Postgres-conditioned path).
- **Authoring vs. IR vs. runtime.** Each capability has three faces: how the user writes it (authoring DSL), how it's represented in the canonicalised contract (IR), and how the runtime/planner/verifier act on it. The component docs walk those three layers in order.
- **TML-2459 carries the IR machinery.** None of the IR work below requires inventing new framework infrastructure; TML-2459 establishes the 3-layer IR and the SPIs. This project adds new IR *kinds* (Postgres RLS policy, framework-level posture, framework-level cross-space FK carrier) within the established shape.

## Open questions (project-level)

- **Where does the Supabase contract live on disk?** Inside the `@prisma-next/extension-supabase` package (shipped to npm)? In a generated `node_modules/.prisma-next-supabase/` directory? In the app's `migrations/supabase/`? This affects how the user imports it to construct the typed handle (`supabase.contract<SupabaseContract>(json)`). *(Working assumption: pinned mirror under `migrations/supabase/`, generated on `prisma-next install` or equivalent, mirroring how app contracts already live under `migrations/<space>/`.)*
- **Does `supabase()` in `extensionPacks` take options for project-level choices (e.g., schemas to include, role names if non-default)?** Probably yes; sketched in [`extension-package.md`](extension-package.md), not settled.
- **What does the migration story look like for a user already running Supabase with hand-rolled SQL migrations?** Some kind of "adopt existing schema" workflow; details in [`developer-experience.md`](developer-experience.md), not settled.
