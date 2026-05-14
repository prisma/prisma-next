# Mirror SQL's adapter-SPI dispatch pattern in Mongo

> **Status (M2.5).** Originally filed as a standalone project at `projects/relocate-mongo-target-descriptor/spec.md` (TML-2505), framed as a flat file relocation of `mongo-target-descriptor.ts` from family-mongo into target-mongo. Promoted to in-scope for `target-extensible-ir` as M2.5 in `wip/unattended-decisions.md § 9`. Pre-M2.5-R1 reconnaissance (recorded in `§ 11`) surfaced that the descriptor relocation alone could not satisfy the original AC — `family-mongo`'s `control-instance.ts` carries seven additional runtime call sites that import target/adapter symbols, none of which are reachable by moving one file. The spec was rewritten around the correct architectural shape — **mirror SQL's adapter-SPI dispatch pattern**, with the descriptor relocation as one chapter in a larger reshape. See `wip/unattended-decisions.md § 11` for the user-validated reasoning trail and the SQL pattern verification.
>
> File renamed from `relocate-mongo-target-descriptor.spec.md` to reflect the corrected scope. The original framing is preserved in the decision log; cross-references in `plan.md § M2.5` and the unattended-decisions log are updated.
>
> **TML-2464 AC #7 absorbed (recorded in `wip/unattended-decisions.md § 12`).** TML-2464 (`tml-2464-strip-single-spacemulti-space-branching-once-every-target-is`) is paused on user instruction until `target-extensible-ir` lands. Its branch carries 6 commits, three of which deliver AC #7 — the cross-family rename `schemaVerifyAgainstSchema → verifySchema`, the compose `introspect + verifySchema` at call sites, and the removal of the async `schemaVerify` from `ControlFamilyInstance`. Cherry-pick probe of those three commits onto `target-extensible-ir` HEAD: `b4548c1b3` (rename) and `e6c9d1563` (compose) auto-merge cleanly; `d0712a45e` (async removal) conflicts in `family-mongo/control-instance.ts` with M2 R1's descriptor-dispatch helpers — exactly the file M2.5 rewrites. The conflict is mechanical and the rewrite is M2.5's job, so M2.5 absorbs all three deliveries inline (§ 0 below) rather than cherry-picking. Result: M2.5 lands the SPI dispatch using the new `verifySchema` naming and the async-removed family interface; TML-2464 resumes against a smaller scope (ACs #1-6 + #8 — multi-space stripping + `Aggregate` qualifier removal) when `target-extensible-ir` merges.

## Summary

`@prisma-next/family-mongo` currently depends on `@prisma-next/target-mongo`, `@prisma-next/adapter-mongo`, and `@prisma-next/driver-mongo` — an inverted dependency edge that has no equivalent in `@prisma-next/family-sql`. The inversion forces architectural workarounds (Mongo SPI bases live at the foundation layer rather than family layer; M2 R1 placement defect; tax on every future Mongo target).

