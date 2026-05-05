# Id-Less SQL Models Plan

## Summary

Add SQL PSL support for models without primary keys and for composite `@@id`, so inferred SQL PSL can be emitted back into a contract. Success means id-less SQL models emit storage tables without `primaryKey`, composite `@@id` emits a primary key, and focused package tests pass.

**Spec:** `projects/id-less-sql-models/spec.md`

## Collaborators

| Role | Person/Team | Context |
| --- | --- | --- |
| Maker | Current branch owner | Implements SQL PSL and emitter changes |
| Reviewer | Prisma Next SQL reviewer | Reviews contract shape and downstream behavior |

## Shipping Strategy

Ship as one backward-compatible milestone. Contracts with existing `@id` continue to emit the same `primaryKey`, contracts with `@@id` start emitting the primary key they declare, and id-less models simply omit the optional `primaryKey` property that the SQL storage type already permits.

## Test Design

| Test Case | Type | Acceptance Criteria | Expected Outcome |
| --- | --- | --- | --- |
| TC1 | Unit | AC1 | SQL PSL interpreter accepts a model without `@id`/`@@id` and the table has no `primaryKey`. |
| TC2 | Unit | AC2 | SQL PSL interpreter accepts composite `@@id([email, token])` and emits `primaryKey.columns` in field order. |
| TC3 | Unit | AC3 | SQL PSL interpreter maps `@@id` fields through `@map` and preserves `map: "..."` as the primary key name. |
| TC4 | Unit | AC4 | SQL emitter structure validation accepts a model table without `primaryKey`. |
| TC5 | Package validation | AC5 | Focused package tests and typecheck pass locally. |

## Milestones

### Milestone 1: SQL PSL Id-Less And Composite Identity

Implement the full behavior in the SQL PSL interpreter and SQL emitter validation.

**Tasks:**

- [x] Add failing SQL PSL interpreter tests for id-less models, composite `@@id`, and mapped/named composite `@@id`. Addresses TC1, TC2, TC3.
- [x] Add or update SQL emitter validation tests so model-backed tables without `primaryKey` are valid. Addresses TC4.
- [x] Update SQL PSL model attribute lowering to parse `@@id`, map field names to columns, preserve `map`, and stop reporting missing primary keys for id-less SQL models. Addresses TC1, TC2, TC3.
- [x] Relax SQL emitter structure validation so model-backed SQL tables may omit `primaryKey`, while retaining validation of `primaryKey` column references when present. Addresses TC4.
- [x] Run focused package tests and typecheck. Addresses TC5.

**Validation gate:**

- `pnpm --filter @prisma-next/sql-contract-psl test`
- `pnpm --filter @prisma-next/sql-contract-emitter test`
- `pnpm --filter @prisma-next/sql-contract-psl typecheck`
- `pnpm --filter @prisma-next/sql-contract-emitter typecheck`

## Close-out

- [x] Verify all acceptance criteria in `projects/id-less-sql-models/spec.md`.
- [x] Decide whether any long-lived docs need updates; this change is expected to be covered by tests rather than durable docs.
- [ ] Delete `projects/id-less-sql-models/` during project close-out after the implementation is reviewed.
