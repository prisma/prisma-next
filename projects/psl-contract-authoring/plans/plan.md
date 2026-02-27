# PSL Contract Authoring — Project Plan

## Summary

Deliver a PSL-first contract authoring path for Prisma Next: users point `prisma-next.config.ts` at a Prisma schema file and run `prisma-next contract emit` to produce `contract.json` and `contract.d.ts`. We’ll do this by adding a reusable PSL parser package, normalizing PSL into the same contract IR as the TS authoring surface, and proving parity/determinism with a conformance test set.

**Spec:** `projects/psl-contract-authoring/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Contract authoring owner | Drives execution |
| Reviewer | Framework/tooling reviewer (TBD) | Review config + emission pipeline integration |
| Reviewer | SQL contract authoring surface owner (TBD) | Review IR parity constraints and conformance fixtures |

## Milestones

### Milestone 1: Config + CLI support for PSL source

Make it possible for a project to select PSL-first in `prisma-next.config.ts` (discriminated union shape) and route `prisma-next contract emit` through the existing emission pipeline without breaking TS-first.

**Tasks:**

- [ ] Extend `PrismaNextConfig.contract.source` to accept a PSL-first config value `{ kind: 'psl', schemaPath: string }` (schemaPath required).
- [ ] Implement config validation errors for missing/invalid `schemaPath`.
- [ ] Ensure TS-first `contract.source` behavior remains unchanged (value or loader function).
- [ ] Wire `contract emit` to resolve PSL-first source into a family-compatible contract IR input (no DB connection).
- [ ] Add CLI/integration tests covering:
  - PSL-first config shape is accepted
  - TS-first config continues to work

### Milestone 2: Reusable PSL parser package (`@prisma-next/contract-psl`)

Implement a reusable PSL parser library that can be consumed by emit tooling and other tools (language tooling, external tooling), and that retains source spans for diagnostics.

**Tasks:**

- [ ] Implement a parser API in `packages/1-framework/2-authoring/contract-psl`:
  - Parse a PSL file (string + file path) into an AST with source spans
  - Produce structured, stable diagnostics (error code + span + message)
- [ ] Support v1 PSL constructs needed for conformance:
  - models, scalar fields, optional/required, enums
  - attributes: `@id`, `@unique`, `@@unique`, `@@index`
  - relations: `@relation(fields, references)` + referential actions (same set as TS authoring surface)
  - defaults: `autoincrement()`, `now()`, literal defaults (where supported)
  - `types { ... }` block for named type instances (declarations + references)
- [ ] Add unit tests for:
  - parsing success on representative schemas
  - failure diagnostics include correct spans
  - strict errors for unsupported constructs (no warnings)

### Addendum 2.1: Red-green syntax tree

- [ ] Evaluate a lossless red/green syntax tree approach (rowan-style) for language tooling: define the round-trip invariant (`print(parse(psl))` equals the original PSL byte-for-byte) and decide how invalid/out-of-place tokens are preserved (e.g. kept in the green tree or represented as explicit `invalid` nodes). Record the decision + follow-up work (don’t block the current parser milestone on this).

### Milestone 3: PSL → normalized contract IR + parity/determinism coverage

Normalize PSL AST into the same normalized contract IR used by TS-first, then emit canonical artifacts and prove parity/determinism on a shared conformance set.

**Tasks:**

- [ ] Implement PSL normalization: PSL AST → normalized contract IR (targeting the same IR boundary as TS authoring).
- [ ] Integrate normalization into the existing emit pipeline so `contract emit` produces:
  - `contract.json` (canonical)
  - `contract.d.ts` (types-only)
- [ ] Add a conformance fixture set expressed in both PSL and TS, and a parity test harness that asserts:
  - IR parity at the normalized boundary
  - emitted `contract.json` parity + stable hashes for equivalent intent
- [ ] Add determinism tests:
  - emit twice yields byte-equivalent artifacts (or equivalently canonical JSON string equality)
- [ ] Add diagnostics tests:
  - invalid PSL produces actionable errors with file+span and a targeted “unsupported feature” message
- [ ] Documentation updates:
  - config example for PSL-first
  - how to run `prisma-next contract emit`
  - where artifacts land; how to interpret errors

### Milestone 4: Close-out (required)

Finalize long-lived docs and remove transient project artifacts.

**Tasks:**

- [ ] Verify all acceptance criteria in `projects/psl-contract-authoring/spec.md` are met (link to tests / manual checks).
- [ ] Migrate any long-lived docs/notes into `docs/` (if new docs were created under `projects/`).
- [ ] Delete `projects/psl-contract-authoring/`.

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| PSL-first config + `contract emit` emits `contract.json` + `contract.d.ts` | Integration/E2E | Milestone 1 + 3 | Use CLI test fixtures |
| TS-first config still works | Integration/E2E | Milestone 1 | Guard against regressions |
| Emit twice with unchanged inputs produces equivalent outputs | Integration | Milestone 3 | Determinism harness |
| Invalid PSL yields helpful diagnostic with source location | Unit + Integration | Milestone 2 + 3 | Parser spans + CLI surface |
| PSL/TS conformance set yields equivalent canonical `contract.json` + stable hashes | Unit/Integration | Milestone 3 | Assert IR parity + JSON/hash parity |
| Unsupported PSL constructs are documented and fail strictly | Docs + Unit | Milestone 2 + 3 | “Simple, not perfect” v1 boundary |
| Docs explain config selection + command usage + artifact locations + errors | Docs | Milestone 3 | Link from relevant READMEs |
| Tests cover success/failure/determinism/parity | Unit/Integration | Milestone 2 + 3 | Explicit suites for each area |

## Open Items

- Confirm the exact TS-authoring-supported referential action set used for PSL normalization (enforce identical mapping).
- Define the precise mapping for `types { ... }` entries to codec/native/typeParams so it matches the existing SQL authoring surface expectations.

