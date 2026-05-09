# System design review — commit `68ebbeb25`

## Summary

This commit hoists the contract-space identity / authoring types out of the SQL family (`@prisma-next/family-sql/control`) and into the framework's control plane (`@prisma-next/framework-components/control`), renames them away from the `Extension*` prefix, and makes the contract-space type generic over its contract. It is a structural refactor in service of M1-cleanup item F4: no behaviour changes, no new functional surface — purely "where do these types live, and what are they called."

## What actually changed

Three interfaces previously declared in `packages/2-sql/9-family/src/core/migrations/types.ts` are deleted and re-introduced (with renames) in a new file `packages/1-framework/1-core/framework-components/src/control/control-spaces.ts`:

- `ExtensionContractRef` → `ContractSpaceHeadRef`
- `ExtensionMigrationPackage` → `AuthoredMigrationPackage`
- `ExtensionContractSpace` → `AuthoredContractSpace<TContract extends Contract = Contract>`

The third type acquires a new generic parameter. The SQL family then specialises it on `SqlControlExtensionDescriptor.contractSpace?: AuthoredContractSpace<Contract<SqlStorage>>` so descriptor authors keep a typed contract; the framework-side type itself is family-neutral.

To let `AuthoredMigrationPackage` reference `MigrationMetadata` from the framework layer without an upward import to `migration-tools` (which sits a layer above), `MigrationHints` and `MigrationMetadata` are *also* hoisted — they move into `framework-components/src/control/control-migration-types.ts`. The old home (`migration-tools/src/metadata.ts`) becomes a re-export so its dozen-or-so consumers don't have to be touched. The arktype runtime schema that validates `migration.json` deliberately stays in `migration-tools/src/io.ts`, since it is an I/O concern, not a type definition.

A producer-side rename rides along: `writeExtensionMigrationPackage` → `writeAuthoredMigrationPackage`, and the lampshaded local-duplicate `MigrationPackageContents` interface in `migration-tools/src/io.ts` is dropped in favour of importing `AuthoredMigrationPackage` directly. SQL family consumers (`exports/control.ts`, the type-d test, the integration test fixture) update their imports and drop the no-longer-needed re-exports per the repo's no-backwards-compat-shim convention. Spec § 1 of `framework-mechanism.spec.md` is updated to reflect the new home and names.

## Why this matters structurally

There are three independent structural moves bundled into the change, each worth assessing on its own merits.

**1. Bounded-context placement of contract-space identity.** The project spec (§ Approach, FR1–FR6) describes contract spaces as "a `(contract.json, migration-graph, head-ref)` unit" without any SQL-specific commitment; the framework operates "per space" through its planner / runner / verifier, all of which are family-neutral primitives. The pre-commit placement (in `family-sql/control`) put a family-agnostic concept inside a family-specific package, which forced any future Mongo (or other) family to either re-declare the same shape or to reach across into the SQL package. The hoist puts the concept in the layer that actually owns it. This is a clear bounded-context win and aligns the type's home with the spec's stated scope.

**2. Naming rename `Extension*` → `Authored* / ContractSpace*`.** This is more than cosmetic. The pre-commit names asserted "this is the shape an extension publishes." The new `AuthoredMigrationPackage` describes a structural property — *in-memory, pre-emission, authored* — that turns out to be true of app-space migrations as well as extension-space migrations (see the doc comment: "as published by an extension's descriptor module (or by the app-space planner before emission)"). `Authored*` thus surfaces a previously-implicit truth: the same shape applies to both the user's contract and any extension's contract before either is materialised to disk. `ContractSpaceHeadRef` is a less dramatic rename but follows the same logic — the head ref is owned by a *space*, not by an *extension*; an extension just happens to be one party that owns a space. The renames pull the typology in line with the spec's first-class "contract space" vocabulary (§ Contract spaces) and unblock app-space planner code from having to either reuse `Extension*` types or re-declare parallel shapes.

**3. Dependency direction in `migration-tools`.** Pre-commit, `family-sql` (layer 9) imported `MigrationMetadata` and `MigrationOps` from `migration-tools` (layer 3-tooling) to assemble its `Extension*` types. The new arrangement inverts the metadata flow: `framework-components` (layer 1-core, `migration` plane) defines `MigrationMetadata`, and `migration-tools` (layer 3-tooling) imports it from below. That is the architecturally correct direction — lower layers should not import from higher ones — and it lets `AuthoredMigrationPackage` reference `MigrationMetadata` without crossing layers upward. The retention of `migration-tools/src/metadata.ts` as a re-export is a minor concession to consumer churn (12 files), not a structural compromise.

