# ADR 163 — Provider-invoked source interpretation packages

## Status

Accepted

## Context

Prisma Next supports multiple authoring inputs (TS-first and PSL-first) that must converge on the same deterministic emission pipeline:

`provider (input-specific) → ContractIR → validate/normalize → canonicalize/hash → emit`

We introduced provider-based contract sources (`config.contract.source: () => Promise<Result<ContractIR, Diagnostics>>`) to keep the CLI/control plane **source-agnostic**. At the same time, we want to keep input-specific logic (like PSL parsing + interpretation) pluggable and out of the CLI and control plane wiring.

During initial implementation, SQL PSL interpretation code lived in the TS authoring package (`@prisma-next/sql-contract-ts`). That mixed concerns and increased the dependency surface of the TS authoring surface with PSL-specific logic.

## Decision

Input-specific parsing and interpretation live in **provider-invoked authoring packages** that:

- export **pure** interpretation APIs (no config loading, no CLI coupling)
- perform **no file I/O**
- return structured diagnostics with stable codes and spans when available

For SQL PSL-first, we create `@prisma-next/sql-contract-psl` as the dedicated package that interprets PSL input into SQL `ContractIR`.

The CLI / ControlClient remain source-agnostic and do not import PSL-specific packages. They only call `config.contract.source()` and then emit from the returned `ContractIR`.

## Consequences

### Positive

- **CLI stays family/source-agnostic**: no PSL branching or imports in command handlers.
- **Pluggable providers remain real**: new authoring sources can ship as packages without modifying CLI/control-plane logic.
- **Clearer package boundaries**:
  - `@prisma-next/sql-contract-ts`: TS-first authoring only
  - `@prisma-next/sql-contract-psl`: PSL-first interpretation only
  - `@prisma-next/psl-parser`: syntax-only parser (AST + diagnostics)

### Trade-offs

- Providers must compose file-loading + interpretation (often via a helper), e.g.:
  - read PSL text (provider) → parse to AST (`@prisma-next/psl-parser`) → interpret (`@prisma-next/sql-contract-psl`)
- Some duplication risk exists if multiple orchestrators want to “help” with PSL; this ADR prevents that by making the provider responsible for invoking interpretation.

## Implementation notes (non-normative)

- The interpretation package accepts **PSL parser output** (AST + parser diagnostics) and produces `ContractIR`.
- The provider owns parsing: it calls `parsePslDocument({ schema, sourceId })`, then passes the parser output to the interpreter.
- File paths belong in diagnostics only; canonical artifacts must not embed provenance.

## Related

- `projects/psl-contract-authoring/specs/pluggable-contract-sources.spec.md`
- `projects/psl-contract-authoring/specs/sql-contract-psl.spec.md`
- `docs/architecture docs/adrs/ADR 006 - Dual Authoring Modes.md`
- `docs/architecture docs/adrs/ADR 150 - Family-Agnostic CLI and Pack Entry Points.md`

