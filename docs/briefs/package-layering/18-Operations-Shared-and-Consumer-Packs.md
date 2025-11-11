## Slice 18 — Operations To Shared, Consumer-Provided Packs, Emitter Takes Pre-Assembled Registries

Domain: SQL family + Framework
Layers: shared (family model, no IO) + tooling (CLI), emitter (tooling, no IO)
Planes: shared + migration

### Executive Summary
- Move SQL operations to a pure shared surface (types + typed registry helpers). No manifests, no pack IO.
- Consumers (runtime wiring, CLI config) import/instantiate extension packs and pass them in. Framework never “discovers” packs.
- Tooling/CLI assembles registries (and any other context) from packs, then calls the emitter.
- Emitter accepts a pre-assembled context (TargetFamilyHook, OperationRegistry, type imports, etc.) and compiles IR → artifacts. It remains family-agnostic and IO-free.
- This resolves the runtime→migration exception for operations in Dependency Cruiser.

### Why (Context & Problems)
- sql/operations currently mixes model with assembly from manifests, creating plane violations and tool coupling.
- Emitter includes pack loading helpers which entangle it with package management.
- Runtime and CLI already know their packs. Passing them in is cleaner and more composable.

### Design (What “done” looks like)
1) @prisma-next/sql-operations (shared)
   - Exports only:
     - `SqlLoweringSpec` (sql)
     - `SqlOperationSignature` extends core `OperationSignature`
     - `SqlOperationRegistry = OperationRegistry<SqlOperationSignature>` (typed)
     - `createSqlOperationRegistry()`, `register(reg, sig)`
   - Never references `ExtensionPack` or manifests.

2) Consumer-provided packs
   - Runtime (no-emit):
     ```ts
     import pgVectorExt from '@prisma-next/ext-pgvector';
     const runtime = new RuntimeExecutor({ extensions: [pgVectorExt()] });
     ```
   - CLI (emit):
     ```ts
     // prisma-next.config.ts
     import pgVectorExt from '@prisma-next/ext-pgvector';
     export default defineConfig({ extensions: [pgVectorExt()] });
     ```

3) Tooling/CLI assembles registries
   - CLI turns packs → OperationRegistry and type-import lists (and any other registries) before calling emitter.
   - Manifests are a serialization of the operation definition; they are parsed/normalized in tooling, not in shared/emitter.

4) Emitter input contract
   - Emitter does NOT receive packs.
   - Emitter receives: `{ hook: TargetFamilyHook, opRegistry: OperationRegistry<FamilySig>, typeImports, ... }` and IR.
   - TargetFamilyHook may expose a method to serialize operations to IR if base core op definition is insufficient for emission.

### Out of Scope
- Changing core operation model or pack/manifests schema.
- Implementing migrations runner.
- Changing runtime lanes beyond import path fixes.

### Milestones (TDD, review gates, coverage)
M1 — Shared operations model only (unit)
- Tests (sql/operations):
  - `createSqlOperationRegistry` returns typed registry; `register` stores `SqlOperationSignature` only.
  - No references to `ExtensionPack`/manifests (grep guard).
- Coverage: ≥ 95% lines/branches in `packages/sql/operations`.
- Review gate: shared-only, compiles when imported by runtime/lanes.

M2 — CLI: assemble registries from packs (unit/integration)
- Implement CLI helper(s) to:
  - Parse/normalize manifests to operation definitions.
  - Build `OperationRegistry<SqlOperationSignature>`.
  - Prepare type-import lists needed for `contract.d.ts`.
- Tests:
  - Unit: manifest → op definition mapping; invalid manifest rejections.
  - Integration: given mock `ExtensionPack[]`, produced registry contains all ops; types imports extracted.
- Coverage: ≥ 90% for new CLI pack helpers.
- Review gate: emitter not used; packs flow → registry is deterministic.

M3 — Emitter takes pre-assembled context (integration)
- Change emitter signature to accept `{ hook, opRegistry, typeImports, ... }` (no packs argument).
- Tests:
  - Integration: given IR + prebuilt `opRegistry` + `hook`, emitter produces contract.json & contract.d.ts with expected ops/types.
- Coverage: maintain existing thresholds (≥ 90%) for emitter package.
- Review gate: zero SQL imports in emitter; zero pack IO in emitter.

M4 — End-to-end (E2E) scenario
- Compose: app config → packs (consumer) → CLI builds registry → emitter emits.
- Tests:
  - E2E: uses a sample extension pack fixture to generate artifacts.
  - Assert `contract.json` contains serialized operations; `contract.d.ts` imports match.
- Coverage: repo E2E ensures all new paths exercised.
- Review gate: readme examples match reality; smoke run via `pnpm test:integration` passes.

M5 — Architecture & Dependency Cruiser
- architecture.config.json: set `packages/sql/operations/**` to plane `shared`.
- Dependency Cruiser: remove runtime→migration exception for operations; run `pnpm lint:deps`.
- Review gate: graph is green; no packs/manifests in shared/emitter.

### Acceptance Criteria
- sql/operations is shared, pure (types + typed registry helpers only).
- Emitter accepts a pre-assembled context; has zero SQL imports and no pack IO.
- Tooling/CLI assembles registries & type imports from consumer-provided packs; manifests deserialization happens here.
- E2E test demonstrates consumer-provided packs → CLI registry → emitter artifacts.
- Dependency Cruiser passes with the operations exception removed.

### Risks & Mitigations
- Type drift between manifest schema and op model: add Arktype validators in CLI mapping; cross-check against hook serialization to IR.
- Documentation drift: update AGENT_ONBOARDING and Architecture Overview examples to show consumer-provided packs; include migration notes.
- Hidden emitter reliance on packs: grep for `loadExtensionPacks` and remove from emitter public API.

### Verification Checklist (grep/scriptable)
- No `ExtensionPack` or `manifest` imports in `packages/sql/operations/src`.
- No `loadExtensionPacks` exposed in `packages/framework/tooling/emitter/src/exports/index.ts`.
- No imports from `packages/targets/sql/**` in runtime-plane code.
- `pnpm lint:deps` passes with runtime→migration operations exception removed.

