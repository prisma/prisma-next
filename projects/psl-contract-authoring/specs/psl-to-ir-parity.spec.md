# Summary

Normalize PSL AST into the same normalized contract IR as TS-first authoring, integrate it into `contract emit`, and prove parity/determinism with a shared conformance suite.

# Description

PSL-first and TS-first are two inputs that must produce the same canonical Prisma Next contract artifacts for equivalent schema intent. This milestone delivers the “semantic core” of PSL-first:

- PSL AST → normalized contract IR
- canonical emission (`contract.json` + `contract.d.ts`) via `prisma-next contract emit`
- parity and determinism tests that keep the two authoring modes aligned
- docs for the PSL-first workflow

This milestone is where the bounded v1 PSL subset becomes real: anything not representable in the current contract model remains a strict error.

# Requirements

## Functional Requirements

- Implement PSL normalization: PSL AST → normalized contract IR (same boundary as TS authoring).
- Integrate PSL normalization into the emission pipeline so PSL-first `contract emit` produces:
  - `contract.json` (canonical)
  - `contract.d.ts` (types-only)
- Add conformance fixtures expressed in both PSL and TS for the v1 supported subset.
- Add parity tests that assert:
  - normalized IR parity (primary debugging boundary)
  - emitted JSON + stable hash parity for equivalent intent
- Add determinism tests ensuring repeated emit yields equivalent artifacts.
- Add diagnostics tests ensuring invalid/unsupported PSL yields actionable errors with spans surfaced through the CLI.
- Update docs describing PSL-first config and `contract emit` workflow.

## Non-Functional Requirements

- Keep the parity boundary at normalized IR so failures can be debugged by comparing IR.
- No new DB primitives introduced; PSL support is bounded by representable IR.

## Non-goals

- Supporting namespaced extension attributes/blocks beyond what’s needed for named type instances.
- Making unsupported PSL constructs “best effort”.

# Acceptance Criteria

- [ ] PSL-first `contract emit` emits `contract.json` + `contract.d.ts` for v1 supported schemas.
- [ ] Conformance fixtures exist in both PSL and TS for the v1 supported set.
- [ ] Parity tests assert normalized IR parity and emitted JSON/hash parity.
- [ ] Determinism tests assert emitting twice yields equivalent outputs.
- [ ] CLI surfaces actionable diagnostics for invalid/unsupported PSL (with spans).
- [ ] Docs cover PSL-first config + `contract emit` workflow.

# Other Considerations

## Security

- PSL-first emission must not evaluate user code; it reads PSL only.

## Cost

- Offline tooling; no runtime cost impact.

## Observability

- Parity harness should print useful diffs on failure (IR diff first, then JSON diff).

## Data Protection

- Operates only on schema/contract artifacts.

## Analytics

- None required.

# References

- Project spec: `projects/psl-contract-authoring/spec.md`
- Project plan: `projects/psl-contract-authoring/plans/plan.md`
- Data contract overview: `docs/architecture docs/subsystems/1. Data Contract.md`
- Emission pipeline: `docs/architecture docs/subsystems/2. Contract Emitter & Types.md`

# Open Questions

- Define the precise mapping for `types { ... }` entries to `codecId`/`nativeType`/`typeParams` so it matches the existing SQL TS authoring surface.
