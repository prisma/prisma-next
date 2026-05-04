# Summary

Add first-class create/update timestamp defaults to the SQL authoring surfaces. SQL PSL should support Prisma-compatible `@updatedAt` while continuing to use `@default(now())` for create timestamps, and TypeScript SQL authoring should expose equivalent helpers that lower to the existing storage-default and execution-mutation-default contract IR.

# Context

## At a glance

Prisma users expect timestamp fields to be declarative, not hand-written at every mutation call site. Prisma ORM models create timestamps with `@default(now())` and update timestamps with `@updatedAt`. This spec keeps that shape valid in Prisma Next:

```prisma
model User {
  id        Int      @id @default(autoincrement())
  email     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

The TypeScript authoring surface should have the same meaning without forcing users to spell out contract internals.

```ts
const User = model('User', {
  fields: {
    email: field.text(),
    createdAt: field.createdAt(),
    updatedAt: field.updatedAt(),
  },
});
```

Create-time timestamps lower to the same storage default as `@default(now())`, so the database owns the value at insert time. `@updatedAt` is an application-side mutation default. It lowers to `contract.execution.mutations.defaults` with both `onCreate` and `onUpdate`, so Prisma Next fills the timestamp on insert and on non-empty update payloads when the caller does not provide an explicit value.

## Problem

The SQL lower layers already contain most of the machinery. `ExecutionMutationDefault` has both `onCreate` and `onUpdate`, and the SQL runtime already applies the appropriate default for create and update operations. The missing piece is authoring: PSL only understands `@default(...)`, and the TypeScript field-preset template can only express a single `executionDefault`, which the builder treats as `onCreate`.

This means a user can write `createdAt DateTime @default(now())`, but they cannot express Prisma-style `@updatedAt` from PSL. In TypeScript they can use `field.createdAt()` in the existing Postgres target authoring pack, but there is no symmetric `field.updatedAt()` helper. The workaround is to hand-author contract execution defaults, which is exactly the kind of contract-IR detail the authoring surfaces are supposed to hide.

## Approach

Use the existing contract shape. Do not add a new `@updatedAt` section to the contract, and do not teach migrations about a new timestamp concept. Create-time timestamp helpers should become normal column storage defaults `{ kind: 'function', expression: 'now()' }`. `@updatedAt` should become an execution mutation default whose `onCreate` and `onUpdate` values reference the target-provided `timestampNow` generator.

The authoring layer needs a small generalization: field state and field-preset descriptors must represent mutation defaults as `{ onCreate?, onUpdate? }`, not only the current on-create-only `executionDefault`. Existing generated ID helpers become the on-create-only case of that general shape. This keeps the public contract honest while allowing `field.updatedAt()` to be implemented as a normal composed authoring helper.

The runtime generator should be target-owned, not part of the ID-generator package. `@prisma-next/ids` is for textual IDs such as `uuidv7` and `nanoid`; a wall-clock timestamp generator is a mutation-default generator, but it is not an ID generator. Postgres and SQLite runtime/control adapters should register the same `timestampNow` generator ID, with applicability restricted to timestamp-compatible codecs.

# Requirements

## Functional Requirements

- **FR1.** SQL PSL accepts no-argument `@updatedAt` field attributes on timestamp-compatible `DateTime` fields for Postgres and SQLite.
- **FR2.** Create-time timestamp authoring remains represented as a storage column default equivalent to `@default(now())`; Prisma Next does not add a PSL `@createdAt` alias.
- **FR3.** `@updatedAt` lowers to an execution mutation default with both `onCreate` and `onUpdate` set to the target-provided `timestampNow` generator.
- **FR4.** SQL TypeScript authoring exposes `field.createdAt()` and `field.updatedAt()` helpers, where `field.createdAt()` matches PSL `@default(now())` and `field.updatedAt()` matches PSL `@updatedAt`.
- **FR5.** Existing generated ID helpers keep their current behavior while moving through the generalized mutation-default authoring state.
- **FR6.** Invalid timestamp attribute usage fails with span-aware PSL diagnostics: attributes with arguments, optional fields, list fields, non-timestamp fields, and combinations with conflicting defaults are rejected.
- **FR7.** Runtime mutation default generators for supported SQL targets provide the current timestamp value expected by their timestamp codecs for `@updatedAt`, explicit user-provided values still win, and empty update payloads leave `@updatedAt` unchanged by skipping all `onUpdate` execution defaults.
- **FR8.** Documentation reflects the new PSL defaults and the TypeScript helper counterparts across Postgres and SQLite.

## Non-Functional Requirements

- **NFR1.** The change must reuse the existing `ExecutionMutationDefault` contract IR and avoid a new contract schema concept.
- **NFR2.** PSL and TypeScript authoring for the same model and target must emit byte-equivalent storage and execution sections after deterministic sorting.
- **NFR3.** Existing `@default(now())`, `field.createdAt()`, and generated ID helper behavior must remain stable.
- **NFR4.** Target-specific timestamp applicability must stay explicit; the authoring layer should not silently accept lossy date-only or time-only codecs as `@updatedAt` fields.

## Non-goals

- Adding database triggers for `updatedAt`.
- Adding a PSL `@createdAt` alias.
- Inferring timestamp semantics from field names during introspection.
- Changing Prisma ORM compatibility beyond the explicit authoring surfaces described here.

# Acceptance Criteria

- [ ] **AC1.** A PSL model with `createdAt DateTime @default(now())` continues to emit a non-null timestamp column with default `{ kind: 'function', expression: 'now()' }` and no execution mutation default. Covers FR2, NFR2.
- [ ] **AC2.** A PSL model with `updatedAt DateTime @updatedAt` emits a non-null timestamp column and one execution mutation default entry with both `onCreate` and `onUpdate`. Covers FR1, FR3, NFR1.
- [ ] **AC3.** The equivalent SQL TypeScript model using `field.createdAt()` and `field.updatedAt()` emits the same contract shape as the PSL model for Postgres and SQLite. Covers FR4, NFR2.
- [ ] **AC4.** Existing generated ID helpers still emit on-create execution defaults and still reject invalid nullable/generated combinations. Covers FR5, NFR3.
- [ ] **AC5.** PSL invalid cases produce diagnostics with useful spans and stable codes: `@updatedAt(foo)`, `String @updatedAt`, `DateTime? @updatedAt`, `DateTime[] @updatedAt`, and `DateTime @updatedAt @default(now())`. Covers FR6.
- [ ] **AC6.** Runtime create mutations fill omitted `updatedAt`; non-empty update mutations fill omitted `updatedAt`; empty update payloads skip `onUpdate` execution defaults and leave `updatedAt` unchanged; explicit `updatedAt` values are not overwritten; and `createdAt` remains a storage default handled by the database. Covers FR7.
- [ ] **AC7.** Package READMEs or product docs list `@default(now())`, `@updatedAt`, `field.createdAt()`, and `field.updatedAt()` in the supported SQL authoring vocabulary. Covers FR8.
- [ ] **AC8.** SQLite PSL and TypeScript authoring accept the same timestamp model as Postgres, emit SQLite-native timestamp codecs/defaults, and preserve Postgres behavior after the SQL PSL provider becomes target-generic. Covers FR1, FR3, FR4, NFR2, NFR4.

# Other Considerations

## Security

This feature does not introduce a new data access path. The timestamp generator must use local process time and must not read environment variables or database credentials.

## Cost

No meaningful runtime cost is expected. The runtime already scans mutation defaults for a table; this project only adds another generated value case.

## Observability

No new telemetry is required. Existing runtime errors for missing mutation default generators should be enough if a contract references the timestamp generator without a runtime component that provides it.

## Data Protection

Created and updated timestamps are metadata and may still be user-associated data in application contexts. This project does not change retention, masking, or export behavior.

## Analytics

No product analytics are required.

# References

- `packages/2-sql/2-authoring/contract-psl/src/psl-field-resolution.ts`
- `packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts`
- `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts`
- `packages/3-targets/3-targets/postgres/src/core/authoring.ts`
- `packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts`
- `packages/3-targets/6-adapters/postgres/src/exports/runtime.ts`
- `packages/3-targets/6-adapters/sqlite/src/core/control-mutation-defaults.ts`
- `packages/3-targets/6-adapters/sqlite/src/core/runtime-adapter.ts`
- `docs/products/psl/README.md`

# Resolved Decisions

- **RD1.** The internal timestamp generator ID is `timestampNow`, to avoid confusing it with the storage-default function name `now()`.
- **RD2.** Empty update payloads skip all `onUpdate` execution defaults. We do not add generator-level metadata just to special-case `@updatedAt`.
