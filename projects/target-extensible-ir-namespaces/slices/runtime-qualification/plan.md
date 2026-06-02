# Dispatch plan: runtime-qualification — default-namespace ownership rework

_Slice spec: [`spec.md`](./spec.md). One PR (#670, currently draft). Single persistent implementer + reviewer. Sequential — each dispatch leaves the tree green._

The slice's runtime qualification, AST coordinate, qualifying renderers, query-builder type parity, and transitional-helper retirement **already landed** on PR #670 (see spec § Current state). This plan covers only the **R1–R4 rework** that corrects the one architectural defect review found: the per-target default namespace was implemented as framework-owned constants that name a target (`POSTGRES_DEFAULT_DOMAIN_NAMESPACE_ID`, `defaultDomainNamespaceIdForSqlTarget`, `defaultStorageNamespaceIdForSqlTarget`, branching on `targetId === 'postgres'` inside target-agnostic packages). The rework moves that one fact onto the **target descriptor** (`defaultNamespaceId`), consumed only by authoring; runtime resolves target-agnostically.

**Shared validation gate** (each dispatch runs the subset covering its surface; R4 runs all): `pnpm typecheck` · package-scoped `pnpm test` for touched packages · `pnpm lint:deps` · (R4) `pnpm test:packages` + `pnpm test:integration` + `pnpm test:e2e` + `pnpm fixtures:check`.

### R1: target-owned default namespace (LANDED — uncommitted)

- **Outcome:** `TargetPackRef` carries a required `defaultNamespaceId: string`; the three real target descriptors declare it (`postgres` → `'public'`, `sqlite` / `mongo` → `'__unbound__'`); `build-contract.ts` stamps bare model/table namespaces from `definition.target.defaultNamespaceId`; the local `defaultModelNamespaceId(targetId)` / `POSTGRES_DEFAULT_NAMESPACE_ID` with their `targetId === 'postgres'` branch are deleted from authoring. Descriptor tests pin the declared values; `TargetPackRef` literals across the test suite updated.
- **Builds on:** the corrected design (spec §2).
- **Hands to:** a target-owned `defaultNamespaceId` authoring already reads — the single source the rest of the rework collapses onto.
- **Focus:** the descriptor field + authoring rewire + fixtures only. No framework/family helper deletion yet (that is R3, after the last non-authoring consumer is gone). **Status: complete on disk, awaiting commit.**

### R2: contract-walking ergonomics (direct `Models` alias)

- **Outcome:** the emitter emits `type Models = ContractModelDefinitions<Contract>` as a **direct alias** (not the inline `infer` conditional that regressed it); `examples/prisma-next-demo/src/app/ContractView.tsx` walks models through that alias with **no** `domainModelsAtDefaultNamespace(...)` call, **no** `defaultDomainNamespaceIdForSqlTarget(contract.target)` argument, and **no** `as Models` cast. All emitted `contract.d.ts` fixtures regenerated; `fixtures:check` clean.
- **Builds on:** R1 (target-owned default in place).
- **Hands to:** a demo that no longer consumes any framework default-namespace helper — clearing the last non-authoring consumer so R3 can delete those helpers without breaking the tree.
- **Focus:** the `Models` emission in the contract-dts emitter + `ContractView.tsx` + regenerated fixtures. No resolver/helper deletion here. **This dispatch must precede R3** — it removes the demo's dependency on the target-naming helper R3 deletes.

### R3: delete target-naming defaults; resolvers resolve target-agnostically

- **Outcome:** every framework/family default-namespace helper that names a target is deleted — `POSTGRES_DEFAULT_DOMAIN_NAMESPACE_ID`, `defaultDomainNamespaceIdForSqlTarget`, `defaultDomainNamespaceIdForMongo` (framework `@prisma-next/contract`), `POSTGRES_DEFAULT_STORAGE_NAMESPACE_ID` / `defaultStorageNamespaceIdForSqlTarget` (SQL-family `@prisma-next/sql-contract`), and the Mongo-family re-export — along with their export barrels and tests. The universal `UNBOUND_DOMAIN_NAMESPACE_ID` sentinel stays. Bare-name flat access resolves through the contract's sole namespace: `soleDomainNamespaceId` (formerly `inferDefaultDomainNamespaceId`) **throws** on a zero- or multi-namespace contract rather than guessing by insertion order, and the sole-namespace helpers (`domainModelsAtDefaultNamespace` / `domainValueObjectsAtDefaultNamespace`) drop their unused optional `defaultNamespaceId`. The shared resolvers (`resolveStorageTable`, `resolveDomainModel`) likewise drop their dead optional `defaultNamespaceId` and scan the contract's namespaces; the runtime call sites (`sql-builder` `resolve-table.ts`, `sql-orm-client` `storage-resolution.ts`) stop importing the deleted helpers and call the resolvers without a per-target default.
- **Builds on:** R2 (no non-authoring consumer of the target-naming helpers remains).
- **Hands to:** a codebase where the only place a target's default namespace is named is the target's own descriptor.
- **Focus:** deletion + resolver-signature change + the two runtime call sites + their tests. Validation gate extends to **workspace-wide** `pnpm typecheck` + a grep proving the deleted symbols are gone from `packages/`.

### R4: ADR 223 amend + full re-verify

- **Outcome:** ADR 223 is amended from the rejected framework-façade framing to the **target-owned default-namespace** convention (descriptor `defaultNamespaceId`; authoring-only consumer; runtime scans). Upgrade instructions re-checked if `examples/` or `packages/3-extensions/` *source* changed by the rework. Full gates green (`test:packages` + `test:integration` + `test:e2e` + `fixtures:check`), proving the rework did not regress the qualified-SQL behaviour D1–D8 established.
- **Builds on:** the settled rework (R1–R3).
- **Hands to:** slice DoD met → push, take PR #670 out of draft / re-request review.
- **Focus:** ADR + upgrade docs + the full-suite proof. No production logic changes (a logic gap routes back to the owning dispatch).

## Open items

- Project **close-out** (Linear Completed, folder cleanup) is a project-level step via `drive-close-project` after this slice's PR merges — not a dispatch here.
- Multi-namespace bare-name collision ordering (insertion-order, no `public` preference) is accepted for this slice and resolved by TML-2550's explicit-namespace DSL.
- The prior D1–D8 review history lives in [`reviews/code-review.md`](./reviews/code-review.md) (SATISFIED for the original design); the rework rounds append below it.
