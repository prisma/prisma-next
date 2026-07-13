# BetterAuth example

A minimal app proving the `@prisma-next/extension-better-auth` consumer story end-to-end:

- The **better-auth extension pack** in `prisma-next.config.ts` brings the four BetterAuth core models (`User`, `Session`, `Account`, `Verification`) into the app as a managed contract space — the framework owns their DDL through the pack's shipped migrations.
- The app's own `Profile` model carries a **cross-space foreign key** onto the pack's `User`, authored with the branded handle from `@prisma-next/extension-better-auth/contract` and created as a real `ON DELETE CASCADE` constraint in the database.
- `betterAuth()` runs over **`prismaNextAdapter`**, so every auth read/write goes through contract-typed collections against the same database as the app — no separate auth store, no schema drift.
- A minimal HTTP server exposes BetterAuth's handler plus one authenticated endpoint that reads the session **and** traverses `Profile → user`.

## Layout

| Path | What it is |
| --- | --- |
| `prisma-next.config.ts` | App config: postgres target, `extensions: [betterAuthPack]` |
| `src/prisma/contract.ts` | App contract: `Profile` with `rel.belongsTo(User, …)` + cross-space FK via `User.refs.id` |
| `src/prisma/contract.json` / `.d.ts` | Emitted aggregate contract (step 1 output, committed) |
| `migrations/app/…` | Planned app migration: `profile` table + FK (step 2 output, committed) |
| `migrations/better-auth/…` | The pack's contract space, seeded by step 2 (committed) |
| `src/prisma/db.ts` | Client construction — see "Two typed views" below |
| `src/auth.ts` | `betterAuth()` over `prismaNextAdapter` |
| `src/server.ts` | HTTP server: `/api/auth/*` + authenticated `GET /api/me` |
| `test/example.integration.test.ts` | CI surface automating everything below against a dev database |

## Schema flow (three steps)

The committed artifacts are the outputs of these steps — re-running them is a no-op (the example test asserts this for step 1 and validates the committed migrations offline for step 2).

```bash
# 1. Emit the aggregate contract (app Profile + the pack's four models)
pnpm exec prisma-next contract emit

# 2. Plan migrations — writes migrations/app/… for the profile table and
#    seeds the pack's shipped migrations into migrations/better-auth/…
pnpm exec prisma-next migration plan --name init

# 3. Create the schema — walks BOTH spaces to head on your database:
#    the pack's four auth tables, then the app's profile table with its
#    cross-space FK onto "public"."user"(id)
DATABASE_URL=postgres://… pnpm exec prisma-next db init
```

## Run it

```bash
DATABASE_URL=postgres://… pnpm exec tsx src/main.ts
```

Sign up:

```bash
curl -i -X POST http://localhost:3000/api/auth/sign-up/email \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse-battery-staple","name":"Ada Lovelace"}'
```

Take the `set-cookie` value from the response, then make an authenticated request:

```bash
curl http://localhost:3000/api/me -H 'cookie: <set-cookie value>'
```

The response carries the session (read through BetterAuth over the contract-typed adapter) and the profile with its user (read through the ORM). The `profile` row itself is created by your app code — see the integration test for the full sign-up → profile → authenticated-read flow.

## Two typed views over one database

`src/prisma/db.ts` constructs two clients over a **shared connection pool**:

- `db` — over the emitted **aggregate contract**, for the app's own models (`Profile`). The aggregate records the pack requirement, so construction passes the pack's runtime descriptor: `postgres<Contract>({ contractJson, pg, extensions: [betterAuthRuntimeDescriptor] })`. Without it, `postgres()` rejects the contract ("Contract requires extension pack 'better-auth'").
- `authDb` — over the pack's **contract-space contract**, which types the four auth models for `prismaNextAdapter`. Marker verification stays on `db` (the marker names the aggregate; this is a partial view of the same database).

Two views are needed because the aggregate contract records the pack's models as cross-space *references*, not as navigable domain models — `db.orm.public.User` does not exist on the aggregate, and the `Profile.user` relation is not `include()`-able across spaces in the current framework. The FK is still a real database constraint (the test proves the cascade), and the server follows it explicitly with one extra typed query.
