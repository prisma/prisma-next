# Summary

Prisma Next SQL PSL authoring should accept SQL models without an `@id` field and should lower composite `@@id` declarations into SQL primary keys. This restores compatibility with database tables that do not have a primary key while preserving composite primary key support for SQL contracts.

# Context

## At a glance

Today, a SQL `contract.prisma` model such as `model IdlessThing { email String @unique token String }` fails before contract emission with `PSL_MISSING_PRIMARY_KEY`, and `@@id([email, token])` fails both as missing `@id` and as unsupported. The SQL contract shape already allows `storage.tables.<table>.primaryKey` to be absent, and SQL schema introspection already prints no-primary-key tables as id-less PSL models, so the PSL interpreter should round-trip those SQL tables instead of rejecting them.

## Problem

The SQL PSL interpreter currently derives primary keys only from field-level `@id` attributes and reports `PSL_MISSING_PRIMARY_KEY` when no field has `@id`. This blocks legitimate SQL schemas whose tables have no primary key and makes introspected PSL for those tables non-emittable.

Composite `@@id` is already emitted by the SQL schema-to-PSL path for composite database primary keys, but the SQL PSL interpreter treats `@@id` as unsupported. That means a table inferred from a live SQL schema can print valid-looking PSL and then fail when the user emits the contract.

## Approach

For SQL PSL only, stop requiring at least one field-level `@id` per model. When a model has no field-level `@id` and no model-level `@@id`, emit the SQL table without `primaryKey` while keeping columns, unique constraints, indexes, relations, roots, and model field mappings intact.

For SQL PSL model-level `@@id`, parse the field list and optional `map` name using the same helpers already used for `@@unique` and `@@index`, map field names through `@map`, and lower the result to the contract's SQL primary key shape. Keep invalid argument and unknown-field diagnostics aligned with existing model attribute handling.

# Requirements

## Functional Requirements

- **FR1.** SQL PSL models without `@id` or `@@id` must emit a contract successfully.
- **FR2.** Id-less SQL models must produce storage tables with no `primaryKey` property.
- **FR3.** SQL PSL `@@id([fieldA, fieldB])` must emit a composite SQL `primaryKey`.
- **FR4.** SQL PSL `@@id(..., map: "name")` must preserve the primary key name.
- **FR5.** Field-to-column mapping via `@map` must apply to `@@id` fields.
- **FR6.** The change is limited to SQL PSL authoring and SQL emission validation; document-family behavior is out of scope.

## Non-Functional Requirements

- **NFR1.** The change must preserve existing diagnostics for malformed field lists, invalid `map` arguments, and unknown fields.
- **NFR2.** The generated `contract.d.ts` must continue to omit `primaryKey` when the storage table has none and include it when present.
- **NFR3.** Existing package-local tests must remain deterministic and require no database service.

## Non-goals

- Changing ORM operations that assume a single primary key fallback.
- Adding Prisma Client-like APIs for id-less models.
- Changing SQL schema verification semantics beyond accepting contracts whose tables intentionally omit `primaryKey`.
- Changing document or MongoDB PSL behavior.

# Acceptance Criteria

- [ ] **AC1.** Given a SQL PSL model with no `@id` or `@@id`, contract interpretation succeeds and the emitted storage table has no `primaryKey`. Covers FR1, FR2, NFR2.
- [ ] **AC2.** Given a SQL PSL model with `@@id([email, token])`, contract interpretation succeeds and the emitted storage table primary key columns are `['email', 'token']`. Covers FR3.
- [ ] **AC3.** Given `@map` on fields and `@@id(..., map: "name")`, contract interpretation uses mapped column names and preserves the primary key name. Covers FR4, FR5.
- [ ] **AC4.** SQL emitter structure validation accepts a model whose referenced table has no `primaryKey`. Covers FR1, FR2, NFR2.
- [ ] **AC5.** Focused SQL PSL and SQL emitter tests pass without requiring database infrastructure. Covers NFR3.

# Other Considerations

## Security

This is a compile-time authoring and emission change. It does not add runtime query execution, authentication, or data access behavior.

## Cost

No new runtime service or infrastructure cost is expected. The implementation is limited to package-local TypeScript code and tests.

## Observability

No runtime observability changes are required. Existing contract diagnostics remain the relevant feedback channel for malformed PSL.

# References

- `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts`
- `packages/2-sql/3-tooling/emitter/src/index.ts`
- `packages/2-sql/9-family/test/psl-contract-infer/print-psl/print-psl.core.test.ts`

# Open Questions

None. This spec treats SQL id-less models as storage tables without `primaryKey` and treats `@@id` as the SQL primary key declaration.
