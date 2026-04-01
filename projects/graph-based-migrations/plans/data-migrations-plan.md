# Data Migrations Plan

## Summary

Add data migration support to prisma-next's graph-based migration system. All migrations (structural + data) are authored as TypeScript operation chains using operation builders, serialized to JSON ASTs at verification time, and executed as SQL at apply time. Data transforms are first-class operations in the chain. The system detects when data migrations are needed, scaffolds the appropriate operations, tracks named invariants in the ledger, and routes through invariant-satisfying paths.

**Spec:** `projects/graph-based-migrations/specs/data-migrations-spec.md`

## Prerequisites

### P1: Ref format refactor — DONE

Refs refactored from `migrations/refs.json` to `migrations/refs/<name>.json` with `{ hash: string, invariants: string[] }`.

## Progress

### Done

- [x] `DataTransformOperation` + `SerializedQueryNode` types at framework level
- [x] Thin operation descriptors (reference contract by name, not value)
- [x] Operation resolver (descriptors + contract context → `SqlMigrationPlanOperation`)
- [x] `resolveDescriptors` on `TargetMigrationsCapability` (framework interface + Postgres impl)
- [x] `scaffoldMigrationTs` + `evaluateMigrationTs` + `hasMigrationTs` utilities
- [x] `query-node-renderer` with `raw_sql` passthrough (slot for proper AST rendering later)
- [x] Runner handles `DataTransformOperation` with check→(skip or run)→check lifecycle
- [x] `migration new` command (scaffolds package with migration.ts)
- [x] `migration verify` evaluates migration.ts, resolves descriptors, writes ops.json, attests
- [x] `migration verify` scans all packages (not just `--dir`)
- [x] `writeMigrationManifest` + `writeMigrationOps` shared utilities
- [x] `'data'` operation class allowed in migration apply policy
- [x] E2E journey test: migration new → fill migration.ts → verify → apply → data correct
- [x] Operation builder exports from `@prisma-next/target-postgres/migration-builders`

## Milestones

### Milestone: Harden migration verify

`migration verify` now scans all packages and handles draft migrations, but needs thorough testing and hardening around target selection and ambiguous graph states.

**Tasks:**

- [ ] Test verify with multiple packages (mix of attested, draft, mismatched)
- [ ] Test verify behavior with diverged graph (multiple leaves) — verify should not require path selection since it operates on packages, not the graph
- [ ] Test verify when draft migration has migration.ts that fails evaluation (syntax error, invalid descriptors)
- [ ] Test verify when draft migration has no migration.ts (plain draft from manual migrationId reset)
- [ ] Verify that verify never requires `--ref` or path selection — it operates per-package, not per-graph-path. If ambiguity matters (e.g., for resolveDescriptors context), surface a clear error with hints to use `migration status` to understand the graph state
- [ ] Test that verify correctly loads config for resolveDescriptors (the target is needed for TS evaluation)
- [ ] Consider: should verify re-attest already-attested packages that have a migration.ts with newer mtime than ops.json? (stale serialization detection)

### Milestone: Draft migration visibility

Draft migrations from `migration new` are invisible to `migration status` and `migration apply`. See `projects/graph-based-migrations/issue-triage.md` for details.

**Tasks:**

- [ ] `migration status`: show draft packages with a `[draft]` marker
- [ ] `migration apply`: warn if draft packages exist, suggest running `migration verify`
- [ ] `migration plan`: error if a draft package targeting the same `to` hash already exists
- [ ] Update `loadMigrationBundles` or add a variant that returns both attested and draft bundles

### Milestone: Planner detection and scaffolding

The planner detects data migration needs and produces `migration.ts` files with operation builder calls (including `dataTransform` placeholders).

**Tasks:**

- [ ] Determine intercept point in planner for data migration detection
- [ ] When NOT NULL column added without default: emit addColumn (nullable) + dataTransform placeholder + setNotNull instead of temp default strategy
- [ ] When non-widening type change detected: emit temp column + dataTransform + drop/rename
- [ ] When nullable → NOT NULL: emit dataTransform placeholder + setNotNull
- [ ] Scaffold migration.ts with detected changes as comments
- [ ] Skip attestation when data migration detected (leave package draft)
- [ ] Tests for each detection case

### Milestone: Graph integration and invariant-aware routing

**Tasks:**

- [ ] Extend `MigrationChainEntry` to carry data transform metadata
- [ ] Extend pathfinder to collect invariant names along paths
- [ ] Implement invariant-aware path selection from environment refs
- [ ] Extend ledger to record data transform names
- [ ] Update `migration status` to show data transform info
- [ ] Tests for routing with invariants

### Milestone: Close-out

**Tasks:**

- [ ] VP1 scenario end-to-end (split name)
- [ ] Update subsystem docs
- [ ] Migrate docs from `projects/` to `docs/`

## Open Items

1. **Planner refactor approach**: The planner currently doesn't work from a unified diff. Additive detection is done by iterating the contract, reconciliation from schema issues. A clean diff-based planner would make pattern matching natural, but is a significant refactor. For now, minimal intercept in `buildAddColumnOperation` for the NOT NULL case. See spec and conversation for full analysis.

2. **Draft visibility**: Tracked in issue-triage.md.

3. **Query builder expressiveness**: UPDATE with expressions, INSERT...SELECT, mutation joins — known gaps. QB extends independently.

4. **Verify target selection**: `migration verify` must not require ambiguous path resolution. It operates per-package. If resolveDescriptors needs target context, the config provides it. If the graph is ambiguous, verify doesn't care — it's not path-finding, just attesting packages.

5. **Stale serialization**: If migration.ts is edited after verify, the ops.json is stale but edgeId still matches ops.json (not migration.ts). Re-running verify should detect this. Consider mtime-based hint.