This milestone severs the inversion by mirroring SQL's adapter-SPI dispatch pattern: define a `MongoControlAdapter` SPI interface at `family-mongo`; move wire-level operations (marker-collection ops, schema verification, operation formatting) into the adapter package where the connection vocabulary lives; refactor `family-mongo`'s `control-instance.ts` to dispatch via the SPI carried in the control stack rather than importing target/adapter symbols directly. Relocate the three Mongo SPI bases from foundation back to family layer (the M2 R1 workaround is no longer needed). Relocate `mongo-target-descriptor.ts` from family-mongo to target-mongo (mirrors SQLite's `control-target.ts` placement). Result: `family-mongo` carries zero target/adapter/driver dependencies — the same shape as `family-sql`.

## Context

### The SQL adapter-SPI pattern (reference)

- **`SqlControlAdapter` SPI interface** at `packages/2-sql/9-family/src/core/control-adapter.ts` declares the adapter shape that the family dispatches through. The SPI carries `readMarker`, `readAllMarkers`, `introspect`, `lower`, plus optional `normalizeDefault` / `normalizeNativeType` hooks. Family-shared `parseContractMarkerRow` lives at `family-sql/verify`; the family-shared verifier `verifySqlSchema` lives at `family-sql/schema-verify`.
- **Adapter implementations** at `packages/3-targets/6-adapters/{postgres,sqlite}/` implement the SPI. Adapter method bodies execute queries directly via `driver.query(...)` — the adapter is the natural home because it has both the connection (`driver`) and the dialect-specific query vocabulary. `PostgresControlAdapter.readMarker` does its own existence probe + row decode; `PostgresControlAdapter.introspect` does its own catalog queries.
- **`@prisma-next/family-sql/package.json`** declares zero `target-postgres / target-sqlite / adapter-postgres / adapter-sqlite / driver-postgres / driver-sqlite` runtime deps. (One stale `driver-postgres` dep is unrelated to the dispatch shape.) The family-instance (`packages/2-sql/9-family/src/core/control-instance.ts`) calls `getControlAdapter().readMarker(driver, APP_SPACE_ID)` — the adapter is supplied via the control stack at composition time.

### The Mongo deviation (current state)

- **No `MongoControlAdapter` SPI exists.** `family-mongo`'s `control-instance.ts` imports concrete symbols (`readMarker`, `updateMarker`, `initMarker`, `readAllMarkers`, `verifyMongoSchema`, `formatMongoOperations`, `MongoTargetContract`, `introspectSchema`) directly from `@prisma-next/target-mongo` and `@prisma-next/adapter-mongo`. There is no dispatch interface mediating the family↔adapter boundary.
- **`marker-ledger.ts` is misplaced.** Lives at `packages/3-mongo-target/1-mongo-target/src/core/marker-ledger.ts` (target package). The file's imports are: `ContractMarkerRecord` type from `@prisma-next/contract/types`, raw command classes from `@prisma-next/mongo-query-ast/execution`, arktype, and the MongoDB driver `Db / Document / UpdateFilter`. **Zero target-mongo-specific dependencies.** It's pure wire-level Mongo I/O — the architecturally correct home is the adapter package, mirroring `PostgresControlAdapter.readMarker`.
- **`introspectSchema`** is at `packages/3-mongo-target/2-mongo-adapter/src/core/introspect-schema.ts` (correct placement per the SQL pattern). The deviation is that `family-mongo` imports it via `@prisma-next/adapter-mongo/control` directly rather than dispatching through an SPI.
- **`verifyMongoSchema`** lives at `target-mongo/schema-verify`. SQL's equivalent (`verifySqlSchema`) is family-shared at `family-sql/schema-verify`. The Mongo placement is debatable on first principles (single-target collapse), but mirroring SQL puts the family-shared verifier shell at `family-mongo`. The per-element diff/canonicalize helpers (`contractToMongoSchemaIR`, `canonicalizeSchemasForVerification`, `diffMongoSchemas`) stay at the target — they're target-specific shape transformations, lifted to family layer in a future project per `plan.md § Open items`.
- **`formatMongoOperations`** lives at `target-mongo/control`. Used by family-instance's `toOperationPreview` method to format pending operations for human display. SQL doesn't have an equivalent at the same surface (SQL uses `LoweredStatement` from `sql-relational-core`). For Mongo, the formatter is wire-level (operates on the raw command shape), so it can sit on the `MongoControlAdapter` SPI alongside the marker ops.
- **`MongoTargetContract` type** is imported from `target-mongo/control` at the family. SQL family uses generic `Contract` from `@prisma-next/contract/types`. For the SPI shape, `MongoControlAdapter` becomes generic over the contract shape — the family-instance dispatches through the adapter and lets the adapter's contract-shape generic propagate.

### Why the original "relocation only" framing missed the scope

The original spec (filename: `relocate-mongo-target-descriptor.spec.md`) framed M2.5 as "a relocation, not a refactor" — move one file, update consumers, sever deps. Pre-M2.5-R1 reconnaissance found that the spec's AC — `family-mongo/package.json` carries zero `target-mongo / adapter-mongo / driver-mongo` deps — cannot be satisfied by the file move alone, because `control-instance.ts` and `exports/schema-verify.ts` carry seven runtime call sites importing target/adapter symbols that the descriptor file relocation does not touch. The architecturally honest fix is to introduce the dispatch SPI that mediates those call sites; the file relocation falls out as one consequence of doing that fix correctly.

## Changes

The work is structured as a single coherent reshape — the SPI definition, the adapter implementation, the family-instance dispatch refactor, the file moves, and the package.json severance all interlock and need to land together to keep the workspace compiling. The implementer round can sequence them as separate commits but they constitute one milestone.

### 0. Absorb TML-2464 AC #7 (rename + async-`schemaVerify` removal)

These deliverables come from TML-2464 (currently paused) and are folded in here so M2.5 can use the new naming throughout. They are mechanically small; their value is naming consistency with the post-`target-extensible-ir` codebase TML-2464 will produce when it resumes.

- **Rename `ControlFamilyInstance.schemaVerifyAgainstSchema` → `verifySchema`** (sync, takes pre-projected `schema` slice). Cross-family rename. Files touched (per TML-2464 commit `b4548c1b3`): `packages/1-framework/1-core/framework-components/src/control/control-instances.ts`, `packages/1-framework/3-tooling/cli/src/control-api/operations/db-verify.ts`, `packages/1-framework/3-tooling/cli/test/config-types.test.ts`, `packages/2-mongo-family/9-family/src/core/control-instance.ts`, `packages/2-sql/9-family/src/core/control-instance.ts`. Implementer can cherry-pick `b4548c1b3` from the `tml-2464-strip-single-spacemulti-space-branching-once-every-target-is` branch (clean auto-merge) and drop the project-doc additions (`projects/migration-runner-target-layer/{spec,plan}.md`) — those belong to TML-2464, not this project.
- **Compose `introspect + verifySchema` at family-verify call sites** (per TML-2464 commit `e6c9d1563`). Test-only changes; cherry-pick clean. Drop project-doc additions as above.
- **Remove async `schemaVerify` from `ControlFamilyInstance`** and from the SQL family-instance + Mongo family-instance implementations (per TML-2464 commit `d0712a45e`). The Mongo half is naturally absorbed by § 5 below — when refactoring `family-mongo/control-instance.ts` to dispatch via the SPI, the async `schemaVerify` method is deleted; its single internal use case (the legacy `db verify` CLI path) is rewritten to compose `introspect + verifySchema`. The SQL half is a smaller mechanical pass — delete `MongoFamilyInstance.schemaVerify`'s SQL counterpart at `packages/2-sql/9-family/src/core/control-instance.ts:124-186` and update the callers per TML-2464's diff (CLI `db-verify` operation already uses `verifySchema` after the § 0a rename).

After § 0 lands, the framework declares one synchronous schema-verification primitive (`verifySchema`); both family implementations match. § 5 (Mongo dispatch refactor) then rewrites Mongo's `verifySchema` body to dispatch via the SPI's `introspectSchema` + family-shared `verifyMongoSchema` helper. SQL's `verifySchema` body is unchanged by this milestone (it already dispatches through `verifySqlSchema`).

### 1. Define `MongoControlAdapter` SPI at `family-mongo`

New file: `packages/2-mongo-family/9-family/src/core/control-adapter.ts`. Mirror `SqlControlAdapter` shape:

- `interface MongoControlAdapter<TTarget extends string = string> extends ControlAdapterInstance<'mongo', TTarget>` — the dispatch surface.
- Methods, mirroring SQL where applicable and adding Mongo-specific surface where needed:
  - `readMarker(driver, space): Promise<ContractMarkerRecord | null>` — direct mirror of SQL.
  - `readAllMarkers(driver): Promise<ReadonlyMap<string, ContractMarkerRecord>>` — direct mirror.
  - `initMarker(driver, space, dest): Promise<void>` — Mongo-specific (SQL uses upsert via `writeContractMarker`); the API surface follows current `marker-ledger` shape.
  - `updateMarker(driver, space, expectedFrom, dest): Promise<boolean>` — Mongo-specific (CAS via `findOneAndUpdate`).
  - `writeLedgerEntry(driver, space, entry): Promise<void>` — Mongo-specific (ledger entries co-exist with marker docs in the same collection).
  - `introspectSchema(driver): Promise<MongoSchemaIR>` — direct mirror of SQL's `introspect` (Mongo signature is simpler because there's no schema-name parameter).
  - `formatMongoOperations(operations): readonly string[]` — Mongo-specific; formats raw commands for human display in `toOperationPreview`.
