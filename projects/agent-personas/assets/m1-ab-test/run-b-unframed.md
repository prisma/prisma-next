# System design review — `68ebbeb25` (M1-cleanup F4)

## Summary

This commit hoists the contract-space identity and authoring types out of the SQL family into the framework control plane, renaming them in the process and making the contract-space type generic over the contract value. It also pulls migration-package metadata types up alongside (so the new framework-level types can reference them without an upward import), leaves a re-export shim in `migration-tools/metadata.ts` for existing import paths, and renames the producer-side helper `writeExtensionMigrationPackage` → `writeAuthoredMigrationPackage`.

## Walkthrough

**New home, new names.** Three interfaces move from `packages/2-sql/9-family/src/core/migrations/types.ts` into a new `packages/1-framework/1-core/framework-components/src/control/control-spaces.ts`:

- `ExtensionContractRef` → `ContractSpaceHeadRef`
- `ExtensionMigrationPackage` → `AuthoredMigrationPackage`
- `ExtensionContractSpace` → `AuthoredContractSpace<TContract extends Contract = Contract>`

The SQL family no longer declares its own copies. `SqlControlExtensionDescriptor.contractSpace` is now typed as `AuthoredContractSpace<Contract<SqlStorage>>`, importing the generic from `@prisma-next/framework-components/control` and pinning the storage block at the consumption site. The SQL family's public surface (`packages/2-sql/9-family/src/exports/control.ts`) drops the three `Extension*` re-exports; the framework's public surface (`packages/1-framework/1-core/framework-components/src/exports/control.ts`) gains them under the new names alongside the existing `APP_SPACE_ID`. No backward-compat shims at the SQL re-export layer (per the repo's stated convention).

**Generic parameter.** The new generic on `AuthoredContractSpace` is the core mechanism that makes the hoist viable: the framework type stays family-agnostic, while each family pins a typed contract value at the descriptor surface. The bound (`extends Contract`) and default (`Contract`) are sensible — every SQL descriptor will pass `Contract<SqlStorage>` explicitly, and the default is only there to keep the type usable in family-neutral contexts.

**Metadata types come along for the ride.** Because `AuthoredMigrationPackage` references `MigrationMetadata`, the metadata types had to live somewhere `framework-components/control` can reach. The commit moves `MigrationHints` and `MigrationMetadata` into a new section at the top of `framework-components/src/control/control-migration-types.ts`. `migration-tools/src/metadata.ts` becomes a one-line `export type { ... } from '@prisma-next/framework-components/control'`. The arktype runtime validator for `migration.json` stays in `migration-tools/src/io.ts`, which is sound: type definition and write-time JSON validation are separable concerns.

**Producer-side rename and de-duplication.** `writeExtensionMigrationPackage` is renamed to `writeAuthoredMigrationPackage`. A small but cleanly motivated change in `migration-tools/src/io.ts`: the lampshaded-as-duplicate local `MigrationPackageContents` interface is deleted and replaced by importing the canonical `AuthoredMigrationPackage` from framework-components. One type, one home.

**Family/framework boundary.** The dependency graph after the commit: `framework-components` (1-core) declares the contract-space and metadata types; `migration-tools` (3-tooling) consumes them; `family-sql` (2-sql/9) consumes them; the integration-test fixture imports `AuthoredContractSpace` from framework-components and `Contract<SqlStorage>` from `@prisma-next/sql-contract/types`. All flows are downstream-to-upstream by the layer numbering — no inversion.

## Concerns

**1. The "Authored" qualifier is doing weak work.** The rename's stated motivation is that the in-memory descriptor-side shape is also the shape the app-space planner produces before emission, so "extension" was too narrow. Fair. But "Authored" describes *when the value lives* (pre-emission), not *what it is structurally*. There is no `OnDiskContractSpace` symmetric counterpart — `ContractSpaceHeadRef` doesn't pick up the qualifier because it has no on-disk/in-memory split. Three new types, two different naming rationales. That asymmetry is a tell that "authoring" isn't a structural distinction the type system needs to carry; it's a workflow stage.

More concretely, this naming choice creates active tension with the spec. § 1 of `framework-mechanism.spec.md` (updated by this commit) names the in-memory type `AuthoredMigrationPackage` and the on-disk type `MigrationPackage`. § 3 of the same file (not updated; see below) still says `MigrationPackage` is the *canonical* structural shape and `OnDiskMigrationPackage extends MigrationPackage` is the augmented on-disk form. The commit message acknowledges that §§ 3, 6, 7 still reference the old names "out of the spec-edit authorisation for this round," but the conceptual disagreement between § 1's `Authored*` framing and § 3's `MigrationPackage`/`OnDiskMigrationPackage` framing isn't just stale prose — it's two incompatible naming schemes for the same boundary, both currently in the spec. A reviewer reading the spec at this commit can't tell which is canonical, and the implementation locks in the § 1 choice.

**2. `migration-tools/src/metadata.ts` as re-export shim.** The repo's golden rules (`AGENTS.md`) say "Do not reexport things from one file in another, except in the `exports/` folders" and "Don't add exports for backwards compatibility unless requested to do so." The new `metadata.ts` is a single-line re-export from another package, not in an `exports/` folder, justified by "12 consumers in CLI + tests." This is a debt the commit doesn't promise to repay: nothing in the diff or message commits to migrating those consumers to import from `@prisma-next/framework-components/control` directly and deleting the shim. The cleaner shape — given the rest of the commit's willingness to break import paths (the SQL family's three re-exports were dropped without shims) — would be to do the same with `metadata.ts`'s consumers in a follow-up.

**3. `MigrationPackage`'s name is now claimed by the on-disk type.** At this commit, `migration-tools/src/package.ts` defines `MigrationPackage` as `{ dirName, dirPath, metadata, ops }` — i.e. the on-disk form, with `dirPath`. The new `AuthoredMigrationPackage` is the in-memory form. So the *canonical* name (`MigrationPackage`) belongs to the *less canonical* shape (the one with extra disk-bound state), and the in-memory form has a workflow-qualified name. Spec § 3's preferred outcome inverts that — `MigrationPackage` canonical, `OnDiskMigrationPackage` augmented. This commit chose minimum-churn (don't rename `MigrationPackage`'s many call sites) over the spec's preferred shape. Defensible, but it leaves the eventual `OnDiskMigrationPackage` rename either undone or contradictory.

**4. `ops` element type widens at the family/framework boundary.** Pre-commit, `ExtensionMigrationPackage.ops` was `MigrationOps` from `@prisma-next/migration-tools/package`. Post-commit, `AuthoredMigrationPackage.ops` is `readonly MigrationPlanOperation[]` from `framework-components/control-migration-types`. If `MigrationPlanOperation` carries a generic for target-specific op details (it has `<TTargetDetails>` defaults elsewhere in the codebase) and the SQL family was previously seeing a SQL-specialised op shape, the descriptor surface has lost the per-family op detail typing. The integration fixture continues to typecheck, but the fixture is *constructing* values, not destructuring `op.targetDetails`-style fields — so it isn't evidence either way. Worth verifying that the SQL planner / runner / emitter that consume `descriptor.contractSpace.migrations[*].ops` still get the typing they need. If the answer is "no, but they cast" — that should be visible in the next round; if the answer is "yes, by re-narrowing at the consumption site" — fine.

**5. Spec is internally inconsistent at this commit.** The commit message is candid that §§ 3, 6, 7 still mention `Extension*` names. Combined with point (1) — § 1's `Authored*` framing vs. § 3's `MigrationPackage`/`OnDiskMigrationPackage` framing — the spec at HEAD describes three overlapping vocabularies (legacy `Extension*`, current `Authored*`, aspirational canonical `MigrationPackage` + `OnDiskMigrationPackage`). Out-of-scope-for-this-round is reasonable for *one* commit, but the divergence should not survive M1.

## Verdict

**CONCERNS.**

The hoist itself is structurally correct and well-motivated: contract-space identity belongs in the framework layer per the project spec's family-agnostic FRs, the generic parameter is the right mechanism for keeping typed contracts at the consumption site, the dependency graph stays well-layered, and the de-duplication of `MigrationPackageContents` is a clean win. The blocking concerns aren't with *what* moved or *whether* it should have moved — they're with the naming and the loose ends:

- `Authored*` as a qualifier doesn't earn its keep against the spec's preferred `MigrationPackage`/`OnDiskMigrationPackage` framing, and the resulting name collisions (`MigrationPackage` claimed by the on-disk type) are likely to make subsequent rounds harder, not easier.
- The `migration-tools/metadata.ts` re-export shim violates a stated repo convention and isn't paired with a planned cleanup.
- The spec drift between §§ 1, 3, 6, 7 should be reconciled before further structural rounds land on top.

None of these are show-stoppers — the commit is a reasonable mid-flight checkpoint — but the naming question deserves a deliberate decision (commit to `Authored*` everywhere, *or* pivot to the spec § 3 phrasing) before the boundary types calcify in any more call sites.
