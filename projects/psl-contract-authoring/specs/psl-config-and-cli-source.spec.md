# Summary

> ⚠️ **Superseded / replaced**
>
> This spec describes the **enumerated source kind** approach (`contract.source = { kind: 'psl', schemaPath }`).
> The project has since moved to **provider-based contract sources** (pluggable providers returning `ContractIR` via `Result<>`).
>
> - **Replacement spec**: `projects/psl-contract-authoring/specs/pluggable-contract-sources.spec.md`
> - **Current project plan**: `projects/psl-contract-authoring/plans/plan.md` (Milestone 1)
>
> Keep this spec only as historical context for what was implemented earlier on the branch; do not treat it as the current plan of record.

Add PSL-first project configuration and CLI wiring so `prisma-next contract emit` can read a Prisma schema file (PSL) as the contract source while keeping the existing TS-first flow unchanged.

# Description

Prisma Next already emits canonical artifacts (`contract.json` + `contract.d.ts`) via `prisma-next contract emit`, using a contract source configured in `prisma-next.config.ts`.

This milestone adds a PSL-first config option with an explicit schema path, validates it, and routes the CLI’s emit path to resolve PSL input into a family-compatible contract IR input. The implementation must not break TS-first `contract.source` behavior (value or loader function).

**Scope note:** this spec is about configuration + CLI source resolution and wiring. It does not define the full PSL parser or the normalization logic beyond integrating with the existing emission pipeline.

# Requirements

## Functional Requirements

- Support a PSL-first config shape in `prisma-next.config.ts`:
  - `contract.source = { kind: 'psl', schemaPath: string }`
  - `schemaPath` is required and must be explicit (no implicit defaults).
- Validate PSL-first config at config-load time:
  - Missing/invalid `schemaPath` fails with an actionable error.
- Preserve TS-first config behavior:
  - Existing `contract.source` value shapes remain accepted (plain value or loader function).
- Ensure `prisma-next contract emit` resolves PSL-first source into the same downstream emission flow as TS-first (offline; no DB connection).
- Add CLI/integration test coverage for both authoring modes:
  - PSL-first config accepted and routes to emit
  - TS-first config continues to work unchanged

## Non-Functional Requirements

- Error messages are clear, stable, and point the user to the config field that needs fixing.
- Keep layering boundaries intact: config/CLI code should not import runtime-only modules.

## Non-goals

- Implementing the PSL parser itself (handled by parser milestone).
- Defining/implementing PSL→IR normalization (handled by normalization milestone).
- Supporting “best effort” parsing or warnings; config-level issues are hard errors.

# Acceptance Criteria

- [ ] A PSL-first `prisma-next.config.ts` using `contract.source = { kind: 'psl', schemaPath: '...' }` is accepted by config validation.
- [ ] Missing or invalid `schemaPath` produces an actionable error.
- [ ] TS-first projects using existing `contract.source` patterns still pass config validation and emit successfully.
- [ ] `prisma-next contract emit` routes PSL-first source into the emit operation without requiring a DB connection.
- [ ] CLI/integration tests cover PSL-first and TS-first paths.

# Other Considerations

## Security

- Treat PSL and config inputs as untrusted; avoid leaking full absolute paths in errors by default (prefer relative paths when feasible).

## Cost

- Negligible (offline CLI behavior).

## Observability

- Ensure CLI failure output is structured enough to diagnose misconfig quickly (consistent error summary + fix hint).

## Data Protection

- No production data is processed; only schema/config inputs.

## Analytics

- None required for this milestone.

# References

- Project spec: `projects/psl-contract-authoring/spec.md`
- Project plan: `projects/psl-contract-authoring/plans/plan.md`
- Emission overview: `docs/architecture docs/subsystems/2. Contract Emitter & Types.md`
- ADR: `docs/architecture docs/adrs/ADR 006 - Dual Authoring Modes (PSL-first and TS-first) with a Single Canonical Artifact.md`

# Open Questions

- None (config shape and “explicit schemaPath” are decided).
