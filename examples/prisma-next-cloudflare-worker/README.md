# prisma-next-cloudflare-worker

End-to-end example for the `@prisma-next/postgres/serverless` facade, running on a Cloudflare Worker against a Hyperdrive-fronted Postgres origin.

This example mirrors `examples/prisma-next-demo` (the Node demo), minus pgvector — the Worker example exists to exercise the per-request `postgresServerless` lifecycle, not vector search. PGlite, the engine `prisma dev` ships, also does not include pgvector.

## What this example demonstrates

- **Module-scope `db`** built once per isolate via `postgresServerless<Contract>({ contractJson, middleware })`.
- **Per-request `runtime`** via `await using runtime = await db.connect({ url: env.HYPERDRIVE.connectionString })`. The `[Symbol.asyncDispose]` ensures the underlying `pg.Client` is `end()`-ed when the `fetch` handler returns.
- **All three query surfaces** through `Runtime`:
  - SQL DSL: `runtime.execute(db.sql.user.select(...).build())`
  - ORM client: `createOrmClient(runtime).User.newestFirst().take(10).all()`
  - Transactions: `withTransaction(runtime, async (tx) => …)`
- **Cursor early-break** over a streamed result set (`for await … break`), exercising the cursor path that `postgresServerless` enables by default.

Routes implemented in [`src/worker.ts`](src/worker.ts):

| Route             | Surface         | Notes                                                      |
| ----------------- | --------------- | ---------------------------------------------------------- |
| `GET /health`     | —               | DB-free liveness check                                     |
| `GET /sql/users`  | SQL DSL         | `db.sql.user.select(...).limit(?)`                         |
| `GET /orm/users`  | ORM client      | `User.newestFirst().take(?)`                               |
| `GET /orm/posts`  | ORM client      | `Post.forUser(?).orderBy(...).take(?)`                     |
| `GET /orm/tasks`  | ORM client      | Discriminated `Task` / `Bug` / `Feature` queries           |
| `GET /tx/commit`  | `withTransaction` | INSERT post + UPDATE user atomically                     |
| `GET /tx/rollback`| `withTransaction` | Throws inside the body; verifies ROLLBACK propagates     |
| `GET /cursor/large` | Cursor stream | `for await … break` after N rows; cursor cancels cleanly   |

## Layout

```
examples/prisma-next-cloudflare-worker/
├── prisma/schema.prisma                # Demo schema minus pgvector
├── src/
│   ├── worker.ts                       # `fetch` handler — all routes
│   ├── prisma/db.ts                    # Module-scope postgresServerless client
│   ├── prisma/contract.{json,d.ts}     # Emitted by `pnpm emit`
│   └── orm-client/                     # ORM extensions (collections + factory)
├── scripts/
│   ├── db-dev.ts                       # Wraps `@prisma/dev` for local Postgres
│   ├── setup-schema.ts                 # `prisma-next db init`
│   ├── seed.ts                         # Insert sample users + posts
│   └── start-dev-db-for-tests.mjs      # Subprocess helper for vitest globalSetup
├── test/
│   ├── global-setup.ts                 # Boots prisma dev, applies schema, seeds
│   ├── worker.integration.test.ts      # vitest-pool-workers integration suite
│   └── cloudflare-test.d.ts            # Pulls in `cloudflare:test` ambient types
├── wrangler.jsonc                      # Hyperdrive binding declaration
├── prisma-next.config.ts               # Contract emit config
├── vitest.config.ts                    # cloudflareTest plugin + globalSetup
└── .env.example                        # Copy → .env, paste prisma dev TCP URL
```

## Setup (local development)

### Prerequisites

- Node satisfying the root `package.json` `engines.node` (`>=24`).
- `pnpm`. Install workspace deps from the repo root with `pnpm install`.

### One-time bootstrap

```bash
cd examples/prisma-next-cloudflare-worker
pnpm emit                        # generate src/prisma/contract.{json,d.ts}
cp .env.example .env             # gitignored
```

### Per-session: start a local Postgres origin

`prisma dev` (`@prisma/dev`) provides a PGlite-backed Postgres reachable over TCP. **Use the TCP `postgres://` URL it prints — not the HTTP `prisma+postgres://` URL, which is Data-Proxy-shaped and incompatible with `pg.Client`.**

In one terminal:

```bash
pnpm db:dev
# → Prisma dev DB running.
# → TCP URL : postgres://postgres:postgres@localhost:51214/template1?sslmode=disable
```

Paste that URL into `.env`:

```bash
WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgres://postgres:postgres@127.0.0.1:51214/template1?sslmode=disable"
```

Wrangler reads this env var to populate the `HYPERDRIVE` binding's local connection string ([Cloudflare docs](https://developers.cloudflare.com/hyperdrive/configuration/local-development)). Note: this goes in **`.env`**, not `.dev.vars` — `.dev.vars` is for runtime worker secrets, not Wrangler configuration. The `WRANGLER_*` prefix is being deprecated in favor of `CLOUDFLARE_*` in newer Wrangler; either works as of `wrangler@4.87`.

