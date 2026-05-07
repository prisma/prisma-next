# WS5: PSL composite primary keys

## Summary

Support SQL PSL model-level composite primary keys via `@@id([fieldA, fieldB])` in the contract interpreter, closing the current printer/interpreter asymmetry for greenfield junction tables.

## Problem

`contract infer` can already print composite SQL primary keys as `@@id([...])`, but the PSL interpreter rejects `@@id` as an unsupported model attribute. This blocks the WS5 M2 SaaS skeleton, specifically membership/junction models that use composite primary keys instead of surrogate IDs.

## Scope

- Accept `@@id([fieldA, fieldB])` on SQL PSL models.
- Preserve declared field order in the emitted primary key.
- Resolve fields through existing `@map`/`@@map` mappings so storage primary keys use column names.
- Support the `map: "constraint_name"` argument consistently with `@@unique` and `@@index`.
- Return diagnostics for malformed field lists, unknown fields, nullable fields, and duplicate field-level/model-level primary key declarations.
- Add a regression proving PSL emitted by `contract infer` for a composite primary key can be interpreted back into an equivalent contract shape.

## Out of Scope

- Native scalar arrays.
- `@updatedAt`.
- Inline `@db.*` field attributes.
- P7 upgrade compatibility syntax.
- New relation inference behavior beyond what composite primary keys require.

## Acceptance Criteria

- A model with `@@id([orgId, userId])` emits `storage.tables.<table>.primaryKey.columns` with the mapped column names in the same order.
- A model with `@@id([orgId, userId], map: "membership_pkey")` emits the primary key name.
- A model with `@@id` and no field-level `@id` no longer triggers `PSL_MISSING_PRIMARY_KEY`.
- A model that combines field-level `@id` with model-level `@@id` fails with a clear diagnostic.
- A model that references an unknown or nullable field in `@@id` fails with a clear diagnostic.
- Focused package tests pass for `@prisma-next/sql-contract-psl`.
