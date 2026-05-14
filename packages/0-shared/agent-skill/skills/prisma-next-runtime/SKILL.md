---
name: prisma-next-runtime
description: Wire the Prisma Next runtime — db.ts setup, middleware composition (telemetry, lints, budgets), connection configuration, per-environment config, Vite/Next no-emit plugin, switching targets. Use for db.ts, postgres(), mongo(), middleware, telemetry, query log, lints, budgets, DATABASE_URL, .env, connection pool, dev vs prod config, vite plugin, next plugin, no-emit, read replicas, multi-database.
---

# Prisma Next — Runtime (`db.ts` Wiring)

> **Edit your data contract. Prisma handles the rest.**

This skill covers the **runtime entry point** — `db.ts` — and how to
compose the database client with extensions, middleware, and
environment configuration.

## When to Use

- User is wiring up `db.ts` for the first time (post-init).
- User wants to add middleware (telemetry, lints, budgets, custom).
- User wants per-environment config (dev vs prod, multi-region).
- User wants to switch targets (Postgres ↔ Mongo).
- User wants to use the no-emit Vite/Next plugin.
- User mentions: *db.ts, postgres(), mongo(), middleware, telemetry,
  query log, lints, budgets, DATABASE_URL, .env, connection pool, dev
  vs prod, vite plugin, next plugin, read replicas, multi-database*.

## When Not to Use

- User wants to write queries → `prisma-next-queries`.
- User wants to edit the contract → `prisma-next-contract`.
- User wants to debug a connection / runtime error → `prisma-next-debug`.

## Key Concepts (before any workflow)

- **`db.ts` is the runtime entry point.** Imports `@prisma-next/postgres`
  (or `mongo`), the contract artifacts (`contract.json` + the
  `Contract` type from `contract.d.ts`), and any middleware. Exports a
  `db` value the rest of your app imports.
- **Middleware** wraps every operation. Telemetry, lints, budgets ship
  in `@prisma-next/postgres/middleware`; extensions can contribute
  more. Middleware composes in order — the first one passed runs
  outermost.
- **`prisma-next.config.ts` vs `.env`**: the config file is for static
  config (target, contract path, extensions, capabilities); `.env` is
  for per-environment values (`DATABASE_URL`, secrets). Don't put
  secrets in the config.
- **Vite / Next plugin**: an alternative dev flow where contract
  artifacts are computed at build time (no on-disk `contract.json` /
  `contract.d.ts`). For production builds, still emit explicitly.

## Workflow — Basic `db.ts`

Init scaffolds something like:

```typescript
// prisma/db.ts
import postgres from '@prisma-next/postgres/runtime';
import type { Contract, TypeMaps } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

export const db = postgres<Contract, TypeMaps>({
  contractJson,
  url: databaseUrl,
});
```

The `Contract` type parameter is **critical** — without it, types
collapse to a generic shape. See the comment in `db.ts` for the
rationale.

## Add telemetry middleware

```typescript
import postgres from '@prisma-next/postgres/runtime';
import { createTelemetryMiddleware } from '@prisma-next/postgres/middleware';
import type { Contract, TypeMaps } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract, TypeMaps>({
  contractJson,
  url: process.env['DATABASE_URL']!,
  middleware: [
    createTelemetryMiddleware({ serviceName: 'my-app' }),
  ],
});
```

Telemetry middleware emits OpenTelemetry spans for each operation.
Pair with your observability stack's collector.

## Add lints middleware

Lints catch common mistakes at runtime — querying without `.where`
filters that should be required, returning entire tables without a
limit, etc.

```typescript
import { lints } from '@prisma-next/postgres/middleware';

middleware: [
  lints({
    requireWhere: ['User', 'Order'],  // these models must have a .where()
    maxRowsWithoutLimit: 1000,
  }),
];
```

Lints throw / log on violation depending on configuration.

## Add budgets middleware

Budgets enforce time / row-count caps per operation.

```typescript
import { budgets } from '@prisma-next/postgres/middleware';

middleware: [
  budgets({
    maxDurationMs: 5_000,
    maxRows: 10_000,
  }),
];
```

A query that exceeds either budget throws a structured error.

## Compose multiple middleware

```typescript
middleware: [
  createTelemetryMiddleware({ serviceName: 'my-app' }),  // outermost
  lints({ requireWhere: ['User'] }),
  budgets({ maxDurationMs: 5_000 }),                      // innermost
];
```

Order matters: outermost wraps. Telemetry first means budgets / lints
failures are captured as spans.

## Add an extension-contributed middleware

Some extensions ship middleware (e.g. an audit-log middleware). Import
from the extension's `middleware` entry:

```typescript
import { auditMiddleware } from '@prisma-next/postgres-extension-audit/middleware';

middleware: [
  createTelemetryMiddleware({ serviceName: 'my-app' }),
  auditMiddleware({ destination: 'kafka' }),
];
```

Check the extension's README for its middleware exports.

## Configure the connection

Three sources of truth, in precedence order (later overrides earlier):

1. **`db.connection` in `prisma-next.config.ts`** — static config the
   CLI uses for emit / verify. Rarely set; prefer `.env`.
2. **`DATABASE_URL` env var (loaded from `.env` by `dotenv/config`)** —
   default; read by both the CLI and the runtime.
3. **`--db <url>` CLI flag** — overrides everything else for one
   command. Use for one-off invocations against a different DB.

