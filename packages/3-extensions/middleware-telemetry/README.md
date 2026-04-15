# @prisma-next/middleware-telemetry

A generic, family-agnostic telemetry middleware for Prisma Next runtimes.

## Purpose

This package is a **proof-of-concept** demonstrating that the `RuntimeMiddleware` SPI works across both SQL and Mongo runtimes. It validates the cross-family middleware contract by implementing a single middleware that operates identically in both families without any family-specific code.

It is **not** intended as a production observability solution. Because framework-level middleware can only access `PlanMeta` (lane, target, storageHash, refs), they cannot inspect query content (SQL strings, Mongo commands, ASTs). Production telemetry will typically use family-specific middleware interfaces (`SqlMiddleware`, `MongoMiddleware`) that expose the full plan type.

## Usage

```typescript
import { createTelemetryMiddleware } from '@prisma-next/middleware-telemetry';

// Default: logs events via ctx.log.info
const middleware = createTelemetryMiddleware();

// Custom: collect events programmatically
const middleware = createTelemetryMiddleware({
  onEvent: (event) => console.log(event),
});
```

The middleware emits a `TelemetryEvent` before and after each query execution, containing lane, target, storageHash, and (after execution) row count, latency, and completion status.

## See also

- [Runtime & Middleware Framework](../../../docs/architecture%20docs/subsystems/4.%20Runtime%20&%20Middleware%20Framework.md) — SPI design and middleware lifecycle
