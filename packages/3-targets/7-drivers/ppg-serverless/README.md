# @prisma-next/driver-ppg-serverless

Prisma Postgres (PPG) serverless driver for Prisma Next.

## Package Classification

- **Domain**: targets
- **Layer**: drivers
- **Plane**: runtime

## Overview

The PPG serverless driver provides WebSocket-based transport and connection management for Prisma Postgres, using the official `@prisma/ppg` client. It implements the `SqlDriver` interface for executing SQL statements and managing connections over a WebSocket-only transport — there is no TCP fallback and no `pg-cursor` dependency, so the driver is portable to edge runtimes that do not expose raw TCP sockets.

In Prisma Next, "driver" refers to the Prisma Next interface (not the underlying client library). Drivers are transport-agnostic from the framework's perspective: they own pooling, connection management, and transport protocol (TCP, HTTP, WebSocket, etc.), but contain no dialect-specific logic. All dialect behavior lives in adapters. Instantiation is separate from connection; `create()` returns an unbound driver, `connect(binding)` binds at the boundary ([ADR 159](../../../../docs/architecture%20docs/adrs/ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md)).

This package reuses the existing `postgres` target and `postgres` adapter (same `familyId: 'sql'`, same `targetId: 'postgres'` as `@prisma-next/driver-postgres`), exposing only a runtime entry point. The migration / control plane continues to be served by `@prisma-next/driver-postgres/control`.

> **Slice 1 placeholder:** the current `./runtime` export ships a descriptor whose `SqlDriver` methods throw `"driver-ppg-serverless: runtime not implemented; landing in Slice 2"`. The real `@prisma/ppg` transport, the `PpgBinding` discriminated union, and the connection lifecycle wiring land in subsequent slices.

## Purpose

Provide a WebSocket-based PPG transport for Prisma Next that runs in edge and serverless environments where raw TCP is unavailable. Execute SQL statements and manage connections without dialect-specific logic.

## Responsibilities

- **Connection Management**: Acquire and release database connections over `@prisma/ppg`
- **Statement Execution**: Execute SQL statements with parameters
- **Query Explanation**: Execute EXPLAIN queries for query analysis
- **Transport Protocol**: Handle the Prisma Postgres WebSocket protocol via `@prisma/ppg`

**Non-goals:**
- Dialect-specific SQL lowering (adapters)
- Query compilation (sql-query)
- Runtime execution orchestration (runtime)
- TCP transport — TCP-based PostgreSQL is served by `@prisma-next/driver-postgres`
- Streaming cursors (no `pg-cursor` equivalent on PPG; streaming semantics will be addressed when the real runtime lands)

## Architecture

<!-- TODO: Slice 2 -->

## Components

### Descriptor metadata (`src/core/descriptor-meta.ts`)
- Exports `ppgServerlessDriverDescriptorMeta` with `kind: 'driver'`, `familyId: 'sql'`, `targetId: 'postgres'`, `id: 'ppg-serverless'`.

### Runtime descriptor (`src/exports/runtime.ts`)
- Default export: the `RuntimeDriverDescriptor` consumers register with the runtime.
- Slice 1 placeholder; real implementation lands in Slice 2.

## Dependencies

- **`@prisma/ppg`**: Prisma Postgres WebSocket client (pinned in the workspace catalog at `1.0.1`).
- **`@prisma-next/framework-components`**: Driver descriptor + instance types.
- **`@prisma-next/sql-relational-core`**: `SqlDriver` interface.
- **`@prisma-next/sql-contract`**, **`@prisma-next/sql-errors`**, **`@prisma-next/sql-operations`**, **`@prisma-next/contract`**, **`@prisma-next/errors`**, **`@prisma-next/utils`**: standard SQL-driver dependencies.

## Related Subsystems

- **[Adapters & Targets](../../docs/architecture%20docs/subsystems/5.%20Adapters%20&%20Targets.md)**: Driver specification

## Related ADRs

- [ADR 159 — Driver Terminology and Lifecycle](../../../../docs/architecture%20docs/adrs/ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md)
- [ADR 005 — Thin Core Fat Targets](../../../../docs/architecture%20docs/adrs/ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md)
- [ADR 016 — Adapter SPI for Lowering](../../../../docs/architecture%20docs/adrs/ADR%20016%20-%20Adapter%20SPI%20for%20Lowering.md)

## Usage

<!-- TODO: Slice 2 -->

## Exports

- `./runtime`: Runtime entry point for the PPG serverless driver
  - Default: `ppgServerlessRuntimeDriverDescriptor` — use `create()` for an unbound driver, then `connect(binding)` (Slice 2).