- Public surface: re-export from `packages/2-mongo-family/9-family/src/exports/control-adapter.ts` mirroring `family-sql/exports/control-adapter.ts`.

The SPI is generic over `TTarget` to leave room for future Mongo targets (Atlas, DocumentDB) the same way SQL is generic over `'postgres' | 'sqlite'`. Today there is one `targetId: 'mongo'`.

### 2. Move `marker-ledger.ts` from target-mongo to mongo-adapter

- Source: `packages/3-mongo-target/1-mongo-target/src/core/marker-ledger.ts`
- Destination: `packages/3-mongo-target/2-mongo-adapter/src/core/marker-ledger.ts`
- The file's imports are unchanged (zero target-mongo internals). The `_prisma_migrations` collection name constant goes with it.
- Move companion test: `packages/3-mongo-target/1-mongo-target/test/marker-ledger.test.ts` → `packages/3-mongo-target/2-mongo-adapter/test/marker-ledger.test.ts`. Update the import path inside the test file.
- Drop the `marker-ledger` re-export from `packages/3-mongo-target/1-mongo-target/src/exports/control.ts`.

### 3. Implement `MongoControlAdapter` at `mongo-adapter`

New class `MongoControlAdapterImpl` (or function-form factory mirroring SQL's adapter convention) in the adapter package. Implementation wraps the `Db` connection and forwards SPI calls to the relocated `marker-ledger` functions, the existing `introspect-schema.ts`, and any other adapter-resident operations.

`packages/3-mongo-target/2-mongo-adapter/src/core/runner-deps.ts` already constructs a `MongoRunnerDependencies` envelope that gathers the relocated symbols; refactor it to consume the new `MongoControlAdapter` instance rather than importing the marker functions directly. The runner-deps shape is unchanged for downstream consumers.

### 4. Relocate `verifyMongoSchema` and `formatMongoOperations` to family-mongo

Both are family-shared in concept (they're not specific to one Mongo target — they operate on the shared `MongoSchemaIR` and the shared raw command AST). Mirror SQL where `verifySqlSchema` and SQL formatting helpers live at `family-sql`.

- `packages/3-mongo-target/1-mongo-target/src/core/schema-verify/verify-mongo-schema.ts` (and any sibling `schema-verify/*` helpers that are family-shared) → `packages/2-mongo-family/9-family/src/core/schema-verify/`. Existing per-element helpers at the target (`contractToMongoSchemaIR`, `canonicalizeSchemasForVerification`, `diffMongoSchemas`) stay in the target — they're the per-target shape transformations the family-shared verifier walks (`plan.md § Open items` records the eventual lift to family if a second Mongo target lands; for M2.5 the verifier shell moves up but the helpers stay where they are).
- `packages/3-mongo-target/1-mongo-target/src/core/ddl-formatter.ts` (carries `formatMongoOperations` + the `MongoDdlCommandFormatter` visitor + helpers) → `packages/2-mongo-family/9-family/src/core/operation-preview.ts` as a family-mongo free function, mirroring SQL's `sqlOperationsToPreview` at `packages/2-sql/9-family/src/core/operation-preview.ts`. The family-instance's `toOperationPreview` method calls the free function directly (matches SQL's `return sqlOperationsToPreview(operations)`). The formatter has zero target-mongo internals (visits the family-shared `MongoDdlCommandVisitor` from `mongo-query-ast/control`); family placement is the SQL-pattern-preserving choice.
- Update target-mongo's exports to re-export the moved symbols from family-mongo for any external consumer that needs them (or — preferred — update the consumers to import from family-mongo directly, per the no-backwards-compat rule).

### 5. Refactor `family-mongo/control-instance.ts` to dispatch via the SPI

Every direct import of a target/adapter symbol becomes an SPI dispatch:

- `import { readMarker, updateMarker, initMarker, readAllMarkers } from '@prisma-next/target-mongo/control'` → removed; method bodies call `getControlAdapter().readMarker(driver, space)` etc.
- `import { introspectSchema } from '@prisma-next/adapter-mongo/control'` → removed; method bodies call `getControlAdapter().introspectSchema(driver)`.
- `import { verifyMongoSchema } from '@prisma-next/target-mongo/schema-verify'` → becomes a same-package import after § 4 moves the verifier into family-mongo.
- `import { formatMongoOperations, type MongoTargetContract } from '@prisma-next/target-mongo/control'` → `formatMongoOperations` becomes same-package after § 4; `MongoTargetContract` is replaced by the SPI's contract-shape generic (or by the framework's generic `Contract` type if the family-instance's signature can be widened).

The control-stack lookup that returns the bound `MongoControlAdapter` mirrors SQL's `getControlAdapter()` helper at `packages/2-sql/9-family/src/core/control-instance.ts:258-261` — match the SQL surface naming (`getControlAdapter()` returning the typed instance, throwing a structured error if the adapter is missing or not a `MongoControlAdapter`).

The `verifySchema` method (post-§ 0 rename) loses the async `schemaVerify` sibling delivered in § 0; its body is rewritten to: validate the contract via `validateMongoContract`, return a synchronous `verifyMongoSchema(...)` call against the pre-projected `schema` slice. The (now-deleted) async `schemaVerify` method's one internal use case at the legacy `db verify` CLI path is rewritten to compose `getControlAdapter().introspectSchema(driver)` + `verifySchema(...)` — matching the SQL family's flow at `packages/2-sql/9-family/src/core/control-instance.ts` and the test composition pattern landed by TML-2464 commit `e6c9d1563`.

### 6. Relocate the three Mongo SPI bases from foundation back to family

The M2 R1 workaround placed `MongoContractSerializerBase`, `MongoSchemaVerifierBase`, and `abstract class MongoStorageBase` at `packages/2-mongo-family/1-foundation/mongo-contract/src/ir/` because `family-mongo → target-mongo` was inverted. With the inversion severed via § 1-5, the bases belong at the family layer per the architectural-principles ADR (Principle 2 — cross-target consistency; SQL's bases live at family). Move:

- `packages/2-mongo-family/1-foundation/mongo-contract/src/ir/mongo-contract-serializer-base.ts` → `packages/2-mongo-family/9-family/src/core/ir/mongo-contract-serializer-base.ts`
- `packages/2-mongo-family/1-foundation/mongo-contract/src/ir/mongo-schema-verifier-base.ts` → `packages/2-mongo-family/9-family/src/core/ir/mongo-schema-verifier-base.ts`
- `packages/2-mongo-family/1-foundation/mongo-contract/src/ir/mongo-storage-base.ts` (or whatever the abstract storage base file is named) → `packages/2-mongo-family/9-family/src/core/ir/`

Update `target-mongo`'s implementer classes (`MongoTargetContractSerializer`, `MongoTargetSchemaVerifier`, `MongoTargetStorage`) to import the bases from `@prisma-next/family-mongo/control` (or wherever the family barrel surfaces them).

### 7. Relocate `mongo-target-descriptor.ts` to target-mongo

The original spec's load-bearing change. Now mechanical because § 1-6 already removed the family-layer reasons it lived there.

- Source: `packages/2-mongo-family/9-family/src/core/mongo-target-descriptor.ts`
- Destination: `packages/3-mongo-target/1-mongo-target/src/core/control-target.ts` (mirrors SQLite's filename convention).
- The new home imports `MongoControlFamilyInstance` and the multi-space types from `@prisma-next/family-mongo/control` (upward direction).
- The currently-downward imports (`@prisma-next/adapter-mongo/control`, `@prisma-next/driver-mongo`, `@prisma-next/target-mongo/control`, `@prisma-next/target-mongo/pack`) become same-package relative imports (since the file now lives in target-mongo) — the adapter and driver imports remain shaped the same but are now downward-from-target (the natural direction).

### 8. Sever the family→target/adapter/driver dep edges

In `packages/2-mongo-family/9-family/package.json`, drop:

- `@prisma-next/target-mongo`
- `@prisma-next/adapter-mongo`
- `@prisma-next/driver-mongo`

Run `pnpm install` to update the lockfile. After this commit, `cat packages/2-mongo-family/9-family/package.json | rg "target-mongo|adapter-mongo|driver-mongo"` returns zero hits in the `dependencies` block.

The family's public re-exports (e.g. `mongoTargetDescriptor`, `MongoControlTargetDescriptor`) point at `@prisma-next/target-mongo/control` — public API unchanged.

### 9. Update consumers

- Workspace grep for direct deep imports into the old paths (`from '@prisma-next/family-mongo/.../mongo-target-descriptor'`, `from '@prisma-next/mongo-contract/.../mongo-contract-serializer-base'`, `from '@prisma-next/target-mongo/control'` for any of the symbols that moved): update to the new locations or — preferred — to the public package surface.
- `packages/3-mongo-target/1-mongo-target/src/exports/control.ts` no longer re-exports the marker-ledger symbols (they moved to mongo-adapter; downstream consumers either dispatch via the SPI or import from the adapter directly).
- Test files consuming the moved symbols update to the new paths. Tests at `packages/3-mongo-target/1-mongo-target/test/marker-ledger.test.ts` move with the file (§ 2).

### 10. Update subsystem 10 doc

`docs/architecture docs/subsystems/10. MongoDB Family.md` — if PR 494 named `mongo-target-descriptor.ts`, `marker-ledger.ts`, or `verifyMongoSchema`'s file path in any "where things live" reference, update the path. Add a short note on the `MongoControlAdapter` SPI alongside the existing surface-area descriptions; the framing can be brief because the architectural-principles ADR (already drafted) carries the full convention. Do not gold-plate; minimal corrections + a paragraph naming the SPI are sufficient.

## Acceptance criteria

- **TML-2464 AC #7 absorbed.** `ControlFamilyInstance.schemaVerifyAgainstSchema` is renamed to `verifySchema` across framework + sql-family + mongo-family + cli. The async `schemaVerify` method is removed from `ControlFamilyInstance` and from both family implementations. Call sites compose `introspect + verifySchema` where the legacy combined call existed.
- **Dep severance.** `cat packages/2-mongo-family/9-family/package.json | rg "target-mongo|adapter-mongo|driver-mongo"` returns zero hits in the `dependencies` block.
- **`MongoControlAdapter` SPI exists.** `packages/2-mongo-family/9-family/src/core/control-adapter.ts` declares the interface; `packages/2-mongo-family/9-family/src/exports/control-adapter.ts` re-exports it.
- **`MongoControlAdapterImpl`** (or factory equivalent) at `mongo-adapter` implements the SPI. The adapter's runner-deps construction goes through it.
- **`marker-ledger.ts`** lives at `packages/3-mongo-target/2-mongo-adapter/src/core/`; no copy at `packages/3-mongo-target/1-mongo-target/src/core/`. `marker-ledger.test.ts` moves with it.
- **`verifyMongoSchema`** lives at `packages/2-mongo-family/9-family/src/core/schema-verify/`; the per-element helpers (`contractToMongoSchemaIR`, `canonicalizeSchemasForVerification`, `diffMongoSchemas`) remain at target-mongo.
- **`formatMongoOperations`** lives at `packages/2-mongo-family/9-family/src/core/operation-preview.ts` as a free function, mirroring SQL's `sqlOperationsToPreview`. The family-instance's `toOperationPreview` calls it directly.
- **Three SPI bases relocate from foundation back to family layer.** `ls packages/2-mongo-family/9-family/src/core/ir/` contains `mongo-contract-serializer-base.ts`, `mongo-schema-verifier-base.ts`, `mongo-storage-base.ts` (or equivalent); `ls packages/2-mongo-family/1-foundation/mongo-contract/src/ir/` is empty of SPI base files.
- **`mongo-target-descriptor.ts` no longer exists at `packages/2-mongo-family/9-family/src/core/`.** The descriptor lives at `packages/3-mongo-target/1-mongo-target/src/core/control-target.ts`.
- **`family-mongo/control-instance.ts` carries zero direct imports** from `@prisma-next/target-mongo/*` or `@prisma-next/adapter-mongo/*`. All access is via the `MongoControlAdapter` SPI surfaced by the control stack.
- **Public API preserved.** `@prisma-next/family-mongo/control` still exposes `mongoTargetDescriptor` and `MongoControlTargetDescriptor` (re-exported from target-mongo). Consumers importing from the family's public surface keep working without any source change.
- **`pnpm lint:deps`** passes (zero new violations; the family→target/adapter/driver violations should disappear).
- **`pnpm typecheck`** passes workspace-wide.
- **`pnpm --filter '@prisma-next/mongo*' --filter '@prisma-next/family-mongo*' --filter '@prisma-next/mongo-target*' test`** passes (all moved-file tests + new SPI tests green).
- **`pnpm test:integration`** passes — particularly multi-space runner, `db-sign / db-verify / db-update`, and the contract-spaces-mongo-port surface from PR 494. The documented PGlite shutdown-race flake set (`plan.md § Open items` trajectory note) is accepted; isolation re-runs of any non-PGlite failure are required before declaring done.

## Out of scope

- Lifting the per-element diff/canonicalize helpers (`contractToMongoSchemaIR`, `canonicalizeSchemasForVerification`, `diffMongoSchemas`) from target-mongo to family-mongo. Tracked in `plan.md § Open items` as a future project (post-Supabase, when a second Mongo target makes the lift load-bearing).
- Renaming `mongoTargetDescriptor` or any of its constituent types. Out of scope for this PR.
- Reshaping the `MongoControlTargetDescriptor` type itself. The descriptor's *shape* is unchanged; only its *placement* and the dispatch wiring around it change.
- Multi-space runner mechanism changes (PR 494's contribution). This relocation moves PR 494's code with the descriptor relocation but preserves its semantics byte-for-byte.
- SQL family / target descriptor changes. SQL is already in the target shape this milestone migrates Mongo to.
- Any change to `architecture.config.json`. The existing layering rules are correct; this milestone removes the need for the workaround they tolerated, not the rules themselves.

## Open questions

1. **Does the descriptor need a factory function or is the singleton form sufficient?** SQLite uses a `const sqliteControlTargetDescriptor` singleton; Mongo uses (or used to use) a factory pattern. If the relocation can simplify Mongo to the singleton form without affecting consumers, prefer the singleton. If consumers depend on the factory shape (e.g. for per-test descriptor variation), keep the factory. Out of scope for this milestone unless it blocks the relocation; otherwise track as a follow-up.
2. **Does `family-mongo` need to retain the descriptor type re-export indefinitely?** Strictly, callers could import the type from `@prisma-next/target-mongo/control` directly. The family's re-export is a backwards-compat shim. Per the repo's no-backwards-compat rule (`.cursor/rules/no-backward-compatibility.md`), the re-export should eventually be removed and call sites updated to import from the target package directly. Confirm in scope of this PR (preferred) or split into a follow-up at the implementer's discretion.
