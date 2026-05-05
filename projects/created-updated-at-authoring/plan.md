# Created/Updated Timestamp Authoring Plan

## Summary

Add Prisma-style timestamp defaults across Postgres and SQLite. Success means SQL PSL `@default(now())` and `@updatedAt`, plus TypeScript `field.createdAt()` / `field.updatedAt()`, lower to the existing SQL storage-default and execution-mutation-default IR with target-owned timestamp generators.

**Spec:** `projects/created-updated-at-authoring/spec.md`

## Collaborators

| Role | Person/Team | Context |
| ---- | ----------- | ------- |
| Maker | TBD | Implements the authoring and runtime-generator changes |
| Reviewer | SQL authoring/runtime reviewer | Reviews SQL PSL lowering, TypeScript builder state, and runtime default semantics |
| Collaborator | Target adapters owner | Confirms Postgres and SQLite timestamp generator/applicability behavior |

## Shipping Strategy

Ship this as three milestones. Milestone 1 makes the shared SQL mutation-default path capable of representing update-time defaults without exposing new user syntax. Milestone 2 delivers Postgres authoring on top of that path. Milestone 3 makes SQLite a first-class SQL authoring target for timestamp defaults, then finishes documentation and close-out. No feature flag is needed because old contracts do not reference the timestamp generator, and new runtime behavior is activated only by contracts that explicitly contain `onCreate` / `onUpdate` defaults.

## Test Design

| AC | TC | Test Case | Type | Milestone | Expected Outcome |
| --- | --- | --- | --- | --- | --- |
| AC1 | TC1 | Interpret Postgres PSL with `createdAt DateTime @default(now())` | Unit | Milestone 2 | Contract storage column has `default: { kind: 'function', expression: 'now()' }`; execution defaults omit that column |
| AC2 | TC2 | Interpret Postgres PSL with `updatedAt DateTime @updatedAt` | Unit | Milestone 2 | Contract execution section has one default for the mapped column with both `onCreate` and `onUpdate` |
| AC3 | TC3 | Build equivalent Postgres TS and PSL contracts for created/updated timestamp fields | Unit | Milestone 2 | Storage tables and execution defaults are byte-equivalent after deterministic sorting |
| AC4 | TC4 | Re-run existing generated ID helper tests after SQL mutation-default state refactor | Unit | Milestone 1 | `uuidv4`, `uuidv7`, `nanoid`, `cuid2`, `ulid`, and `ksuid` helpers still emit on-create defaults and current validation failures |
| AC5 | TC5 | Interpret invalid SQL PSL timestamp attributes | Unit | Milestone 2 | Invalid attributes produce `PSL_INVALID_ATTRIBUTE_ARGUMENT`, `PSL_UNSUPPORTED_FIELD_ATTRIBUTE`, or the existing closest stable diagnostic with spans on the offending attribute |
| AC6 | TC6 | Apply SQL runtime defaults for create/non-empty update/no-op update with `timestampNow` | Unit | Milestone 1 | Create and non-empty update fill omitted `updatedAt`; empty update payloads skip `onUpdate` execution defaults; explicit values are skipped; `createdAt` remains a database storage default |
| AC8 | TC7 | Interpret SQLite PSL with `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt` | Unit | Milestone 3 | Contract uses SQLite timestamp-compatible codecs/defaults and emits one `updatedAt` execution default with both phases |
| AC8 | TC8 | Build equivalent SQLite TS and PSL contracts for created/updated timestamp fields | Unit | Milestone 3 | SQLite TS authoring emits the same storage and execution shape as SQLite PSL |
| AC7 | TC9 | Check docs/readme updates for supported SQL vocabulary | Manual | Milestone 3 | SQL docs mention `@default(now())`, `@updatedAt`, `field.createdAt()`, and `field.updatedAt()` |

## Milestones

### Milestone 1: Shared SQL Mutation Defaults Plumbing

Generalize the SQL authoring/runtime path so mutation defaults can represent `onCreate`, `onUpdate`, or both. This milestone should not add new PSL syntax yet; it prepares the contract builder and SQL runtime/control descriptors for target-specific `@updatedAt` support.

**Tasks:**

