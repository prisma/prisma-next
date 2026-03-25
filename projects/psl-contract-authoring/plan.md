# PSL Contract Authoring — Project Plan

## Summary

Deliver a PSL-first contract authoring path for Prisma Next: users point `prisma-next.config.ts` at a Prisma schema file and run `prisma-next contract emit` to produce `contract.json` and `contract.d.ts`. We’ll do this by adding a reusable PSL parser package, normalizing PSL into the same contract IR as the TS authoring surface, and proving parity/determinism with a fixture-driven conformance set.

**Spec:** `projects/psl-contract-authoring/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Contract authoring owner | Drives execution |
| Reviewer | Framework/tooling reviewer (TBD) | Review config + emission pipeline integration |
| Reviewer | SQL contract authoring surface owner (TBD) | Review IR parity constraints and conformance fixtures |

## Milestones

### Milestone 1: Pluggable contract sources (provider API)

Make contract authoring sources pluggable by design. Instead of enumerating source “kinds” in framework config, accept a source provider that returns `ContractIR` (via `Result<>`). The framework remains responsible for validation, normalization, canonicalization/hashing, and artifact emission.

**Spec:** `projects/psl-contract-authoring/specs/Milestone 1 - Pluggable contract sources.spec.md`  
**Execution Plan:** `projects/psl-contract-authoring/plans/pluggable-contract-sources-plan.md`

**Tasks:**

- [ ] Define a `ContractSourceProvider` interface that produces `Promise<Result<ContractIR, Diagnostics>>` (always async), with diagnostics suitable for CLI/editor rendering.
- [ ] Update config typing + validation to accept providers (commit to provider-only; remove enumerated source “kind” union from the intended end-state).
- [ ] Update `contract emit` to call the provider to obtain IR, then run framework-owned validation + normalization + canonicalization/hashing + emission (source-agnostic).
- [ ] Ensure canonical artifacts do not include source locations/IDs (paths/sourceIds are diagnostics-only).
- [ ] Add CLI/integration tests covering:
  - TS-first provider emits `contract.json` + `contract.d.ts`
  - PSL-first provider emits `contract.json` + `contract.d.ts`
  - No source-specific branching is required in the CLI/control plane

### Milestone 2: Reusable PSL parser package (`@prisma-next/psl-parser`)

Implement a reusable PSL parser library that can be consumed by emit tooling and other tools (language tooling, external tooling), and that retains source spans for diagnostics.

**Spec:** `projects/psl-contract-authoring/specs/Milestone 2 - PSL parser.spec.md`  
**Execution Plan:** `projects/psl-contract-authoring/plans/contract-psl-parser-plan.md`

**Tasks:**

- [ ] Implement a parser API in `packages/1-framework/2-authoring/psl-parser` producing AST + spans.
- [ ] Produce structured, stable diagnostics (error code + span + message) suitable for CLI/editor.
- [ ] Support v1 constructs needed for conformance (models/scalars/enums/attributes/relations/defaults/`types { ... }`).
- [ ] Add unit tests for parsing + span correctness + strict errors for unsupported constructs.
- [ ] Evaluate a lossless red/green syntax tree approach for language tooling; record decision and follow-ups (don’t block v1).

### Milestone 3: Fixture-driven parity harness

Build the fixture-driven parity harness and expand coverage across the already-supported PSL surface, without adding new interpretation behavior yet.

**Spec:** `projects/psl-contract-authoring/specs/Milestone 3 - Fixture-driven parity harness.spec.md`  
**Execution Plan:** `projects/psl-contract-authoring/plans/Milestone 3 - Fixture-driven parity harness-plan.md`

**Tasks:**

- [ ] Create fixture-driven parity harness (PSL + TS + expected canonical `contract.json` snapshot).
- [ ] Expand fixtures to cover supported PSL features (models/scalars/attributes/enums/defaults/relations/named types).
- [ ] Assert parity at normalized Contract IR boundary and emitted `contract.json` + stable hashes.
- [ ] Add determinism tests (emit twice yields equivalent artifacts).
- [ ] Add diagnostics tests for invalid/unsupported PSL (span + stable codes).
- [ ] Record and maintain a TS↔PSL gap inventory to guide follow-up milestones.

### Milestone 4: Parameterized attributes and first extension-pack parity (pgvector)

Close a TS↔PSL gap by supporting parameterized attributes in PSL interpretation, with an MVP proving pgvector column typing parity.

**Spec:** `projects/psl-contract-authoring/specs/Milestone 4 - Parameterized attributes and pgvector parity.spec.md`  
**Execution Plan:** `projects/psl-contract-authoring/plans/Milestone 4 - Parameterized attributes and pgvector parity-plan.md`

**Tasks:**

- [ ] Add mapping support: `@@map("...")` and `@map("...")`.
- [ ] Extend parsing/interpretation pipeline to carry raw attribute tokens/args without hardcoding all attributes in the parser.
- [ ] Support parameterized attributes on fields and named types in `types { ... }`.
- [ ] Prove pgvector parity via at least one fixture (PSL ↔ TS) with canonical `contract.json` + hash equality.

### Milestone 5: ID variants and default function parity (TS-aligned)

Add PSL support for the TS-aligned ID default function vocabulary (uuid/cuid2/ulid/nanoid/dbgenerated) and prove parity via fixtures.

**Spec:** `projects/psl-contract-authoring/specs/Milestone 5 - ID variants and default function parity.spec.md`

**Tasks:**

- [ ] Support TS-aligned default functions: `uuid()`, `cuid(2)`, `ulid()`, `nanoid()`, `dbgenerated("...")`.
- [ ] Add parity fixtures for each supported function (canonical `contract.json` + stable hashes vs TS fixtures).
- [ ] Reject unsupported defaults with actionable diagnostics.

### Milestone 6: Follow-up — Declared applicability + pack-provided mutation default registry

Make mutation default generator compatibility deterministic without type-theory inference by adopting **declared applicability**, and make both lowering vocabulary and runtime generator implementations composable from framework components.

**Spec:** `projects/psl-contract-authoring/specs/Follow-up - Pack-provided mutation default functions registry.spec.md`  
**Execution Plan:** `projects/psl-contract-authoring/plans/Follow-up - Pack-provided mutation default functions registry-plan.md`  
**ADR:** `docs/architecture docs/adrs/ADR 169 - Declared applicability for mutation default generators.md`

**Tasks:**

- [ ] Define contribution interfaces for (a) default-function lowering handlers and (b) runtime generator implementations.
- [ ] Define/implement applicability declaration (“supported column shapes”) and deterministic precedence/collision rules.
- [ ] Assemble registries from composed target/adapter/extension packs.
- [ ] Update authoring (PSL initially) to consume the assembled lowering registry (no provider hardcoding).
- [ ] Update runtime to resolve mutation default generator ids via composed registry (baseline: `@prisma-next/ids`).
- [ ] Add integration tests proving pack-provided generators/defaults work end-to-end and diagnostics remain stable.

### Milestone 6.1: Follow-up — Move ID generator implementations to composition (thin core, fat interfaces)

Remove “built-in” ID generator implementations and privileged vocabularies from low layers. Registries/strategy shapes remain in low layers; concrete implementations (and generator-owned metadata like applicability + generated-column typing) are provided only by composed components (targets/adapters/extension packs).

**Spec:** `projects/psl-contract-authoring/specs/follow-up-move-id-generators-to-composition.spec.md`

**Tasks:**

- [ ] Move ID generator algorithm implementations out of framework authoring layers and into a composed component (preferably an extension pack).
- [ ] Remove low-layer exports that encode privileged “built-in” generator vocabularies (id unions / id lists).
- [ ] Ensure TS authoring convenience helpers (if retained) do not require shipping concrete implementations in low layers.
- [ ] Update fixtures/tests to prove generator ids exist only when the corresponding component is composed.

### Milestone 6.2: Follow-up — Pack-provided type constructors and field presets

Introduce composed registries of **type constructors** (parameterized types like `Uuid(7)` or `Vector(1536)` that bundle column type + mutation default + constraints) and **field presets** (fully configured field templates like `CreatedAt` or `UpdatedAt`). These registries are pack-provided and surface-agnostic: PSL and TS authoring both project them into their own syntax.

**ADR:** `docs/architecture docs/adrs/ADR 170 - Pack-provided type constructors and field presets.md`

**Tasks:**

- [ ] Define shared type constructor and field preset descriptor interfaces in `sql-core/contract`.
- [ ] Define registry assembly rules (duplicate detection, precedence, dot-namespacing for extension packs).
- [ ] Implement type constructor interpretation in PSL (e.g. `id Uuid(7) @id` → column type + mutation default).
- [ ] Implement field preset interpretation in PSL (e.g. `createdAt CreatedAt` → typed column + `now()` default).
- [ ] Expose type constructors and field presets in TS authoring surface (e.g. `col.uuid({ version: 7 })` or `.default((d) => d.uuid(7))`).
- [ ] Add parity fixtures: PSL and TS authoring produce the same contract output for type constructors and presets.
- [ ] Add diagnostics for unknown type constructors and invalid parameters.

### Milestone 7: PSL sql template literal syntax (follow-up)

Introduce PSL grammar support for inline SQL literals via backticks (`sql\`...\``), designed for tooling highlighting and future SQL embedding surfaces.

