## Slice 16 — Remove Dependency Cruiser Exceptions (Domain: Tooling, Layer: tooling, Plane: migration)

### Context
With the SQL family/Extensions split, common contract types surface, and CLI pluginization in place, the remaining dep‑cruise exceptions can be removed.

### Goals
1. Delete all exception predicates from `dependency-cruiser.config.mjs`.
2. Keep rules strict: no runtime→migration imports; no upward imports within a domain; cross‑domain imports denied except Framework.

### Steps
1. Verify no imports remain that rely on:
   - Authoring → Targets (SQL) upward edge
   - Lanes (runtime) → Runtime (SQL) upward edge
   - CLI → SQL targets/authoring
   - Runtime/lanes/adapters/extensions → SQL targets (runtime→migration)
2. Remove exception helpers and rerun `pnpm lint:deps`.
3. Fix any remaining violations or re‑scope packages.

### Acceptance
- `dependency-cruiser.config.mjs` has no exceptions.
- `pnpm lint:deps` passes repo‑wide.

