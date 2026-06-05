# @prisma-next/driver-ppg-serverless

Prisma Postgres (PPG) serverless driver for Prisma Next. WebSocket-only data-plane transport via the official `@prisma/ppg` client — no `pg`, no TCP, no `pg-cursor`, portable to edge runtimes that do not expose raw TCP sockets.

## Package Classification

- **Domain**: targets
- **Layer**: drivers
- **Planes**: runtime (`./runtime`), migration (`./control`)

## Overview

The PPG serverless driver implements the `SqlDriver` interface for Prisma Next, using `@prisma/ppg` as its sole transport. Every call goes through a `Client.newSession()` WebSocket session: top-level `execute` / `query` / `executePrepared` open a one-shot session per call, while `acquireConnection()` returns a long-lived session the caller can reuse across operations and an explicit `BEGIN` / `COMMIT` / `ROLLBACK` transaction. There is no connection pool at this layer — PPG handles pooling on the wire side.

In Prisma Next, "driver" refers to the Prisma Next interface (not the underlying client library). Drivers are transport-agnostic from the framework's perspective: they own connection management and transport protocol (TCP, HTTP, WebSocket, …) but contain no dialect-specific logic. Dialect behaviour lives in adapters. Instantiation is separate from connection; `create()` returns an unbound driver, `connect(binding)` binds at the boundary ([ADR 159](../../../../docs/architecture%20docs/adrs/ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md)).

This package reuses the existing `postgres` target and `postgres` adapter (same `familyId: 'sql'`, same `targetId: 'postgres'` as `@prisma-next/driver-postgres`). The runtime entry binds to `@prisma/ppg`; the control entry re-exports `@prisma-next/driver-postgres/control` so migrations / `dbInit` / `dbVerify` continue to run over a direct TCP connection (those are not edge workloads and do not need to be wire-compatible with PPG).

## Purpose

Provide a WebSocket-based PPG transport for Prisma Next that runs in edge and serverless environments where raw TCP is unavailable.

## Responsibilities

- **Session lifecycle**: open / close `@prisma/ppg` sessions; one per call for the top-level API, one per `acquireConnection()` for the long-lived API.
- **Statement execution**: execute SQL statements with parameters; collect rows or stream them via PPG's `CollectableIterator`.
- **Row hydration**: map PPG's positional `Row.values` into framework-shaped name-keyed records, and lift array-typed columns (`text[]`, `int4[]`, `jsonb[]`, …) into JS arrays at the driver boundary so the framework's adapter layer sees the same row shape it sees from `@prisma-next/driver-postgres`.
- **Transactions**: issue `BEGIN` / `COMMIT` / `ROLLBACK` on a long-lived session via `beginTransaction()`.
- **Error normalisation**: translate PPG's `DatabaseError` / `WebSocketError` / `ValidationError` into the same `SqlQueryError`-shaped surface that `driver-postgres` produces.

**Non-goals:**

- Dialect-specific SQL lowering (adapters).
- Query compilation (`sql-query`).
- Runtime execution orchestration (`sql-runtime`).
- TCP transport — served by `@prisma-next/driver-postgres`.
- Streaming cursors with explicit batch sizes — PPG's `CollectableIterator` streams row-by-row; the `pg-cursor`-style `cursor: { batchSize }` option from `driver-postgres` has no equivalent here.
- First-class prepared statements with explicit handles — PPG has no client-side `PREPARE` step (parameters are still safely parameterised). `executePrepared` collapses to `execute`; the `handle` argument is accepted for interface compatibility but never written.

## Architecture

```mermaid
flowchart TD
    Caller[Caller: facade or createBoundDriverFromBinding]
    Driver[PpgServerlessRuntimeDriver]
    Resolve[Resolve binding kind url or ppgClient]
    OwnClient[Construct @prisma/ppg Client from URL + withArrayParsers]
    BorrowClient[Use caller-owned @prisma/ppg Client]
    OneShot[client.newSession per call]
    LongLived[client.newSession per acquireConnection]
    PPG[Prisma Postgres service]

    Caller --> Driver
    Driver --> Resolve
    Resolve -->|url| OwnClient
    Resolve -->|ppgClient| BorrowClient
    OwnClient --> OneShot
    OwnClient --> LongLived
    BorrowClient --> OneShot
    BorrowClient --> LongLived
    OneShot -->|WebSocket| PPG
    LongLived -->|WebSocket| PPG
```

## Usage

The driver descriptor is the default export from `./runtime`. The `create()` method returns an unbound driver; `connect(binding)` binds it to a `@prisma/ppg` client.

```typescript
import ppgServerlessDriver from '@prisma-next/driver-ppg-serverless/runtime';

const driver = ppgServerlessDriver.create();
await driver.connect({
  kind: 'url',
  url: process.env['PPG_URL']!,
});

// driver is now bound; use acquireConnection, execute, query, etc.
```

### Binding variants

```typescript
import { client as createPpgClient, defaultClientConfig } from '@prisma/ppg';
import ppgServerlessDriver, {
  withArrayParsers,
} from '@prisma-next/driver-ppg-serverless/runtime';

// (a) URL binding — the driver constructs and owns the PPG client.
//     Array-OID parsers are registered automatically.
await driver.connect({ kind: 'url', url: 'postgres://identifier:key@db.prisma.io:5432/postgres?sslmode=require' });

// (b) ppgClient binding — the caller owns the client and its lifecycle.
//     Wire array parsers into the client config yourself if you read
//     array-typed columns (text[], uuid[], int4[], jsonb[], …).
const config = defaultClientConfig('postgres://identifier:key@db.prisma.io:5432/postgres?sslmode=require');
const ppgClient = createPpgClient({
  ...config,
  parsers: withArrayParsers(config.parsers ?? []),
});
await driver.connect({ kind: 'ppgClient', client: ppgClient });
```

