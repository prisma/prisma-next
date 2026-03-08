# ADR 170 — Pack-provided type constructors and field presets

## Context

Prisma Next supports dual authoring modes (ADR 006):

- PSL-first authoring (schema language)
- TS-first authoring (builder APIs)

Today, both authoring surfaces frequently need to specify more than a “base scalar type”:

- a parameterized storage shape (e.g. `varchar(35)` length)
- a target/extension-owned persistence mechanism (codec/native type)
- optionally, a storage default or execution-time mutation default (ADR 158)
- occasionally, column attributes/constraints that are semantically bundled with the choice (e.g. “id column preset”)

In PSL, this often shows up as `@` attributes that act as workarounds for an underpowered type position:

- `String @db.VarChar(35)`-style patterns in Prisma ecosystem
- extension-specific attributes that parameterize the storage type (example: `@pgvector.column(1536)` in this repo)
- `@default(uuid())` for what is conceptually a preset (“UUID id column”) rather than a generic default function call

In TS authoring, this gap is often filled by helper functions that emit “generated column specs” and choose storage parameters (for example “packed” id columns). Historically this repo used a low-layer `@prisma-next/ids` package to provide those helpers, but that created an architectural category error: a privileged “built-in” vocabulary and concrete implementations in a low layer (see ADR 005 and ADR 169).

We want a design that:

- improves PSL ergonomics by promoting these concepts into the type position,
- keeps the framework core ignorant of concrete vocabulary and implementations, and
- preserves deterministic composition and layering (“thin core, fat targets/packs”).

## Problem

We need a shared, composable vocabulary mechanism for authoring-time “type-like” builders that can:

- specify parameterized storage types (codec/native type/type params),
- optionally bundle defaults and constraints when that is the natural abstraction (field presets),
- work consistently across PSL and TS authoring,
- avoid reintroducing global built-ins or hardcoded maps in low layers, and
- remain deterministic under composition (hard errors for collisions).

## Decision

### 1) Introduce composed registries for authoring-time constructors

We introduce composition-owned registries (contributed by family/target/extension packs) that provide:

- **Type constructors**: build the storage shape (`codecId`, `nativeType`, `typeParams` or `typeRef`).
- **Field presets**: may additionally bundle:
  - nullability,
  - storage defaults,
  - execution-time mutation defaults (`ExecutionMutationDefaultValue`, ADR 158),
  - and may imply constraints (see Decision 4).

Framework/core authoring packages define only:

- the constructor/preset *shapes* (interfaces/types),
- deterministic registry assembly rules,
- and registry consumption hooks in PSL/TS authoring surfaces.

Concrete constructor/preset implementations live only in composition layers (family/target/extension packs).

### 2) Namespacing uses dot notation

Constructor names are referenced using **dot notation** namespaces.

Examples (illustrative):

- `sql.String(length: 35)`
- `ids.Uuid(4)`
- `pgvector.Vector(1536)`

### 3) Registry collisions are hard errors

When assembling constructor/preset registries, duplicates are a **fail-fast hard error**.

There is no override/last-wins behavior.

If collisions become common, contributors must introduce or expand namespaces rather than relying on implicit precedence.

### 4) Presets may imply constraints

Field presets may imply constraints.

For example, a preset used to define an id column may imply primary key semantics rather than requiring a separate explicit attribute.

The exact constraint encoding remains part of the authoring surface’s normal contract encoding rules (no executable code in contracts; contracts store data).

### 5) Non-namespaced entries are reserved

To prevent an ambient, global “standard library” from reappearing implicitly:

- **Only family and target** contributors may provide **non-namespaced** constructor/preset entries.
- Extension packs should contribute namespaced entries by default.

This preserves a small, deliberate “baseline vocabulary” owned by the family/target while keeping extensions explicit.

### 6) Unify TS and PSL on shared underlying data structures

Both authoring surfaces target the same underlying structures for storage typing and defaults:

- `ColumnTypeDescriptor` (`codecId`, `nativeType`, `typeParams`/`typeRef`)
- `ExecutionMutationDefaultValue` for execution-time defaults (ADR 158)

TS “column helpers” can be implemented as thin wrappers over the same constructor/preset descriptors contributed by composition.

PSL interpretation consumes the composed registries to lower type expressions and presets; it must not hardcode constructor names or semantics in the interpreter.

## Consequences

### Benefits

- **Better PSL ergonomics**: type position becomes expressive enough to carry parameterization and presets, reducing reliance on `@` attribute workarounds.
- **One vocabulary seam**: both TS and PSL can opt into the same composed constructor/preset sets.
- **Layering alignment**: removes pressure to keep concrete helpers in low layers.
- **Deterministic composition**: collisions are explicit and actionable.

### Costs

- **New SPI surface**: registries and assembly rules must be defined and maintained.
- **Migration work**: existing attribute-based patterns (e.g. `@pgvector.column`) may be migrated to type constructors/presets.
- **Vocabulary management**: contributors must coordinate namespacing to avoid collisions.

### Risks and mitigations

- **PSL complexity growth**:
  - Mitigation: keep the core grammar minimal; treat constructors/presets as registry-backed identifiers rather than baking semantics into PSL.
- **Recreating built-ins under a new name**:
  - Mitigation: reserve non-namespaced entries; require namespacing for extensions; enforce collision hard errors.

## Related ADRs

- ADR 005 — Thin Core Fat Targets
- ADR 006 — Dual Authoring Modes
- ADR 104 — PSL extension namespacing & syntax
- ADR 112 — Target Extension Packs
- ADR 158 — Execution mutation defaults
- ADR 169 — Declared applicability for mutation default generators

