# Open Issues — fix/planner-issues branch

Consolidated from code review, TODOs, and issue triage. Verified against codebase on 2026-03-23.

---

## Bugs

### ~~1. `buildSetDefaultOperation` postcheck checks existence, not value~~ FIXED

Fixed: `buildSetDefaultOperation` now uses `columnDefaultValueCheck` with `renderExpectedPgDefault`. Also refactored both `buildSetDefaultOperation` and `buildAlterDefaultOperation` to take `columnDefault` as a separate parameter with `Omit<StorageColumn, 'default'>` to prevent accidental use of the wrong default. Stale TODO at line 629 removed.

### 2. `extra_default` false positives on serial/identity columns

**Location:** `verify-sql-schema.ts:739`
**Code review:** #2

The `extra_default` check fires when `strict && schemaColumn.default` is truthy but the contract has no default. Serial/identity columns have implicit defaults (`nextval('..._seq')`) that the contract doesn't declare — the contract uses `autoincrement` semantics instead. There is no guard for this anywhere in the verify path (confirmed: no `nextval`, `serial`, `isGenerated`, or `autoincrement` references in `verify-sql-schema.ts`).

This will produce false positives for any serial/identity column in strict mode.

**Fix:** Guard the `extra_default` check to skip columns where `schemaColumn.default` starts with `nextval(` or the contract column has generated/autoincrement semantics.

---

## ~~Code quality~~ FIXED

- **#4** Renamed `columnDefaultCheck` → `columnDefaultExistsCheck`, added JSDoc to all three check helpers.
- **#5** Eliminated the spread workaround entirely by refactoring `buildSetDefaultOperation` and `buildAlterDefaultOperation` to take `columnDefault` as a separate parameter.
- **#6** Dropped — `noImplicitReturns` is enabled, adding `default: never` is pointless.

---

## Design questions (verify with team)

### 7. `default_mismatch` classified as `widening` — intentional?

**Location:** `planner-reconciliation.ts:214-234, 610`
**Code review:** #4

`default_mismatch` requires `mode.allowWidening` and produces `operationClass: 'widening'`. Changing a default doesn't break existing rows, so this is defensible. But it means changing `DEFAULT 'draft'` to `DEFAULT 'active'` is classified the same as `DROP NOT NULL`. Worth confirming this matches the intended operation class taxonomy.

User input: I don't feel like this is narrowing, widening or destructive, I don't think?

### 8. Operation ordering in compound scenarios

**Location:** `planner-reconciliation.ts:740-750`
**Code review:** #7

`sortSchemaIssues` sorts alphabetically by `kind`. For "change type and default together", this means `default_mismatch` executes before `type_mismatch`. This works today because tested cases are forgiving, but a type-sensitive default (only valid for the new type) would fail. Pre-existing issue, not introduced by this PR.

---

## Deferred

### 3. Duplicate `SchemaIssue` type in two packages

**Location:**
- `packages/1-framework/1-core/migration/control-plane/src/types.ts:391-420`
- `packages/1-framework/1-core/shared/config/src/types.ts:191-220`

**Code review:** #9

`SchemaIssue`, `SchemaVerificationNode`, and `VerifyDatabaseSchemaResult` are duplicated identically across both files. The duplicate was introduced in `af0712a3b` ("feat(config): add shared config package for authoring surface") — copy-pasted from `core-control-plane`, kept in sync manually since. Every new issue kind (like `extra_default`) must be added to both.

**Layering analysis:** `@prisma-next/config` is in the `shared` plane; `@prisma-next/core-control-plane` is in the `migration` plane. Plane rules forbid shared from importing migration. Migration can import shared. So the canonical types must live in `config` (shared), and `core-control-plane` should add a dependency on `@prisma-next/config` and re-export them. All external consumers import from `core-control-plane/types` today, so the re-export keeps them working unchanged. Config's copy is not even exported from its public API — it's only used internally by the `ControlFamilyInstance.schemaVerify()` return type.

---

## Already fixed / not applicable

| Review item | Status | Reason |
|---|---|---|
| #3 — `columnTypeCheck` fragility with aliased PG types | Not applicable | Contract stores canonical types; `::regtype` resolves correctly. Only relevant if user-supplied type names are ever allowed. |
| #10 — Same operation id for set/alter default | Not applicable | A column can only have `default_missing` OR `default_mismatch`, never both — the verifier logic is mutually exclusive. |
| #11 — `makeTable` implicit PK | Not applicable | Test helper convention is clear from usage; callers that need different PK behavior use inline definitions. |
| Issue triage: extra_default | Fixed | TML-2091 — implemented in this branch. |
| TODO at line 629 | Stale | `buildAlterDefaultOperation` already uses `columnDefaultValueCheck`. The TODO text is misleading — delete it. |