**Spec:** `projects/psl-contract-authoring/specs/Milestone 7 - PSL sql template literal syntax.spec.md`

### Milestone 8: Relation navigation list fields + `contract.relations` lowering (follow-up)

Accept relation navigation list fields (e.g. `Post[]` backrelations) while continuing to strictly reject scalar lists, and emit stable `contract.relations` entries for both sides of relations.

**Spec:** _TBD (create follow-up spec when starting this slice)_  
**Source requirement:** `projects/psl-contract-authoring/spec.md` (“Planned follow-up requirement: relation navigation lists + consistent `contract.relations`”)

### Milestone 9: Close-out (required)

Finalize long-lived docs and remove transient project artifacts.

**Spec:** `projects/psl-contract-authoring/specs/Milestone 6 - Close-out.spec.md`

**Tasks:**

- [ ] Verify all acceptance criteria in `projects/psl-contract-authoring/spec.md` are met (link to tests / manual checks).
- [ ] Migrate any long-lived docs/notes into `docs/`.
- [ ] Strip repo-wide references to `projects/psl-contract-authoring/**`.
- [ ] Delete `projects/psl-contract-authoring/`.

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| PSL-first `contract emit` emits `contract.json` + `contract.d.ts` | Integration/E2E | Milestone 1 + 4 | CLI fixtures |
| TS-first `contract emit` still works | Integration/E2E | Milestone 1 | Regression guard |
| Emit twice yields equivalent outputs | Integration | Milestone 3 | Determinism harness |
| Invalid PSL yields helpful span-based diagnostic | Unit + Integration | Milestone 2 + 3 | Parser spans + CLI surface |
| PSL/TS conformance set yields equivalent canonical `contract.json` + stable hashes | Integration | Milestone 3 + 4 + 5 | Harness + pgvector + default functions |
| Unsupported PSL constructs fail strictly and are documented | Unit + Docs | Milestone 2 + 3 | “Simple, not perfect” boundary |
| Docs explain config selection + command usage + artifact locations + errors | Docs | Milestone 3 + 4 | Link from relevant READMEs |

## Open Items

- Confirm the exact TS-authoring-supported referential action set used for PSL normalization (enforce identical mapping).
- Define the precise mapping for `types { ... }` entries to codec/native/typeParams so it matches the existing SQL authoring surface expectations.
- Keep ADR 104 aligned with the current composition model (packs composed in `prisma-next.config.ts`).

