# Declarative Database Dependencies

## Summary

Replace `SqlSchemaIR.extensions` (Postgres-specific) with a generic `dependencies: DependencyIR[]` node, remove the `extension` field and `verifyDatabaseDependencyInstalled` callback from `ComponentDatabaseDependency`, and update all consumers (planner, verifier, introspection, `contractToSchemaIR`, tests) to use dependency ID matching. Success means incremental `migration plan` no longer re-emits extension operations, and the schema IR is target-agnostic.

**Spec:** `projects/on-disk-migrations-v2/specs/declarative-database-dependencies.spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Agent | Drives execution |

## Milestones

### Milestone 1: Schema IR type change and interface cleanup

Foundational type changes that all other work depends on. Delivers compilable code with updated types but deferred behavioral changes.

**Tasks:**

- [ ] M1-T1: Replace `extensions: readonly string[]` with `dependencies: readonly DependencyIR[]` on `SqlSchemaIR` in `packages/2-sql/1-core/schema-ir/src/types.ts`. Export `DependencyIR` as `{ readonly id: string }`. Make `dependencies` required (empty array for no dependencies). (AC-1, AC-2)
- [ ] M1-T2: Remove `extension?: string` field from `ComponentDatabaseDependency` in `packages/2-sql/3-tooling/family/src/core/migrations/types.ts`. (AC-3)
- [ ] M1-T3: Remove `verifyDatabaseDependencyInstalled` callback from `ComponentDatabaseDependency` in `packages/2-sql/3-tooling/family/src/core/migrations/types.ts`. (AC-4)
- [ ] M1-T4: Update pgvector extension descriptor (`packages/3-extensions/pgvector/src/exports/control.ts`) — remove `extension` field and `verifyDatabaseDependencyInstalled` callback from database dependency declarations.
- [ ] M1-T5: Fix all TypeScript compilation errors caused by the type changes. This includes updating all test files that construct `SqlSchemaIR` with `extensions: []` to use `dependencies: []`, and all files that reference `verifyDatabaseDependencyInstalled` or `extension` on dependencies.

### Milestone 2: Behavioral updates (contractToSchemaIR, planner, verifier, introspection)

Update the four consumers of the changed types to implement the new behavior.

**Tasks:**

- [ ] M2-T1: Update `contractToSchemaIR` (`packages/2-sql/3-tooling/family/src/core/migrations/contract-to-schema-ir.ts`) — replace `collectExtensionsFromComponents` with dependency ID collection from framework components' `databaseDependencies.init[].id`. Return `dependencies: [{ id: dep.id }, ...]` instead of `extensions: [...]`. (AC-5)
- [ ] M2-T2: Update the postgres planner (`packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts`) — replace `verifyDatabaseDependencyInstalled(schema)` call with a dependency ID presence check against `schemaIR.dependencies`. Skip install ops when `dep.id` is found in `dependencies`, emit when missing. Remove the `PlannerDatabaseDependency` type's `verifyDatabaseDependencyInstalled` field. (AC-7)
- [ ] M2-T3: Update schema verification (`packages/2-sql/3-tooling/family/src/core/migrations/schema-verify.ts` or equivalent) — replace per-component `verifyDatabaseDependencyInstalled` calls with generic dependency ID subset check. (AC-4, AC-6)
- [ ] M2-T4: Update postgres adapter introspection (`packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts`) — map `pg_extension` rows to `DependencyIR` entries using `postgres.extension.<extname>` convention instead of populating `extensions`. (AC-6)

### Milestone 3: Test updates and verification

Ensure all tests pass and acceptance criteria are verified.

**Tasks:**

- [ ] M3-T1: Update family-level `contractToSchemaIR` tests (`packages/2-sql/3-tooling/family/test/contract-to-schema-ir.test.ts`) — assert `dependencies` instead of `extensions`. Add test that dependency IDs are collected from framework components.
- [ ] M3-T2: Update postgres planner `contractToSchemaIR` tests (`packages/3-targets/3-targets/postgres/test/migrations/planner.contract-to-schema-ir.test.ts`) — update all schema IR constructions and assertions from `extensions` to `dependencies`. Verify incremental planning doesn't re-emit extension ops. (AC-8)
- [ ] M3-T3: Update postgres planner case/behavior/reconciliation tests — replace `extensions: []` with `dependencies: []` in all schema IR fixtures.
- [ ] M3-T4: Update schema verification dependency tests (`packages/2-sql/3-tooling/family/test/schema-verify.dependencies.test.ts`) — replace `verifyDatabaseDependencyInstalled` with dependency ID matching. Update assertions.
- [ ] M3-T5: Update postgres adapter introspection tests (`packages/3-targets/6-adapters/postgres/test/control-adapter.test.ts`) — verify `pg_extension` rows produce `dependencies: [{ id: 'postgres.extension.<name>' }]`.
- [ ] M3-T6: Update integration tests that reference `extensions` on schema IR (`test/integration/`).
- [ ] M3-T7: Run full test suite (`pnpm test:packages`) and fix any remaining failures.

### Milestone 4: Documentation and close-out

Update ADR and architecture docs, then clean up.

**Tasks:**

- [ ] M4-T1: Update ADR 154 (`docs/architecture docs/adrs/ADR 154 - Component-owned database dependencies.md`) — add section describing the `DependencyIR` approach, replacing procedural callbacks with structural ID matching.
- [ ] M4-T2: Update Migration System subsystem doc (`docs/architecture docs/subsystems/7. Migration System.md`) — update the "Offline planning via contract-to-schemaIR" section to describe `dependencies` instead of `extensions`.
- [ ] M4-T3: Update the project spec (`projects/on-disk-migrations-v2/spec.md`) § "Offline planning" to reflect the final `DependencyIR` approach.

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| AC-1: `SqlSchemaIR` has `dependencies: DependencyIR[]` | Unit (compile) | M1-T1 | Type change verified by compilation |
| AC-2: `DependencyIR` is `{ readonly id: string }` | Unit (compile) | M1-T1 | Type definition verified by compilation |
| AC-3: No `extension` field on `ComponentDatabaseDependency` | Unit (compile) | M1-T2 | Removal verified by compilation |
| AC-4: `verifyDatabaseDependencyInstalled` removed; generic verification | Unit | M3-T4 | Schema verify dependency tests |
| AC-5: `contractToSchemaIR` populates `dependencies` from `dep.id` | Unit | M3-T1, M3-T2 | Family + postgres contract-to-schema-ir tests |
| AC-6: Introspection maps `pg_extension` to `DependencyIR` | Unit | M3-T5 | Adapter introspection tests |
| AC-7: Planner skips/emits based on dependency ID presence | Unit | M3-T2 | Planner contract-to-schema-ir tests |
| AC-8: Incremental plan doesn't re-emit extension ops | Unit | M3-T2 | Round-trip planner test with incremental change |
| AC-9: 3rd-party extensibility | Unit | M3-T2 | Test with custom dependency ID and install ops |

## Open Items

None — all open questions resolved in spec.
