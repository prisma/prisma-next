# migration show Plan

## Summary

Add a `migration show` subcommand that renders migration package contents using the existing `formatMigrationPlanOutput` renderer (same as `db update --plan`), with operation class badges, DDL preview, and destructive operation warnings. Support git-style hash prefix resolution for targeting specific migrations. Integrate into `migration plan` so users see the full detail at plan time.

**Spec:** `projects/migration-show/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Agent | Drives execution |
| Reviewer | sbs | Architectural review, UX validation |

## Milestones

### Milestone 1: Implementation ✅

Build the `migration show` command, hash prefix resolution, destructive warning, and integrate into `migration plan`.

**Tasks:**

- [x] Write unit tests for hash prefix resolution: unique match, ambiguous match (lists candidates), no match (error), full hash match, path detection (contains `/`)
- [x] Implement `resolveByHashPrefix` function in `migration-show.ts` that resolves a hash prefix to a `MigrationPackage` — handles ambiguous, no-match, and draft-skipping
- [x] Write unit tests for destructive warning rendering: additive-only (no warning), mixed additive+destructive (warning with count), destructive-only (warning)
- [x] Extend `formatMigrationPlanOutput` in `output.ts` to include destructive operations warning line and yellow-highlighted `[destructive]` badges
- [x] Create `formatMigrationShowOutput` in `output.ts` for migration show-specific output (metadata, operations, DDL, destructive warnings)
- [x] Create `packages/1-framework/3-tooling/cli/src/commands/migration-show.ts`: command handler that reads a migration package (via path or hash prefix or default-to-latest), extracts DDL via `extractSqlDdl`, and renders via `formatMigrationShowOutput`
- [x] Register `migration show` in `cli.ts` under the `migration` group
- [x] Add `@prisma-next/cli/commands/migration-show` export to CLI `package.json` exports map
- [x] Add entry to `tsdown.config.ts`
- [x] Update `MigrationPlanResult.operations` in `migration-plan.ts` to include `operationClass` and `sql`
- [x] Update the local `formatMigrationPlanOutput` in `migration-plan.ts` with operation class badges, DDL preview, and destructive warnings
- [x] Fix migration-verify tampered-package test to use schema-valid tampered ops (arktype validation)
- [x] Update `output.db-update.test.ts` with destructive warning assertions

**Note on e2e tests:** Full CLI e2e tests (spawning the process with a real config file) were not added because the existing test pattern for migration commands in this codebase tests at the DAG/IO level rather than process-level. The unit tests for `resolveByHashPrefix` and `formatMigrationShowOutput` cover the key behaviors.

**Note on `migration-plan.ts` formatter:** Rather than replacing the local formatter with a call to the shared `formatMigrationPlanOutput` from `output.ts`, the local formatter was updated in-place to include the same features (operation class badges, DDL preview, destructive warnings). The two formatters serve different shapes: the shared one takes `MigrationCommandResult` (used by `db init`/`db update`), while the local one takes `MigrationPlanResult`. A new `formatMigrationShowOutput` was added for `migration show`.

### Milestone 2: Verification and close-out ✅

**Tasks:**

- [x] Run `pnpm lint:deps` — no layering violations (343 modules, 657 dependencies)
- [x] Run `pnpm test --filter @prisma-next/cli` — 241 tests pass
- [x] Run `pnpm test --filter @prisma-next/migration-tools` — 67 tests pass
- [x] Update CLI README with `migration show` command documentation and entrypoint
- [ ] Add verification scenarios to `projects/on-disk-migrations/verification-scenarios.md`
- [ ] Verify all acceptance criteria from the spec with reviewer

## Test Coverage

| Acceptance Criterion | Test Type | Status | Notes |
|---|---|---|---|
| `show <dir>` displays with class badges | Unit | ✅ | `formatMigrationShowOutput` tests |
| `show <hash-prefix>` resolves by unique prefix | Unit | ✅ | `resolveByHashPrefix` tests |
| `show <ambiguous-prefix>` lists matches | Unit | ✅ | Returns structured error |
| `show <unknown-prefix>` errors clearly | Unit | ✅ | Returns structured error |
| `show` defaults to latest | Impl | ✅ | DAG leaf resolution in command handler |
| Destructive ops warning line | Unit | ✅ | Both `output.ts` and show formatter |
| DDL preview always shown | Unit | ✅ | Always rendered when sql present |
| Draft indicator for `edgeId: null` | Unit | ✅ | Shows "(draft — not yet attested)" |
| `migration plan` includes class badges + DDL | Unit | ✅ | Updated local formatter |
| Destructive warning in `db update --plan` | Unit | ✅ | `output.db-update.test.ts` |
| `pnpm lint:deps` passes | CI | ✅ | 0 violations |
| Existing tests pass | CI | ✅ | 241 CLI + 67 migration-tools |

## Resolved Items

- **On-disk `ops.json` shape:** Confirmed compatible. The Postgres planner produces `SqlMigrationPlanOperation` with `{ id, label, operationClass, target, precheck, execute, postcheck }` where each step has `{ description, sql }`. Serialized directly to `ops.json`. The existing `extractSqlDdl()` works identically on deserialized ops — no mapping needed.
- **Hash prefix matching field:** Match against `edgeId` (the migration's content-addressed identity), not `to` hash. Draft migrations (`edgeId: null`) are excluded from prefix matching since they have no identity hash.
- **Formatter architecture:** Three formatters coexist: (1) `formatMigrationPlanOutput` in `output.ts` for `MigrationCommandResult` (db init/update), (2) local `formatMigrationPlanOutput` in `migration-plan.ts` for `MigrationPlanResult`, (3) `formatMigrationShowOutput` in `output.ts` for `MigrationShowResult`. All three now share the same visual language (tree characters, operation class badges, destructive warnings).

## Open Items

- Verification scenarios need to be added to `projects/on-disk-migrations/verification-scenarios.md`
- Final acceptance criteria review with stakeholder
