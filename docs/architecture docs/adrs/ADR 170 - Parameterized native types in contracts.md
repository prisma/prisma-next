---
status: accepted
---

# ADR 170 - Parameterized native types in contracts

## Context

Some storage types are **parameterized** at the database level (for example `varchar(255)`, `bit(16)`, `vector(1536)`).

We need a safe, cross-target contract representation that:

- Preserves the base native type name for planner/type safety rules.
- Carries parameters as structured data.
- Allows adapters to render target-specific SQL correctly (for DDL) and also to verify schemas (contract vs database introspection).

This decision was prompted by pgvector `vector(N)` when authored via PSL named types: representing the full `vector(1536)` string in `nativeType` caused migration planning and verification edge cases (including unsafe quoting paths).

## Decision

For parameterized storage types, **contracts MUST represent the base type name in `nativeType`** and represent parameters in `typeParams`.

- Example (pgvector):
  - `nativeType: "vector"`
  - `typeParams: { length: 1536 }`

Expansion to a parameterized SQL type string (for example `vector(1536)`) is the responsibility of the **target adapter** via a native-type expansion hook:

- DDL/migrations: adapter expands when rendering column types.
- Schema verification: adapter expands the *expected* type before comparing to introspected schema types.

## Consequences

- **Safety**: planners and validators can continue applying native type safety rules to base type identifiers, without handling arbitrary strings that might look like executable SQL.
- **Determinism**: contracts remain stable; parameters are explicit structured data.
- **Extensibility**: new parameterized types can follow the same pattern without teaching each planner about bespoke `nativeType` string formats.
- **Hash changes**: adopting this convention changes storage/profile hashes for affected contracts; contracts should be re-emitted.

## Implementation Notes

- Contract authoring (PSL/TS) should emit base `nativeType` + `typeParams` for parameterized types.
- Postgres adapter expands parameterized types in:
  - migration planning/type rendering (for DDL)
  - schema verification (expected type rendering)
- Where schema verification is codec-hook driven, parameterized type expansion should be provided via control-plane codec hooks on the composed framework components.

