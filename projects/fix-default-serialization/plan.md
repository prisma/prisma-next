# Fix Default Serialization in contractToSchemaIR

## Summary

Replace the broken `convertDefault` function with a target-provided `DefaultRenderer` callback, following the existing `NativeTypeExpander` IoC pattern. This eliminates spurious migration diffs caused by `[object Object]` rendering of structured default values (JSONB objects, arrays, `TaggedBigInt`).

**Spec:** `projects/fix-default-serialization/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Sævar Berg | Drives execution |

## Milestones

### Milestone 1: Add `DefaultRenderer` callback and wire Postgres implementation

Deliverable: `contractToSchemaIR` accepts and uses a `DefaultRenderer` callback; the Postgres target passes its renderer; all tests pass.

**Tasks:**

- [ ] 1.1 Define `DefaultRenderer` type in `contract-to-schema-ir.ts` alongside `NativeTypeExpander`
  - Signature: `(def: ColumnDefault, column: StorageColumn) => string`
  - Add it as an optional parameter to `contractToSchemaIR` (and thread through `convertColumn`)
- [ ] 1.2 Implement fallback logic for when no renderer is provided
  - Handle simple cases: string (with quote escaping), number, boolean, null, function expression
  - Throw a clear error for structured types (object, array, tagged values) directing callers to provide a renderer
  - This preserves backward compatibility for existing tests that use simple defaults without a renderer
- [ ] 1.3 Delete `convertDefault` function
  - Replace the call site in `convertColumn` with the new callback (or fallback)
- [ ] 1.4 Export `renderDefaultLiteral` from the Postgres planner (or create a thin wrapper)
  - The existing `renderDefaultLiteral` in `planner.ts` is a private function
  - Extract it to a shared location within the Postgres target (e.g., alongside `buildColumnTypeSql` which is already exported) or export it directly
  - Wrap it to match the `DefaultRenderer` signature: `(def: ColumnDefault, column: StorageColumn) => string` (dispatch on `def.kind`, call `renderDefaultLiteral` for literals, return `def.expression` for functions)
- [ ] 1.5 Wire the Postgres renderer into `contractToSchema` in `packages/3-targets/3-targets/postgres/src/exports/control.ts`
  - Pass the renderer as the new parameter to `contractToSchemaIR`
- [ ] 1.6 Update the `@prisma-next/family-sql` control exports if the new type needs to be exported

### Milestone 2: Update tests

Deliverable: All existing tests pass, new tests cover the previously-broken cases, and the planner round-trip test covers structured defaults.

**Tasks:**

- [ ] 2.1 Update existing unit tests in `contract-to-schema-ir.test.ts`
  - Tests for simple defaults (string, number, boolean, function) should continue passing without providing a renderer (fallback path)
  - The 5 new tests added during investigation (object, array, `TaggedBigInt`, `TaggedRaw`, nested object) should pass when a renderer is provided
  - Update the new tests to pass a mock renderer that matches Postgres behavior
- [ ] 2.2 Add a planner round-trip test with structured defaults in `planner.contract-to-schema-ir.test.ts`
  - Create a storage with JSONB object defaults, array defaults, and `TaggedBigInt` defaults
  - Assert `contractToSchemaIR → planner` round-trip produces zero operations (no spurious diff)
- [ ] 2.3 Verify no regressions: run full package test suite
  - `pnpm test:packages` must pass
  - `pnpm lint:deps` must pass (no layering violations)

### Milestone 3: Close-out

**Tasks:**

- [ ] 3.1 Verify all acceptance criteria are met
- [ ] 3.2 Delete `projects/fix-default-serialization/`

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| Correct SchemaIR defaults for all value types | Unit | 2.1 | Tests with mock renderer in `contract-to-schema-ir.test.ts` |
| Planner round-trip with structured defaults produces zero ops | Unit | 2.2 | `planner.contract-to-schema-ir.test.ts` |
| No `convertDefault` remains | Code review | 1.3 | Verified by deletion |
| Postgres `contractToSchema` passes renderer | Code review | 1.5 | Verified in `control.ts` |
| Existing tests pass without renderer (backward compat) | Unit | 2.1, 2.3 | Fallback handles simple cases |
| No layering violations | Lint | 2.3 | `pnpm lint:deps` |

## Open Items

- The fallback behavior (when no renderer is provided) is a convenience for tests and hypothetical future targets that don't have structured defaults. If we later decide all callers must provide a renderer, we can make the parameter required and remove the fallback.
