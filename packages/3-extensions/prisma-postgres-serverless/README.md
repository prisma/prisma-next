# @prisma-next/prisma-postgres-serverless

Edge/serverless-friendly Prisma Postgres facade for Prisma Next. Install this single package to get config, runtime, and the transitive type dependencies needed to author and run a Prisma Postgres app against the `@prisma/ppg` WebSocket client — no `pg` and no TCP transport on the data plane, so the runtime entry is portable to edge runtimes that do not expose raw TCP sockets.

The facade composes the existing Postgres execution stack with a different driver:

- the existing `postgres` target (`@prisma-next/target-postgres`) — same dialect, same migration ops.
- the existing `postgres` adapter (`@prisma-next/adapter-postgres`) — shared SQL lowering.
- the new `@prisma-next/driver-ppg-serverless` driver — WebSocket transport via `@prisma/ppg`.

It is the serverless sibling of [`@prisma-next/postgres`](../postgres/README.md) (the long-lived Node-process facade backed by TCP `pg`). Pick the facade that matches your deployment lifecycle; both expose the same authoring + ORM surface.

## Package Classification

- **Domain**: extensions
- **Layer**: adapters
- **Planes**: shared (`config`, `contract-builder`, `control`, `family`, `target`), runtime (`runtime`), migration (`migration`)

## Quick Start

```typescript
// prisma-next.config.ts
import { defineConfig } from '@prisma-next/prisma-postgres-serverless/config';

export default defineConfig({
  contract: './prisma/contract.prisma',
  db: { connection: process.env['PPG_URL']! },
});
```

```typescript
// db.ts
import prismaPostgresServerless from '@prisma-next/prisma-postgres-serverless/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = prismaPostgresServerless<Contract>({
  contractJson,
  url: process.env['PPG_URL']!,
});
```

### Cloudflare Workers

```typescript
// worker.ts
import prismaPostgresServerless from '@prisma-next/prisma-postgres-serverless/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

interface Env {
  PPG_URL: string;
}

export default {
  async fetch(_req: Request, env: Env): Promise<Response> {
    const db = prismaPostgresServerless<Contract>({
      contractJson,
      url: env.PPG_URL,
    });
    try {
      const rows = await db.orm.User.findMany();
      return Response.json(rows);
    } finally {
      await db.close();
    }
  },
};
```

The PPG-compatible URL form is `postgres://identifier:key@db.prisma.io:5432/postgres?sslmode=require`. The `prisma+postgres://accelerate.prisma-data.net/?api_key=…` form returned by Prisma Accelerate / data-proxy is **not** a PPG URL — it carries a different wire protocol (GraphQL over HTTPS) and is rejected by `@prisma/ppg` upstream of the facade. If you provision via the Prisma Data Platform Management API, take the URL from `endpoints.pooled.connectionString`.

## Runtime environments

The runtime entry uses only `fetch` and `WebSocket` at runtime (transitively, through `@prisma/ppg`). Tested under:

- Node.js 20+
- Cloudflare Workers
- Vercel Edge Functions
- Deno / Deno Deploy
- Bun (Node + edge)

## Exports

| Subpath | Status | Notes |
|---|---|---|
| `./runtime` | Substantive | `prismaPostgresServerless<Contract>(options)` factory. Returns a client with `sql` / `orm` / `context` / `runtime()` / `connect()` / `transaction()` / `prepare()` / `close()` / `[Symbol.asyncDispose]`. |
| `./config` | Re-export | `@prisma-next/postgres/config` (`defineConfig`). |
| `./contract-builder` | Re-export | `@prisma-next/postgres/contract-builder` (`defineContract`, `field`, `model`, `rel`, …). |
| `./control` | Re-export | `@prisma-next/postgres/control` (control-plane descriptor + `createPostgresControlClient` for migration tooling). Pulls `pg` into the install graph; never into the runtime bundle. |
| `./family` | Re-export | `@prisma-next/family-sql/pack` (the value passed as `family:` to `defineContract`). |
| `./migration` | Re-export | `@prisma-next/target-postgres/migration` — `Migration` base class, CLI runner, op helpers. |
| `./target` | Re-export | `@prisma-next/target-postgres/pack` (the value passed as `target:` to `defineContract`). |

Compared to `@prisma-next/postgres`, two exports are deliberately absent:

- **No `./serverless`.** This package _is_ the serverless surface; there is no second facade hiding behind a subpath.
- No separate Node / Pool factory — the runtime is always per-call session-based (one `@prisma/ppg` session per top-level call; one long-lived session per `acquireConnection()`), so there is no `pg.Pool` to surface.

## Authoring + ORM

The contract-builder, family, and target re-exports point at the same packages `@prisma-next/postgres` uses, so contracts authored against either facade are interchangeable:

```typescript
import { defineContract, field, model } from '@prisma-next/prisma-postgres-serverless/contract-builder';

export const contract = defineContract(
  { extensionPacks: {} },
  ({ field: f, model: m }) => ({
    models: {
      Item: m('Item', {
        fields: {
          id: f.id.uuidv7(),
          name: f.text(),
        },
      }),
    },
  }),
);
```