- [ ] Extend SQL TypeScript authoring field state from on-create-only `executionDefault` to a mutation-default shape that can carry `onCreate` and `onUpdate` while preserving existing generated ID helper behavior. Satisfies TC4.
- [ ] Update `buildSqlContractFromDefinition` and contract lowering so on-create-only generated fields still produce the same execution defaults, and fields with both phases emit both `onCreate` and `onUpdate`. Satisfies TC4, TC6.
- [ ] Extend SQL authoring field-preset descriptors/templates to express phase-specific mutation defaults, then update `instantiateAuthoringFieldPreset`, `buildFieldPreset`, and helper type inference accordingly. Satisfies TC4.
- [ ] Add a target-owned `timestampNow` mutation default generator descriptor and runtime generator to Postgres and SQLite adapters, with applicability restricted to timestamp-compatible codecs. Satisfies TC6.
- [ ] Teach SQL mutation-default application to skip all `onUpdate` defaults when the update payload is empty, matching Prisma `@updatedAt` semantics where no write means no timestamp advance. Satisfies TC6.
- [ ] Add SQL runtime/control tests for the timestamp generator, explicit-value skip behavior, and empty-update behavior. Satisfies TC6.

**Validation gate:**

- `pnpm -F @prisma-next/sql-contract-ts test`
- `pnpm -F @prisma-next/sql-runtime test test/mutation-default-generators.test.ts test/sql-context.test.ts`
- `pnpm -F @prisma-next/adapter-postgres test test/control-mutation-defaults.test.ts`
- `pnpm -F @prisma-next/adapter-sqlite test test/control-mutation-defaults.test.ts`
- `pnpm lint:deps`

### Milestone 2: Postgres SQL Authoring Surface

Wire Postgres PSL and TypeScript authoring into the generalized SQL mutation-default path. Postgres is the first end-to-end SQL target because the current SQL PSL provider is Postgres-typed and the Postgres target already has most of the authoring vocabulary.

**Tasks:**

- [ ] Verify Postgres PSL `DateTime @default(now())` remains the create-time timestamp path. Satisfies TC1.
- [ ] Add Postgres PSL field-attribute parsing/lowering for no-argument `@updatedAt`, lowering it to a timestamp mutation default with both `onCreate` and `onUpdate`. Satisfies TC2.
- [ ] Add strict Postgres PSL validation for conflicting/defaulted/optional/list/non-timestamp `@updatedAt` usages, using existing diagnostic codes where possible instead of inventing new ones without need. Satisfies TC5.
- [ ] Add Postgres TypeScript `field.updatedAt()` and verify existing `field.createdAt()` remains equivalent to PSL `@default(now())`. Satisfies TC3.
- [ ] Add Postgres TS/PSL parity coverage for a model containing both timestamp helpers. Satisfies TC3.

**Validation gate:**

- `pnpm -F @prisma-next/sql-contract-psl test`
- `pnpm -F @prisma-next/sql-contract-ts test`
- `pnpm -F @prisma-next/adapter-postgres test test/control-mutation-defaults.test.ts`
- `pnpm lint:deps`

### Milestone 3: SQLite SQL Authoring Parity and Close-Out

Make SQLite a real SQL authoring target for timestamp defaults instead of relying on Postgres-specific provider types. This milestone brings SQLite to parity with the Postgres SQL surface while preserving Postgres behavior, then updates durable docs and removes the transient project artifacts.

**Tasks:**

- [ ] Generalize `@prisma-next/sql-contract-psl` provider and interpreter target/ref types from `TargetPackRef<'sql', 'postgres'>` to SQL target-generic refs, and keep existing Postgres tests passing. Satisfies TC7.
- [ ] Add SQLite target authoring field contributions for timestamp-compatible fields, including `field.createdAt()` and `field.updatedAt()`, with SQLite-native codecs/defaults. Satisfies TC8.
- [ ] Wire SQLite scalar descriptors, default-function lowering, and mutation-default generator descriptors into the PSL provider/config path so `@default(now())` and `@updatedAt` lower correctly for SQLite. Satisfies TC7.
- [ ] Add SQLite PSL validation coverage for invalid `@updatedAt` usage, including arguments, optional fields, list fields, non-date fields, and conflicting defaults. Satisfies TC7.
- [ ] Add SQLite TS/PSL parity coverage for a model containing `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt`. Satisfies TC8.
- [ ] Update `docs/products/psl/README.md`, `packages/2-sql/2-authoring/contract-psl/README.md`, and the TypeScript authoring README/API docs with target-specific SQL semantics. Satisfies TC9.
- [ ] Close out the project artifacts: verify acceptance criteria, migrate any long-lived convention into durable docs, strip repo-wide references to `projects/created-updated-at-authoring/**`, and delete the transient project directory. Satisfies TC9.

