# Issue Triage

Issues discovered during project work, captured for later investigation and potential Linear ticket creation.

---

## Migration types are manually duplicated alongside arktype schemas

**Discovered:** 2026-03-12 | **Severity:** medium

**Observed:** The migration-tools package defines arktype schemas for runtime validation (`MigrationManifestSchema`, `MigrationOpSchema`, `MigrationHintsSchema`) in `io.ts`, but the corresponding TypeScript interfaces (`MigrationManifest`, `MigrationOps`, `MigrationHints`) are manually written in `types.ts`. The two definitions must be kept in sync by hand. The same pattern exists for smaller types like `StatusRef` and `StatusDiagnostic` in the CLI package, where identical interfaces were defined in multiple files.

**Location:**
- `packages/1-framework/3-tooling/migration/src/io.ts` (arktype schemas: `MigrationManifestSchema`, `MigrationOpSchema`, `MigrationHintsSchema`)
- `packages/1-framework/3-tooling/migration/src/types.ts` (manually written interfaces: `MigrationManifest`, `MigrationOps`, `MigrationHints`)
- `packages/1-framework/3-tooling/cli/src/utils/migration-types.ts` (shared `StatusRef`, `StatusDiagnostic`)

**Impact:** Any schema change requires updating two files. If they drift apart, runtime validation accepts a shape that doesn't match the TypeScript type (or vice versa), leading to silent type unsafety. As the number of validated shapes grows (refs, diagnostics, config), the maintenance burden and drift risk increase.

**Suggested fix:** Use `typeof Schema.infer` to derive TypeScript types directly from the arktype schemas, making the schema the single source of truth. For example:
```typescript
const MigrationManifestSchema = type({ ... });
export type MigrationManifest = typeof MigrationManifestSchema.infer;
```
This eliminates the manually-written interfaces in `types.ts` and guarantees the types always match the validation logic. Audit `arktype` usage across the repo — the CLI package lists it as a dependency but never imports it.

**Context:** Discovered while refactoring `StatusRef` / `StatusDiagnostic` out of `migration-status.ts` into a shared `migration-types.ts`. The CLI package has `arktype` in `package.json` but zero imports — it may be a dead dependency or an indicator that this consolidation was intended but never completed.

---
