## Summary

Add a **second entrypoint** to `@prisma-next/sql-contract-psl` that provides a thin, Node-only “composition helper” for PSL-first SQL authoring:

- **Pure entrypoint** (existing): interpret parsed PSL → SQL `ContractIR`
- **Provider entrypoint** (new): read schema from disk → parse → interpret → return `ContractConfig` / provider

This spec also explicitly extracts the existing `prismaContract()` helper (currently in core-control-plane config types) into the SQL PSL package’s provider entrypoint, keeping the name **`prismaContract`**.

Goal: users can import “all PSL→SQL contract utilities” from one package without teaching the core/CLI about PSL.

## Motivation

Today, PSL-first config requires wiring a resolver function via `prismaContract(schemaPath, resolver, output?)`, which duplicates the same composition everywhere (read → parse → interpret). We want a one-liner for PSL-first SQL projects, analogous to `typescriptContract(...)`.

## Design

### Entry points

1. **Interpretation-only (existing)**
  - Package: `@prisma-next/sql-contract-psl`
  - API: `interpretPslDocumentToSqlContractIR({ document, target? })`
  - No file I/O and no parsing. Takes parser output and returns `Result<ContractIR, ContractSourceDiagnostics>`.
2. **Node/provider helper (new)**
  - Subpath export: `@prisma-next/sql-contract-psl/provider` (name bikeshed OK; must clearly imply Node/I/O)
  - Responsibilities:
    - Read PSL schema text from a provided `schemaPath`
    - Parse using `@prisma-next/psl-parser` (`parsePslDocument`)
    - Interpret using `interpretPslDocumentToSqlContractIR`
    - Return a provider suitable for `defineConfig({ contract: ... })`
  - Must not import CLI modules. It is “CLI-used via config”, not “a CLI package”.

### Proposed public API (provider entrypoint)

#### Extracted helper name (required)

The provider entrypoint MUST export a helper named **`prismaContract()`** (keep the name).

- This is an extraction of the existing helper at:
  - `packages/1-framework/1-core/migration/control-plane/src/config-types.ts` (`prismaContract(...)`)
- Today it is “file I/O + user-supplied resolver”.
- After extraction, `prismaContract()` becomes the standard PSL-first SQL composition route: file I/O + parse + interpret, returning a contract source provider/config.

#### API shape

Pick one of these shapes (implementation can support both if trivial), but keep the name `prismaContract` for the primary helper:

#### Option A (most ergonomic): returns `ContractConfig`

- `prismaContract(schemaPath: string, options?: { output?: string; target?: TargetPackRef<'sql','postgres'> }): ContractConfig`

This lets config be:

- `contract: prismaContract('./schema.prisma', { output: 'src/prisma/contract.json' })`

#### Option B (more primitive): returns `ContractSourceProvider`

- `prismaContract(schemaPath: string, options?: { target?: TargetPackRef<'sql','postgres'> }): ContractSourceProvider`

Then config can choose `output` separately using existing config helpers.

### Diagnostics contract

- Provider helper must return `Result<ContractIR, ContractSourceDiagnostics>` with:
  - parser diagnostics preserved (sourceId + span)
  - interpreter diagnostics appended
  - stable `summary`
- File I/O failures produce `notOk` with:
  - `summary` like `Failed to read Prisma schema at "<schemaPath>"`
  - diagnostic code `PSL_SCHEMA_READ_FAILED`
  - `sourceId` set to the user-provided `schemaPath`

### Naming

- Keep the extracted helper name as **`prismaContract`** (this is explicitly “Prisma schema / PSL contract source” in the SQL family context).

## Requirements

### Functional requirements

- Users can configure PSL-first SQL authoring in `prisma-next.config.ts` without providing a resolver function.
- The core/CLI remains source-agnostic (no PSL branching).
- The interpretation-only entrypoint remains usable independently (tests/other tooling can pass parser output directly).

### Non-functional requirements

- Keep bundling/exports clear: browser/tooling consumers can import the pure entrypoint without pulling in Node file I/O.
- Determinism: provider helper must not add provenance into canonical artifacts (it returns IR only; canonical artifact rules remain framework-owned).

## Acceptance criteria

- `@prisma-next/sql-contract-psl` continues to export `interpretPslDocumentToSqlContractIR` unchanged.
- New entrypoint exists at `@prisma-next/sql-contract-psl/provider` (or equivalent) providing the composition helper API.
- Integration fixture `prisma-next.config.parity-psl.ts` is updated to use the new helper (removes inline resolver boilerplate).
- The previous `prismaContract(schemaPath, resolver, output?)` helper is no longer the recommended PSL-first composition route for SQL; the extracted `@prisma-next/sql-contract-psl/provider` `prismaContract()` is.
- Add/adjust integration test coverage that:
  - emits successfully from the PSL provider helper (read → parse → interpret → emit)
  - renders diagnostics for an unsupported PSL construct (span + sourceId preserved)

## Non-goals

- Changing the core provider interface (`ContractSourceProvider`) or introducing source kind unions.
- Adding non-SQL PSL providers.

## Implementation notes (for the executing agent)

- Use `pathe` for path resolution (repo rule).
- Keep the pure interpreter entrypoint free of `node:*` imports.
- If the provider entrypoint needs Node-only imports, isolate them to the subpath export.
- Update `packages/2-sql/2-authoring/contract-psl/README.md` to document both entrypoints and their responsibilities.

