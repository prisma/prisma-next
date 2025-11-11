# Recommendations

## Observations
- `src/schema.ts` still imports `RuntimeContext` from `@prisma-next/sql-runtime` (see the TODO at the top), so relational-core depends on the runtime ring and cannot be consumed by other lanes without pulling in runtime-heavy dependencies.
- The operations attachment logic lives inside `operations-registry.ts`, re-implementing capability gating and column wiring instead of exposing a shared helper that other lanes could reuse alongside `@prisma-next/operations`.
- The README stays high-level and lacks a concrete example showing how to call `schema(context)` and drill into tables/columns, which makes it harder for new consumers to plug the package into their lane.

## Suggested Actions
- Introduce a lean schema context interface that contains just the operations registry, adapter, and capabilities; keep it in this package so the runtime dependency can be swapped out once Slice 6 exposes the lightweight contract.
- Lift the column-attachment logic into a reusable helper (or re-export it) so other lanes and runtimes can attach operations without duplicating the `hasAllCapabilities` plumbing.
- Expand the README with a quick-start snippet that wires `createTestContext`/`schema(context)` and documents how to reach `tables.<name>.columns.<name>` while respecting capability gating.
