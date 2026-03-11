# PR #231 Review TODOs

Review comments from **wmadden** and **jkomyno** on `refactor/declarative-dependency-ir`.

## wmadden (Changes Requested)

### Architectural concern: composability of dependency detection

**Status:** Discussed with wmadden — accepted as known limitation for now (deferred follow-up)

wmadden argues the PR shifts dependency detection from component-owned to adapter-owned, violating composability:

- The adapter introspects `pg_extension` and produces `DependencyIR` IDs it knows about
- Third-party extensions cannot introduce new dependency shapes unless the adapter is updated
- `DependencyIR` becomes "things the adapter knows how to introspect", not "things components declare"
- Wants component-owned detection (or a detector registry) so dependency presence is composable with extension packs

> "If we want to keep `DependencyIR` as structural IDs, we still need component-owned detection (or at least a component-contributed detector registry) so that dependency installation/presence is composable with extension packs, not gated on adapter feature work."

**Decision note:** Keep the current model for now. It works for Postgres extension-shaped dependencies (`pg_extension` mapped to dependency IDs), but broader dependency shapes are a known limitation. Follow-up work may introduce component-contributed detectors/detector registry.

### Inline comments

- [x] **ADR 154 — verify method question** (`docs/architecture docs/adrs/ADR 154 - Component-owned database dependencies.md:41`)
  Asks: "Isn't the verify method needed to detect whether the dependency is installed in the database schema?"
  **Resolved:** ADR 154 now separates target architecture from implementation status. The Decision/Model sections describe component-owned verification as the intended end-state, and a dedicated "Current implementation compromise (v1)" section documents today's adapter-owned `requiredId ∈ schema.dependencies` simplification and the intent to restore component-owned verification for non-extension dependency shapes.

- [x] **FK-backing index name duplication** (`contract-to-schema-ir.ts:114`)
  "This name generation looks like it doesn't belong here. It must exist in at least one other place and these two locations should share a common implementation."
  **Resolved:** Extracted `defaultIndexName` into `@prisma-next/sql-schema-ir/naming` (commit `d07c16f24`).

- [x] **Use `ifDefined` helper** (`contract-to-schema-ir.ts:212`)
  Suggests using the project's `ifDefined` utility instead of an inline conditional.

- [x] **`isDependencyProvider` belongs alongside `DatabaseDependencyProvider`** (`contract-to-schema-ir.ts:236-238`)
  "This looks a bit suspicious. It probably belongs alongside `DatabaseDependencyProvider` if framework components may conditionally implement the interface."
  **Resolved:** Moved `isDatabaseDependencyProvider` to `types.ts` next to `DatabaseDependencyProvider` (commit `110ced4ce`).

---

## jkomyno (Commented — approve with suggestions)

### P2 — Important

- [x] **1. Hardcoded `pg` namespace in target-agnostic family layer**
  `contract-to-schema-ir.ts` — `deriveAnnotations()` hardcodes `{ pg: { storageTypes: storage.types } }` in the family layer. If a MySQL target were added, it would incorrectly get `pg` annotations. Consider making the annotation namespace a parameter or documenting as acknowledged coupling.
  **Resolved:** `contractToSchemaIR` now requires `annotationNamespace` and writes storage-type annotations under that namespace. Postgres passes `annotationNamespace: 'pg'` at the target boundary, eliminating family-layer hardcoding and preserving target-agnostic behavior.

- [x] **2. Duplicate type guard pattern** (`isDependencyProvider` vs `isSqlDependencyProvider`)
  Two separate duck-typing guards exist in different layers doing similar checks.
  **Resolved:** Removed planner-local `isSqlDependencyProvider` entirely. The `familyId === 'sql'` check was redundant since the type already guarantees it. Planner now uses `collectInitDependencies` (shared utility) which internally uses `isDatabaseDependencyProvider`.

- [x] **3. `extension_missing` issue kind not renamed to `dependency_missing`**
  `verify-helpers.ts:489` still emits `kind: 'extension_missing'`. Referenced in 15+ locations. Recommendation: follow-up ticket (large blast radius).
  **Resolved:** Renamed `SchemaIssue.kind` to `dependency_missing` in shared types, family verifier emission, postgres reconciliation additive-issue filtering, and all related unit/integration assertions.

- [x] **4. Weak typing of `frameworkComponents` in `ContractToSchemaIROptions`**
  Was `readonly unknown[]`, should be properly typed.
  **Resolved:** Changed to `ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>` (commit `110ced4ce`).

- [x] **5. Three near-duplicate dependency collection functions**
  `collectDependenciesFromComponents()` (schema IR), `collectDependencies()` (planner), `collectDependenciesFromFrameworkComponents()` (verifier) all do the same core algorithm with different type guards, dedup, and return types.
  **Resolved:** Extracted `collectInitDependencies()` into `types.ts` (next to `isDatabaseDependencyProvider`), exported from `@prisma-next/family-sql/control`. All three consumers now use it. Schema-IR adds dedup on top; planner adds sort + cast; verifier casts to typed deps.

