# ADR 170 — Pack-provided type constructors and field presets

## Context

Prisma Next supports dual authoring modes (ADR 006): PSL-first (schema language) and TS-first (builder APIs). In practice, both surfaces routinely need to express **more than just a base scalar type**:

- a parameterized storage shape (e.g. `varchar(35)`),
- a target/extension-owned persistence mechanism (codec + native type),
- sometimes a default (including execution-time mutation defaults, ADR 158), and
- sometimes a “preset” that naturally bundles multiple choices (e.g. “this is my id column”).

Today, PSL encodes much of this via `@` attributes because the type position can’t carry enough information. That leads to patterns like:

- `String @db.VarChar(35)`-style workarounds,
- extension-specific “type parameterization” attributes (e.g. `@pgvector.column(1536)` in this repo), and
- `@default(uuid())` where the author’s intent is closer to “UUID id preset” than “call an arbitrary function”.

TS authoring fills the same gap with helper functions that produce column definitions and often pick efficient storage parameters (for example “packed” id columns). Historically, this repo attempted to centralize those helpers in a low-layer `@prisma-next/ids` package; that created an architectural category error by introducing a privileged built-in vocabulary and concrete implementations in a low layer (ADR 005, ADR 169).

This ADR records the next step: make “type-like” authoring vocabulary **composition-owned**, so both PSL and TS can be ergonomic without hardcoding semantics in core.

## Problem

We need a shared, composable vocabulary mechanism for authoring-time “type-like” building blocks that:

- can produce parameterized storage types (`codecId`/`nativeType`/`typeParams`),
- can optionally bundle defaults and constraints when that is the natural abstraction,
- works consistently across PSL and TS authoring,
- does not reintroduce global built-ins or hardcoded maps in low layers, and
- is deterministic under composition (collisions are hard errors).

## Decision

### 1) Introduce composed registries for authoring-time constructors

We introduce composition-owned registries (contributed by family/target/extension packs). These registries are the single place where “type-like vocabulary” is defined.

They provide two related concepts:

- **Type constructors**: build the storage shape (`codecId`, `nativeType`, `typeParams` or `typeRef`).
- **Field presets**: build the storage shape and may additionally bundle:
  - nullability,
  - storage defaults,
  - execution-time mutation defaults (`ExecutionMutationDefaultValue`, ADR 158),
  - and may imply constraints (see Decision 4).

Framework/core authoring packages remain thin. They define only:

- the constructor/preset *shapes* (interfaces/types),
- deterministic registry assembly rules,
- and registry consumption hooks in PSL/TS authoring surfaces.

Concrete constructor/preset implementations live only in composition layers (family/target/extension packs). This is the critical layering boundary.

### 2) Namespacing uses dot notation

Constructor and preset names are referenced using **dot notation** namespaces.

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

To prevent an ambient, global “standard library” from reappearing implicitly, we reserve the “short names”:

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

- **Better PSL ergonomics**: the type position can carry parameterization and presets, reducing reliance on `@` attribute workarounds.
- **One vocabulary seam**: both TS and PSL opt into the same composed constructor/preset sets.
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

