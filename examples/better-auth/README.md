# BetterAuth example

A minimal app proving the `@prisma-next/extension-better-auth` consumer story end-to-end:

- The **better-auth extension pack** in `prisma-next.config.ts` brings the four BetterAuth core models (`User`, `Session`, `Account`, `Verification`) into the app as a managed contract space — the framework owns their DDL through the pack's shipped migrations.
- The app's own `Profile` model declares a **cross-space foreign key** onto the pack's `User` in PSL (`better-auth:public.User`), created as a real `ON DELETE CASCADE` constraint in the database.
- `betterAuth()` runs over **`prismaNextAdapter({ pg })`**: hand the adapter the app's shared connection pool and it builds its space-scoped client view internally — auth data lives in the same database as the app, with **one client and one pool** in app code.
- A minimal HTTP server exposes BetterAuth's handler plus one authenticated endpoint combining a session read (BetterAuth) with a `Profile` read (the ORM).

## Layout

| Path | What it is |
| --- | --- |
| `prisma-next.config.ts` | App config: postgres target, `extensions: [betterAuthPack]` |
| `src/prisma/contract.prisma` | App contract in PSL: `Profile` with the cross-space FK `user better-auth:public.User @relation(…, onDelete: Cascade)` |
| `src/prisma/contract.json` / `.d.ts` | Emitted aggregate contract (step 1 output, committed) |
| `migrations/app/…` | Planned app migration: `profile` table + FK (step 2 output, committed) |
| `migrations/better-auth/…` | The pack's contract space, seeded by step 2 (committed) |
| `src/prisma/db.ts` | One client over the aggregate contract, on an app-owned pool |
| `src/auth.ts` | `betterAuth()` over `prismaNextAdapter({ pg: pool })` |
| `src/server.ts` | HTTP server: `/api/auth/*` + authenticated `GET /api/me` |
| `test/example.integration.test.ts` | CI surface automating everything below against a dev database |

## Schema flow (three steps)

The committed artifacts are the outputs of these steps — re-running them is a no-op (the example test asserts this byte-for-byte for steps 1 and 2, and validates the committed migrations offline).

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

The response carries the session and its user (read through BetterAuth over the contract-typed adapter) and `profile: null` on a fresh sign-up — the `profile` row is created by your app code, not by BetterAuth. Once your app has created one (see the integration test for the full sign-up → profile → authenticated-read flow), the response carries the profile as well (read through the ORM).

## One client, one pool

`src/prisma/db.ts` constructs a single `postgres()` client over the app's emitted **aggregate contract**, on an app-owned `pg.Pool`:

- The aggregate records the pack requirement, so construction passes the pack's runtime descriptor: `postgres<Contract>({ contractJson, pg: pool, extensions: [betterAuthRuntimeDescriptor] })`. Without it, `postgres()` rejects the contract ("Contract requires extension pack(s) 'better-auth', but runtime descriptors do not provide matching component(s).").
- `src/auth.ts` hands the **same pool** to the adapter — `prismaNextAdapter({ pg: pool })` — which internally constructs its own view over the pack's contract space (the aggregate records pack models as cross-space references, not navigable domain models, so `db.orm.public.User` deliberately does not exist on the app's client). App code never sees that view; auth models are reached through BetterAuth's API.
- The pool carries an `'error'` handler: pg emits `'error'` on idle-client disconnects (pgbouncer restarts, serverless Postgres reaping idle connections), and without a listener that event crashes the Node process.