- [x] **6. Dead `SqlPlannerConflictKind` variants**
  `'extensionMissing'` and `'unsupportedExtension'` in the union are never emitted. Clean up alongside `extension_missing` rename.
  **Resolved:** Removed both dead variants from `SqlPlannerConflictKind` and updated postgres README example text.

- [x] **7. `OperationClass` type still includes `'extension'`**
  Used in `PostgresPlanTargetDetails.objectType`. Should be renamed to `'dependency'` for consistency.
  **Resolved:** Renamed to `'dependency'`. Blast radius was zero — the `'extension'` variant was never used as a value anywhere.

### P3 — Nice-to-have

- [x] **8. `DependencyIR` defined after `SqlSchemaIR` that references it**
  Move `DependencyIR` above `SqlSchemaIR` for readability.
  **Resolved:** Moved `DependencyIR` above `SqlSchemaIR` in `types.ts`.

- [x] **9. `sortDependencies` unnecessary early-return**
  `if (dependencies.length <= 1) return dependencies` — `Array.sort` already handles this.
  **Already absent** in current code — jkomyno's comment was based on an earlier revision.

- [x] **10. `contractToSchema` type cast in postgres target descriptor**
  `contract as SqlContract<SqlStorage> | null` cast is safe but not statically enforced.
  **Analysis:** The cast is correct by design. The adapter is the boundary where framework-level `ContractIR` meets family-level `SqlContract`. Making this statically enforced would require making `TargetMigrationsCapability` generic over the contract type, which cascades into many interfaces. Not worth the complexity.

- [x] **11. `SchemaNodeKind` still uses `'extension'` instead of `'dependency'`**
  **Resolved:** Renamed schema-view node kind from `'extension'` to `'dependency'` in shared/core schema-view types, SQL family `toSchemaView` dependency nodes, and CLI schema-tree rendering.

- [ ] **12. No runtime validation of dependency ID format**
  `DependencyIR = { readonly id: string }` has no validation that IDs follow the `target.type.name` convention. A structural validator could prevent subtle bugs (e.g., ID typo causing the planner to always re-emit an install op).
  **Deferred:** Non-blocking for this PR; out of scope for now.

### Squash recommendation

jkomyno suggests squashing 6 commits into 3 for cleaner history:
- Keep commit 1 (preparatory fix)
- Squash commits 2 + 5 + 6 (refactor + regression fixes)
- Squash commits 3 + 4 (docs + spec status update)

---

## wmadden latest review follow-ups (resolved)

Latest wmadden review context:
- Review comment: [pullrequestreview-3923363607](https://github.com/prisma/prisma-next/pull/231#pullrequestreview-3923363607)
- Latest note (approved) says only two blockers remained; those blockers were ADR wording + `SchemaIssue.table` and are now addressed.

Remaining non-blocking items from that same long review are now resolved:

- [x] **NB-F01: `SqlPlannerConflictLocation.extension` field is stale**
  - Location: `packages/2-sql/3-tooling/family/src/core/migrations/types.ts`
  - **Resolved:** Removed `extension?: string` from `SqlPlannerConflictLocation`.
  - Validation: ran `pnpm --filter @prisma-next/family-sql typecheck`.
  - Commit: `92d589d94`.

- [x] **NB-F03: `deduplicateDependencyIRs` skips empty IDs silently**
  - Location: `packages/2-sql/3-tooling/family/src/core/migrations/contract-to-schema-ir.ts`
  - **Resolved:** Replaced silent skip with fail-fast validation: empty/whitespace IDs now throw `Dependency id must be a non-empty string`; dedup for valid IDs remains unchanged.
  - Tests added:
    - `deduplicates dependency IDs from framework components`
    - `throws for empty dependency IDs from framework components`
    - (both in `packages/2-sql/3-tooling/family/test/contract-to-schema-ir.test.ts`)
  - Validation: ran `pnpm --filter @prisma-next/family-sql test -- test/contract-to-schema-ir.test.ts test/schema-view.test.ts`.
  - Commit: `92d589d94`.

- [x] **NB-F04: planner test helper duplicates enum planning logic**
  - Location: `packages/3-targets/3-targets/postgres/test/migrations/planner.contract-to-schema-ir.test.ts`
  - **Resolved:** Kept the test-double approach intentionally and documented it in-place with a clarifying comment:
    - the helper is a minimal double for planner/`contractToSchemaIR` wiring,
    - concrete enum hook semantics are covered in adapter enum hook tests.
  - Commit: `98ac30e50`.

- [x] **NIT-F01: dependency schema-tree label still says "extension"**
  - Location: `packages/2-sql/3-tooling/family/src/core/control-instance.ts`
  - **Resolved:** Updated dependency node label from `${shortName} extension is enabled` to `${shortName} dependency is installed`.
  - Test added: `renders dependency nodes with dependency-oriented wording` in `packages/2-sql/3-tooling/family/test/schema-view.test.ts`.
  - Validation: covered by `pnpm --filter @prisma-next/family-sql test -- test/contract-to-schema-ir.test.ts test/schema-view.test.ts`.
  - Commit: `92d589d94`.
