# @prisma-next/sql-contract-psl

PSL-first SQL contract interpretation and provider composition for Prisma Next.

## Overview

`@prisma-next/sql-contract-psl` provides two entrypoints:

- **Pure interpreter** (`@prisma-next/sql-contract-psl`): parsed PSL document -> SQL `ContractIR`
- **Provider helper** (`@prisma-next/sql-contract-psl/provider`): read file -> parse -> interpret -> `ContractConfig`

This keeps core/CLI source-agnostic while giving PSL-first SQL users a one-line config helper.

## Responsibilities

- Interpret `ParsePslDocumentResult` into SQL `ContractIR`
- Interpret generic PSL attributes into SQL contract semantics (`@id`, `@unique`, `@default`, `@relation`, `@map`, `@@map`)
- Lower supported default functions through a registry boundary (provider-supplied in v1) so parser/interpreter remain generic
- Support pgvector parity mapping from PSL attributes to existing TS-representable descriptor shape (`codecId`, `nativeType`, `typeParams`)
- Map PSL relation action tokens to SQL contract referential actions and emit diagnostics for unsupported values
- Emit deterministic relation metadata in `models.<Model>.relations` and top-level `contract.relations`
- Enforce extension composition for supported namespaced attributes (for example `@pgvector.column(...)`)
- Compose provider flow for SQL PSL-first config (`read -> parse -> interpret`)
- Preserve parser diagnostics and add interpreter diagnostics with stable codes
- Return `notOk` with structured diagnostics for unsupported constructs
- Keep interpretation deterministic for equivalent AST inputs

Determinism note:
- Relation metadata emission is intentionally **sorted by storage table name, then model name, then relation field name** (not PSL declaration order) so `contract.json` snapshots and hashes are stable across environments.

## Non-responsibilities

- Canonical artifact emission (`contract.json`, `contract.d.ts`) and hashing
- CLI or ControlClient orchestration

The **pure interpreter entrypoint** specifically excludes:
- File I/O (`schema.prisma` reading)
- PSL parsing (`parsePslDocument`)
- Artifact emission (`contract.json`, `contract.d.ts`) and hashing
- CLI or ControlClient orchestration

Current scope is SQL/Postgres-first: scalar and enum mappings resolve to Postgres codec/native type descriptors in v1.

Unsupported PSL constructs in v1 (strict errors):

- **Scalar and storage-oriented lists are rejected**:
  - Scalar lists like `String[]`
  - Enum lists and named-type lists
- **Relation navigation lists are supported** when they can be matched to an FK-side relation:
  - Example: `User.posts Post[]` + `Post.user User @relation(fields: [userId], references: [id])`
  - Matching may use `@relation("Name")` or `@relation(name: "Name")` when multiple candidates exist
  - Navigation list fields accept only `@relation` (name-only form); other field attributes are strict errors
- **Implicit Prisma ORM many-to-many remains unsupported** (list navigation on both sides without explicit join model)
  - Represent many-to-many with an explicit join model (two foreign keys)

Supported `@default(...)` surface in v1:

- Storage defaults: `autoincrement()`, `now()`, literals, `dbgenerated("...")`
- Execution defaults: `uuid()`, `uuid(4)`, `uuid(7)`, `cuid(2)`, `ulid()`, `nanoid()`, `nanoid(<2-255>)`
- Explicitly unsupported in v1: `cuid()` (diagnostic suggests `cuid(2)`)
- `dbgenerated("...")` preserves the parsed PSL string-literal contents as-is (escaped sequences are not normalized in v1).

## Public API

- `@prisma-next/sql-contract-psl`
  - `interpretPslDocumentToSqlContractIR({ document, target? })`
- `@prisma-next/sql-contract-psl/provider`
  - `prismaContract(schemaPath, { output?, target?, composedExtensionPacks? })`
  - `composedExtensionPacks` is currently a milestone-local string-id hook for namespace
    availability checks (for example `['pgvector']`); plan to evolve to richer composed pack
    metadata/manifest inputs before broadening namespaced-attribute validation.

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
- `docs/architecture docs/subsystems/1. Data Contract.md`
- `docs/architecture docs/subsystems/2. Contract Emitter & Types.md`
- `docs/architecture docs/adrs/ADR 006 - Dual Authoring Modes.md`
- `docs/architecture docs/adrs/ADR 163 - Provider-invoked source interpretation packages.md`
