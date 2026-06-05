# Overview — Supabase integration end-to-end story

> This is the integration narrative — the surface a Supabase user sees, and how the constituent projects compose to produce it. For the per-constituent design specs see the [umbrella README](README.md). For the canonical decisions log see [`decisions.md`](decisions.md).

## At a glance

A Prisma Next app using Supabase is one where the app contract references Supabase-managed tables (notably `auth.users`), and the framework knows enough about those tables to typecheck FK references, verify they exist with the right shape, and emit RLS policies — but **does not migrate them**.

```prisma
// app/prisma/schema.prisma (the user's code)
namespace public {
  model Profile {
    id       String @id @default(uuid())
    userId   String @unique(map: "profile_userId_unique")
    username String

    // Cross-contract FK — the `supabase:` prefix resolves against
    // extensionPacks in prisma-next.config.ts.
    user     supabase:auth.User @relation(fields: [userId], references: [id], onDelete: Cascade, map: "profile_userId_fkey")

    @@map("profile")
  }

  // RLS policies live in the same namespace as their target model.
  // Multiple permissive policies per (target, op) are allowed
  // (Postgres ORs them).

  policy profiles_select_own {
    target    = Profile
    operation = select
    roles     = [authenticated]
    using     = "user_id = (auth.uid())::uuid"
  }

  policy profiles_update_own {
    target    = Profile
    operation = update
    roles     = [authenticated]
    using     = "user_id = (auth.uid())::uuid"
    withCheck = "user_id = (auth.uid())::uuid"
  }
}
```

```ts
// prisma-next.config.ts
import { defineConfig } from '@prisma-next/config';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import supabasePack from '@prisma-next/extension-supabase/pack';
import sqlFamily from '@prisma-next/family-sql/control';
import postgresPack from '@prisma-next/target-postgres/control';

export default defineConfig({
  family: sqlFamily,
  target: postgresPack,
  extensionPacks: [supabasePack],
  contract: prismaContract('./app/prisma/schema.prisma', {
    output: 'app/migrations/app/contract.json',
    target: postgresPack,
  }),
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
//
// Reaching a table in a named namespace (auth.users alongside public.users)
// goes through the explicit namespace-aware surface:
//   db.asUser(jwt).sql.auth.users.select({ ... }).build()
```

The TS contract surface is structurally parallel and is described in each constituent project's spec; both PSL and TS lower to the same canonical `contract.json`. Once that JSON exists, the runtime story is identical regardless of which authoring surface produced it.

One facade, one factory call. There is no top-level `db.sql` — `db` requires a role first (`asUser` / `asAnon` / `asServiceRole`) before queries can be built. In a Supabase app there's no meaningful "no role" execution context; making it impossible by construction is intentional.

That's the user's surface. Everything below explains what the framework does to make this work and what we have to build.

## What "Supabase integration" actually means

We deliver eight capabilities across six framework-primitive projects plus an integration project. Each capability has a canonical home in one of the constituent project specs.

1. **Polymorphic IR + namespaces + within-contract cross-namespace FKs.** [target-extensible-ir](../target-extensible-ir/spec.md). Foundation for everything below — the target-only IR kind seam (RLS uses it), the namespace concept (cross-contract refs and policies need it), and the FK reference carrier (cross-contract refs extends it).

2. **Control policy.** [control-policy](../control-policy/spec.md). A generic, target-agnostic `control` field on IR nodes (`managed` / `tolerated` / `external` / `observed`) declaring how much the framework's control plane participates in each object's migration lifecycle. The Supabase contract declares `auth.users` with `control: 'external'`; the verifier confirms shape, the planner emits no DDL. Supabase consumes this primitive; it does not introduce it.

3. **Cross-contract-space FK references.** [cross-contract-refs](../cross-contract-refs/spec.md). Unified authoring surface (TS: existing `constraints.foreignKey` / `rel.belongsTo` with a model handle from another contract space; PSL: colon-prefixed dot-qualified type refs, e.g. `supabase:auth.User`); FK reference IR carries the foreign contract space ID; implicit resolution against the loaded contract aggregate built from `extensionPacks`; planner emits qualified `REFERENCES "auth"."users"("id")` for named target namespaces and unqualified `REFERENCES "users"("id")` for `__unspecified__` targets.

4. **RLS policies + Postgres roles as first-class Postgres IR.** [postgres-rls](../postgres-rls/spec.md). `PostgresRlsPolicy` and `PostgresRole` as target-only IR kinds. TS authoring: `.rls([...])` — a fourth staged-builder method, target-gated by pack-aware typing. PSL authoring: top-level `policy <name> { … }` named-block declarations. Content-addressed wire names so the verifier never compares reparsed predicate bodies. Verifier diffs against `pg_policies` + `pg_roles`.

5. **Runtime target-layer class.** [runtime-target-layer](../runtime-target-layer/spec.md). Export `SqlRuntime`; introduce `class PostgresRuntime extends SqlRuntime` (the missing target layer); add `protected withRawConnection(callback)` below the user middleware chain. The substrate Supabase's runtime uses to enforce role binding structurally rather than procedurally.

6. **Namespace-aware query surface.** [explicit-namespace-dsl](../explicit-namespace-dsl/spec.md). The explicit `db.sql.<ns>.<table>` / `db.<ns>.<Model>` accessors that let a query reach a table in a *named* namespace. **This is a launch blocker, not a fast-follow.** A Supabase app queries `auth.*` and `public.*` tables that collide by bare name — both schemas ship a `users` table — and the default-namespace fallback (from the runtime-qualification slice, TML-2605) resolves only a single namespace by bare name. Without explicit qualification there is no way to address `auth.users`: every namespace collapses into one flat space, which is the user-facing fudge we refuse to ship. The surface is purely additive on the fallback (default-namespace consumers see zero churn) and depends only on TML-2605, so it runs in parallel with the other primitives rather than gating the IR project's close-out.

