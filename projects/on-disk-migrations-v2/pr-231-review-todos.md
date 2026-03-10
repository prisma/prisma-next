# PR #231 Review TODOs

Review comments from **wmadden** and **jkomyno** on `refactor/declarative-dependency-ir`.

## wmadden (Changes Requested)

### Architectural concern: composability of dependency detection

**Status:** Open — needs discussion/decision

wmadden argues the PR shifts dependency detection from component-owned to adapter-owned, violating composability:

- The adapter introspects `pg_extension` and produces `DependencyIR` IDs it knows about
- Third-party extensions cannot introduce new dependency shapes unless the adapter is updated
- `DependencyIR` becomes "things the adapter knows how to introspect", not "things components declare"
- Wants component-owned detection (or a detector registry) so dependency presence is composable with extension packs

> "If we want to keep `DependencyIR` as structural IDs, we still need component-owned detection (or at least a component-contributed detector registry) so that dependency installation/presence is composable with extension packs, not gated on adapter feature work."

### Inline comments

- [ ] **ADR 154 — verify method question** (`docs/architecture docs/adrs/ADR 154 - Component-owned database dependencies.md:41`)
  Asks: "Isn't the verify method needed to detect whether the dependency is installed in the database schema?"
  saevarb replied explaining the new model handles this via ID presence checks. May need further ADR clarification.

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

- [ ] **3. `extension_missing` issue kind not renamed to `dependency_missing`**
  `verify-helpers.ts:489` still emits `kind: 'extension_missing'`. Referenced in 15+ locations. Recommendation: follow-up ticket (large blast radius).

- [x] **4. Weak typing of `frameworkComponents` in `ContractToSchemaIROptions`**
  Was `readonly unknown[]`, should be properly typed.
  **Resolved:** Changed to `ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>` (commit `110ced4ce`).

- [x] **5. Three near-duplicate dependency collection functions**
  `collectDependenciesFromComponents()` (schema IR), `collectDependencies()` (planner), `collectDependenciesFromFrameworkComponents()` (verifier) all do the same core algorithm with different type guards, dedup, and return types.
  **Resolved:** Extracted `collectInitDependencies()` into `types.ts` (next to `isDatabaseDependencyProvider`), exported from `@prisma-next/family-sql/control`. All three consumers now use it. Schema-IR adds dedup on top; planner adds sort + cast; verifier casts to typed deps.

- [ ] **6. Dead `SqlPlannerConflictKind` variants**
  `'extensionMissing'` and `'unsupportedExtension'` in the union are never emitted. Clean up alongside `extension_missing` rename.

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

- [ ] **11. `SchemaNodeKind` still uses `'extension'` instead of `'dependency'`**
  Could be renamed together with `extension_missing` in a follow-up.

- [ ] **12. No runtime validation of dependency ID format**
  `DependencyIR = { readonly id: string }` has no validation that IDs follow the `target.type.name` convention. A structural validator could prevent subtle bugs (e.g., ID typo causing the planner to always re-emit an install op).

### Squash recommendation

jkomyno suggests squashing 6 commits into 3 for cleaner history:
- Keep commit 1 (preparatory fix)
- Squash commits 2 + 5 + 6 (refactor + regression fixes)
- Squash commits 3 + 4 (docs + spec status update)
