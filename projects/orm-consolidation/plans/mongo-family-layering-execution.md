# MongoDB Family Layering — Execution Plan

Implementation plan for the [layering design](mongo-family-layering.md). Decomposes the `1-core` monolith into foundation + transport packages, eliminates structural shims, and updates the architecture config.

## Current state

```
packages/2-mongo-family/
  1-core/          → @prisma-next/mongo-core (monolith)
  2-authoring/
  2-query/         → @prisma-next/mongo-query-ast
  3-tooling/
  4-orm/           → @prisma-next/mongo-orm
  5-runtime/       → @prisma-next/mongo-runtime
  9-family/        → @prisma-next/family-mongo
```

`1-core` holds six unrelated responsibilities:

| File(s) | Responsibility | Target package |
|---|---|---|
| `contract-types.ts`, `contract-schema.ts`, `validate-*.ts` | Contract shape + validation | `mongo-contract` (foundation) |
| `codecs.ts`, `codec-registry.ts` | Codec interface + registry | `mongo-codec` (foundation) |
| `values.ts`, `param-ref.ts` | Value types | `mongo-value` (foundation) |
| `wire-commands.ts`, `results.ts` | Wire command classes + result types | `mongo-wire` (transport) |
| `adapter-types.ts` | `MongoAdapter` + `MongoQueryPlanLike` shim | `mongo-lowering` (transport) |
| `driver-types.ts` | `MongoDriver` interface | `mongo-lowering` (transport) |

## Decisions

### `MongoQueryExecutor` stays in the ORM

The design doc proposed moving `MongoQueryExecutor` from `4-orm` to `4-query/mongo-query-ast`. We decided against this:

- The interface is not related to query AST — it's the execution boundary contract.
- It follows dependency inversion: the consumer (ORM) defines the interface, the runtime structurally satisfies it.
- The SQL side has no explicit `QueryExecutor` interface; the ORM produces plans, the runtime exposes `execute()`, and they're wired at the composition root.
- If a future query-builder also needs an executor, we can extract it then.

### `codec-types.ts` in `1-core` gets deleted

`1-core/src/exports/codec-types.ts` is a hand-maintained static `CodecTypes` map that duplicates `adapter-mongo/src/exports/codec-types.ts`. The `1-core` copy is wrong in two ways:

1. **Wrong location**: codec concretions belong with adapter concretions, not foundation abstractions.
2. **Wrong descriptor**: the import pointer is on the family's `mongoTargetDescriptor`, but the SQL precedent shows this belongs on the **adapter descriptor** — the adapter declares its own codec types import.

Fix:
- Delete `1-core/src/exports/codec-types.ts` and its `package.json` export entry.
- Remove `types.codecTypes.import` from `mongoTargetDescriptor` in `9-family`.
- Add `types.codecTypes.import` to the adapter descriptor in `adapter-mongo`, pointing to `@prisma-next/adapter-mongo/codec-types`.
- Update emitter tests and fixture `contract.d.ts` files to import from the adapter path.

### `mongo-codec` has no `codec-types` entrypoint

The `mongo-codec` foundation package holds only abstractions: `MongoCodec` interface, `mongoCodec()` factory, trait types, `MongoCodecRegistry` interface, `createMongoCodecRegistry()`.

## Phases

Each phase produces commits that leave the build green.

### Phase A: Foundation split

Create `1-foundation/` with three packages, move source files from `1-core`, update all imports.

1. Create `1-foundation/mongo-contract/` — move `contract-types.ts`, `contract-schema.ts`, `validate-mongo-contract.ts`, `validate-storage.ts`, `validate-domain.ts` (and tests).
2. Create `1-foundation/mongo-codec/` — move `codecs.ts`, `codec-registry.ts` (and tests).
3. Create `1-foundation/mongo-value/` — move `values.ts`, `param-ref.ts`.
4. Update every `@prisma-next/mongo-core` import that references foundation types to the new package names.
5. Delete `codec-types.ts` export from `1-core`; wire the adapter descriptor to own the codec types import (see decision above).

After this phase, `1-core` still exists but holds only wire commands, results, adapter types, and driver types.

### Phase B: Transport layer

Create `6-transport/` with two packages, move remaining `1-core` content, delete `1-core`.

1. Create `6-transport/mongo-wire/` — move `wire-commands.ts`, `results.ts`.
2. Create `6-transport/mongo-lowering/` — move `adapter-types.ts`, `driver-types.ts`.
3. Update imports (runtime, adapter, driver, family).
4. Delete `1-core/`.

### Phase C: Eliminate shims

Now that the adapter interface lives in transport (above query), it can reference real AST types.

1. Change `MongoAdapter.lower()` to accept `MongoQueryPlan` directly (import from `@prisma-next/mongo-query-ast`).
2. Delete `MongoQueryPlanLike`.
3. Update the runtime and adapter implementation to use `MongoQueryPlan` instead of `MongoQueryPlanLike`.

### Phase D: Renumber + architecture config

1. Renumber directories to match the target structure (`4-orm` → `5-query-builders`, `5-runtime` → `7-runtime`).
2. Update `architecture.config.json`:
   - New `layerOrder` for mongo: `["foundation", "authoring", "tooling", "query", "query-builders", "transport", "runtime", "family"]`
   - Update all mongo package globs to match new paths.
3. Run `pnpm lint:deps` to validate.

## References

- [Package layering design](mongo-family-layering.md)
- [Unified Mongo query plan](unified-mongo-query-plan.md)
- [ORM consolidation plan](../plan.md)
