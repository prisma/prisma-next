# Code Review: Fix planner/verifier bugs blocking reconciliation operations

**Branch:** `fix/planner-issues` (vs `feat/state-transition-migrations`)
**Parent ticket:** TML-2086 — 6 sub-issues (TML-2076, TML-2077, TML-2087, TML-2088, TML-2089, TML-2091)
**Date:** 2026-03-23

## Summary

Six bugs in the migration planner and schema verifier, all discovered through integration testing of the plan->run->verify pipeline against live Postgres. The fixes are well-scoped, defensively coded, and the test coverage is substantial. Implements two new operation builders (`default_missing`, `default_mismatch`), strengthens postchecks, fixes missing `indexOrConstraint` data in the verifier, adds `extra_default` detection, and delivers ~2,100 lines of integration tests covering all 11 reconciliation operations plus 7 compound scenarios.

**Commits reviewed:**

| Commit | Description |
|--------|------------|
| `7aa838a0d` | fix(planner): handle default_missing and default_mismatch schema issues |
| `5efcb3827` | fix(planner): use type-aware postcheck for ALTER COLUMN TYPE |
| `adc6d7f8f` | fix(verifier): populate indexOrConstraint on extra-object issues and fix FK detection |
| `549736139` | docs: create reconciliation-testing project with compound scenario spec and plan |
| `5fd1642a5` | test(planner): add compound reconciliation integration tests |
| `6a7a3754a` | refactor(planner): replace LIKE with exact match in default value postcheck |
| `ffaf036b3` | fix(verifier): detect extra_default when DB has default but contract does not |
| `3d01db1c4` | test(planner): add integration tests for extra_default, unique/FK, and PK mismatch |
| `5f457a0f1` | test(planner): add integration test for extra_default with nullability widening |

**Files changed:** 15 files, +2,120 / -20 lines

## Critical Issues

### 1. `buildSetDefaultOperation` postcheck only checks existence, not value

**Location:** `planner-reconciliation.ts:587-592`

`buildSetDefaultOperation` (for `default_missing`) uses `columnDefaultCheck` which only verifies `column_default IS NOT NULL`. This is the same class of bug that TML-2089 fixed for `buildAlterDefaultOperation`. If a column already has *some other* default (e.g., from a prior partial migration or a serial sequence), the idempotency probe postcheck would pass even though the correct default wasn't applied.

**Fix:** Use `columnDefaultValueCheck` with `renderExpectedPgDefault`, matching the pattern already used in `buildAlterDefaultOperation`:

```typescript
postcheck: [
  {
    description: `verify column "${columnName}" default matches expected value`,
    sql: columnDefaultValueCheck({
      schema: schemaName,
      table: tableName,
      column: columnName,
      expectedDefault: renderExpectedPgDefault(column.default!, column),
    }),
  },
],
```

**Note:** The TODO on line 629 (`buildAlterDefaultOperation`) is a false alarm — that function already uses `columnDefaultValueCheck` correctly. The bug is only in `buildSetDefaultOperation`.

**Supersedes prior review Minor Suggestion #3** which stated "when adding a default where none existed, existence is sufficient". On further analysis, existence-only is insufficient — the postcheck must verify the *correct* default was applied, not just that *any* default exists.

## Recommendations

### 2. `extra_default` detection may false-positive on serial/identity columns

**Location:** `verify-sql-schema.ts:739-760`

When `strict` mode is on and the contract has no default but the DB has one, this now emits `extra_default`. Serial/identity columns have implicit defaults (`nextval('..._seq')`) that the contract may not declare explicitly. If the contract defines a serial column via `autoincrement` semantics rather than an explicit `default`, this could produce false positives.

**Action:** Verify whether serial/identity columns already get special handling upstream. The `buildColumnDefaultSql` comment says "autoincrement is handled specially via SERIAL types", which suggests there may be a gap. If not already handled, the `extra_default` check needs a guard filtering out `nextval(` defaults or checking an `isGenerated` flag.

