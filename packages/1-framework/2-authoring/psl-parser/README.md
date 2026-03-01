# @prisma-next/psl-parser

Reusable PSL parser for Prisma Next.

## Overview

`@prisma-next/psl-parser` parses Prisma Schema Language (PSL) source into a deterministic AST with source spans and stable machine-readable diagnostics. It is intentionally parser-only: normalization to contract IR and emit integration happen in downstream milestones/packages.

In the provider-based authoring model, PSL providers call this parser and then return `Result<ContractIR, ContractSourceDiagnostics>` to the framework emit pipeline.

## Responsibilities

- Parse PSL source text (`schema` + `sourceId`) with deterministic ordering.
- Return AST nodes with source spans for models, fields, enums, and `types { ... }`.
- Preserve raw PSL relation action tokens (for example `Cascade`) without semantic normalization.
- Return stable diagnostics (`code`, `message`, `span`, `sourceId`) for invalid and unsupported constructs.
- Enforce strict error behavior for unsupported syntax (no warning or best-effort mode).
- Parse attributes generically (namespaced or not), including optional argument lists; semantics live downstream.
- Emit attribute nodes with explicit target (`field` / `model` / `namedType`), attribute name, and parsed argument list with spans.

## Attributes (generic parsing boundary)

`@prisma-next/psl-parser` parses attributes **generically**:

- Attributes may be **non-namespaced** (for example `@id`) or **namespaced** (for example `@pgvector.column`).
- Attributes may include an **optional argument list**.
- Arguments are parsed into positional/named entries with preserved raw values and source spans.
- The parser owns **syntax + structure + spans**, not semantics.

Interpretation/validation (for example `@prisma-next/sql-contract-psl`) is responsible for:

- mapping attributes to existing contract authoring shapes,
- enforcing strictness (unknown/unsupported attributes are errors),
- enforcing pack composition (using `@<ns>.*` without composing the pack fails), and
- ensuring parity with the TS authoring surface.

## Public API

- `parsePslDocument(input)` in `src/parser.ts`
- Exported AST/diagnostic/span types in `src/types.ts`
- Subpath exports:
  - `@prisma-next/psl-parser/parser`
  - `@prisma-next/psl-parser/types`

## Dependencies

- **Depends on**
  - No cross-domain runtime dependencies.
- **Used by**
  - PSL normalization/emission tooling (next milestone)
  - Potential language tooling and external parsers that need spans + diagnostics

## Architecture

```mermaid
flowchart LR
  PSL[PSL source text] --> Parser[psl-parser]
  Parser --> AST[PSL AST with spans]
  Parser --> Diagnostics[Structured diagnostics]
  AST --> Normalizer[PSL -> contract IR normalizer]
  Diagnostics --> CLI[CLI/editor renderers]
```

## Package Boundaries

- This package does not perform file I/O.
- This package does not normalize to contract IR.
- This package does not emit `contract.json` or `contract.d.ts`.

## Related Docs

- `docs/Architecture Overview.md`
- `docs/architecture docs/subsystems/2. Contract Emitter & Types.md`
- `docs/architecture docs/adrs/ADR 163 - Provider-invoked source interpretation packages.md`

