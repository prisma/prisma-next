# Requirements: Parameterized column types

## Problem statement

Prisma Next currently models column JavaScript types primarily via `codecId → CodecTypes[codecId].output`.
This breaks down when a single codec ID represents a **family** of types that differ by **per-column parameters**.

Examples:
- Enums (future): a generic enum codec output is `string`, but each enum instance needs a specific union type.
- Vectors (pgvector): we currently “fudge” vector typing as `number[]`, losing dimension \(N\) (e.g. 1536).
- Numeric/decimal: precision and scale are per-column.
- String/varchar: length is per-column.

This surfaced as a layering issue where the SQL family emitter attempted to special-case Postgres enum codec IDs.

## Goals (must)

- Define a **general custom / parameterized types framework** (not enum/vector special cases in core).
- Extend the contract so a column can carry **opaque, codec-owned JS/type parameter JSON** alongside `codecId` (and any named
  type references needed for ergonomics like `schema.types.Role`).
- Ensure emitted `contract.d.ts` can express **precise JS types** for parameterized columns by delegating to
  codec/extension-provided type templates/renderers:
  - Vectors can resolve to a parameterized type (e.g. `Vector<1536>`) when dimension metadata exists.
- Ensure codecs can be initialized with contract-provided JS/type params to **enforce parameterization at runtime**
  (validation and encode/decode constraints).
- Enable `schema()` to surface **codec-provided helper objects** (e.g. `schema.types.Role.admin`) that are typed from
  `contract.d.ts`.

## Non-goals (v1)

- Inferring vector dimensions from runtime values.
- Migrating existing databases to new dimensions/enum variants automatically (planner conflict strategy is separate).

## Compatibility / constraints

- No target branching in core SQL family packages.
- Avoid adding runtime-only coupling to the emitter; type computation should use contract metadata + declared types.

## Acceptance criteria

- Contracts can represent parameterized/custom types without core knowing the domain semantics (“enum”, “vector”, etc.):
  - Per-column params exist and are passed to codecs at runtime.
  - Optional named type instances exist to enable ergonomic schema surfaces (e.g. `schema.types.Role`).
- Emitted `contract.d.ts` reflects parameterization precisely:
  - Vector model field types resolve to a parameterized vector type when dimension is present.
- A test suite covers parameterized type emission and runtime init:
  - Vector typing behavior with and without dimensions.
  - Runtime validation rejects invalid params and (optionally) invalid values.