### 3. `columnTypeCheck` fragility with aliased PG types

**Location:** `planner.ts:990-1000`

The postcheck compares `atttypid` against `'expectedType'::regtype`. This works for canonical PG type names (`int4`, `text`, `uuid`), but could fail if the contract ever uses aliases (`integer`, `int`, `varchar`) because `::regtype` resolves to the canonical OID. Since `buildColumnTypeSql` returns the expanded native type from the contract, this is fine today — the contract stores canonical types. Noting it as a fragility if user-supplied type names are ever supported.

### 4. Confirm `default_mismatch` as `widening` is intentional

**Location:** `planner-reconciliation.ts:214-234`

`default_mismatch` requires `mode.allowWidening` and produces `operationClass: 'widening'`. This is reasonable (changing a default doesn't break existing rows), but is a design choice worth being intentional about. Changing from `DEFAULT 'draft'` to `DEFAULT 'active'` is classified the same as `DROP NOT NULL`. Verify this matches the operation class taxonomy the team uses.

### 5. Replace spread TODO with narrowing comment

**Location:** `planner-reconciliation.ts:230-234`

```typescript
// TODO: why do we need a spread here but nowhere else?
return buildAlterDefaultOperation(schemaName, issue.table, issue.column, {
  ...contractColMismatch,
  default: contractColMismatch.default,
});
```

The spread exists solely to narrow the type: `contractColMismatch.default` is `T | undefined`, but `buildAlterDefaultOperation` requires `{ default: NonNullable<...> }`. The `invariant` above proves it's defined, but TypeScript doesn't narrow through `invariant()`. The spread re-assigns `default` after the check, which *does* narrow. Replace the TODO with a comment explaining this — the code is correct.

### 6. Rename `columnDefaultCheck` -> `columnDefaultExistsCheck` + JSDoc all check helpers

**Location:** `planner.ts:1004`

The current name is ambiguous — it could mean "check the value" or "check existence". `columnDefaultExistsCheck` makes the semantics obvious and contrasts clearly with `columnDefaultValueCheck`. Add JSDoc to `columnTypeCheck` (line 979) as well.

### 7. Implicit operation ordering in compound scenarios

**Location:** `planner-reconciliation.ts:737-753`

`sortSchemaIssues` sorts alphabetically by `kind`. For "changes column type and default together" (text DEFAULT 'active' -> int4 DEFAULT 1), this means `default_mismatch` executes before `type_mismatch` — ALTER DEFAULT runs before ALTER TYPE. This works for the tested case because integer `1` is valid as a text default. But for a more type-sensitive change (e.g., a default that's only valid for the new type), the order would matter.

This is a pre-existing architectural concern in `sortSchemaIssues`, not introduced by this PR. Noting it here because the compound integration tests now exercise this path and it would be worth a comment in the sort function documenting the ordering invariant, or tracking it as a known limitation.

### 8. `renderExpectedPgDefault` lacks exhaustive `default` case

**Location:** `planner.ts:1055-1074`

The switch handles `literal` and `function`, which is exhaustive for the current `ColumnDefault` type. But if a new variant is added to `ColumnDefault` in the future, this function would silently return `undefined` at runtime despite the `string` return type annotation (TypeScript's `noImplicitReturns` would catch it at compile time only if enabled). Adding a `default: never` case would make this future-proof:

```typescript
default: {
  const _exhaustive: never = columnDefault;
  throw new Error(`Unhandled default kind: ${(_exhaustive as { kind: string }).kind}`);
}
```

Not blocking — the type system currently constrains this correctly.

## Minor Suggestions

### 9. Duplicate `SchemaIssue` type in two packages

**Location:** `packages/1-framework/1-core/migration/control-plane/src/types.ts:411-412` and `packages/1-framework/1-core/shared/config/src/types.ts:208-209`

Both files declare a `SchemaIssue` type with the same `kind` union. The `extra_default` addition was correctly applied to both, but this is a maintenance hazard. If these are the same type, one should re-export the other.

### 10. Same operation id for `setDefault` and `alterDefault`

`buildSetDefaultOperation` and `buildAlterDefaultOperation` both use `setDefault.${tableName}.${columnName}` as the operation id. If both `default_missing` and `default_mismatch` were emitted for the same column in one plan, deduplication would drop one. This is likely impossible (a column either has no default or has a wrong default), but a brief comment at the `id` assignment would make this intentional coupling clear.

### 11. `makeTable` always assigns a PK

The integration test helper `makeTable` uses `primaryKey: { columns: [Object.keys(columns)[0]!] }`, silently assigning a PK to the first column. Tests that need PK-less tables already use inline definitions (e.g., the drop-PK test). If this convention isn't obvious to future contributors, a JSDoc note on `makeTable` would help.

## Positive Notes

- **All previous review findings addressed**: The earlier iteration's recommendations (wrong comment text, unused import, missing FK unit test, test boilerplate) have all been resolved. Clean follow-through.
- **Verifier `indexOrConstraint` fix was load-bearing**: Populating `indexOrConstraint` on extra-FK, extra-unique, and extra-index issues in `verify-helpers.ts` was a necessary prerequisite — without it, these issues silently fell through the `!issue.indexOrConstraint` guard and drop operations were unreachable dead code.
- **FK strict-mode fix**: The `constraintFks.length > 0 || strict` change closes a real gap where extra FKs were invisible when the contract had no FKs for a table. The comment explains the why.
- **Postcheck strengthening for ALTER TYPE**: Replacing the existence-only postcheck with a type-aware check via `pg_attribute.atttypid = '...'::regtype` is correct. The old check would pass even if the type change failed silently.
- **LIKE -> exact match**: Replacing `LIKE` with exact `=` in `columnDefaultValueCheck` removes a class of false positives where `%` or `_` in default values could match unintended patterns.
- **Operation class correctness**: `default_missing` as `additive` and `default_mismatch` as `widening` is the right classification. Adding a default where none exists is purely additive; changing an existing default is a semantic widening.
- **Integration test coverage**: 11 single-operation tests + 7 compound scenarios exercising the full plan->run->verify pipeline against a real Postgres instance. Compound tests cover: type+default, nullability+default, FK+table drop, column+index drop, mixed nullability, type with index, literal->function default, nullability widening+default drop.
- **Defensive invariants**: `invariant()` assertions for contract/issue consistency catch verifier bugs early with clear messages, with corresponding unit tests for the throw path.
- **`extra_default` issue kind**: Clean addition across both type definitions, verifier detection, planner operation builder (`buildDropDefaultOperation`), and conflict conversion. Correctly classified as `destructive`.
- **Spec-driven approach**: The specs and plans in `projects/reconciliation-testing/` provide clear traceability from requirements to tests to discovered issues.

## Action Items

| # | Severity | Item | Status |
|---|----------|------|--------|
| 1 | Critical | `buildSetDefaultOperation` postcheck should check value, not just existence | Open |
| 2 | Recommendation | Verify `extra_default` doesn't false-positive on serial/identity columns | Open |
| 3 | Recommendation | Note `columnTypeCheck` fragility with aliased types | Open |
| 4 | Recommendation | Confirm `default_mismatch` as widening is intentional | Open |
| 5 | Recommendation | Replace spread TODO with narrowing comment | Open |
| 6 | Recommendation | Rename `columnDefaultCheck` -> `columnDefaultExistsCheck` + JSDoc | Open |
| 7 | Recommendation | Document operation ordering invariant in `sortSchemaIssues` | Open |
| 8 | Recommendation | Add exhaustive `default: never` to `renderExpectedPgDefault` | Open |
| 9 | Minor | Deduplicate `SchemaIssue` type across packages | Open |
| 10 | Minor | Comment shared operation id between set/alter default | Open |
| 11 | Minor | Add JSDoc note to `makeTable` test helper about implicit PK | Open |
