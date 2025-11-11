## Slice 15 — CLI Pluginization for Target Families (Domain: Tooling, Layer: tooling, Plane: migration)

### Context
The CLI has exceptions that import SQL authoring/targets directly. We need a plugin boundary so the CLI is target‑agnostic.

### Goals
1. Define a plugin API in framework tooling for target families.
2. Implement SQL plugin(s) outside the CLI that the CLI loads by capability/manifest.
3. Remove CLI → SQL authoring/targets imports.

### Deliverables
- Plugin API in `packages/framework/tooling` (type‑only dependency on shared plane).
- SQL plugin package implementing the API (in SQL family or Extensions as appropriate).
- CLI loads plugins via configuration/capabilities.

### Steps
1. Define plugin interfaces and discovery (static import map or manifest).
2. Extract SQL‑specific code from CLI into a plugin package.
3. Wire CLI to resolve plugins from config/capabilities.
4. Remove direct imports from CLI to SQL authoring/targets.
5. Dep‑cruise: delete CLI exceptions; `pnpm lint:deps` green.

### Acceptance
- CLI contains zero direct SQL family imports beyond the plugin API types.
- Plugin(s) tested end‑to‑end via example/demo.