```typescript
// Bad: hardcoding the URL in the config file.
// Leaks credentials. Bypasses per-environment overrides.
export default definePnConfig({
  target: 'postgres',
  contract: { path: 'prisma/schema.psl', authoring: 'psl' },
  connection: { url: 'postgresql://app:secret@localhost/db' },
});

// Good: read from the env var.
import 'dotenv/config';
export default definePnConfig({
  target: 'postgres',
  contract: { path: 'prisma/schema.psl', authoring: 'psl' },
});
// DATABASE_URL is read by the runtime + CLI automatically.
```

## Per-environment config (dev vs prod)

Use environment variables — one `DATABASE_URL` per environment.
`.env` for local dev; the deploy platform's secrets for prod.

```
# .env (local)
DATABASE_URL=postgresql://localhost:5432/myapp_dev

# .env.production (set on the deploy platform, NOT committed)
DATABASE_URL=postgresql://prod-host:5432/myapp_prod
```

For more complex per-env divergence (different middleware in dev vs
prod, different lints), branch in `db.ts`:

```typescript
const isProd = process.env['NODE_ENV'] === 'production';

export const db = postgres<Contract, TypeMaps>({
  contractJson,
  url: process.env['DATABASE_URL']!,
  middleware: isProd
    ? [createTelemetryMiddleware({ serviceName: 'my-app' })]
    : [createTelemetryMiddleware({ serviceName: 'my-app-dev' }),
       lints({ requireWhere: ['User'] })],  // strict lints in dev
});
```

## Switch targets (Postgres ↔ Mongo)

If a project needs to switch its underlying target:

1. Re-init: `pnpm prisma-next init --reinit --target mongodb` (or
   `--target postgres`).
2. PN re-scaffolds `prisma-next.config.ts` and `db.ts` for the new
   target.
3. Re-author the contract for the new target's idioms (Mongo uses
   nested documents; Postgres uses relations).
4. `contract emit` + `db init` against the new DB.

`db.ts` ends up importing from `@prisma-next/mongo/runtime` instead of
`@prisma-next/postgres/runtime`. The `db` API surface stays the same.

## Vite plugin (no-emit dev flow)

For TS-authored contracts, you can skip the on-disk `contract.json` /
`contract.d.ts` files and let Vite emit them at build time:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { prismaNext } from '@prisma-next/vite';

export default defineConfig({
  plugins: [prismaNext({ configPath: './prisma-next.config.ts' })],
});
```

Then in `db.ts`, import virtual modules:

```typescript
import postgres from '@prisma-next/postgres/runtime';
import type { Contract, TypeMaps } from 'virtual:prisma-next/contract.d';
import contractJson from 'virtual:prisma-next/contract.json';

export const db = postgres<Contract, TypeMaps>({ contractJson, url: process.env['DATABASE_URL']! });
```

For production builds where you can't rely on the plugin, run
`prisma-next contract emit` to materialize the artifacts.

## Next.js equivalent

Same pattern, different config file:

```typescript
// next.config.ts
import { withPrismaNext } from '@prisma-next/next';
export default withPrismaNext({ configPath: './prisma-next.config.ts' })({ /* nextConfig */ });
```

## Common Pitfalls

1. **Hardcoding `DATABASE_URL` in `prisma-next.config.ts`.** Leaks
   credentials; bypasses per-environment overrides. Use `.env`.
2. **Omitting the `Contract` type parameter** in
   `postgres<Contract, TypeMaps>(...)`. Without it, types collapse to
   a generic shape and you lose autocomplete for models.
3. **Forgetting `with { type: 'json' }` on the contract import.**
   Required by Node's ESM JSON-import attribute spec.
4. **Middleware order matters.** Outermost wraps; put telemetry
   first if you want it to capture inner-middleware errors.
5. **Switching targets without re-emitting.** The contract artifacts
   are target-shaped; emit after the target change.

## What Prisma Next doesn't do yet

- **Multi-database routing / read replicas.** Prisma Next doesn't
  ship a built-in primary/replica router or shard-aware client.
  Workaround: configure separate `db.ts` instances per data store
  and call the right one in your application code. If you need
  first-class multi-database routing, file a feature request:
  <https://github.com/prisma/prisma-next/issues/new>.
- **Connection pooling tuning as a first-class config field.** The
  underlying driver (`pg`, `mongodb`) accepts pool options, and you
  can pass them through, but PN doesn't surface them in
  `prisma-next.config.ts`. Workaround: pass driver options through
  the `postgres({ driverOptions: { ... } })` parameter. If you need
  first-class pool config, file a feature request:
  <https://github.com/prisma/prisma-next/issues/new>.
- **Query logger middleware as a built-in.** Prisma Next doesn't ship
  a "log every query" middleware. Workaround: write a small custom
  middleware that wraps each operation and logs; or use the telemetry
  middleware and inspect spans. If you need a built-in query log,
  file a feature request:
  <https://github.com/prisma/prisma-next/issues/new>.

## Reference Files

- `references/middleware-api.md` — the middleware contract; how to author a custom one.
- `references/connection-config.md` — every connection-config option PN forwards to the driver.
- `references/vite-plugin.md` / `references/next-plugin.md` — plugin options.

## Checklist

- [ ] `db.ts` imports the runtime, the contract, the type maps with the right type parameter.
- [ ] `with { type: 'json' }` on the contract import.
- [ ] `DATABASE_URL` lives in `.env`, not in `prisma-next.config.ts`.
- [ ] Middleware ordered intentionally (telemetry outermost typically).
- [ ] Per-env divergence (if any) gated by `NODE_ENV` or similar.
- [ ] Did NOT hardcode credentials in any committed file.
- [ ] Did NOT confabulate read-replica / multi-DB / connection-pool config — pointed at the capability-gap section + feature-request URL.
