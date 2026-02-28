# @prisma-next/sql-contract-psl

PSL-first SQL contract interpretation for Prisma Next.

## Overview

`@prisma-next/sql-contract-psl` converts parsed PSL documents into SQL `ContractIR` for the provider-based emit flow:

- parser (`@prisma-next/psl-parser`) produces AST + parser diagnostics
- this package interprets AST into SQL `ContractIR`
- provider returns `Result<ContractIR, ContractSourceDiagnostics>` to framework emit

This package is interpretation-only. It does not read files, load config, or emit artifacts.

## Responsibilities

- Interpret `ParsePslDocumentResult` into SQL `ContractIR`
- Preserve parser diagnostics and add interpreter diagnostics with stable codes
- Return `notOk` with structured diagnostics for unsupported constructs
- Keep interpretation deterministic for equivalent AST inputs

## Non-responsibilities

- File I/O (`schema.prisma` reading)
- PSL parsing (`parsePslDocument`)
- Artifact emission (`contract.json`, `contract.d.ts`) and hashing
- CLI or ControlClient orchestration

## Public API

- `interpretPslDocumentToSqlContractIR({ document, target? })`

## Dependencies

- **Depends on**
  - `@prisma-next/psl-parser` for parser result types
  - `@prisma-next/sql-contract-ts` for SQL authoring builder composition
  - `@prisma-next/core-control-plane` for contract source diagnostics types
  - `@prisma-next/contract` and `@prisma-next/utils`
- **Used by**
  - PSL contract providers configured via `contract.source`

## Architecture

```mermaid
flowchart LR
  provider[PSL provider] --> parser[@prisma-next/psl-parser]
  parser --> parsed[ParsePslDocumentResult]
  parsed --> interpreter[@prisma-next/sql-contract-psl]
  interpreter --> irResult[Result_ContractIR_Diagnostics]
  irResult --> emit[Framework emit pipeline]
```

## Related Docs

- `docs/Architecture Overview.md`
- `docs/architecture docs/subsystems/2. Contract Emitter & Types.md`
- `docs/architecture docs/adrs/ADR 163 - Provider-invoked source normalization packages.md`
- `projects/psl-contract-authoring/specs/sql-contract-psl.spec.md`
