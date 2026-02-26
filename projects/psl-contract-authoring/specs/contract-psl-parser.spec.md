# Summary

Implement a reusable PSL parser package (`@prisma-next/contract-psl`) that can parse Prisma schema files into an AST with source spans and produce strict, structured diagnostics.

# Description

PSL-first contract authoring requires parsing PSL reliably and in a way that can be reused by more than just contract emission (language tooling, external tooling, and other internal tooling).

This milestone implements the parser API in `packages/1-framework/2-authoring/contract-psl` and supports the v1 PSL subset defined by the project spec, including the `types { ... }` block for named type instances. Unsupported PSL constructs are strict errors.

# Requirements

## Functional Requirements

- Provide a parser API in `@prisma-next/contract-psl` that:
  - Parses a PSL document (string + file path/identifier)
  - Returns an AST that retains source spans for relevant nodes
  - Returns structured diagnostics (stable error code + span + message)
- Parse the v1 supported PSL subset:
  - models + scalar fields, required/optional
  - enums
  - attributes: `@id`, `@unique`, `@@unique`, `@@index`
  - relations: `@relation(fields, references)` plus referential actions (same supported set as TS authoring)
  - defaults: `autoincrement()`, `now()`, supported literal defaults
  - `types { ... }` block for named type instances (declarations + references)
- Produce strict errors for unsupported constructs (no warnings / no best-effort).

## Non-Functional Requirements

- Deterministic parse output (AST shape and node ordering) for identical inputs.
- Stable diagnostic ordering and error codes.
- Small, well-defined public API that doesn’t assume a CLI environment.

## Non-goals

- PSL → normalized contract IR (handled by the normalization/parity milestone).
- Full PSL compatibility beyond the v1 supported set.

# Acceptance Criteria

- [ ] Parser returns AST with spans for representative v1 schemas.
- [ ] Invalid PSL produces a diagnostic with a precise span and clear message.
- [ ] Unsupported PSL constructs fail with strict errors.
- [ ] Unit tests cover success cases and failure diagnostics (including spans).

# Other Considerations

## Security

- Parser is purely syntactic/structural; do not evaluate content.

## Cost

- Offline tooling; negligible operational cost.

## Observability

- Diagnostics must be stable and machine-readable for downstream renderers (CLI/editor integrations).

## Data Protection

- Operates on schema text only.

## Analytics

- None required.

# References

- Project spec: `projects/psl-contract-authoring/spec.md`
- Project plan: `projects/psl-contract-authoring/plans/plan.md`
- Emission pipeline: `docs/architecture docs/subsystems/2. Contract Emitter & Types.md`
- Placeholder package: `packages/1-framework/2-authoring/contract-psl/README.md`

# Open Questions

- Where should the TS-authoring referential action set be sourced from so the PSL parser and normalization reuse it (single source of truth)?
