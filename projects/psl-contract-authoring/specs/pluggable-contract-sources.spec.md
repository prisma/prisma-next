# Summary

Make contract authoring sources pluggable by design: instead of the framework/CLI enumerating source “kinds” (PSL vs TS vs future inputs) via a discriminated union, allow `prisma-next.config.ts` to provide a source provider that returns canonical **Contract IR**, while the framework remains responsible for **validating, normalizing, canonicalizing, hashing, and emitting** artifacts.

# Description

Today, PSL-first is wired as a framework-known config shape (`contract.source = { kind: 'psl', schemaPath }`) that the CLI resolves into a downstream input. This requires the framework/CLI to know about every source kind it wants to support.

We want an architecture where:

- The framework is **ignorant of source provider logic** (no “kind switching” in CLI/core).
- New authoring sources can be added as packages without changing core config types.
- The convergence boundary remains the framework-defined **Contract IR**.
- Parity/determinism is preserved by running a **framework-owned normalization + canonicalization pass** on any IR produced by providers (regardless of origin).

This spec defines the provider interface, config wiring, error behavior, and the normalization/canonicalization expectations needed to keep `contract.json` + hashes stable and comparable across authoring sources.

# Requirements

## Functional Requirements

- `prisma-next.config.ts` can supply a **contract source provider** instead of a source “kind” union.
  - **Provider contract**: a provider is always async and can be invoked to produce a `Promise<Result<ContractIR, Diagnostics>>`.
  - Diagnostics are structured (include spans/sourceIds where available) and are intended for CLI/editor rendering.
- The CLI/control plane remains **source-agnostic**:
  - It calls the provider to obtain `ContractIR`.
  - It does not need to understand “PSL”, “TS”, or any future source types.
- The framework remains responsible for artifact-level guarantees:
  - Validate the returned IR (structure + invariants).
  - Normalize IR into the canonical normalized boundary (defaults, stable naming/id rules, consistent representation).
  - Canonicalize/hash from normalized IR.
  - Emit `contract.json` + `contract.d.ts` deterministically.
- **Contract artifacts do not contain source locations/IDs**:
  - `contract.json` (and hashes) must not include schema paths, sourceIds, or other provenance identifiers.
  - Source locations/IDs exist only in diagnostics and other non-canonical debug output.
- **Decision: remove `sources` from canonical artifacts entirely**:
  - The canonical contract artifact (`contract.json`) must not contain a top-level `sources` field (even as an empty structural placeholder).
  - Any provenance/debug information must live outside canonical artifacts (e.g. diagnostics, CLI debug output).

## Non-Functional Requirements

- **Deterministic artifacts**: given equivalent schema intent, the normalized IR and resulting canonical artifacts/hashes are equivalent across providers.
- **Layering boundaries**: core-control-plane and CLI do not import parser implementations; providers live in separate packages.
- **Error UX**: failures surface as actionable diagnostics, ideally pointing to specific spans/sourceIds where applicable.
- **Extensibility**: adding a new source provider should not require changes to core config types or CLI switch statements.

## Non-goals

- Migrating all existing TS-first configurations to the provider API immediately.
- Defining a lossless (rowan-style) syntax tree for PSL in this task (tracked separately).
- Supporting third-party providers as a stable public plugin ecosystem in v1 (this is internal pluggability to remove framework coupling).

# Acceptance Criteria

## Provider boundary

- A provider interface exists and is documented with:
  - how it produces `ContractIR`
  - how it reports diagnostics/errors
  - what determinism constraints apply (especially around normalization/canonicalization expectations)

## Framework guarantees

- The framework/CLI can emit artifacts from provider-returned IR without any source-specific branching.
- The framework applies a normalization + canonicalization pass that:
  - yields stable `contract.json` ordering/omissions
  - produces stable hashes for equivalent normalized IR
  - strips any provider-supplied provenance (paths/sourceIds) from the canonical artifact surface
  - emits `contract.json` with **no `sources` field**

## Conformance

- A conformance harness exists where at least two providers (TS-first and PSL-first) can be run on an equivalent schema intent and compared at:
  - normalized IR boundary
  - emitted `contract.json` boundary (and hashes)

## Documentation + ADR alignment

- Docs are updated to reflect:
  - provider-based authoring as the intended end-state (no enumerated source “kind” union)
  - canonical artifacts contain no provenance and no `sources` field
- Relevant ADR(s) are updated (or a new ADR is added) to record:
  - the provider-based authoring direction
  - the decision to remove `sources` from canonical artifacts

# Other Considerations

## Security

- Provider code runs at emit-time. This is not fundamentally new (TS-first `contract.source` can already be a loader function), but the provider design should make the trust boundary explicit:
  - Providers are local build-time code, not remote plugins.
  - Avoid leaking sensitive absolute paths in errors by default.

## Cost

- Offline tooling; negligible operational cost. Normalization/canonicalization pass should be linear in IR size.

## Observability

- Ensure failures can be attributed to:
  - provider load/parse/authoring errors (diagnostics)
  - framework validation/normalization errors (structured failures)
  - emission/canonicalization errors (unexpected)

## Data Protection

- Inputs are schema/config text only. Avoid writing raw schema contents into emitted artifacts unless explicitly desired.

## Analytics

- None required.

# References

- Project spec: `projects/psl-contract-authoring/spec.md`
- PSL parser milestone spec: `projects/psl-contract-authoring/specs/contract-psl-parser.spec.md`
- PSL parity milestone spec: `projects/psl-contract-authoring/specs/psl-to-ir-parity.spec.md`
- Rust Analyzer “lossless syntax trees” background (conceptual reference): `https://rust-analyzer.github.io/book/contributing/syntax.html`
- ADRs (update required): `docs/architecture docs/adrs/ADR 006 - Dual Authoring Modes (PSL-first and TS-first) with a Single Canonical Artifact.md`

# Open Questions

1. **Test harness location**: Where should the provider conformance suite live so that adding a provider comes with a minimal, obvious parity contract?

