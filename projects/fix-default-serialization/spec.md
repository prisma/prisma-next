# Summary

Replace the broken inline `convertDefault` in `contractToSchemaIR` with a target-provided callback (`DefaultRenderer`), following the existing `NativeTypeExpander` IoC pattern. This eliminates a duplicate rendering function that silently produces `[object Object]` for structured default values, causing spurious migration diffs.

# Description

## Problem

`convertDefault()` in `packages/2-sql/3-tooling/family/src/core/migrations/contract-to-schema-ir.ts` uses `String(def.value)` for non-string, non-primitive literal defaults. This produces garbage for any structured value that typechecks as `ColumnDefaultLiteralInputValue`:

- **Object/array JSON defaults** (e.g., `{ foo: "bar" }`, `[1, 2, 3]`) → `"[object Object]"` or `"1,2,3"`
- **TaggedBigInt** (`{ $type: 'bigint', value: '42' }`) → `"[object Object]"`
- **TaggedRaw** (`{ $type: 'raw', value: 'now()' }`) → `"[object Object]"`
- **Date** → locale-dependent string, wrong format for SQL

String defaults, plain numbers, booleans, and null work correctly.

## Impact

`contractToSchemaIR` is called by the Postgres target (and any future SQL target) to build the "from" side `SqlSchemaIR` when planning migrations. When the "from" contract contains structured defaults (JSONB objects, arrays, `TaggedBigInt`), the SchemaIR default string is `[object Object]`. The migration planner's schema verification (`verifySqlSchema` → `columnDefaultsEqual`) then sees a mismatch between the garbled "from" and the correct "to" contract default, producing **spurious migration operations** on every plan.

## Root cause

There are two independent functions that serialize `ColumnDefault` values to SQL literal strings:

1. **`convertDefault`** (family layer, `contract-to-schema-ir.ts`) — broken, missing cases for structured types.
2. **`renderDefaultLiteral`** (Postgres target, `planner.ts:875`) — correct, handles all value types including `TaggedBigInt`, `TaggedRaw`, `Date`, objects/arrays.

The Postgres planner's `renderDefaultLiteral` is used for DDL generation (CREATE TABLE / ALTER TABLE), so DDL is correct. The bug only affects the SchemaIR conversion path used for migration diffs.

## Why not just fix `convertDefault` in place?

Default value serialization to SQL literal strings is inherently target-specific:

- Different databases have different literal syntax (quoting, casting, type annotations)
- The `::jsonb` cast in Postgres DDL is dialect-specific
- How a `TaggedBigInt` or `Date` renders may vary between Postgres, MySQL, SQLite

The family layer (`packages/2-sql/3-tooling/family/`) is target-agnostic by design. It cannot import from the Postgres target layer due to strict layering constraints (core → authoring → tooling → lanes → runtime → adapters). Having a second, necessarily-incomplete rendering function in the family layer violates the "thin core, fat targets" principle and creates an ongoing maintenance burden — every time a new default value type is added, two functions must be updated.

## Proposed solution

Follow the existing `NativeTypeExpander` IoC pattern: `contractToSchemaIR` already accepts an optional `expandNativeType` callback that the target provides. Add an analogous `renderDefault` callback:

- The Postgres target provides its existing `renderDefaultLiteral` (wrapped to match the callback signature) when calling `contractToSchemaIR`.
- The family layer's `convertDefault` is deleted — no fallback, no duplicate.
- Future SQL targets (MySQL, SQLite) provide their own dialect-specific renderer.

This is the same inversion of control pattern already proven by `NativeTypeExpander`, applied to the same function for the same architectural reasons.

# Requirements

## Functional Requirements

1. `contractToSchemaIR` accepts a new optional `renderDefault` callback of type `DefaultRenderer`.
2. When `renderDefault` is provided, it is used to convert `ColumnDefault` values to `SqlColumnIR.default` strings.
3. When `renderDefault` is not provided, a minimal fallback handles the simple cases (string, number, boolean, null, function expression) to avoid breaking existing tests that don't provide a renderer. Structured types (objects, arrays, tagged values) throw a clear error directing the caller to provide a renderer.
4. The Postgres target passes its existing rendering logic as the `renderDefault` callback.
5. The inline `convertDefault` function is deleted.
6. All existing tests continue to pass.
7. New unit tests assert correct rendering for all `ColumnDefaultLiteralInputValue` variants: object, array, `TaggedBigInt`, `TaggedRaw`, nested objects.

## Non-Functional Requirements

- No new cross-layer imports are introduced.
- The callback signature is simple and stable: `(def: ColumnDefault, column: StorageColumn) => string`.
- The change is backward-compatible for callers that don't pass structured defaults (the fallback handles simple cases).

## Non-goals

- Changing how the Postgres planner generates DDL (its `renderDefaultLiteral` / `buildColumnDefaultSql` are correct and unchanged).
- Changing schema verification logic (`verifySqlSchema` / `columnDefaultsEqual` — these already handle structured defaults correctly).
- Adding MySQL/SQLite renderers (those targets don't exist yet).
- Changing the `ColumnDefault` or `ColumnDefaultLiteralInputValue` types.

# Acceptance Criteria

- [ ] `contractToSchemaIR` with a Postgres-style renderer produces correct SchemaIR default strings for: string, number, boolean, null, function expression, `TaggedBigInt`, `TaggedRaw`, object, array, nested object, `Date`.
- [ ] The planner round-trip test (`contractToSchemaIR → planner`) produces zero operations for a contract with structured defaults (no spurious diffs).
- [ ] No `convertDefault` function remains in `contract-to-schema-ir.ts`.
- [ ] The Postgres target's `contractToSchema` method passes a `renderDefault` callback.
- [ ] All existing unit and integration tests pass without modification (backward compatibility for simple defaults without a renderer).
- [ ] No new cross-layer import violations (`pnpm lint:deps` passes).

# References

- Linear ticket: [TML-2046](https://linear.app/prisma-company/issue/TML-2046/pn-contracttoschemair-convertdefault-produces-garbage-for)
- Buggy function: `packages/2-sql/3-tooling/family/src/core/migrations/contract-to-schema-ir.ts:21` (`convertDefault`)
- Correct reference: `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts:875` (`renderDefaultLiteral`)
- IoC precedent: `NativeTypeExpander` type in `contract-to-schema-ir.ts:41`
- Architecture overview: `docs/Architecture Overview.md` (thin core, fat targets)
- Layering config: `architecture.config.json`

# Open Questions

None — the approach mirrors an existing, proven pattern (`NativeTypeExpander`) in the same function.
