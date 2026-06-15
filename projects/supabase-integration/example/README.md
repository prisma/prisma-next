# Supabase example app — design-time sketch

This directory is a **design-time sketch** of the runnable Supabase example app that will eventually live at `examples/supabase/`. The code does **not** typecheck today — most of the framework surface it depends on (namespace authoring, cross-contract refs, RLS DSL, `SupabaseRuntime` subclass extending `PostgresRuntime`) doesn't exist yet.

## Why this exists

Writing the example against the design — before committing to a project spec — is a forcing function. Each file in this directory surfaces concrete design questions that an isolated topic-by-topic conversation would not have surfaced. Those questions are tracked in [`design-holes.md`](./design-holes.md).

The sketch also doubles as:

- **Spec anchor.** When the project moves out of design-notes phase, AC1 for the Supabase project will be "this sketch typechecks against the live framework after slices X / Y / Z ship," and the subsequent ACs hang off its observable behaviour.
- **Onboarding artifact.** When the project ships, this directory migrates to `examples/supabase/` and becomes the canonical onboarding sample. Users land here first.

## Layout

| File | What it exercises |
|------|-------------------|
| [`src/prisma/contract.ts`](./src/prisma/contract.ts) | Namespaces (`public`), cross-contract FK to `AuthUser` (imported from `@prisma-next/extension-supabase/contract`), within-contract FK to `Profile`, RLS policies, opaque `auth.uid()` references in predicates, role constants |
| [`src/prisma/db.ts`](./src/prisma/db.ts) | `SupabaseRuntime` factory (default-export `supabase({...})` from `/runtime`), JWT secret config, optional user middleware |
| [`src/handlers.ts`](./src/handlers.ts) | `asUser(jwt)`, `asAnon()`, `asServiceRole()` request-handler patterns; multi-statement flows via `.transaction(...)`; structural `SET LOCAL` guarantee |
| [`migrations/supabase/contract.json`](./migrations/supabase/contract.json) | Pinned mirror of the Supabase extension contract (used by the planner; authoring uses the subpath import directly) |
| [`migrations/supabase/contract.d.ts`](./migrations/supabase/contract.d.ts) | Typed mirror used by the framework for verifier/planner type lookups |
| [`prisma-next.config.ts`](./prisma-next.config.ts) | `extensionPacks: [supabasePack]` (value-imported from `/pack`), contract source, DB connection |
| [`.env.example`](./.env.example) | `DATABASE_URL`, `SUPABASE_JWT_SECRET` (or `SUPABASE_JWKS_URL`) |
| [`design-holes.md`](./design-holes.md) | Every concrete decision the design doesn't yet cover, indexed by file |

## How to read this

Read `contract.ts` first — it's the densest design surface. Each thing that doesn't have a clear answer in the existing design notes is flagged in `design-holes.md`. The intent is that we work through `design-holes.md` next, settle each item, and update the surrounding design notes before promoting any of this to a real spec.

When the framework catches up to the design and this directory typechecks against it, the example moves to `examples/supabase/` as part of project close-out.
