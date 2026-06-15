# Dispatch 02 — Builder terminals and construction migration

**Branch:** `mongo-planner-ddl-adoption` · **Date:** 2026-06-11

## Terminals added

`CollectionBuilder` (contract-free entry in `@prisma-next/mongo-query-builder/contract-free`) gained two new terminals:

```ts
collection(name).createCollection(options?: CreateCollectionOptions): CreateCollectionCommand
collection(name).createIndex(keys: ReadonlyArray<MongoIndexKey>, options?: CreateIndexOptions): CreateIndexCommand
```

Both return canonical frozen nodes. The method signatures reuse the existing option types from `@prisma-next/mongo-query-ast/control`; no parallel option shapes were introduced.

Tests live in `packages/2-mongo-family/5-query-builders/query-builder/test/collection-ddl.test.ts`.

## Construction sites migrated

`migration-factories.ts` → `createCollection()` and `createIndex()`:

- `execute` steps now call `collection(collectionName).createCollection(options)` and `collection(collectionName).createIndex(keys, {...options, name})` instead of `new CreateCollectionCommand(...)` / `new CreateIndexCommand(...)`.
- Check filters moved from `MongoFieldFilter.eq('key', ...)` / `MongoFieldFilter.eq('name', ...)` to `createFieldAccessor<IndexInfoDocShape>()` and `createFieldAccessor<CollectionInfoDocShape>()` accessor calls.
- Text-index detection uses `f.rawPath('key._fts').eq('text')` — `rawPath` is the documented escape hatch for paths outside the typed model surface (the `key._fts` sub-field is MongoDB-internal and not in the `IndexInfoDocShape`).
- The unique-flag postcheck filter uses the `filter.and(other)` combinator added in this dispatch (see below), not a hand-built `MongoAndExpr.of([...])` array.

`rg` for `new CreateCollectionCommand(` / `new CreateIndexCommand(` in `migration-factories.ts` and `op-factory-call.ts` returns empty.

## `.and()` combinator

`MongoFilterExpr.and(other: MongoFilterExpr): MongoAndExpr` was added to `filter-expressions.ts` alongside the existing `.not()`. Used in `createIndex()` to fold the unique flag into the postcheck filter:

```ts
const fullFilter = options?.unique ? filter.and(f.unique.eq(true)) : filter;
```

## Open question 1 — `validatedCollection` callers

`validatedCollection()` in `migration-factories.ts` composes `createCollection()` + `createIndex()` and is the only non-test caller of those two factory functions. It is the primary construction path for the schema-driven bootstrap. The factories stay alive for it; they now construct via the builder internally. No external callers write `new CreateCollectionCommand(...)` directly. A Phase-2 follow-up can migrate `validatedCollection` itself if needed, but there is no pressure: the construction path is already correct.

## `Buildable` decision

`Buildable` / `isBuildable` / `resolveQuery` (~lines 46–60 in `migration-factories.ts`) pre-date D2; they are present in D1 commit `a5a080d42`. The bare `value as { build: unknown }` cast inside `isBuildable` is pre-existing. D2 did not add it, so it is out of scope here. `lint:casts` delta is 0.

## Fixes applied during gate run

- Removed the `andFilters` dead-code helper that D2 added but did not use (the `createIndex` implementation switched to `filter.and()` directly).
- Changed `f('key._fts')` to `f.rawPath('key._fts')` — the callable form of `createFieldAccessor` requires a `NestedDocShape` second generic; `IndexInfoDocShape` has no nested shapes, so the callable form resolved to `never`. `rawPath` is the correct API for untyped dot-paths.
- Fixed Biome import ordering (moved the `contract-free` import before `mongo-value` and `utils`).
