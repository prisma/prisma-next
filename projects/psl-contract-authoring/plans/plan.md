# PSL Contract Authoring — Project Plan

## Summary

Deliver a PSL-first contract authoring path for Prisma Next: users point `prisma-next.config.ts` at a Prisma schema file and run `prisma-next contract emit` to produce `contract.json` and `contract.d.ts`. We’ll do this by adding a reusable PSL parser package, normalizing PSL into the same contract IR as the TS authoring surface, and proving parity/determinism with a conformance test set.

**Spec:** `projects/psl-contract-authoring/spec.md`

## Collaborators


| Role     | Person/Team                                | Context                                               |
| -------- | ------------------------------------------ | ----------------------------------------------------- |
| Maker    | Contract authoring owner                   | Drives execution                                      |
| Reviewer | Framework/tooling reviewer (TBD)           | Review config + emission pipeline integration         |
| Reviewer | SQL contract authoring surface owner (TBD) | Review IR parity constraints and conformance fixtures |


## Milestones

### Milestone 1: Pluggable contract sources (provider API)

Make contract authoring sources pluggable by design. Instead of enumerating source “kinds” in framework config, accept a source provider that returns `ContractIR` (via `Result<>`). The framework remains responsible for validation, normalization, canonicalization/hashing, and artifact emission.

**Spec:** `projects/psl-contract-authoring/specs/Milestone 1 - Pluggable contract sources.spec.md`
**Execution Plan:** `projects/psl-contract-authoring/plans/pluggable-contract-sources-plan.md`

**Tasks:**

- Define a `ContractSourceProvider` interface that produces `Promise<Result<ContractIR, Diagnostics>>` (always async), with diagnostics suitable for CLI/editor rendering.
- Update config typing + validation to accept providers (commit to provider-only; remove enumerated source “kind” union from the intended end-state).
- Update `contract emit` to call the provider to obtain IR, then run framework-owned validation + normalization + canonicalization/hashing + emission (source-agnostic).
- Ensure canonical artifacts do not include source locations/IDs (paths/sourceIds are diagnostics-only).
- Add CLI/integration tests covering:
  - TS-first provider emits `contract.json` + `contract.d.ts`
  - PSL-first provider emits `contract.json` + `contract.d.ts`
  - No source-specific branching is required in the CLI/control plane
  - E2E conformance/parity coverage for provider-based emission boundaries

### Addendum 1.1 (Optional): Split up overloaded core migration/control-plane package (TML-2018)

This is an internal maintainability slice: `packages/1-framework/1-core/migration/control-plane` currently hosts both migration-plane domain concerns and config typing/validation used by `prisma-next.config.ts`. The goal is to split out **at least** one focused core package for config types + validation so the provider-based authoring work can evolve without dragging migration-plane dependencies along.

**Spec:** `projects/psl-contract-authoring/specs/optional-split-up-1-core-migration.spec.md`

**Tasks (proposed):**

- Introduce a dedicated package for config types + validation (including `PrismaNextConfig`, `ContractConfig`, `defineConfig()`, `validateConfig()`, and `ContractSourceProvider` + diagnostics types).
- Update CLI config loading and downstream authoring helpers (e.g. `@prisma-next/contract-ts`) to depend on the new package.
- Keep the remainder of `@prisma-next/core-control-plane` focused on domain actions (verify/migrations/etc) and remove the moved symbols.
- Add/adjust tests to ensure there is **no behavior change** in config validation and `contract emit` continues to work.

### Milestone 2: Reusable PSL parser package (`@prisma-next/psl-parser`)

Implement a reusable PSL parser library that can be consumed by emit tooling and other tools (language tooling, external tooling), and that retains source spans for diagnostics.

**Spec:** `projects/psl-contract-authoring/specs/Milestone 2 - PSL parser.spec.md`

**Tasks:**

- Implement a parser API in `packages/1-framework/2-authoring/psl-parser`:
  - Parse a PSL file (string + file path) into an AST with source spans
  - Produce structured, stable diagnostics (error code + span + message)
- Support v1 PSL constructs needed for conformance:
  - models, scalar fields, optional/required, enums
  - attributes: `@id`, `@unique`, `@@unique`, `@@index`
  - relations: `@relation(fields, references)` + referential actions (same set as TS authoring surface)
  - defaults: `autoincrement()`, `now()`, literal defaults (where supported)
  - `types { ... }` block for named type instances (declarations + references)
