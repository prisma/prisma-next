# Relocate `mongo-target-descriptor.ts` into `target-mongo`

## Summary

Move `packages/2-mongo-family/9-family/src/core/mongo-target-descriptor.ts` into the `target-mongo` package at `packages/3-mongo-target/1-mongo-target/src/core/control-target.ts`, mirroring SQLite's filename and directory layout. Flip the import direction so the descriptor's home in the target package imports `MongoControlFamilyInstance` and the multi-space types from `@prisma-next/family-mongo/control` — instead of the family package importing target/adapter/driver internals. This resolves a long-standing layering asymmetry between the Mongo family and the SQL family (Postgres descriptor lives at `packages/3-targets/3-targets/postgres/src/exports/control.ts`; SQLite lives at `packages/3-targets/3-targets/sqlite/src/core/control-target.ts`; Mongo's lived in the family package and reached down into target+adapter+driver).

## Context

- `packages/2-mongo-family/9-family/src/core/mongo-target-descriptor.ts` currently imports from `@prisma-next/adapter-mongo/control`, `@prisma-next/driver-mongo`, `@prisma-next/target-mongo/control`, and `@prisma-next/target-mongo/pack` — the family layer reaching downward into target / adapter / driver internals.
- The same SPI/descriptor surface in SQL lives at the target layer: `packages/3-targets/3-targets/postgres/src/exports/control.ts` and `packages/3-targets/3-targets/sqlite/src/core/control-target.ts`. Each target's `control-target.ts` imports the family's abstract surface (e.g. `SqlControlFamilyInstance`, `SqlControlTargetDescriptor` from `@prisma-next/family-sql/control`) and constructs the target-specific descriptor — the natural direction (target depends on family, never the reverse).
- The Mongo asymmetry is a historical artefact of Mongo currently having a single target. It surfaced concretely as an M1 placement defect for the new SPI bases (`MongoContractSerializerBase` etc.) during the `target-extensible-ir` project's M2 R1 reconnaissance: the Mongo family bases had been placed in `family-mongo`, but `family-mongo` already depends on `target-mongo`, so target classes could not extend the family bases without a circular workspace dependency. The bases were moved to `mongo-contract` (foundation) as the smallest mechanical fix; the deeper descriptor-seam asymmetry was recorded as a follow-up.
- PR 494 (TML-2408 contract-spaces-mongo-port) deepened the descriptor surface in `mongo-target-descriptor.ts` with multi-space runner wiring (`executeAcrossSpaces`, per-space verify projection, `MultiSpaceCapableRunner` implementation). That increased the cost of doing this relocation later — every consumer of the family-resident descriptor now sees more surface — and surfaced the asymmetry into project-relevant concerns (it's another consumer entrenched on the wrong-direction seam). PR 494 is the trigger for filing this work as a discrete follow-up.
- The Mongo file already has the right type (`MigratableTargetDescriptor<'mongo', 'mongo', MongoControlFamilyInstance>`) — there is nothing to redesign. This is a relocation, not a refactor.

## Changes

1. **Move the file**

   - `packages/2-mongo-family/9-family/src/core/mongo-target-descriptor.ts` → `packages/3-mongo-target/1-mongo-target/src/core/control-target.ts`.
   - The new home imports `MongoControlFamilyInstance` (currently a relative `from './control-instance'` import) from the family's public control export instead — `from '@prisma-next/family-mongo/control'`.
   - The currently-downward imports (`@prisma-next/adapter-mongo/control`, `@prisma-next/driver-mongo`, `@prisma-next/target-mongo/control`, `@prisma-next/target-mongo/pack`) become same-package or upward imports relative to the new home and shorten correspondingly (`@prisma-next/target-mongo/control` becomes a relative import; `@prisma-next/target-mongo/pack` becomes a relative import to the pack module; adapter and driver imports are unchanged in shape but are now downward-from-target — the natural direction).

2. **Update consumers**

   The file is consumed in two ways today:
   - As a value (`mongoTargetDescriptor` factory or singleton) — used by example apps, integration test fixtures, CLI fixtures.
   - As a re-export from `packages/2-mongo-family/9-family/src/exports/control.ts` and from `packages/3-mongo-target/1-mongo-target/src/exports/runtime.ts`.

   For each consumer:
   - If the consumer imports the descriptor from `@prisma-next/family-mongo/control`, leave the family's re-export pointing at the new target-resident location (so the family's public API does not change).
   - If the consumer imports the descriptor type (`MongoControlTargetDescriptor`) from `@prisma-next/family-mongo/control`, leave the family's re-export of the type in place (same reasoning).
   - If a test or fixture imports the descriptor *file* directly via a deep relative path (e.g. `../../packages/2-mongo-family/9-family/src/core/mongo-target-descriptor`), update the path to point at the new home (or — preferred — switch the import to the package's public export).

   Concrete consumer files identified during scoping (verify against HEAD before editing):
   - `packages/2-mongo-family/9-family/src/exports/control.ts` — re-export source path updates.
   - `packages/2-mongo-family/9-family/src/core/control-instance.ts` — if it imports the descriptor type/value directly, update; if the dependency was the other direction (descriptor importing the instance), the relocation flips it cleanly.
   - `packages/3-mongo-target/1-mongo-target/src/exports/runtime.ts` — already in the target package; the import becomes a relative import to the new sibling.
   - `packages/3-mongo-target/1-mongo-target/src/exports/pack.ts` — likewise.
   - `packages/3-mongo-target/1-mongo-target/src/core/descriptor-meta.ts` — likewise.
   - Test files in `packages/2-mongo-family/9-family/test/` (`control.test.ts`, `operation-preview.test.ts`) — the family-package tests' direct imports.
   - Test files in `packages/3-mongo-target/1-mongo-target/test/` (`migration-e2e.test.ts`, `descriptor-meta.test.ts`) — already in the target package; the import shortens.
   - Integration-test fixtures (`test/integration/test/mongo/...`, `test/integration/test/fixtures/cli/...`) and example apps (`examples/mongo-demo/...`, `examples/retail-store/...`) — typically import via the public package surface; verify whether any reach into the family-resident location directly.

3. **Update `family-mongo`'s public re-exports if needed**

   `packages/2-mongo-family/9-family/src/exports/control.ts` currently re-exports `mongoTargetDescriptor` and `MongoControlTargetDescriptor` from the family-resident module. After the move, the re-export points at `@prisma-next/target-mongo/control` (the target package's public export). The family's public API does not change — consumers that import via `@prisma-next/family-mongo/control` keep working.

4. **Verify `pnpm lint:deps` is clean**

   This relocation is expected to remove a latent layering concern (family→target+adapter+driver imports) without introducing a new violation. If `pnpm lint:deps` reports a new violation post-move, that's a finding for this PR, not a separate concern.

5. **Update subsystem 10 doc if it names the file**

   `docs/architecture docs/subsystems/10. MongoDB Family.md` — if the doc names `mongo-target-descriptor.ts` (e.g. in a "where things live" reference table), update the path. PR 494 added the `## Contract spaces` section to this doc and may have introduced such a reference; verify.

## Acceptance criteria

- `mongo-target-descriptor.ts` no longer exists at `packages/2-mongo-family/9-family/src/core/`; the descriptor lives at `packages/3-mongo-target/1-mongo-target/src/core/control-target.ts`.
- No file references `../core/mongo-target-descriptor` or `./mongo-target-descriptor` outside the new location.
- `pnpm lint:deps` reports zero layering violations involving `mongo-target-descriptor` / `control-target` (and zero new violations elsewhere as a consequence).
- `pnpm -F @prisma-next/family-mongo build` and `pnpm -F @prisma-next/target-mongo build` pass.
- `pnpm -F @prisma-next/family-mongo typecheck` and `pnpm -F @prisma-next/target-mongo typecheck` pass.
- `pnpm test:packages`, `pnpm test:integration`, and `pnpm test:e2e` are green (in particular: integration tests for multi-space runner, e2e for `db-sign` / `db-verify` / `db-update`, and the new contract-spaces-mongo-port surface from PR 494).
- The family's public API (`@prisma-next/family-mongo/control`) still exposes `mongoTargetDescriptor` and `MongoControlTargetDescriptor` — no public-API change.

## Out of scope

- Any change to the `MongoControlTargetDescriptor` type itself (the descriptor's *shape* is unchanged; this is a *placement* change).
- Any change to the multi-space runner mechanism (PR 494's contribution); this relocation moves that code but preserves its semantics.
- Renaming `mongoTargetDescriptor` or any of its constituent types.
- Reshaping the SPI implementer surface (`MongoTargetContractSerializer`, `MongoTargetSchemaVerifier`) — those already live in the target package; they're consumed by the descriptor regardless of where the descriptor lives.
- Changes to SQL family / target descriptors. SQL is already in the right shape.

## Open questions

1. **Does the descriptor need a factory function or is the singleton form sufficient?** SQLite uses a `const sqliteControlTargetDescriptor` singleton; Mongo uses (or used to use) a factory pattern. If the relocation can simplify Mongo to the singleton form without affecting consumers, prefer the singleton. If consumers depend on the factory shape (e.g. for per-test descriptor variation), keep the factory.
2. **Does `family-mongo` need to retain the descriptor type re-export indefinitely?** Strictly, callers could import the type from `@prisma-next/target-mongo/control` directly. The family's re-export is a backwards-compat shim. Per the repo's no-backwards-compat rule (`.cursor/rules/no-backward-compatibility.md`), the re-export should be removed and call sites updated to import from the target package directly. Confirm in scope of this PR or split into a follow-up at scoping time.
