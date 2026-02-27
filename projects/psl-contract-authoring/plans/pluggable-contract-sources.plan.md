# Pluggable Contract Sources Plan

## Summary

Decouple contract input loading/parsing from the framework by introducing a provider boundary that returns `ContractIR` plus structured diagnostics, while keeping the framework responsible for validation, normalization, canonicalization, hashing, and artifact emission. Success means `contract emit` no longer branches on source kinds, canonical artifacts remain provenance-free (including no top-level `sources` field), and TS-first/PSL-first providers can be compared in a conformance harness at normalized IR and emitted artifact boundaries.

**Spec:** `projects/psl-contract-authoring/specs/pluggable-contract-sources.spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | William Madden | Drives implementation and sequencing |

## Milestones

### Milestone 1: Provider boundary and source-agnostic emit flow

Deliver a provider-based contract source interface and remove source-kind branching from CLI/control-plane emit wiring.

**Tasks:**

- [ ] Define and document `ContractSourceProvider` + provider result/diagnostic contracts with an always-async interface (`Promise<Result<ContractIR, Diagnostics>>`), diagnostics shape, and determinism expectations.
- [ ] Update config typing/validation to accept provider-based authoring input as the primary boundary (no new source-kind switch surface in framework code).
- [ ] Refactor `contract emit` entrypoints to call providers and consume `ContractIR` without PSL/TS-specific branching in CLI/control-plane.
- [ ] Add unit/integration tests that prove source-agnostic execution path and actionable provider diagnostics.

### Milestone 2: Framework-owned normalization/canonicalization guarantees

Enforce canonical artifact invariants irrespective of provider origin, including provenance stripping and stable hashes.

**Tasks:**

- [ ] Run provider-returned IR through framework validation + normalization before canonicalization/hashing/emission.
- [ ] Ensure canonical artifact output omits provenance identifiers and emits no top-level `sources` field.
- [ ] Add deterministic canonicalization/hash regression tests for equivalent normalized IR.
- [ ] Add failure-path tests separating provider diagnostics, framework validation failures, and unexpected emission failures.

### Milestone 3: Provider conformance harness (TS-first + PSL-first)

Create a conformance harness to compare equivalent schema intent across at least two providers at normalized IR and emitted artifact boundaries.

**Tasks:**

- [ ] Implement/compose TS-first and PSL-first providers that target the same normalized IR boundary.
- [ ] Add a shared fixture corpus for equivalent schema intent and run provider outputs through normalized IR parity assertions in end-to-end tests.
- [ ] Add emitted artifact parity assertions (`contract.json`, `storageHash`, `profileHash`, optional `executionHash`) for equivalent intent in end-to-end tests.
- [ ] Add end-to-end coverage proving `contract emit` works with both providers through the same source-agnostic path.

### Milestone 4: Documentation and ADR alignment

Finalize architecture/documentation alignment for provider-based sources as part of this task scope.

**Tasks:**

- [ ] Update docs to describe provider-based authoring as the intended model and canonical artifact provenance rules.
- [ ] Update/add ADRs to record provider boundary direction and removal of canonical `sources`.
- [ ] Verify all acceptance criteria in this spec with links to automated/manual checks.

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| Provider interface exists and is documented (IR production, diagnostics, determinism constraints) | Unit + Docs | Milestone 1 / Task 1 | Include type-level/API contract checks plus README/docs evidence |
| Framework/CLI emits from provider-returned IR without source-specific branching | Integration | Milestone 1 / Tasks 2-4 | Assert both providers use identical emit pipeline entrypoints |
| Framework normalization + canonicalization yields stable ordering/omissions | Unit | Milestone 2 / Tasks 1-3 | Canonical JSON snapshot/regression tests |
| Stable hashes for equivalent normalized IR | Unit + E2E | Milestone 2 / Task 3, Milestone 3 / Task 3 | Cross-provider hash parity assertions |
| Canonical artifacts strip provider provenance and emit with no `sources` field | Unit + E2E | Milestone 2 / Task 2 | Assert absence in emitted `contract.json` and hash inputs |
| Conformance harness compares TS-first and PSL-first at normalized IR boundary | E2E | Milestone 3 / Tasks 1-2 | Fixture-driven parity suite |
| Conformance harness compares emitted artifact boundary (JSON + hashes) | E2E | Milestone 3 / Task 3 | Equivalent intent must produce equivalent artifacts |
| Docs reflect provider end-state and no canonical provenance/`sources` | Docs | Milestone 4 / Task 1 | Update package/system docs and migration notes |
| ADR alignment records provider direction and `sources` removal decision | Docs/ADR | Milestone 4 / Task 2 | New ADR or ADR updates referenced in PR |

## Open Items

- None.