**Validation gate:**

- `pnpm -F @prisma-next/sql-contract-psl test`
- `pnpm -F @prisma-next/sql-contract-ts test`
- `pnpm -F @prisma-next/target-sqlite test`
- `pnpm -F @prisma-next/adapter-sqlite test test/control-mutation-defaults.test.ts`
- `pnpm lint:deps`
- `pnpm build`

### Milestone 4: ORM-client wiring and across-rows stability (post-review fix)

The first three milestones generalized the SQL mutation-default *runtime contract* and made authoring on Postgres + SQLite emit the right execution defaults. A direct comparison against Prisma 6's `@updatedAt` semantics (Dub port; see `prisma-next-updatedat-expectations.md`) surfaced two compatibility gaps that the prior milestones did not exercise:

1. The high-level ORM `Collection` update paths (`update`, `updateAll`, `updateCount`, `upsert` update branch, and the nested update branch in `updateFirstGraph`) never called `applyMutationDefaults({ op: 'update', ... })`. The runtime correctly skipped on empty payloads and refused to overwrite explicit user values, but no caller invoked it for non-empty updates, so `@updatedAt` never advanced via ORM updates.
2. Bulk inserts via `Collection.createAll` / `createCount` invoked `applyMutationDefaults` per row, which made `timestampNow` produce a fresh `Date` per row and drift within a single ORM operation. Prisma 6 emits one timestamp per lowered mutation; Prisma Next must do the same.

This milestone closes both gaps without changing the contract IR or the PSL/TS authoring surface.

**Tasks:**

- [x] Wire `applyMutationDefaults({ op: 'update' })` into `Collection.updateAll`, `Collection.updateCount`, the update branch of `Collection.upsert`, and the nested update branch in `updateFirstGraph` (`mutation-executor.ts`). Empty payloads still short-circuit before the runtime call. Satisfies the doc's "Update Semantics", "Explicit Update Value", and "Empty Update Semantics" sections.
- [x] Add a `stableAcrossRows: boolean` flag to `RuntimeMutationDefaultGenerator` and an `acrossRowsCache?: Map<string, unknown>` parameter to `MutationDefaultsOptions`. Generators that opt in (e.g. `timestampNow`) reuse one generated value across every row of one ORM operation; per-row generators (`cuid`, `uuidv4`, …) stay independent. Satisfies the doc's "Bulk Write Semantics".
- [x] Mark `timestampNowRuntimeGenerator` with `stableAcrossRows: true` and have `Collection.applyCreateDefaults` allocate one `acrossRowsCache` per bulk insert.
- [x] Runtime tests: cover the cache contract — shared cache reuses the value across calls; absent cache or non-stable-across-rows generator regenerates per call.
- [x] ORM-client tests (`collection-mutation-defaults.test.ts`): cover `create` omit/explicit, `createAll` shared timestamp, `updateAll` non-empty/explicit/empty, `updateCount` non-empty/empty, and `upsert` create/update branches including the empty-update branch.

**Validation gate:**

- `pnpm -F @prisma-next/sql-runtime test`
- `pnpm -F @prisma-next/sql-orm-client test`
- `pnpm test:packages` (one-off `--concurrency=1` if turbo flake)
- `pnpm lint:deps`

## Resolved Decisions

- The internal timestamp generator ID is `timestampNow`.
- Empty update payloads skip all `onUpdate` execution defaults. Do not add generator-level metadata for `@updatedAt`.
- The "stable within a single lowered mutation" property in the expectations doc is encoded as `RuntimeMutationDefaultGenerator.stableAcrossRows` (flag) plus `MutationDefaultsOptions.acrossRowsCache` (per-operation scope cache). Naming was chosen over alternatives like `bulkStable`/`bulkCache` to match the expectations doc's wording and to describe the observable property rather than an implementation phrase.
