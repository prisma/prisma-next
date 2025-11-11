## Slice 19 — Decouple SQL Operations From Assembly (Domain: SQL family, Layer: tooling + core, Planes: migration + shared)

### Context
- `@prisma-next/sql-operations` currently mixes two concerns:
  1) The SQL operations model (LoweringSpec + SQL OperationSignature + registry primitives)
  2) Assembly from ExtensionPack manifests (pack IO/iteration and mapping to signatures)
- Runtime (lanes/sql-runtime) imports operation shapes. When `sql-operations` is marked migration, those imports violate plane rules; when marked shared, its pack/assembly dependencies become inappropriate.
- The emitter should compile Contract IR to artifacts. Pack discovery/loading/manifest mapping are separate tooling responsibilities and should not live in the shared model or in the emitter core.

### Problem
- Mixed responsibilities force either: (a) runtime → migration imports, or (b) a shared package that still depends on tooling/pack types. Both are undesirable.

### Decision
- Split concerns:
  - Keep `@prisma-next/sql-operations` as the pure SQL operations model and registry primitives (shared, side‑effect free).
  - Move assembly (pack/manifest reading and mapping to signatures) into a small tooling module under Framework tooling (emitter/CLI).

### Goals
1. sql-operations exports only pure model + registry helpers (no pack/manifests/IO).
2. A new tooling unit assembles registries from extension packs (pack IO + mapping functions).
3. Emitter core consumes a prebuilt registry; it does not know how to read/resolve packs.
4. Unblock reclassification/move of `sql-operations` to the shared plane.

### Non‑Goals
- Redesign operation manifests or extension pack format.
- Change the framework target‑agnostic operations model (`@prisma-next/operations`).
- Implement a migrations engine.

### Deliverables
- `@prisma-next/sql-operations` (pure model)
  - Location: `packages/sql/operations` (eventual plane: shared)
  - Exports:
    - `SqlLoweringSpec` — `{ targetFamily: 'sql'; strategy: 'infix' | 'function'; template: string }`
    - `SqlOperationSignature` — `CoreOperationSignature & { lowering: SqlLoweringSpec }`
    - `SqlOperationRegistry` — `OperationRegistry<SqlOperationSignature>`
    - `createSqlOperationRegistry()`, `register(reg, sig)`
  - Removes: `assembleOperationRegistry` that accepts packs/manifests.

- Tooling (new module under Framework tooling)
  - Location: `packages/framework/tooling/packs/src/sql-ops.ts` (or `emitter/src/ops/sql-ops.ts`)
  - Exports:
    - `toSqlOperationSignature(m: OperationManifestLike): SqlOperationSignature`
    - `assembleSqlOperationRegistryFromPacks(packs: ExtensionPack[]): SqlOperationRegistry` (reads `pack.manifest.operations`, validates, maps to signatures, registers into a new registry)
  - Optional: validators for manifests (Arktype) co‑located here, or keep them near mapping.

- Tests
  - sql-operations: registry + types only (no pack references)
  - tooling/packs: pack→manifest→signature mapping + assembly
  - emitter: tests consume a prebuilt registry (assembled in test or via helper), not packs directly

### Interfaces (authoritative)
- In `@prisma-next/sql-operations`:
  ```ts
  // types
  export interface SqlLoweringSpec { readonly targetFamily: 'sql'; readonly strategy: 'infix' | 'function'; readonly template: string }
  export interface SqlOperationSignature extends CoreOperationSignature { readonly lowering: SqlLoweringSpec }
  export type SqlOperationRegistry = OperationRegistry<SqlOperationSignature>;

  // helpers
  export function createSqlOperationRegistry(): SqlOperationRegistry;
  export function register(reg: SqlOperationRegistry, sig: SqlOperationSignature): void;
  ```

- In tooling (packs):
  ```ts
  export type OperationManifestLike = {
    readonly for: string;
    readonly method: string;
    readonly args: readonly Array<{ kind: 'typeId' | 'param' | 'literal'; type?: string }>;
    readonly returns: { kind: 'typeId'; type: string } | { kind: 'builtin'; type: 'number'|'boolean'|'string' };
    readonly lowering: { strategy: 'infix'|'function'; template: string };
    readonly capabilities?: readonly string[];
  };

  export function toSqlOperationSignature(m: OperationManifestLike): SqlOperationSignature;

  export function assembleSqlOperationRegistryFromPacks(packs: ExtensionPack[]): SqlOperationRegistry;
  // Implementation: createSqlOperationRegistry(); for each pack.manifest.operations → toSqlOperationSignature → register(reg, sig)
  ```

### Affected Files (initial extraction)
- Move/remove assembly from: `packages/sql/operations/src/index.ts`
  - Remove direct imports of `ExtensionPack` and pack types from this package.
  - Keep only `SqlLoweringSpec`, `SqlOperationSignature`, registry helpers.
- Add mapping/assembly in tooling: `packages/framework/tooling/packs/src/sql-ops.ts`
  - Reuse helpers from `@prisma-next/sql-operations` and `@prisma-next/operations`.
- Update imports in emitter (if any) to consume the new helper instead of sql-operations assembly.

### Architecture & Dep‑Cruiser Changes
- Short term (during extraction): sql-operations may remain where it is; ensure no tooling imports remain in it.
- Long term (per Slice 18): map `packages/sql/operations/**` to domain sql, layer core, plane shared in `architecture.config.json`.
- After runtime imports point only to shared sql-operations (types/registry), remove runtime→migration exceptions.

### Migration Plan (staged)
1. Create tooling module `framework/tooling/packs/src/sql-ops.ts` with mapping + assembly helpers; add unit tests.
2. Remove `assembleOperationRegistry` from `sql-operations`; export registry helpers only; fix its tests accordingly.
3. Update emitter to call `assembleSqlOperationRegistryFromPacks` (or accept a prebuilt registry) and stop importing assembly from `sql-operations`.
4. Verify runtime/lanes import only `SqlLoweringSpec`/`SqlOperationSignature` from `sql-operations`.
5. Run `pnpm lint:deps`; if green, proceed to Slice 18 to move/reclassify `sql-operations` to shared plane and drop runtime→migration exceptions.

### Acceptance Criteria
- `@prisma-next/sql-operations` has no references to `ExtensionPack` or pack/manifests.
- A tooling helper assembles the SQL operation registry from packs.
- Emitter consumes a prebuilt registry; it does not perform pack IO or mapping internally.
- `pnpm lint:deps` passes post‑extraction (before/after reclassification), with runtime importing only shared surfaces.

### Risks & Mitigations
- Hidden coupling in tests to old assembly: migrate tests gradually; provide shared fixtures for manifests and a helper that builds a registry via tooling.
- Naming churn: keep `@prisma-next/sql-operations` name stable; only move responsibilities.
- Docs drift: update Architecture Overview and AGENT_ONBOARDING to reflect the Pack Manager/tooling role vs shared sql-operations model.