The migration plane runs over a direct TCP connection (re-exported `./control` from `@prisma-next/postgres/control`). Running migrations in CI / locally typically uses the same `prisma-next` CLI tooling against a TCP URL; runtime queries from Workers / Edge use the WebSocket data plane. Both planes target the same Prisma Postgres database.

## Binding variants

The `runtime()` factory accepts one of three binding inputs (exactly one):

```typescript
// (a) Connection-string URL — the facade constructs and owns the PPG client.
//     Array-OID parsers are registered automatically.
const db = prismaPostgresServerless({ contractJson, url: env.PPG_URL });

// (b) Pre-built @prisma/ppg Client — the caller owns the lifecycle.
//     Wire array parsers in yourself if you read array-typed columns
//     (text[], uuid[], int4[], jsonb[], …).
import { client as createPpgClient, defaultClientConfig } from '@prisma/ppg';
import { withArrayParsers } from '@prisma-next/driver-ppg-serverless/runtime';

const config = defaultClientConfig(env.PPG_URL);
const ppgClient = createPpgClient({
  ...config,
  parsers: withArrayParsers(config.parsers ?? []),
});
const db = prismaPostgresServerless({ contractJson, ppgClient });

// (c) Explicit driver binding — pass a `PpgBinding` discriminated union.
const db = prismaPostgresServerless({
  contractJson,
  binding: { kind: 'url', url: env.PPG_URL },
});
```

## Transactions

`db.transaction(fn)` opens a long-lived session, issues `BEGIN`, runs the callback, then `COMMIT`s on return or `ROLLBACK`s on throw. The callback receives a transaction-scoped `tx` whose `orm` / `sql` / `context` mirror `db`'s top-level surface:

```typescript
await db.transaction(async (tx) => {
  await tx.orm.Item.create({ id: crypto.randomUUID(), name: 'alice' });
  await tx.orm.Item.create({ id: crypto.randomUUID(), name: 'bob' });
});
// Both rows committed atomically. Throw inside the callback to roll back.
```

## Responsibilities

- Build a static Prisma Postgres execution stack from target, adapter, and driver descriptors.
- Build a typed SQL authoring surface and ORM root from the execution context.
- Normalise runtime binding input (`binding`, `url`, `ppgClient`).
- Lazily instantiate runtime resources on first `db.runtime()` or `db.connect(...)` call; memoise so repeated calls return one instance.
- Forward the control / config / contract-builder surfaces from `@prisma-next/postgres` so consumers get a single-import experience.

## Dependencies

- `@prisma/ppg` (via `@prisma-next/driver-ppg-serverless`) — Prisma Postgres WebSocket client.
- `@prisma-next/sql-runtime` — stack / context / runtime primitives.
- `@prisma-next/framework-components/execution` — stack instantiation.
- `@prisma-next/target-postgres` — target descriptor (shared with the long-lived facade).
- `@prisma-next/adapter-postgres` — adapter descriptor (shared with the long-lived facade).
- `@prisma-next/driver-ppg-serverless` — driver descriptor (this facade's defining choice).
- `@prisma-next/postgres` — re-exported for the `./config`, `./contract-builder`, and `./control` surfaces. Pulls `pg` into the install graph through the control re-export, but the runtime bundle stays edge-clean (bundlers tree-shake the unimported `./control` re-export from the `./runtime` entry).
- `@prisma-next/sql-builder`, `@prisma-next/sql-orm-client`, `@prisma-next/sql-contract` — authoring + ORM surfaces.

## Architecture

```mermaid
flowchart TD
    App[App Code] --> Client[prisma-postgres-serverless runtime]
    Client --> Static[Roots: sql, orm, context, contract]
    Client --> Lazy[runtime / connect]

    Lazy --> Bind[Resolve binding: url, ppgClient, or binding]
    Bind --> NewSession[ppg Client.newSession per call or per connection]
    Lazy --> Runtime[createRuntime]

    Runtime --> Target[@prisma-next/target-postgres]
    Runtime --> Adapter[@prisma-next/adapter-postgres]
    Runtime --> Driver[@prisma-next/driver-ppg-serverless]
    Runtime --> SqlRuntime[@prisma-next/sql-runtime]
    Runtime --> ExecPlane[@prisma-next/framework-components/execution]
```

## Related Docs

- Architecture: [`docs/Architecture Overview.md`](../../docs/Architecture%20Overview.md)
- Subsystem: [`docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`](../../docs/architecture%20docs/subsystems/4.%20Runtime%20%26%20Middleware%20Framework.md)
- Subsystem: [`docs/architecture docs/subsystems/5. Adapters & Targets.md`](../../docs/architecture%20docs/subsystems/5.%20Adapters%20%26%20Targets.md)
- ADR: [`docs/architecture docs/adrs/ADR 207 - Per-environment facade asymmetry.md`](../../docs/architecture%20docs/adrs/ADR%20207%20-%20Per-environment%20facade%20asymmetry.md)