- Add unit tests for:
  - parsing success on representative schemas
  - failure diagnostics include correct spans
  - strict errors for unsupported constructs (no warnings)

### Addendum 2.1: Red-green syntax tree

- Evaluate a lossless red/green syntax tree approach (rowan-style) for language tooling: define the round-trip invariant (`print(parse(psl))` equals the original PSL byte-for-byte) and decide how invalid/out-of-place tokens are preserved (e.g. kept in the green tree or represented as explicit `invalid` nodes). Record the decision + follow-up work (don’t block the current parser milestone on this).

### Milestone 3: Fixture-driven parity harness

Build the fixture-driven parity harness and expand coverage across the **already-supported PSL surface**, without adding new interpretation behavior yet. In the same milestone, produce an explicit inventory of TS-authoring behaviors that PSL cannot yet express (to guide the next milestone slices).

**Spec:** `projects/psl-contract-authoring/specs/Milestone 3 - Fixture-driven parity harness.spec.md`
**Execution Plan:** `projects/psl-contract-authoring/plans/Milestone 3 - Fixture-driven parity harness-plan.md`

**Tasks:**

- Build a parity test harness that is **fixture-driven** (data-driven): adding a new case is adding a new directory on disk containing:
  - a PSL schema fixture
  - an equivalent TS contract authoring fixture
  - a pack composition fixture shared by both sides (so extension namespaces are config-owned)
  - an expected canonical `contract.json` snapshot file
  - (proposal) root at `test/integration/test/authoring/parity/<case>/`
- Expand fixtures to cover the PSL features we already support today (no new behavior), including:
  - models + scalar fields + optional/required
  - `@id`, `@unique`, `@@unique`, `@@index`
  - enums + enum columns
  - defaults: `autoincrement()`, `now()`, literal defaults
  - relations via `@relation(fields, references)` + referential actions
  - named types **without** attributes (current behavior)
- Assert parity at the same boundaries the system cares about:
  - normalized Contract IR parity (primary debugging boundary)
  - emitted canonical `contract.json` parity + stable hashes for equivalent intent
- Add determinism tests:
  - emit twice yields byte-equivalent artifacts (or equivalently canonical JSON string equality)
- Add diagnostics tests:
  - invalid/unsupported PSL produces actionable errors with file+span and targeted error codes
- Produce and record an explicit gap inventory (TS surface gaps + Prisma PSL surface gaps) to guide Milestones 4–5.
  - See `projects/psl-contract-authoring/references/authoring-surface-gap-inventory.md`

### Milestone 4: Parameterized attributes and first extension-pack parity (pgvector)

Add the first meaningful new behavior that closes a TS↔PSL gap: support for **parameterized attributes** in PSL interpretation, with a minimum implementation that proves pgvector column typing parity.

**Spec:** `projects/psl-contract-authoring/specs/Milestone 4 - Parameterized attributes and pgvector parity.spec.md`
**Execution Plan:** `projects/psl-contract-authoring/plans/Milestone 4 - Parameterized attributes and pgvector parity-plan.md`

**Tasks:**

- Add representative mapping/naming support:
  - `@@map("...")` for models (table naming)
  - `@map("...")` for fields (column naming)
- Extend the PSL parsing + AST or interpretation pipeline to carry “raw” attribute tokens (including argument strings) without hard-coding every attribute at the parser layer.
- Add PSL interpretation support for parameterized attributes on:
  - fields, and
  - named type instances in `types { ... }` (ergonomic upgrade; reads like parameterized types without new type-expression grammar)
- Minimum supported capability: **pgvector vector column typing** parity with TS.
  - Add at least one parity fixture that proves canonical `contract.json` + hash equality between:
    - PSL: `@pgvector.column(length: 1536)` (preferably via a named type in `types { ... }`)
    - TS: `vector(1536)` / `vectorColumn` via the pgvector pack surface
- In the same thematic area, enumerate and plan follow-on parameterized native types to close TS parity gaps (Postgres adapter examples):
  - `charColumn(length)`
  - `varcharColumn(length)`
  - `numericColumn(precision, scale?)`
  - `timeColumn(precision?)`, `timetzColumn(precision?)`, `intervalColumn(precision?)`
  - `bitColumn(length)`, `varbitColumn(length)`
  - typed `json/jsonb(schema)` (Standard Schema parameterization)

