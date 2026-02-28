# @prisma-next/sql-contract-psl

PSL-first SQL contract interpretation and provider composition for Prisma Next.

## Overview

`@prisma-next/sql-contract-psl` provides two entrypoints:

- **Pure interpreter** (`@prisma-next/sql-contract-psl`): parsed PSL document -> SQL `ContractIR`
- **Provider helper** (`@prisma-next/sql-contract-psl/provider`): read file -> parse -> interpret -> `ContractConfig`

This keeps core/CLI source-agnostic while giving PSL-first SQL users a one-line config helper.

## Responsibilities

- Interpret `ParsePslDocumentResult` into SQL `ContractIR`
- Compose provider flow for SQL PSL-first config (`read -> parse -> interpret`)
- Preserve parser diagnostics and add interpreter diagnostics with stable codes
- Return `notOk` with structured diagnostics for unsupported constructs
- Keep interpretation deterministic for equivalent AST inputs

## Non-responsibilities

- Canonical artifact emission (`contract.json`, `contract.d.ts`) and hashing
- CLI or ControlClient orchestration

The **pure interpreter entrypoint** specifically excludes:
- File I/O (`schema.prisma` reading)
- PSL parsing (`parsePslDocument`)
- Artifact emission (`contract.json`, `contract.d.ts`) and hashing
- CLI or ControlClient orchestration

## Public API

- `@prisma-next/sql-contract-psl`
  - `interpretPslDocumentToSqlContractIR({ document, target? })`
- `@prisma-next/sql-contract-psl/provider`
  - `prismaContract(schemaPath, { output?, target? })`

## Dependencies

- **Depends on**
  - `@prisma-next/psl-parser` for parser + parser result types
  - `@prisma-next/sql-contract-ts` for SQL authoring builder composition
  - `@prisma-next/core-control-plane` for contract source diagnostics types
  - `pathe` for provider path resolution
  - `@prisma-next/contract` and `@prisma-next/utils`
- **Used by**
  - PSL contract providers configured via `contract.source`

## Architecture

```mermaid
flowchart LR
  config[prisma-next.config.ts] --> providerHelper[@prisma-next/sql-contract-psl/provider]
  providerHelper --> fsRead[read schema.prisma]
  fsRead --> parser[@prisma-next/psl-parser]
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
