# Code Review: fix/planner-issues (vs feat/state-transition-migrations)

## Summary

Six commits that fix real bugs in the planner/verifier reconciliation layer, implement two new operation builders (`default_missing`, `default_mismatch`), strengthen postchecks, fix missing `indexOrConstraint` data in the verifier, and deliver ~1,250 lines of integration tests covering all 11 reconciliation operations plus 7 compound scenarios. The changes are well-scoped, defensively coded, and the test coverage is substantial. No critical issues found.

**Commits reviewed:**

| Commit | Description |
|--------|------------|
| `576b69c0d` | fix(planner): handle default_missing and default_mismatch schema issues |
| `944c72c63` | fix(planner): use type-aware postcheck for ALTER COLUMN TYPE |
| `d1100169f` | fix(verifier): populate indexOrConstraint on extra-object issues and fix FK detection |
| `0466da470` | docs: create reconciliation-testing project with compound scenario spec and plan |
| `fa018e68d` | test(planner): add compound reconciliation integration tests |
| `3e16a8699` | refactor(planner): replace LIKE with exact match in default value postcheck |

**Files changed:** 11 files, +1,837 / -18 lines

## Critical Issues

None.

## Recommendations

### 1. Implicit operation ordering for same-column compound scenarios

**Location**: `packages/3-targets/3-targets/postgres/src/core/migrations/planner-reconciliation.ts:685-701`

`sortSchemaIssues` sorts issues alphabetically by `kind`. For the compound test "changes column type and default together" (text DEFAULT 'active' → int4 DEFAULT 1), this means `default_mismatch` executes before `type_mismatch` — i.e., ALTER DEFAULT runs before ALTER TYPE. This works for the tested case because integer `1` is valid as a text default. But for a more type-sensitive change (e.g., a default that's only valid for the new type), the order would matter.

This is a pre-existing architectural concern in `sortSchemaIssues`, not introduced by this PR. Noting it here because the compound integration tests now exercise this path and it would be worth a comment in the sort function documenting the ordering invariant, or tracking it as a known limitation.

### 2. `renderExpectedPgDefault` lacks exhaustive `default` case

**Location**: `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts:1055-1074`

The switch handles `literal` and `function`, which is exhaustive for the current `ColumnDefault` type. But if a new variant is added to `ColumnDefault` in the future, this function would silently return `undefined` at runtime despite the `string` return type annotation (TypeScript's `noImplicitReturns` would catch it at compile time only if enabled). Adding a `default: never` case would make this future-proof:

```typescript
default: {
  const _exhaustive: never = columnDefault;
  throw new Error(`Unhandled default kind: ${(_exhaustive as { kind: string }).kind}`);
}
```

Not blocking — the type system currently constrains this correctly.

## Minor Suggestions

### 1. Same operation id for SET DEFAULT and ALTER DEFAULT

`buildSetDefaultOperation` and `buildAlterDefaultOperation` both use `setDefault.${tableName}.${columnName}` as the operation id. If both `default_missing` and `default_mismatch` were emitted for the same column in one plan, deduplication would drop one. This is likely impossible (a column either has no default or has a wrong default), but a brief comment at the `id` assignment would make this intentional coupling clear.

### 2. `makeTable` always assigns a PK

The integration test helper `makeTable` uses `primaryKey: { columns: [Object.keys(columns)[0]!] }`, silently assigning a PK to the first column. Tests that need PK-less tables already use inline definitions (e.g., the drop-PK test). If this convention isn't obvious to future contributors, a JSDoc note on `makeTable` would help.

### 3. Postcheck asymmetry between `default_missing` and `default_mismatch` is correct but undocumented

`default_missing` postchecks via `columnDefaultCheck` (IS NOT NULL) while `default_mismatch` postchecks via `columnDefaultValueCheck` (exact value match). This is the right design — when adding a default where none existed, existence is sufficient; when changing a default, the value matters. A brief comment on each `buildSetDefaultOperation` / `buildAlterDefaultOperation` explaining the rationale would help.

## Positive Notes

- **All previous review findings addressed**: The earlier iteration's recommendations (wrong comment text, unused import, missing FK unit test, test boilerplate) have all been resolved. Clean follow-through.

- **Verifier `indexOrConstraint` fix was load-bearing**: Populating `indexOrConstraint` on extra-FK, extra-unique, and extra-index issues in `verify-helpers.ts` was a necessary prerequisite for the reconciliation planner — without it, these issues silently fell through the `!issue.indexOrConstraint` guard. The accompanying strict-mode FK detection fix (`constraintFks.length > 0 || strict`) closes a real gap where extra FKs were invisible when the contract had no FKs for a table.

- **Postcheck strengthening**: Replacing the existence-only postcheck on ALTER COLUMN TYPE with a type-aware check via `pg_attribute.atttypid = '...'::regtype` is correct. The old check would pass even if the type change failed silently.

- **LIKE → exact match**: Replacing `LIKE` with exact `=` in `columnDefaultValueCheck` removes a class of false positives where `%` or `_` in default values could match unintended patterns.

- **Operation class correctness**: `default_missing` as `additive` and `default_mismatch` as `widening` is the right classification. Adding a default where none exists is purely additive; changing an existing default is a semantic widening.

- **Integration test coverage**: 11 single-operation tests + 7 compound scenarios is thorough. The compound tests exercise realistic multi-operation plans: type+default, nullability+default, FK+table drop, column+index drop, mixed nullability, type with index, literal→function default.

- **Defensive invariants**: Using `invariant()` to assert contract/issue consistency (e.g., `default_missing` implies contract has a default) is the right pattern — catches verifier bugs early with clear error messages rather than producing silent wrong behavior.

- **Spec-driven approach**: The specs and plans in `projects/reconciliation-testing/` provide clear traceability from requirements to tests to discovered issues.
