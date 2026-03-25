# Summary

Replace the old public `prisma-next db introspect` workflow with two explicit commands:

- `prisma-next db schema` for read-only live schema inspection (tree or JSON, no file writes)
- `prisma-next contract infer` for brownfield PSL generation (`contract.prisma`)

This ships the PSL printer and the brownfield round-trip needed to go from an existing PostgreSQL database to a signed Prisma Next contract.

# Description

The original plan overloaded `db introspect` with two different jobs:

1. inspect the live schema for humans and automation
2. materialize a PSL file for brownfield adoption

The implemented design separates those concerns:

- `db schema` keeps schema inspection explicit and side-effect free
- `contract infer` performs the write step and stops at `contract.prisma`

Brownfield adoption is now:

1. `prisma-next contract infer`
2. `prisma-next contract emit`
3. `prisma-next db sign`

This preserves a clean preview surface while still enabling an end-to-end adoption flow for existing databases.

# Requirements

## Functional Requirements

### `db schema`

- `prisma-next db schema` prints a human-readable schema tree to stdout/stderr in TTY mode
- `prisma-next db schema --json` returns the machine-readable introspection result
- `db schema` never writes PSL or contract files
- `db schema` continues to require a database connection via `--db` or `config.db.connection`

### `contract infer`

- `prisma-next contract infer` writes an inferred PSL contract to disk
- `contract infer --json` returns a success envelope that includes `psl.path`
- `contract infer` warns before overwriting an existing target file unless `--quiet` is set
- output path resolution is:
  1. `--output <path>`
  2. `contract.prisma` next to `config.contract.output`
  3. `contract.prisma` in the current working directory
- the inferred PSL is suitable for the brownfield flow:
  `contract infer` -> `contract emit` -> `db verify --schema-only` -> `db sign`

### PSL printer

- printer input is validated in a shared authoring package, not only inside the CLI
- default mapping remains target-agnostic in the core printer
- Postgres-specific default handling is injected via a Postgres mapping factory
- named-type deduplication keys on the resolved type signature, not only the requested alias
- the printer still emits deterministic models, relations, indexes, enums, and defaults

## Non-Goals

- reintroducing a public `db introspect` command
- making `db schema` write files
- merging inferred PSL into an existing file
- TypeScript contract generation as part of `contract infer`

# Acceptance Criteria

- [x] `db schema` replaces the old public inspection command
- [x] `db schema` prints a tree by default and raw JSON with `--json`
- [x] `db schema` does not write files
- [x] `contract infer` writes `contract.prisma`
- [x] `contract infer --output` overrides the default path
- [x] `contract infer --json` includes `psl.path`
- [x] overwrite warnings are shown and can be suppressed with `--quiet`
- [x] printer validation is shared and accepts both normalized defaults and raw string defaults
- [x] Postgres default mapping is injected instead of hard-coded into the generic printer
- [x] brownfield journey passes:
  `contract infer` -> `contract emit` -> `db verify --schema-only` -> `db sign` -> `db update`
- [x] greenfield and drift journeys still pass after the command split

# References

- CLI commands:
  `packages/1-framework/3-tooling/cli/src/commands/db-schema.ts`
  `packages/1-framework/3-tooling/cli/src/commands/contract-infer.ts`
- shared inspection helper:
  `packages/1-framework/3-tooling/cli/src/commands/inspect-live-schema.ts`
- printer validation and Postgres default mapping:
  `packages/1-framework/2-authoring/psl-printer/src/schema-validation.ts`
  `packages/1-framework/2-authoring/psl-printer/src/postgres-default-mapping.ts`
- direct CLI e2e coverage:
  `test/integration/test/cli.db-introspect.e2e.test.ts`
- journey coverage:
  `test/integration/test/cli-journeys/brownfield-adoption.e2e.test.ts`
  `test/integration/test/cli-journeys/greenfield-setup.e2e.test.ts`
  `test/integration/test/cli-journeys/drift-schema.e2e.test.ts`
  `test/integration/test/cli-journeys/drift-marker.e2e.test.ts`