The PPG-compatible URL form is `postgres://identifier:key@db.prisma.io:5432/postgres?sslmode=require`. The `prisma+postgres://accelerate.prisma-data.net/?api_key=…` form returned by Prisma Accelerate / data-proxy is **not** a PPG URL — it carries a different wire protocol (GraphQL over HTTPS) and is rejected by `@prisma/ppg`'s own connection-string parser. If you provision via the Prisma Data Platform Management API, use `endpoints.pooled.connectionString` for the PPG data plane.

### Runtime environments

The driver and its dependencies (`@prisma/ppg`, `postgres-array`) use only `fetch` and `WebSocket` at runtime. Tested under:

- Node.js 20+
- Cloudflare Workers
- Vercel Edge Functions
- Deno / Deno Deploy
- Bun (Node + edge)

## Components

### Driver runtime (`src/ppg-driver.ts`)

- `PpgServerlessBoundDriverImpl` — the bound driver. Owns the `@prisma/ppg` `Client` (when the binding was `{ kind: 'url' }`) or borrows it (when the binding was `{ kind: 'ppgClient' }`).
- `PpgServerlessSessionConnection` — the long-lived session opened by `acquireConnection()`.
- `PpgServerlessSessionTransaction` — wraps a session inside `BEGIN` / `COMMIT` / `ROLLBACK`.
- `createBoundDriverFromBinding(binding)` — exported for facade composition; resolves a `PpgBinding` into a bound driver, wiring `withArrayParsers` when constructing the client from a URL.

### Array-OID parsers (`src/core/array-parsers.ts`)

`@prisma/ppg`'s `defaultClientConfig` ships parsers for scalar OIDs only (bool, int*, float*, text/varchar, json/jsonb). Without extension, array-typed columns surface as the raw Postgres text-format string (`'{a,b,c}'`) — but the framework's adapter layer assumes the driver hydrates `text[]` as JS arrays, matching `pg`'s native behaviour. `withArrayParsers` lifts a scalar-only parser table into one that also handles the array variants (`_bool`, `_int2`, `_int4`, `_int8`, `_float4`, `_float8`, `_text`, `_varchar`, `_json`, `_jsonb`). The driver wires it automatically for `{ kind: 'url' }` bindings; users supplying their own `Client` (the `ppgClient` binding) opt in by calling the exported helper.

### Error normalisation (`src/normalize-error.ts`)

Translates PPG's three error classes into framework `SqlQueryError` subclasses. Same surface that `@prisma-next/driver-postgres` produces, so middleware and user error handling can branch on error kind, not on driver.

### Descriptor metadata (`src/core/descriptor-meta.ts`)

Exports `ppgServerlessDriverDescriptorMeta` with `kind: 'driver'`, `familyId: 'sql'`, `targetId: 'postgres'`, `id: 'ppg-serverless'`.

## Dependencies

- **`@prisma/ppg`**: Prisma Postgres WebSocket client (pinned in the workspace catalog at `1.0.1`).
- **`postgres-array`**: Postgres array-text-format decoder (pinned at `2.0.0`; pure-JS, edge-safe).
- **`@prisma-next/driver-postgres`**: re-exported by `./control` for the migration plane.
- **`@prisma-next/framework-components`**: Driver descriptor + instance types.
- **`@prisma-next/sql-relational-core`**: `SqlDriver` interface.
- **`@prisma-next/sql-contract`**, **`@prisma-next/sql-errors`**, **`@prisma-next/sql-operations`**, **`@prisma-next/contract`**, **`@prisma-next/errors`**, **`@prisma-next/utils`**: standard SQL-driver dependencies.

## Related Subsystems

- **[Adapters & Targets](../../../../docs/architecture%20docs/subsystems/5.%20Adapters%20%26%20Targets.md)**: Driver specification.

## Related ADRs

- [ADR 159 — Driver Terminology and Lifecycle](../../../../docs/architecture%20docs/adrs/ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md)
- [ADR 005 — Thin Core Fat Targets](../../../../docs/architecture%20docs/adrs/ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md)
- [ADR 016 — Adapter SPI for Lowering](../../../../docs/architecture%20docs/adrs/ADR%20016%20-%20Adapter%20SPI%20for%20Lowering.md)

## Exports

- `./runtime` — Runtime entry point.
  - Default: `ppgServerlessRuntimeDriverDescriptor`. Use `create()` for an unbound driver, then `connect(binding)`.
  - Named: `createBoundDriverFromBinding`, `withArrayParsers`.
  - Types: `PpgBinding`, `PpgServerlessDriverCreateOptions`, `PpgServerlessRuntimeDriver`.
- `./control` — Migration-plane entry point.
  - Re-exports `@prisma-next/driver-postgres/control` so consumers can drive migrations through a single import surface alongside the data-plane runtime. Pulls `pg` into the install graph but never into the runtime bundle; bundlers tree-shake the unimported control re-export.