## Concerns

The change is restrained and the bones are good. Three things worth surfacing:

**Twin definitions of `MigrationMetadata`.** With this commit, `MigrationMetadata` exists as a TypeScript interface in `framework-components/control/control-migration-types.ts` and as an arktype runtime schema in `migration-tools/src/io.ts`. The two must stay structurally equivalent for `migration.json` validation to round-trip correctly. The split has a sound rationale (arktype is an I/O concern; the type definition is a control-plane shape), but it now lives across two packages in two layers, with no compile-time check binding them. Adding a field to `MigrationMetadata` requires hand-editing both. This is not a regression introduced by this commit (the arktype schema has always been at the I/O boundary), but the hoist makes the two definitions farther apart in the codebase, and a maker who only edits the framework-side interface won't get a visible signal that they've broken validator parity. A type-level test asserting structural equivalence — or an arktype `inferIn`-style derivation — would close the loop. It can be a follow-up; flagging it here so it doesn't fall off the radar.

**Slight inconsistency in re-export policy.** The commit drops the SQL family's re-exports of the `Extension*` types from `2-sql/9-family/src/exports/control.ts` ("no backward-compat shims per repo convention"), but keeps `migration-tools/src/metadata.ts` as a re-export of the same types from their new home. The justification given is consumer count (12 files in CLI + tests). Both choices are individually defensible; together they are mildly inconsistent in the application of the convention. If "no backward-compat shims" is the rule, the metadata re-export is a violation; if "transitional shims for consumer churn are acceptable," the SQL family's `Extension*` re-exports could equally have been kept until follow-on consumers caught up. I lean toward the commit's choices being right (the metadata path is a stable public surface; the `Extension*` types had narrow internal consumption) but the asymmetry is worth a sentence in the commit message or a follow-up to retire `migration-tools/src/metadata.ts`'s re-export once a clean cycle has passed.

**Spec consistency.** The commit message acknowledges that spec § 3, § 6, and § 7 of `framework-mechanism.spec.md` still reference the old names in narrative prose. § 1 has been updated — that's the section a maker would read first to understand the type shape — but a maker reading the spec end-to-end will see drift between the resolved names and the planning narrative. The commit author flags this as out-of-scope for the round; it is a real issue that should not linger long.

## Concerns I considered and dismissed

- **Premature genericisation.** `AuthoredContractSpace<TContract = Contract>` introduces a generic parameter that today has only a single specialisation (`Contract<SqlStorage>`). Without a second family in tree, this could look speculative. I am satisfied the cost is low — the parameter has a default, so unconstrained references continue to compile, and the cost of *removing* the generic later if the second family never materialises is trivial. Conversely, *adding* the generic later would force a wave of consumer churn. Net: cheap option to keep open.

- **`MigrationPlanOperation` vs `MigrationOps` typing of `ops`.** `AuthoredMigrationPackage.ops` is now `readonly MigrationPlanOperation[]`, where the previous `ExtensionMigrationPackage.ops` was `MigrationOps`. This is a type-narrowing change (the framework type is more general; the SQL family's ops are a target-specialised subtype). I checked the type-d test (`migrations.types.test-d.ts`); it asserts `AuthoredMigrationPackage['ops']` equals `MigrationOps`, indicating the structural test caught any divergence and the two are interchangeable for SQL consumers today. Good; nothing to do here.

- **Whether contract spaces really are a framework concept.** The spec is family-agnostic in its requirements (FR1–FR6 talk about "contract.json + migration graph + head ref" without naming SQL); the architecture config places `framework-components/src/control/**` in the `framework / core / migration` layer, which is the correct home for migration-plane control types. The hoist is supported by both spec scope and architectural classification.

## Verdict

**SATISFIED.**

The commit does exactly one thing — moves and renames a small cluster of types — and does it cleanly. The new home is the correct layer for the concept (framework / core / migration plane); the renames remove a misleading `Extension*` framing and align the typology with the spec's first-class "contract space" vocabulary; the new generic parameter signals correctly that families specialise the contract while the framework owns the shape; the dependency-direction inversion in `migration-tools` is a structural improvement, not a workaround. The three concerns above are all "watch the seams" rather than "this is wrong" — the twin-definition risk on `MigrationMetadata` is the most worth a follow-up, the re-export inconsistency is a small policy nit, and the spec-prose drift is acknowledged in the commit message as known and out of scope. Given the change is preparation for M1's per-space planner / runner / emitter work, lining up the typology now (cheaply, no behavioural impact) is the right time to do it.
