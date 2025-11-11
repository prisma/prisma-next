## Slice 13 — Split SQL Family vs Extensions (Domain: Architecture, Layer: docs, Plane: migration)

### Context
The SQL domain mixes target‑family (dialect‑agnostic) code with concrete targets (e.g., Postgres). This blurs boundaries and complicates dependency rules.

### Goals
1. Keep SQL family code (contract types, operations specs, emitter hook, lanes) in the SQL domain.
2. Move concrete targets (Postgres adapter/driver and packs) to the Extensions domain.
3. Ensure runtime loads extensions via SPI/capabilities rather than direct imports.

### Non‑Goals
- Changing adapter SPIs or manifest formats (beyond what is needed to relocate packages).
- Moving contract generation out of the app pipeline (remains in CLI/CI).

### Deliverables
- Extensions packages for concrete targets (Postgres) under `packages/extensions/**`.
- Updated docs: Architecture Overview, Agent Onboarding.
- Dep‑cruise config updated to reflect new locations and deny cross‑domain imports where applicable.

### Steps
1. Define/confirm runtime adapter SPI in `framework/runtime-core` is the only dependency for runtime consumers.
2. Relocate:
   - `packages/sql/runtime/adapters/postgres/**` → `packages/extensions/adapter-postgres/**`
   - `packages/sql/runtime/drivers/postgres/**` → `packages/extensions/driver-postgres/**`
   - `packages/sql/postgres/**` → `packages/extensions/adapter-postgres/**` (merge if duplicative)
3. Update package names, imports, and workspace entries.
4. Update dep‑cruise mappings and rerun `pnpm lint:deps`.
5. Update docs and examples to reference extensions path.

### Acceptance
- No concrete dialect code remains in the SQL domain.
- Runtime relies on SPIs and loads extensions dynamically.
- `pnpm lint:deps` passes with new structure.

