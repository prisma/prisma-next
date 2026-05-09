# System-design review — PR #434 (TML-2397 M1, framework mechanism)

**Lens:** architect persona (typology, naming, bounded contexts, conceptual integrity, ubiquitous language).
**Review target:** commit `ee05b2b4f872a2458c8a822eb3f16c0eab556933` (PR #434 head ref at the time of this review).
**Base:** `origin/main` — review range `origin/main..ee05b2b4f`.
**Source-pinning:** every spec file and every source file referenced below is read at `ee05b2b4f` via `git show <sha>:<path>`. The workspace tree contains post-PR work from the agent-personas project that would contaminate the review; that tree was not consulted.
**Spec input:** `projects/extension-contract-spaces/spec.md` and `projects/extension-contract-spaces/specs/framework-mechanism.spec.md` *as they stood at `ee05b2b4f`*.

## Verdict — CONCERNS

The diff lands a load-bearing typology shift (the system grows the *contract space* concept; a single contract-of-record becomes one of N peers) and the framework-level types are mostly placed correctly. Two architect-class defects are worth raising before this surface ossifies under M2/M3 consumers:

1. **Five-of-everything for `{ hash, invariants }`.** The same structural shape is declared under five different names across the diff, each named by its consumer rather than its essence. This is the single highest-leverage finding — *every* consumer that lands in M2/M3 will pick a sixth name unless the typology is reconciled here.
2. **`ContractSpace<TContract>` is a flat type that the runtime universally discriminates by id.** The spec deliberately defers the app-vs-extension partition to the control plane, but every helper in the diff has an `if (spaceId === APP_SPACE_ID)` branch and several reject the app space outright. The "control-plane concern" framing is honest but the typology hole is real and should be visible to M2 consumers, not absorbed silently.

Smaller findings follow. The `Authored*` prefix the architect lens would have flagged in earlier rounds is *not present in this diff* — F6 (the rename to `ContractSpace`) closed that out before this review window, which is itself a successful prior-round architect catch worth acknowledging.

---

## Probes fired

This section records what the architect persona's probes (`drive-agent-personas/personas/architect.md § Probes`) caught when applied to the introduced surface.

### Discriminator-completeness probe — `Authored*` / `Extension*` prefixes

The user-visible reason this E2E exists: the M1 history records F4 (`writeAuthoredMigrationPackage` → `materialiseMigrationPackage`) and F6 (`AuthoredContractSpace` → `ContractSpace`) as architect-class typology corrections that landed *before* `ee05b2b4f`. The probe was applied to the surface as it stands at `ee05b2b4f` to check that no residue survives.

**Result: the prefixes are gone in the framework-components/control surface.** The exported names are `ContractSpace`, `MigrationPackage`, `OnDiskMigrationPackage`, `materialiseMigrationPackage`, `ContractSpaceHeadRef`, `APP_SPACE_ID` — none carry an `Authored*` or `Extension*` qualifier. The JSDoc on `ContractSpace` is explicit about why: *"Whether a value is the app's space or an extension's space is a control-plane concern; the type carries no such distinction."*

A residue check found one stale comment in `test/integration/test/contract-space-fixture/control.ts` referring to *"production extensions (see project review F1)"* — the prefix-elimination has not migrated into the fixture's narrative-style header, but no symbol carries the prefix. Surface as a docs follow-up, not a typology defect.

### Discriminator-completeness probe — `OnDisk*`

`OnDiskMigrationPackage extends MigrationPackage` adds one field (`dirPath: string`) and one *implicit* invariant (the JSDoc says: *"Holding an `OnDiskMigrationPackage` value implies the loader verified the package's integrity"*).

- *Concrete*: yes — the inverse is in-memory `MigrationPackage`.
- *Singular*: **partially.** The prefix encodes two distinctions: (a) `dirPath` is present, (b) the load-time hash check has run. The two happen to coincide in *this* codebase because the only producer of `OnDiskMigrationPackage` is `readMigrationPackage` (which always verifies). They are not the same distinction. A future code path that produces a verified package without a dirPath, or a path that loads from disk without verifying, would expose the overloaded prefix.
- *Structural*: half. `dirPath` is a real field; the verified-ness is only in the JSDoc, not in the type system.
- *Stable*: yes for `dirPath`; not for verified-ness (it depends on which constructor produced the value).

**Surface as typology debt.** The prefix is doing more work than it admits. Either rename to track *just* the `dirPath` axis (e.g. `LocatedMigrationPackage`) and split out a `VerifiedMigrationPackage` brand, or downgrade the JSDoc claim so the type stops promising what its constructors don't enforce. Today the asymmetry is invisible to consumers.

### Consumer-vs-essence probe — `{ hash, invariants }` declared five times

Every type below is structurally `{ readonly hash: string; readonly invariants: readonly string[] }`:

| # | Name | Module | Consumer / framing |
|---|---|---|---|
| 1 | `ContractSpaceHeadRef` | `framework-components/src/control/control-spaces.ts` | "head ref" of a contract space |
| 2 | `PinnedSpaceHeadRef` | `migration/src/emit-pinned-space-artefacts.ts` | "pinned" head ref the emitter writes |
| 3 | `SpacePinnedHashRecord` | `migration/src/verify-contract-spaces.ts` | "pinned hash record" the verifier reads |
| 4 | `SpaceMarkerRecord` | `migration/src/verify-contract-spaces.ts` | "marker record" the verifier reads from the DB |
| 5 | `RefEntry` | `migration/src/refs.ts` | the refs module's record |

The `PinnedSpaceHeadRef` JSDoc admits the duplication explicitly: *"Mirrors `RefEntry` but is redeclared locally so callers can construct the input without depending on the refs module."* That is an honest comment about a typology choice that should not have been made.

**Probe verdict.** The essence is `(hash, invariants)` — a pair the system uses everywhere it talks about *"a contract state at rest."* The five names encode the five *consumers*: head, pinned, hash-record, marker-record, ref-entry. The architect persona's *consumer-vs-essence* probe and *symmetry* probe both fire: siblings should share parameter shapes and naming patterns. Five names for one shape is the maximum-asymmetry case.

**Why this matters now (not later).** Every M2/M3 consumer landing on top of this surface (the SQL-family wiring, the `db init`/`db update` per-space code, the cipherstash extension authoring path) will reach for a name when it accepts or returns this shape. Today the closest precedent is *"name it after my consumer."* That is how a typology hole compounds. The cost of consolidating now (introduce one canonical type, e.g. `ContractStateRef`, retire the four duplicates) is a localised rename in `migration-tools` and `framework-components`. The cost six months from now is repeated in every consumption site that inherits the local re-declaration pattern from `PinnedSpaceHeadRef`.

**Surface to principal-engineer for buildability:** consolidating these types would change the import graph for `migration-tools`. The current re-declarations exist *to keep `migration-tools` from depending on `refs.ts`*. The lens cannot say whether that decoupling is buildability-load-bearing — refer to the principal-engineer for whether the cycle is real.

### Discriminator-completeness probe — `LEGACY_MARKER_SHAPE`

The error code `LEGACY_MARKER_SHAPE` and the runner's `detectLegacyMarkerShape` introduce a `Legacy*` qualifier — the architect persona's `Avoid` list flags this as a phrase to scrutinise.

Applied:

- *Concrete*: pre-1.0 single-row marker (`id smallint primary key`) vs current per-space marker (`space text primary key`). One specific named contrast.
- *Singular*: yes. There is only one prior shape; the column-set check is *"`space` column present"* and that's the only axis.
- *Structural*: yes. The DB schema literally differs.
- *Stable*: yes. The distinction survives any consumer change.

**Probe verdict: passes.** `Legacy` is doing real typology work here. Worth noting because the persona's avoid list calls it out as an anti-signal — the "this prefix is doing typology work" outcome is the well-formed minority case.

The migration mechanism itself (fail-loud rather than auto-promote) is a buildability/operability question — surfaced to principal-engineer.

### Concept-vs-mechanism probe — *"space"* as a domain term

The project ubiquitous language is "contract space." The diff threads it through several surfaces:

- **Domain concept:** `ContractSpace<TContract>` (framework-components), the spec's first-class noun.
- **Mechanism:** the `space` column on `prisma_contract.marker`. Reads cold as a database column whose values are space identifiers.
- **Identifier:** `spaceId: string`, `APP_SPACE_ID`, `ValidSpaceId` (branded), `assertValidSpaceId`, `isValidSpaceId`, `spaceMigrationDirectory`.
- **Pluralised noun:** `loadedSpaces`, `pinnedDirsOnDisk`, `markerRowsBySpace`, `pinnedHashesBySpace`, `extensionPacks`.

The vocabulary is *mostly* coherent: a space is a contract space; it has an id; the marker has one row per space; etc. Two specific places to flag:

- The `space` column is unqualified. Reads cold, an operator opening `prisma_contract.marker` sees a column named `space` and has to infer "contract space, the kind from `extensionPacks`" rather than "PostgreSQL schema" or "memory space." A column comment, or a less-overloaded name, would help. *(Surface to devrel for adopter-learnability framing; the architect concern is just that the term is overloaded in plain SQL.)*
- `extensionPacks` (the `prisma-next.config.ts` field) is the *authoring surface* term. Inside the diff it sits next to `loadedSpaces` (verifier input), `pinnedDirsOnDisk` (filesystem inputs), `markerRowsBySpace` (DB inputs). The framing is fine — *packs* live at the user's authoring surface; *spaces* are the framework's view of what a pack contributes. Just worth recording as the canonical mapping for downstream docs.

### Symmetry probe — sibling-helper shapes

The migration-tools per-space helpers (`planAllSpaces`, `concatenateSpaceApplyInputs`, `verifyContractSpaces`, `emitPinnedSpaceArtefacts`, `detectSpaceContractDrift`, `readPinnedContractHash`, `listPinnedSpaceDirectories`) are a sibling set: each takes per-space input and produces per-space output. Symmetry findings:

- **Duplicate-id rejection: asymmetric coverage.** `planAllSpaces` and `concatenateSpaceApplyInputs` both reject duplicate `spaceId`s with `MIGRATION.DUPLICATE_SPACE_ID` before doing any work. `emitPinnedSpaceArtefacts` validates a *single* id but cannot reject duplicates because it accepts one input per call. `verifyContractSpaces` accepts a `ReadonlySet<string>` for `loadedSpaces` (which structurally cannot contain duplicates) and a `readonly string[]` for `pinnedDirsOnDisk` (which can — but the helper does not check). The symmetry is *almost* uniform; the gap is `verifyContractSpaces` not validating its dir list. Surface as a small finding.
- **Space-id validation: asymmetric coverage.** `emitPinnedSpaceArtefacts` and `readPinnedContractHash` both call `assertValidSpaceId` and reject the app-space at the type-system level. `concatenateSpaceApplyInputs` and `planAllSpaces` accept arbitrary `spaceId: string` without validation — they will happily concatenate a malformed id into the pipeline. The architect lens cannot say whether this is buildability-load-bearing — the helpers are pure and the malformed id will surface elsewhere — but the *partition* the architect cares about ("which helpers police space-id well-formedness?") is asymmetric in a way that does not reflect a real distinction. Surface as symmetry debt.

### Reads-cold probe

A fresh contributor lands on the diff with no project context. What does the surface tell them?

- **`SpacePinnedHashRecord`.** Reads as "a record of a pinned hash, presumably a single hash." Actually carries `hash` + `invariants`. **Misleading.** Either rename (`SpacePinnedHeadRecord`) or merge with the canonical `(hash, invariants)` type the consumer-vs-essence probe is asking for above.
- **`MigrationPackage` vs `OnDiskMigrationPackage`.** Reads cold, the prefix `OnDisk*` says "this one came from disk." A reader skim does not pick up the load-time hash-check invariant. Already covered above.
- **`ContractSpace<TContract>`.** Reads cold as "a contract space — a `(contract, migrations, headRef)` tuple." Accurate. The reader does *not* immediately learn that `emitPinnedSpaceArtefacts` and `readPinnedContractHash` reject the app space at runtime. Already covered under discriminator-completeness.
- **`materialiseMigrationPackage`.** Reads cold as a verb that produces an on-disk side effect. The JSDoc explicitly contrasts it with the lower-level `writeMigrationPackage` (manifest+ops only). The verb choice — *materialise* — pulls weight here: it tells the reader this is the "everything, including contract.json" form. Reads true.
- **`detectSpaceContractDrift` returning `kind: 'noDrift' | 'firstEmit' | 'drift'`.** Reads cold as a three-way classifier. The fact that `firstEmit` *also* means "no drift" (just for a different reason) is encoded in the discriminant rather than collapsed. Reads true.

---

## Bounded-context audit

### Hoist of contract-space identity to `framework-components/control`

`ContractSpace`, `MigrationPackage`, `MigrationMetadata`, `MigrationHints`, `APP_SPACE_ID` are all *framework-level* concepts in this round (the SQL family specialises `ContractSpace` to `Contract<SqlStorage>` at the descriptor surface; Mongo can mirror with `Contract<MongoStorage>` later). Placement at `framework-components/src/control/`:

- `control-spaces.ts` (new) — `ContractSpace`, `ContractSpaceHeadRef`, `MigrationPackage`, `APP_SPACE_ID`.
- `control-migration-types.ts` (existing, gains the metadata types) — `MigrationMetadata`, `MigrationHints`.

The `framework-components/control` namespace already houses control-plane-shared types — adding contract-space identity here is the right bounded context. The previous home for `MigrationMetadata` (in `migration-tools/src/metadata.ts`) was wrong: `migration-tools` is a `3-tooling/` package; the *type* is consumed by both tooling and the SQL family's runtime, so the framework layer is the correct owner. The diff converts `migration-tools/src/metadata.ts` to a one-line re-export from `framework-components/control` — that is the right shape (architect: type lives at framework, tooling re-exports for ergonomic continuity).

**Smaller layering observation.** `migration/src/space-layout.ts` re-exports `APP_SPACE_ID` (`export { APP_SPACE_ID } from '@prisma-next/framework-components/control'`). The repo rule (per `AGENTS.md`) is *"Do not reexport things from one file in another, except in the `exports/` folders."* This is a non-`exports/` re-export. The architect concern is that the convention is bypassed in service of ergonomic local imports — this should either be moved to the `exports/spaces.ts` re-export (where it already exists), or the imports inside `migration-tools` should reach directly to `framework-components/control` (one-hop import; matches the convention). Minor.

### `framework-sql` per-space marker schema lives in `2-sql/5-runtime`

`packages/2-sql/5-runtime/src/sql-marker.ts` adds the `space` column to the marker schema and the per-space write/read primitives. Layer-wise: the marker statements are SQL-specific (Postgres/SQLite share the SQL family's runtime); placement at `5-runtime/` is consistent with the existing single-row marker code lived there too. Reads true.

### Layer purity — `migration-tools` is contract-type-neutral

`migration-tools` accepts `unknown` for the canonical contract value where appropriate (`emitPinnedSpaceArtefacts.contract: unknown`) and is generic over `TContract`/`TPackage` where appropriate (`planAllSpaces`). The JSDoc explicitly notes *"Typed as `unknown` rather than the SQL-family `Contract<SqlStorage>` to keep `migration-tools` framework-neutral."* That is the bounded-context rule applied correctly: `1-framework/3-tooling/` cannot reach into `2-sql/`. The Mongo extensibility argument the spec makes lands in actual code shape here; the architect lens approves.

---

## Findings (architect-lens)

Findings get unique IDs in this artefact's local sequence (separate from `code-review.md`'s).

### A01. Five-of-everything for `{ hash, invariants }`

**Severity:** elevated — typology debt that will compound at every M2/M3 consumption site.
**Locations:**
- `packages/1-framework/1-core/framework-components/src/control/control-spaces.ts` — `ContractSpaceHeadRef`
- `packages/1-framework/3-tooling/migration/src/emit-pinned-space-artefacts.ts` — `PinnedSpaceHeadRef`
- `packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts` — `SpacePinnedHashRecord`, `SpaceMarkerRecord`
- `packages/1-framework/3-tooling/migration/src/refs.ts` — `RefEntry`

**Issue:** five structurally-identical declarations of `{ readonly hash: string; readonly invariants: readonly string[] }`, each named for the consumer that wrote it. The `PinnedSpaceHeadRef` JSDoc admits the duplication out loud.

**Suggestion:** consolidate to one canonical type — `ContractStateRef` (essence: a `(hash, invariants)` reference to a contract state) — exported from `framework-components/control` next to `ContractSpaceHeadRef` (or, more consolidating, as `ContractSpaceHeadRef`'s replacement). Retire the four duplicates; replace consumer-side declarations with imports. The `PinnedSpaceHeadRef.invariants`-pre-sort behaviour is documented on the *helper*, not on the *type* — sorting is the helper's job, not the type's, so consolidation does not lose semantics.

**Refer to principal-engineer:** the `migration-tools/refs.ts → framework-components/control` import direction needs a buildability check before consolidation lands. The architect lens cannot say whether the import is layering-clean.

### A02. `ContractSpace<TContract>` is a flat type the runtime universally discriminates by id

**Severity:** medium — recoverable later, but the lie compounds with each consumer.
**Locations:**
- `packages/1-framework/1-core/framework-components/src/control/control-spaces.ts` — `ContractSpace<TContract>`
- `packages/1-framework/3-tooling/migration/src/emit-pinned-space-artefacts.ts` — branches on `spaceId === APP_SPACE_ID` to throw
- `packages/1-framework/3-tooling/migration/src/read-pinned-contract-hash.ts` — same branch, same throw
- `packages/1-framework/3-tooling/migration/src/concatenate-space-apply-inputs.ts` — branches on `spaceId === APP_SPACE_ID` to put it last
- `packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts` — branches on `spaceId === APP_SPACE_ID` to skip
- `packages/1-framework/3-tooling/migration/src/space-layout.ts` — branches on `spaceId === APP_SPACE_ID` to return the parent dir

**Issue:** the spec settles "app vs extension is a control-plane concern, not a structural one" — but every helper in the diff carries an `if (spaceId === APP_SPACE_ID)` branch, and two helpers reject the app space outright. The flat `ContractSpace<TContract>` type plus a string id captures the structure; the *runtime guards* are six independent re-encodings of the partition.

**Suggestion:** the architect lens names two viable resolutions; the principal-engineer should decide which is buildability-acceptable.

1. **Keep flat, document the discriminator.** Promote `APP_SPACE_ID` to a literal string-union member and add a sibling brand for extension-space ids. Move the "this helper rejects the app space" check from runtime throw to a `extension space id` parameter type (`Exclude<ValidSpaceId, typeof APP_SPACE_ID>` or similar). Cost: most helpers gain a more specific parameter type; consumers that today pass `string` learn the partition at compile time.
2. **Lean into the partition.** Split `ContractSpace<TContract>` into `AppContractSpace<TContract>` and `ExtensionContractSpace<TContract>`. Cost: re-introduces the `Authored*`-flavoured prefix family the F6 round just retired — the discriminator-completeness probe would fire on the new prefixes (what does `ExtensionContractSpace` distinguish from? The app's. Concrete, singular, structural — but the *type system* would carry the partition the spec explicitly punted to the control plane).

**Architect's leaning:** option (1). The spec's "control-plane concern" framing is honest, but it amounts to "we have not encoded the partition we keep enforcing." Encoding it in the type system *is* the control plane. Today's flat shape passes the spec's literal claim while every consumer of the diff has to encode the partition independently — and they will, with five different framings, the way `(hash, invariants)` did.

### A03. `OnDiskMigrationPackage` overloads two distinctions onto one prefix

**Severity:** low — single prefix, single producer today; debt rather than defect.
**Location:** `packages/1-framework/3-tooling/migration/src/package.ts`

**Issue:** `OnDiskMigrationPackage extends MigrationPackage` adds `dirPath: string` (structural) *and* implies hash-verified-on-load (per the JSDoc — *"Holding an `OnDiskMigrationPackage` value implies the loader verified the package's integrity"*). Today the two coincide because `readMigrationPackage` is the only producer and always verifies. They are not the same axis.

**Suggestion:** either (a) downgrade the JSDoc claim to "this type carries `dirPath`; integrity verification is a property of the loader, not the type," or (b) split out a `VerifiedMigrationPackage` brand and have the loader return `OnDisk & Verified`. Option (a) is the cheaper fix and matches the structural reality.

### A04. `SpacePinnedHashRecord` reads cold as "just a hash"

**Severity:** low — naming defect that subsumes into A01 if the consolidation lands.
**Location:** `packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts`

**Issue:** `SpacePinnedHashRecord` carries `{ hash, invariants }`. The name says "hash record." Reads-cold probe fails: a fresh contributor expects a single-string-payload type.

**Suggestion:** if A01 lands (consolidate to `ContractStateRef`), this disappears. If not, rename to `SpacePinnedHeadRecord` to align with the `head ref` framing the spec already uses.

### A05. `space-layout.ts` re-exports `APP_SPACE_ID` outside `exports/`

**Severity:** trivial.
**Location:** `packages/1-framework/3-tooling/migration/src/space-layout.ts:5`

**Issue:** convention (per `AGENTS.md` Golden Rules: *"Do not reexport things from one file in another, except in the `exports/` folders"*) violated for the ergonomic local re-export of `APP_SPACE_ID`.

**Suggestion:** import directly from `@prisma-next/framework-components/control` in the small number of in-`migration-tools` modules that need it. The `exports/spaces.ts` re-export is fine; the in-`src/` re-export is not.

### A06. Stale fixture comment references a renamed concern

**Severity:** trivial.
**Location:** `test/integration/test/contract-space-fixture/control.ts` (header JSDoc)

**Issue:** the header explains the fixture's location with a reference to *"production extensions (see project review F1)"* — but F1 is closed and the architectural reasoning is now part of the M1-cleanup history, not "production extensions." Reads cold as a forward reference into an open question.

**Suggestion:** rewrite the header to state the durable rationale (the fixture is a non-package fixture under `integration-tests/` because it has no external consumers and the package shape is incidental), without the F1 reference.

### A07. Asymmetric space-id validation across sibling helpers

**Severity:** low — surface symmetry debt.
**Locations:**
- `packages/1-framework/3-tooling/migration/src/emit-pinned-space-artefacts.ts` — calls `assertValidSpaceId`
- `packages/1-framework/3-tooling/migration/src/read-pinned-contract-hash.ts` — calls `assertValidSpaceId`
- `packages/1-framework/3-tooling/migration/src/concatenate-space-apply-inputs.ts` — accepts any `string`
- `packages/1-framework/3-tooling/migration/src/plan-all-spaces.ts` — accepts any `string`
- `packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts` — accepts `ReadonlySet<string>` (no validation)

**Issue:** sibling helpers in the same family validate ids unevenly. The architect lens cannot adjudicate whether validation belongs at every entry — that is a buildability/operability question the principal-engineer should weigh — but the pattern *as it stands* is asymmetric without a stated reason.

**Suggestion:** decide, family-wide, where the boundary check lives (entry of every helper, or once at descriptor-load time) and apply uniformly. Document the choice in the migration-tools README so future helpers inherit the convention.

---

## What looks structurally solid

- **F4/F6 corrections are present at `ee05b2b4f`.** The earlier-round architect catches (`AuthoredContractSpace` → `ContractSpace`, `writeAuthoredMigrationPackage` → `materialiseMigrationPackage`) shipped clean. No symbol residue. The architect-lens-loaded run on this surface in this E2E *did not* re-rediscover those two — the claim that the prior architect-pass closed them stands up under fresh-eyes scrutiny.
- **The framework-components/control hoist** of `ContractSpace`, `MigrationPackage`, `MigrationMetadata`, `MigrationHints`, `APP_SPACE_ID` is in the right bounded context. Layer purity holds — `migration-tools` is contract-type-neutral, `framework-components` carries the cross-target identity types.
- **`materialiseMigrationPackage`'s verb** is well-chosen — the JSDoc's contrast with the lower-level `writeMigrationPackage` reads true; the reader can pick the right helper from name alone.
- **`detectSpaceContractDrift`'s `firstEmit` discriminant** keeps the "no drift" rationale explicit instead of collapsing it into `noDrift`. Reads cold true.
- **`ValidSpaceId` brand** plus `assertValidSpaceId` is the right shape: validated-vs-unvalidated tracked at the type level, validation localised to one regex.
- **Layer placement of the `LEGACY_MARKER_SHAPE` check** at the per-target runner is correct — the architect lens approves of *where* (target's runtime, not framework). The *mechanism* (fail-loud rather than auto-promote) is a buildability/operability question — surfaced to principal-engineer.

---

## Out of scope (referred to other personas)

- **`detectLegacyMarkerShape` fail-loud-vs-auto-promote choice.** Operability and blast-radius question — refer to principal-engineer. The architect lens approves of the *placement* (per-target runner) and the *prefix* (`Legacy*` passes the discriminator probe). Whether fail-loud is the right user-facing semantic, and whether the remediation hint ("drop the marker table and re-run dbInit") is honest about data-loss implications, is the principal-engineer's call.
- **Drift detection's non-fatal-warning semantic.** Operability question — refer to principal-engineer. The architect lens approves of the type-level `kind: 'noDrift' | 'firstEmit' | 'drift'` partition.
- **Adopter-learnability of the marker `space` column name.** The column `space` is not self-explaining when an operator opens `prisma_contract.marker` in `psql`. Refer to devrel for fresh-reader friction once a devrel persona/skill is admitted.
- **AC verification across AM1–AM11 + the project spec's AC1–AC16.** That is the principal-engineer's lens (per `review-implementation/SKILL.md § Acceptance-criteria verification`). See `code-review.md`.
- **Walkthrough at the right altitude** for a human operator touring the diff. That is the tech-lead's lens. See `walkthrough.md`.

---

## Methodology

- **Source-pinning.** Every spec read, every source read, every diff read pinned to `ee05b2b4f` via `git show ee05b2b4f:<path>` or `git diff origin/main..ee05b2b4f -- <path>`. The workspace-tree versions of `projects/extension-contract-spaces/**` were not consulted (they contain post-PR work from the agent-personas project that would contaminate this review).
- **Probes applied.** Discriminator-completeness, consumer-vs-essence, concept-vs-mechanism, symmetry, reads-cold — fired explicitly on every introduced name, prefix, namespace, or grouping in the diff. Findings track which probe surfaced each defect.
- **Personas.** Architect persona loaded at the start of this artefact. The architect persona's `## Out of scope for this lens` was honoured — implementation correctness, failure modes, blast radius, AC verification, adopter-learnability, scope, and tech-lead orchestration are referred to the appropriate persona's artefact, not adjudicated here.
- **Probes not loaded into reasoning before this section.** The persona was loaded fresh at the start of this artefact's production; not pre-loaded into background reasoning before § 1 of the composite resolved scope.
