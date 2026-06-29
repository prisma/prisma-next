# Orphan slice: expose the static execution context symmetrically

Standalone slice (no parent project). Make the execution plane's **static context** — the
`ExecutionContext` (contract + codecs + operations + types, no driver/connection) — a
first-class, symmetric, client-safe surface on both the Mongo and Postgres facades.

## At a glance

The SQL/Postgres facade already builds its `ExecutionContext` **upfront** and exposes it as
`db.context: ExecutionContext<TContract>` (`packages/3-extensions/postgres/src/runtime/postgres.ts`,
`createExecutionContext({ contract, stack })`). The type lives in
`packages/2-sql/4-lanes/relational-core/src/query-lane-context.ts`:

```ts
interface ExecutionContext<TContract> {
  readonly contract: TContract;
  readonly contractCodecs: ContractCodecRegistry;
  readonly codecDescriptors: CodecDescriptorRegistry;
  readonly queryOperations: SqlOperationRegistry;
  readonly types: TypeHelperRegistry;
}
```

Mongo has the equivalent — `MongoExecutionContext` in
`packages/2-mongo-family/7-runtime/src/mongo-execution-stack.ts`, whose own doc says
*"Mirrors SQL's `ExecutionContext` in role; Mongo's flavour is leaner."* — but it was never
finished into a usable static context. Three gaps versus SQL:

| | SQL `ExecutionContext` | `MongoExecutionContext` |
|---|---|---|
| built | upfront, before connect | lazily inside `buildRuntime` (`mongo.ts:145`), only on connect |
| exposed | `db.context` | not exposed |
| typed | `contract: TContract` | `contract: unknown` |

The Mongo context is **already driver-free**: `createMongoExecutionStack({ target, adapter })`
takes no driver (it is optional), `@prisma-next/mongo-runtime` has zero driver dependencies,
and the `MongoDriverImpl` is created separately and only handed to `createMongoRuntime`. So
the static context is built without touching `mongodb` today — it is just buried in the
connect path and discarded as a standalone value.

This slice surfaces that abstraction symmetrically and uses it to replace the example's interim
`buildNamespacedEnums` + `blindCast` static-enum helper.

## Why now

PR #880 ("Exercise Mongo enums in retail-store") needed the static enum accessors importable
from a `'use client'` component without pulling the Mongo driver into the browser bundle. It
prototyped a `mongoEnums` + dedicated `@prisma-next/mongo/enums` entrypoint to do that, then
**pulled it back out** — that machinery did not belong in an "exercise enums" PR. The example
now builds its static enums directly from the existing public, driver-free `buildNamespacedEnums`
(`@prisma-next/contract/enum-accessor`) with one `blindCast` in `src/enums.ts`. That works but
is a narrow point solution: the real abstraction is the `ExecutionContext`, which both targets
should build upfront, expose, and offer client-safe. This slice provides the principled surface
the prototype was reaching for.

## Chosen design

The static context to expose **is** the `ExecutionContext` (the execution plane's driver-free
foundation). `enums`, the query builder (`query`/`sql`), and `raw` all derive from it.

1. **Mongo — build upfront, type, expose.** Lift `createMongoExecutionContext({ contract, stack })`
   out of `buildRuntime` so it is constructed once at facade-build time from a driver-free
   stack (`{ target, adapter }`); `buildRuntime` reuses it and adds the driver. Type it
   `MongoExecutionContext<TContract>` (`contract: TContract`, not `unknown`). Expose
   `readonly context: MongoExecutionContext<TContract>` on `MongoClient`, mirroring Postgres's
   `db.context`.

2. **Client-safe static-context factory per target.** `mongoStatic({ contractJson })` /
   `postgresStatic({ contractJson })` on a dedicated client-safe entrypoint
   (`@prisma-next/<target>/static`) build the `ExecutionContext` from the static contract with
   no driver, and return it alongside the derived static surface (`enums`, builder, `raw`,
   `contract`). The factory and the facade share one builder so the exposed `db.context` and
   the standalone context are identical.

3. **Postgres — driverless context for the client-safe path.** Postgres's `createExecutionContext`
   treats the driver as optional (capability source only), but the facade builds its `stack`
   with the driver and imports `postgresDriver` at module level. For `postgresStatic`, build the
   context from a driverless (adapter-only) stack in a driver-free module. Also expose
   `readonly contract` on `PostgresClient` for shape symmetry (it surfaces `context`/`stack`
   today but not `contract`).

4. **Replace the example's interim static enums.** `examples/retail-store/src/enums.ts` currently
   builds its accessors from `buildNamespacedEnums(contractJson.domain)['__unbound__']` with a
   `blindCast` (the leak this slice removes). Point it at `mongoStatic`/`@prisma-next/mongo/static`
   so the typing comes from the framework, not a cast in example code.

## Definition of done

- Both facades build the `ExecutionContext` upfront and expose `db.context: ExecutionContext<TContract>`
  with the same shape (Mongo's typed `<TContract>`, no `unknown`).
- `mongoStatic`/`postgresStatic` exist on `@prisma-next/<target>/static`, return the
  `ExecutionContext` + derived static surface, and are **client-safe**: a `'use client'`
  component importing them builds (`next build`) with **no driver code in the client bundle**
  (the acceptance test that gated #880).
- `retail-store`'s `src/enums.ts` uses the new `@prisma-next/mongo/static` surface instead of
  the `buildNamespacedEnums` + `blindCast` interim, and stays green (typecheck, tests, `next build`).
- `db.enums`/`db.query`/`db.raw`/`db.sql` continue to behave identically (derived from the
  shared context).
- Symmetric: the same factory + entrypoint pattern on both targets; member shapes align
  (`contract`, `enums`, builder, `raw`, `context`).

## Out of scope / notes

- This is distinct from `projects/facade-import-surface-completion/` (import-path consolidation).
  This slice is about the execution-plane static context abstraction, not import shapes.
- SQLite: the Postgres changes are SQL-family-level (`createExecutionContext`, the SQL builders),
  so SQLite inherits most of it; confirm and extend `sqliteStatic` for full parity if cheap.
- `MongoExecutionContext` is intentionally leaner than SQL's (no parameterised codecs, no
  JSON-schema validators, no mutation-default generators yet). Typing/exposing it does not
  require adding those — only `contract: TContract` and surfacing the existing value.