**Advice on a possible Milestone 5 (likely needed):**

If the goal is “close to parity with TS authoring”, a third slice is likely warranted after pgvector:

- **Core storage mapping parity**: table/column mapping controls (model/table naming; column naming) and richer constraint/index options (names, FK flags) where TS already supports them.
- **Default function surface parity**: support for additional default functions beyond `autoincrement()` and `now()` where TS already emits them.

### Milestone 5: ID variants and default function parity (TS-aligned)

Add PSL support for the ID-related default functions and variants that already exist in the TypeScript authoring surface (and are part of the “representative PSL” story), without expanding into Prisma-connector-specific behavior.

**Spec:** `projects/psl-contract-authoring/specs/Milestone 5 - ID variants and default function parity.spec.md`

**Tasks:**

- Support TS-aligned default function vocabulary for IDs (and other fields where applicable), including:
  - `uuid()` (and any TS-supported variants)
  - `cuid(2)` (cuid v2)
  - `ulid()`
  - `nanoid()`
  - `dbgenerated("...")` (where TS authoring already emits it)
- Add fixture-driven parity cases for each supported default function, asserting canonical `contract.json` + stable hashes vs TS fixtures.
- Keep Mongo-only ID semantics (for example `@db.ObjectId` + `auto()`) out of scope for this project slice.

### Milestone 7: PSL sql template literal syntax (follow-up)

Introduce a PSL grammar extension for inline SQL literals using backticks (`sql\`...\``), with **no interpolation** and **single-line only** constraints, starting with storage defaults and designed to extend to future SQL embedding surfaces (views, special indexes).

**Spec:** `projects/psl-contract-authoring/specs/Milestone 7 - PSL sql template literal syntax.spec.md`
**ADR (proposed):** `projects/psl-contract-authoring/references/ADR - PSL sql template literals.md`

### Milestone 6: Close-out (required)

Finalize long-lived docs and remove transient project artifacts.

**Spec:** `projects/psl-contract-authoring/specs/Milestone 6 - Close-out.spec.md`

**Tasks:**

- Verify all acceptance criteria in `projects/psl-contract-authoring/spec.md` are met (link to tests / manual checks).
- Migrate any long-lived docs/notes into `docs/` (if new docs were created under `projects/`).
- Delete `projects/psl-contract-authoring/`.

## Test Coverage


| Acceptance Criterion                                                               | Test Type          | Task/Milestone      | Notes                                    |
| ---------------------------------------------------------------------------------- | ------------------ | ------------------- | ---------------------------------------- |
| PSL-first `contract emit` emits `contract.json` + `contract.d.ts`                  | Integration/E2E    | Milestone 1 + 4     | Use CLI test fixtures                    |
| TS-first `contract emit` still works                                               | Integration/E2E    | Milestone 1         | Guard against regressions                |
| Emit twice with unchanged inputs produces equivalent outputs                       | Integration        | Milestone 3         | Determinism harness                      |
| Invalid PSL yields helpful diagnostic with source location                         | Unit + Integration | Milestone 2 + 3     | Parser spans + CLI surface               |
| PSL/TS conformance set yields equivalent canonical `contract.json` + stable hashes | Unit/Integration   | Milestone 3 + 4 + 5 | Harness, then pgvector, then ID defaults |
| Unsupported PSL constructs are documented and fail strictly                        | Docs + Unit        | Milestone 2 + 3     | “Simple, not perfect” v1 boundary        |
| Docs explain config selection + command usage + artifact locations + errors        | Docs               | Milestone 3 + 4     | Link from relevant READMEs               |
| Tests cover success/failure/determinism/parity                                     | Unit/Integration   | Milestone 2 + 3     | Explicit suites for each area            |


## Open Items

- Confirm the exact TS-authoring-supported referential action set used for PSL normalization (enforce identical mapping).
- Define the precise mapping for `types { ... }` entries to codec/native/typeParams so it matches the existing SQL authoring surface expectations.
- Update ADR 104 to reflect the current composition model: packs are composed/pinned in `prisma-next.config.ts` (no PSL `extensions { ... }` version pinning block), while the emitted contract still records pack versions.
- Include pgvector in the Milestone 4 conformance set: add at least one fixture that proves PSL `@pgvector.`* parity with TS pgvector column typing.

