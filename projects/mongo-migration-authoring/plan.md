# Mongo Migration Authoring — Plan

## What we're building

A migration file that looks like this:

```typescript
import { Migration, createIndex, createCollection }
  from "@prisma-next/target-mongo/migration"

export default class extends Migration {
  plan() {
    return [
      createCollection("users", {
        validator: { $jsonSchema: { required: ["email"] } },
        validationLevel: "strict",
      }),
      createIndex("users", [{ field: "email", direction: 1 }], { unique: true }),
    ]
  }
}

Migration.run(import.meta)
```

`node migration.ts` produces `ops.json`. The existing `MongoMigrationRunner` consumes it unchanged.

**Spec:** `projects/mongo-migration-authoring/spec.md`

## How we get there

Three milestones, each building on the last:

1. **Factories** — implement the five operation factory functions (`createIndex`, `dropIndex`, `createCollection`, `dropCollection`, `collMod`). After this milestone, you can call `createIndex(...)` in a test and get a valid `MongoMigrationPlanOperation`.

2. **Runnable migration files** — implement the `Migration` base class with `plan()` and `Migration.run(import.meta)`. After this milestone, you can write a migration.ts file, run it with `node`, and get `ops.json`.

3. **Composition and end-to-end validation** — implement a compound strategy function, validate the full pipeline against a real MongoDB instance, and close out the project.

---

## Milestone 1: Factories

Implement the five factory functions in `packages/3-mongo-target/1-mongo-target`. Each one produces a `MongoMigrationPlanOperation` with the correct command, prechecks, and postchecks — identical to what the planner produces.

The factories are extracted from the planner's existing inline logic (`planCreateIndex`, `planDropIndex`, etc.) using the same helpers (`buildIndexOpId`, `defaultMongoIndexName`, `keysToKeySpec`, filter expression assembly).

**Tasks:**

- [ ] `createIndex(collection, keys, options?)` — test and implement. Verify: output structure, text index handling, JSON serialization, round-trip through `deserializeMongoOps`, comparison against planner output for equivalent operation.
- [ ] `dropIndex(collection, keys)` — test and implement. Same verification pattern.
- [ ] `createCollection(collection, options?)` — test and implement. Cover: basic creation, validator options, capped/timeseries/collation/clusteredIndex options.
- [ ] `dropCollection(collection)` — test and implement.
- [ ] `collMod(collection, options)` — test and implement. Cover: validator update, changeStreamPreAndPostImages update.
- [ ] Create `src/exports/migration.ts` in `packages/3-mongo-target/1-mongo-target`. Configure the `@prisma-next/target-mongo/migration` export path in `package.json` and tsdown config. Export the five factories.

**Acceptance criteria covered:**

- Each factory produces correct prechecks/commands/postchecks
- Factory output serializes identically to planner output
- Round-trip: factory → `JSON.stringify` → `deserializeMongoOps`

## Milestone 2: Runnable migration files

Implement the `Migration` base class. After this, a `.ts` file with `export default class extends Migration` and `Migration.run(import.meta)` can be run directly to produce `ops.json`.

**Tasks:**

- [ ] Implement `Migration<TOperation>` base class in the framework layer (`packages/1-framework`). Abstract `plan()` method, generic over operation type. Static `run(meta: ImportMeta)` handling entrypoint detection, arg parsing, serialization, and file output.
- [ ] Entrypoint detection: check `import.meta.main` (Bun/Deno), fall back to `import.meta.filename` vs `resolve(process.argv[1])` (Node).
- [ ] `--dry-run` flag: print serialized operations to stdout without writing.
- [ ] `--help` flag: print usage information.
- [ ] Create Mongo-specific alias that fixes the type parameter to `MongoMigrationPlanOperation`. Re-export from `@prisma-next/target-mongo/migration` alongside the factory functions.

**Tests:**

- [ ] `Migration.run(import.meta)` is a no-op when the file is imported (not run directly)
- [ ] `ops.json` is written when the file is run as entrypoint
- [ ] `--dry-run` prints to stdout, does not write `ops.json`
- [ ] `--help` prints usage
- [ ] Default export class can be instantiated and `plan()` called directly (for CLI and test use)
- [ ] Error handling: non-array return from `plan()`

**Acceptance criteria covered:**

- Migration file type-checks and runs with `node migration.ts`
- File produces `ops.json` in its own directory
- `--dry-run` prints operations without writing
- `--help` prints usage
- `Migration.run(import.meta)` is no-op when imported
- Default export can be instantiated and `plan()` called directly

## Milestone 3: Composition and end-to-end validation

Implement a compound strategy function to demonstrate that strategies are plain function composition. Run full end-to-end tests against a real MongoDB instance to validate the entire pipeline: author → run → serialize → deserialize → runner.

**Tasks:**

- [ ] Implement `validatedCollection(name, schema, indexes)` — composes `createCollection` with validator + `createIndex` for each index. Returns a flat operation list.
- [ ] Export the strategy from `@prisma-next/target-mongo/migration`.
- [ ] End-to-end test with factory functions: write a migration.ts file, run it with `node`, verify `ops.json`, deserialize with `deserializeMongoOps`, execute against MongoDB memory server.
- [ ] End-to-end test with strategy function: same pipeline, using `validatedCollection` in the migration file.

**Acceptance criteria covered:**

- Strategy composes multiple factories and returns a flat operation list
- Strategy is a plain exported function
- Round-trip through runner execution (E2E)

**Close-out:**

- [ ] Verify all acceptance criteria from the spec are met
- [ ] Migrate any long-lived documentation into `docs/`
- [ ] Strip repo-wide references to `projects/mongo-migration-authoring/`
- [ ] Delete `projects/mongo-migration-authoring/`

---

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | TBD | Drives execution |
| Reviewer | TBD | Architectural review — particularly the `Migration` base class design |

## Open items

- **Where in the framework should `Migration<TOperation>` live?** It's target-agnostic. Candidates: `@prisma-next/framework-components` (where `MigrationPlanOperation` already lives) or a new package. Decide during M2.
- **Entrypoint detection portability.** Node lacks `import.meta.main`. The fallback needs testing for edge cases (symlinks, path normalization).