7. **The `@prisma-next/extension-supabase` package.** [extension-supabase](../extension-supabase/spec.md). Subpath-only entrypoints: `/pack` (value-imported `ExtensionPack`), `/contract` (hand-authored typed handles — `AuthUser`, `roles`, etc.), `/runtime` (default-export `supabase({...})` factory returning a `SupabaseRuntime` that extends `PostgresRuntime`). The shipped `contract.json` declares `auth`, `storage`, `realtime`, `extensions` schemas with `defaultControl: 'external'`. The runtime exposes `asUser` / `asAnon` / `asServiceRole` role helpers; each issues `SET LOCAL role` / `SET LOCAL request.jwt.claims` below the user-middleware chain (structurally non-bypassable).

8. **Working example app.** [extension-supabase M3](../extension-supabase/plan.md). A committed, runnable example app at `examples/supabase` that exercises cross-contract FK references to `AuthUser`, RLS policies, the `SupabaseRuntime` factory, and all three role helpers (`asUser` / `asAnon` / `asServiceRole`). It is the **walking skeleton** — stood up early in M1 and grown one feature at a time as each constituent lands (decisions [C13/C14](decisions.md); strategy in the [README](README.md) §"Walking skeleton"). **Must-have for launch** — the proof that the integration works end-to-end and the primary onboarding artefact.

### Stretch goals

These are desirable but not required for v0.1. Most belong to follow-up projects after launch.

- **Postgres triggers and functions as first-class IR.** The canonical Supabase "create a profile when a user signs up" pattern uses `CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE PROCEDURE handle_new_user()`. Being able to author this trigger + the function it calls from the contract DSL (rather than dropping to raw SQL migrations) would close the last gap in the canonical Supabase onboarding story. For v0.1, functions are not contract elements at all — neither authored nor verified — because none of the four typical Supabase flows require it; see [`decisions.md` C4](decisions.md). `auth.uid()` etc. live inside opaque RLS predicate strings, and column-default functions like `gen_random_uuid()` go through the existing `DefaultFunctionRegistry`.
- **Scaffold + getting-started polish.** See [`developer-experience.md`](developer-experience.md).
- **PSL `${...}` string interpolation** for the structured analogue of TS's `ref()` helper. Captured as offcut **OC3** in the decisions log.
- **`policyGroup` for shared-target policies.** Captured as offcut **OC2**.
- **Content-addressed wire names backported to indexes, functions, views.** Captured as offcut **OC4**.

### Stretch goals

These are desirable but not required for v0.1. The IR refactor from TML-2459 makes them easy to add once the foundation lands.

- **Postgres triggers and functions as first-class IR.** The canonical Supabase "create a profile when a user signs up" pattern uses `CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE PROCEDURE handle_new_user()`. Being able to author this trigger + the function it calls from the contract DSL (rather than dropping to raw SQL migrations) would close the last gap in the canonical Supabase onboarding story. For v0.1, functions are not contract elements at all — neither authored nor verified — because none of the four typical Supabase flows require it; see [`decisions.md` C4](decisions.md). `auth.uid()` etc. live inside opaque RLS predicate strings, and column-default functions like `gen_random_uuid()` go through the existing `DefaultFunctionRegistry`.

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

- **Layering.** Control policy is a *framework-domain* concept (every target needs it) and is documented in [ADR 224](../../docs/architecture%20docs/adrs/ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md). Cross-contract refs are a *framework-domain* concept (the carrier shape is target-agnostic). RLS is a *Postgres-target-only* concept (the IR kind doesn't exist outside Postgres, and the authoring DSL only surfaces it under a Postgres-conditioned path).
- **Authoring vs. IR vs. runtime.** Each capability has three faces: how the user writes it (authoring DSL), how it's represented in the canonicalised contract (IR), and how the runtime/planner/verifier act on it. The component docs walk those three layers in order.
- **TML-2459 carries the IR machinery; control-policy adds the dispatch primitive; the three middle-tier projects add new IR *kinds* and runtime infrastructure.** None of the constituent work requires inventing new framework infrastructure beyond what TML-2459 (3-layer IR + SPIs) and the control-policy project (per-node `control` field + verifier/planner dispatch) provide. Cross-contract-refs, postgres-rls, and runtime-target-layer compose the established shape into Supabase-shaped capabilities; explicit-namespace-dsl adds the namespace-aware query surface on top of the runtime-qualification path; extension-supabase packages them all into a deliverable.

## Open questions (project-level)

- **Where does the Supabase contract live on disk in the consuming app?** The extension package ships its source-of-truth `contract.json` under its `/contract` subpath. Under [C6](decisions.md), authoring imports typed handles directly from `@prisma-next/extension-supabase/contract` — no manual JSON import. For *migration planning*, the framework needs a pinned mirror of the extension's contract in the consuming app's `migrations/` tree so the planner has a stable, versioned view; working assumption is `migrations/<spaceName>/contract.json`, generated on `prisma-next install` or equivalent. Defer the exact pin/refresh mechanics to implementation. The [cross-contract-refs](../cross-contract-refs/spec.md) project owns this question.
- **Does the Supabase pack take options for project-level choices (e.g., schemas to include, role names if non-default)?** Sketched in the [extension-supabase spec](../extension-supabase/spec.md) — `supabasePackWith({ contractOverride })` is the v0.1 escape hatch; richer options are TBD.
- **What does the migration story look like for a user already running Supabase with hand-rolled SQL migrations?** Some kind of "adopt existing schema" workflow; details in [`developer-experience.md`](developer-experience.md), not settled. Out of any constituent project's v0.1 scope.
