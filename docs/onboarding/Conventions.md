# Conventions

- Tools: pnpm, Turbo, local scripts — `.cursor/rules/use-correct-tools.mdc`.
- TypeScript patterns — `.cursor/rules/typescript-patterns.mdc`.
- No target‑specific branching — `.cursor/rules/no-target-branches.mdc`.
- No barrels — `.cursor/rules/no-barrel-files.mdc`.
- Arktype over Zod — `.cursor/rules/arktype-usage.mdc`.

## Planes & Families

- Distinguish **control plane** vs **execution plane**:
  - Control plane: config loading, contract emission, schema verification, database marker reading. Implemented in `@prisma-next/core-control-plane`, framework CLI, and control‑plane family/adapter/extension entrypoints (e.g., `@prisma-next/family-sql/control`).
  - Execution plane: query lowering, codecs, and runtime execution. Implemented in runtime entrypoints (e.g., `@prisma-next/sql-runtime`, `./runtime` exports on adapters/extensions/families).
- Family descriptors are plane‑specific:
  - Control‑plane families expose hooks like `prepareControlContext`, `introspectSchema`, `verifySchema`, `readMarker` and use a `TargetFamilyContext` subtype (e.g., `SqlFamilyContext`).
  - Runtime families focus on lowering and runtime semantics.
- Control‑plane code must not depend on runtime types (e.g., codec registries); instead, it uses family‑provided metadata abstractions (e.g., SQL type metadata registries).
