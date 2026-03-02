# Summary

Make contract authoring sources pluggable by design: instead of the framework/CLI enumerating source “kinds” (PSL vs TS vs future inputs) via a discriminated union, allow `prisma-next.config.ts` to provide a source provider that returns canonical **Contract IR**, while the framework remains responsible for **validating, normalizing, canonicalizing, hashing, and emitting** artifacts.

# Description

We want an architecture where:

- The framework/control plane is **ignorant of source provider logic** (no “kind switching” in CLI/core).
- New authoring sources can be added as packages without changing core config types.
- The convergence boundary remains the framework-defined **Contract IR**.
- Parity/determinism is preserved by running a **framework-owned normalization + canonicalization pass** on any IR produced by providers (regardless of origin).

This spec defines the provider interface, config wiring, error behavior, and the normalization/canonicalization expectations needed to keep `contract.json` + hashes stable and comparable across authoring sources.

# Requirements

## Functional Requirements

- `prisma-next.config.ts` can supply a **contract source provider**.
  - Provider contract is always async and can be invoked to produce a `Promise<Result<ContractIR, Diagnostics>>`.
  - Diagnostics are structured (include spans/sourceIds where available) and are intended for CLI/editor rendering.
- The CLI/control plane remains **source-agnostic**:
  - it calls the provider to obtain `ContractIR`
  - it does not need to understand “PSL”, “TS”, or any future source types
- The framework remains responsible for artifact-level guarantees:
  - validate the returned IR (structure + invariants)
  - normalize IR into the canonical normalized boundary (defaults, stable naming/id rules, consistent representation)
  - canonicalize/hash from normalized IR
  - emit `contract.json` + `contract.d.ts` deterministically
- **Contract artifacts do not contain provenance**:
  - `contract.json` (and hashes) must not include schema paths, sourceIds, or other provenance identifiers
  - the canonical contract artifact (`contract.json`) must not contain a top-level `sources` field

## Non-Functional Requirements

- Deterministic artifacts: equivalent schema intent yields equivalent normalized IR and equivalent canonical artifacts/hashes across providers.
- Layering boundaries: core-control-plane and CLI do not import parser implementations; providers live in separate packages.
- Error UX: failures surface as actionable diagnostics, ideally pointing to specific spans/sourceIds where applicable.
- Extensibility: adding a new source provider does not require changes to core config types or CLI switch statements.

## Non-goals

- Defining a stable external plugin ecosystem for third-party providers (v1 is internal pluggability).
- “Best effort” parsing/authoring; unsupported constructs should be strict errors in the provider’s diagnostics.

# Acceptance Criteria

- [ ] Provider interface exists and is documented (IR + diagnostics contract).
- [ ] `contract emit` calls the provider and emits artifacts without source-specific branching.
- [ ] Framework normalization + canonicalization yields stable `contract.json` ordering/omissions and stable hashes for equivalent intent.
- [ ] Canonical `contract.json` contains no provenance and no top-level `sources` field.
- [ ] Conformance harness can run at least two providers (TS-first and PSL-first) on equivalent intent and compare:
  - normalized IR
  - emitted canonical `contract.json` (and hashes)

# References

- Project spec: `projects/psl-contract-authoring/spec.md`
- Project plan: `projects/psl-contract-authoring/plans/plan.md`
- Milestone 2 spec: `projects/psl-contract-authoring/specs/Milestone 2 - PSL parser.spec.md`
- Milestone 3 spec: `projects/psl-contract-authoring/specs/Milestone 3 - Fixture-driven parity harness.spec.md`
- ADR 006: `docs/architecture docs/adrs/ADR 006 - Dual Authoring Modes (PSL-first and TS-first) with a Single Canonical Artifact.md`

