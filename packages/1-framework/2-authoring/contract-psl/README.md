# @prisma-next/psl-parser

Reusable PSL parser for Prisma Next.

## Overview

`@prisma-next/psl-parser` parses Prisma Schema Language (PSL) source into a deterministic AST with source spans and stable machine-readable diagnostics. It is intentionally parser-only: normalization to contract IR and emit integration happen in downstream milestones/packages.

## Responsibilities

- Parse PSL source text (`schema` + `sourceId`) with deterministic ordering.
- Return AST nodes with source spans for models, fields, enums, and `types { ... }`.
- Return stable diagnostics (`code`, `message`, `span`, `sourceId`) for invalid and unsupported constructs.
- Enforce strict error behavior for unsupported syntax (no warning or best-effort mode).

## Public API

- `parsePslDocument(input)` in `src/parser.ts`
- Exported AST/diagnostic/span types in `src/types.ts`

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
- `projects/psl-contract-authoring/specs/contract-psl-parser.spec.md`