### Apply schema and seed

In a second terminal:

```bash
pnpm db:init                     # prisma-next db init → CREATE TABLE …
pnpm seed                        # Insert Alice + Bob + posts
```

`prisma dev` defaults to `persistenceMode: "stateless"` — restart the helper and you'll need to re-init and re-seed.

### Run the Worker locally

```bash
pnpm dev                         # wrangler dev → http://localhost:8787
curl http://localhost:8787/health
curl http://localhost:8787/orm/users?limit=5
```

## Deploy

`wrangler.jsonc` carries a placeholder Hyperdrive `id` (`00000000…`). To deploy to a real Cloudflare account, provision a Hyperdrive config first (M4 task 4.2 will land the production guide):

```bash
pnpm exec wrangler hyperdrive create my-hyperdrive --connection-string="postgres://…"
# Replace the "id" in wrangler.jsonc with the printed binding id.
pnpm deploy
```

## Bundle size

`pnpm deploy:dry-run` (`wrangler deploy --dry-run --outdir dist`) reports:

```
Total Upload: 1290.55 KiB / gzip: 254.23 KiB
```

(254 KiB compressed, well under the 1 MB AC-19 budget.)

The bundle includes `pg`, `pg-protocol`, `pg-types`, `pg-cursor`, `pg-pool` (statically imported by `@prisma-next/driver-postgres` even though `postgresServerless` does not construct a `Pool` at runtime), `pg-cloudflare` (auto-pulled by `pg` when `navigator.userAgent === 'Cloudflare-Workers'`), and `@cloudflare/unenv-preset` polyfills.

## Integration tests (`vitest-pool-workers`)

The integration suite under `test/` boots the Worker under `workerd` via `vitest-pool-workers`, points the Hyperdrive binding at a `prisma dev` instance launched in `test/global-setup.ts`, and exercises the SQL DSL, ORM, transactions, and cursor early-break paths.

```bash
pnpm test
```

> **Known issue, October 2026 — not currently passing locally against `prisma dev`.** The combination of `vitest-pool-workers` (and `wrangler dev`) + `pg`/`pg-cloudflare` + a `prisma dev` (PGlite) origin hangs after the Worker calls `pg.Client.connect()` through miniflare's Hyperdrive emulator. The `pg-cloudflare` socket reports "Connection terminated unexpectedly" but the test runner never recovers.
>
> Two upstream issues are in the loop:
> - [`cloudflare/workers-sdk#12984`](https://github.com/cloudflare/workers-sdk/issues/12984) — Vite 8's rolldown resolver mis-resolves `pg`'s dual ESM/CJS exports under `vitest-pool-workers`. Worked around in `vitest.config.ts` via `test.deps.optimizer.ssr.{include, rolldownOptions.external}`. Issue #12984 also documents a third "Cannot perform I/O on behalf of a different Durable Object" failure that may be the same root cause as the runtime hang seen here.
> - The same hang reproduces in plain `wrangler dev` against `prisma dev`. The M1 audit (against a real Postgres origin, not `prisma dev`) succeeded, so the failure may be specific to PGlite's TCP shim interacting with `pg-cloudflare`'s socket.
>
> When this is unblocked, the canonical invocation is `pnpm test:examples --filter prisma-next-cloudflare-worker` from the repo root.

## Troubleshooting

- **`pnpm db:init` fails with a connection error.** Confirm `pnpm db:dev` is still running and that `.env` has the URL it printed (with `127.0.0.1` rather than `localhost`).
- **`wrangler dev` boots but `/orm/users` hangs.** Known issue (above). `GET /health` should still return `{ "ok": true }`.
- **`prisma dev` rejects a second connection.** It enforces a single active connection per server; close the previous client (or just bounce the helper).
- **Bundle includes `pg-cloudflare` even though I'm running on Node.** Expected — `pg` static-imports `pg-cloudflare` via `lib/stream.js`, and runtime detection (`navigator.userAgent === 'Cloudflare-Workers'`) picks the right socket implementation.

## Known limitations

- **Transaction affinity** — every `withTransaction` body must run on the same `runtime` instance (the per-request one). Crossing `runtime` boundaries inside a transaction body is undefined.
- **Isolate memory** — large result sets bound through cursor by default (`postgresServerless` enables cursor unconditionally). For ORM `findMany`-style operations the result set is materialized; size your `take(...)` accordingly.
- **`pg.Pool` not used** — the serverless facade routes through `PostgresDirectDriverImpl` (`pgClient` binding kind). No connection pooling within the isolate; that's Hyperdrive's job in production.
- **Production `id`** — the committed `wrangler.jsonc` has a zero-stuffed Hyperdrive `id`. Deploy will fail until a real id is wired in (M4).
