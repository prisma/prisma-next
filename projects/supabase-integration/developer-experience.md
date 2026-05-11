# Developer experience

## Problem

A user adopting Prisma Next + Supabase should reach a working "Hello world with RLS" in well under 30 minutes. The technical capabilities in the other notes don't pay off unless the on-ramp is smooth.

Three audiences:

1. **Greenfield user starting a new Supabase + Prisma Next project.** Wants `init` to produce something that works, with a comment-rich example.
2. **Existing Supabase user migrating from `@supabase/supabase-js`.** Has live data, custom auth schemas, hand-rolled migrations. Wants to adopt incrementally.
3. **Returning user who built one feature, comes back two weeks later to build another.** Wants discoverable docs and good completions.

## Design intent

### Scaffold

```bash
prisma-next init --supabase
# or, equivalently:
# pnpm dlx @prisma-next/cli init --template supabase
```

Produces:

```
my-app/
├── prisma-next.config.ts
├── app/
│   ├── contract.ts                # one example Profile model with RLS, comments
│   └── db.ts                      # the supabase() facade wired up
├── migrations/
│   ├── app/
│   │   ├── contract.json          # emitted from app/contract.ts
│   │   └── contract.d.ts
│   └── supabase/
│       ├── contract.json          # pinned mirror of @prisma-next/extension-supabase
│       └── contract.d.ts
├── .env.example
└── README.md                      # links to getting-started docs
```

The example model is `Profile` with RLS policies that match the canonical Supabase "users can read/write their own profile" pattern. It's lifted directly from [`overview.md`](overview.md). The example is small enough to read in one screen, deep enough that the user has seen `refIn`, `c.rlsPolicy`, role constants, and the runtime split.

### Getting-started doc

Lives in `docs/` (canonical) or in the package's `README.md` (entry-point friendly). Suggested structure:

1. **At a glance.** The same canonical code sample from [`overview.md`](overview.md), so users see the surface immediately.
2. **Setup.** `prisma-next init --supabase`; what env vars to populate; one paragraph on how the Supabase project's database connection URL maps to `DATABASE_URL`.
3. **Your first model.** Walk through the scaffolded `Profile` model. Explain `refIn`, `posture` (implicit via Supabase contract), `c.rlsPolicy`.
4. **Your first migration.** Run the planner; show the generated DDL; explain what's *not* in it (no `CREATE TABLE auth.users` because it's externally-managed).
5. **Your first query.** Show `db.asUser(jwt).sql.from(Profile)...`. Show what RLS enforcement looks like (a query that would return another user's row returns empty).
6. **What's next.** Link to ref docs (Postgres target, contract authoring, RLS, etc.).

### Migration from `@supabase/supabase-js`

This is the harder DX problem. Existing Supabase apps have:

- A live `public.*` schema with tables, FKs, RLS policies — hand-rolled or migrated through Supabase's dashboard.
- A `@supabase/supabase-js` client wired up in app code with row-level queries.

We need an "adopt existing schema" workflow. Sketch:

1. `prisma-next adopt --from-database <DATABASE_URL>` introspects the live database and emits an initial `contract.ts` for the user's `public.*` schema.
   - Tables → `m.model(...)` declarations.
   - FKs → `m.constraints.ref(...)` or `m.constraints.refIn(...)` depending on the target namespace.
   - RLS policies → `c.rlsPolicy({ ... })` with predicates copied verbatim as strings.
   - Posture → `tolerated` for all introspected objects by default (let extras through; don't generate ALTER ops).
2. The user reviews the emitted `contract.ts`, deletes or moves what they don't want, commits it.
3. Going forward, the planner can produce additive migrations from this baseline.

`adopt` is a Real Project — it's a Postgres-introspection emitter, which doesn't exist today. Probably out of v0.1 scope; document the manual workflow as a fallback:

- "Until `adopt` ships, here's how to hand-write your contract for an existing Supabase app: …"
- The manual workflow is: declare all your existing tables as `tolerated` posture, paste your RLS policies as strings, run the verifier — if it's green, you're aligned with the live schema.

### Authoring ergonomics

Beyond scaffold and docs, three small things matter for daily use:

- **Editor completions on `m.constraints.refIn(supabaseContract, '...', '...')`.** The second and third arguments must autocomplete to known model/field names. This is a type-level concern in `@prisma-next/contract-ts`; the surface is already designed in [`cross-contract-refs.md`](cross-contract-refs.md).
- **Editor completions on `c.rlsPolicy({ roles: [supabase.roles.<TAB>] })`.** The role-constants object is `as const`, so completion works naturally; no extra work.
- **Diagnostic clarity.** When a cross-contract `refIn` fails to resolve, the error message should say *which extension is expected* and *how to add it* (e.g., "Did you add `supabase()` to `extensionPacks`?"). When an RLS predicate fails Postgres validation at migration time, the error should attach the policy name and the line in the user's contract that declared it.

### Documentation deliverables

For v0.1 (specifics to settle when this becomes a real spec):

- **Getting-started page** (canonical doc).
- **`@prisma-next/extension-supabase` package README** with quick reference.
- **RLS reference page** (the policy DSL, predicate string conventions, common patterns).
- **Cross-contract refs reference page** (`refIn` shape, when to use it, troubleshooting).
- **Posture reference page** (the four postures, when each applies, the user-author defaults).
- **Migration guide from `@supabase/supabase-js`** (link to scaffold; manual workflow; pointers).

The example app from the scaffold becomes a referenceable artifact in the docs site.

## Open questions

- **`prisma-next adopt` introspection emitter.** Real feature, probably out of v0.1 scope. Punt to a follow-up project. Could be the "next obvious thing after Supabase v0.1 ships." Decide when project shape is settled.
- **JWT generation in the local dev loop.** Users want to test RLS locally without spinning up a real Supabase project. A `supabase.dev.signJwt({ sub: 'test-user-1', role: 'authenticated' })` test helper would be invaluable. Working assumption: **ship it in `@prisma-next/extension-supabase/test` or similar. Small effort, big DX win.**
- **Tutorials beyond the canonical Profile example.** Comments, posts, "social app" tutorial, e-commerce tutorial. Out of v0.1 scope; the canonical example is enough to ship.

## Settled decisions

- **Working example app is a must-have.** Lives in `examples/supabase/` in the monorepo as a committed, runnable app. The package README links to it. This is the proof that the integration works end-to-end and the primary onboarding artifact for new users.
