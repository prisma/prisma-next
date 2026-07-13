# Slice 03 — contractSpace declared on the core extension descriptor

**Project:** [`../../spec.md`](../../spec.md) · **Project plan:** [`../../plans/plan.md`](../../plans/plan.md) § M2b · **Linear:** TML-2984
**Stacked on:** slice 02 (`tml-2984-slice-02-extension-contracts`, PR #948) — consumes `extensionContracts` machinery it makes cast-free.

## Design (operator-authorized scope addition, 2026-07-10)

`ContractSpace<TContract extends Contract = Contract>` already lives in core
(`framework-components/src/control/control-spaces.ts:77` — "contract-space identity
is a framework concept, not a SQL-specific one"). Both families declare the identical
optional member, pinning only the storage generic
(`SqlControlExtensionDescriptor` → `ContractSpace<Contract<SqlStorage>>`,
`MongoControlExtensionDescriptor` → `ContractSpace<MongoContract<MongoStorageShape>>`).
The missing piece is the declaration site:

1. **Core `ControlExtensionDescriptor`** (`framework-components/src/control/control-descriptors.ts:80`)
   gains `readonly contractSpace?: ContractSpace;` (default generic). Optional member
   → every existing descriptor stays valid; family overrides are covariant readonly
   narrowings and must keep compiling unchanged.
2. **`control-stack.ts` sheds its structural bridges**: `ContractSpaceCarryingDescriptor`
   is deleted and `assembleExtensionContracts` reads `descriptor.contractSpace.contractJson`
   typed — **the `blindCast` goes**. The load-order view
   (`DependencyDeclaringDescriptor`, reads `contractJson.extensionPacks`) goes typed
   too **iff** the `Contract` type exposes `extensionPacks` with a usable shape;
   otherwise it stays and the slice records why (in-code comment is not needed — the
   report suffices).
3. **Grep gate tightens** in `drive/calibration/grep-library.md`: from "no
   `contractSpace.contractJson` casts outside framework-components" to "none anywhere".
4. **Out of scope:** `toExtensionInputs` (its cast is a `readonly unknown[]` API
   boundary, a separate concern); descriptor construction sites in extension packs;
   any behavioral change.

## Coherence rationale

One reviewable PR: "declare in core what both families already agree on, and delete
the bridges the gap forced." Type-level only; bit-identical behavior by construction
(same values flow, typed instead of cast).

## Slice Definition of Done (beyond CI / reviewer / project-DoD)

- [ ] SDoD1 — Core `ControlExtensionDescriptor` declares `contractSpace?: ContractSpace`;
      sql + mongo overrides compile unchanged (their existing
      descriptor-self-consistency suites stay green); type test pins the covariant
      narrowing (family descriptor assignable where core descriptor is expected, with
      typed `contractSpace` access).
- [ ] SDoD2 — Zero `contractJson` casts repo-wide: `assembleExtensionContracts`
      cast-free, `ContractSpaceCarryingDescriptor` deleted; tightened grep gate
      documented and passing (with positive control against pre-change tree).
- [ ] SDoD3 — Load-order dependency view either typed (if `Contract.extensionPacks`
      admits it) or explicitly reported as kept-with-reason.
- [ ] SDoD4 — `MigrationPackage` fit verified: both families' shipped descriptor
      migrations satisfy core's `ContractSpace.migrations` (typecheck is the proof;
      any wrinkle surfaces, not worked around).

## Edge cases (pre-investigated)

- The families' overrides re-declare the member; TypeScript requires override
  compatibility, not identity — `ContractSpace<Contract<SqlStorage>>` must be
  assignable to `ContractSpace<Contract>` (readonly members, covariance holds if
  `Contract<SqlStorage>` extends `Contract`'s default). If a variance snag surfaces
  (e.g. invariant generic in `MigrationPackage`), halt — do not loosen family typing.
- The CLI's `DescriptorMigrationPackage` mirror ("minus `dirPath`") hints descriptor
  migrations may be in-memory; but both families already type their member as
  `ContractSpace<…>` today, so their descriptors already satisfy `MigrationPackage` —
  expected non-issue, verify via typecheck.

## Dispatch plan

Single dispatch.

### S3-D1 — lift the declaration, delete the bridges

- **Outcome:** the § Design list, complete; SDoD1–4.
- **Builds on:** slice 02 (`assembleExtensionContracts`).
- **Hands to:** M3+ (cleaner base; no API change for them).
- **Focus:** `packages/1-framework/1-core/framework-components/` (descriptor + stack +
  tests); `drive/calibration/grep-library.md`; family packages only if typecheck
  demands (expected: no changes).
- **Gate:** `pnpm --filter @prisma-next/framework-components test` + typecheck + lint,
  family descriptor-self-consistency suites
  (`pnpm --filter @prisma-next/family-sql test`, `pnpm --filter @prisma-next/family-mongo test`),
  `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps`, tightened grep gate.
