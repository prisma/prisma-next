# Brief: CLI — Contract Emit Polish (Alignment with Style Guide)

## Problem
The emit command exists today as a top-level command (`prisma-next emit`) with required `--contract` and `--out` flags and optional `--config`. It prints success lines and writes artifacts, but it does not yet:

- Conform to the domain/plane taxonomy (`contract emit`),
- Support JSON output or global verbosity flags consistently,
- Emit PN-CLI error envelopes or adopt stdout/stderr separation strictly,
- Default to config-driven paths when flags are omitted,
- Expose a programmatic API that mirrors the CLI.

## Goals
- Align `prisma-next contract emit` with the Style Guide defaults.
- Provide a programmatic API for emission alongside the CLI surface.
- Add unit tests for the programmatic API and e2e tests for the CLI command.
- Ensure config-driven contract source/output paths (flags are optional) and remove legacy pack flags.

## Non-Goals
- Changing emitter algorithms or SQL family hooks.
- Building migration plane features.

## UX
- Canonical command: `prisma-next contract emit [--contract <path>] [--out <dir>] [--config <path>]`
- Legacy alias: keep `prisma-next emit` as an alias for now (update tests to cover both), but document `contract emit` as canonical.
- Global flags: `--json[=object|ndjson]` (object only for emit), `-q`, `-v`, `-vv`, `--timestamps`, `--color/--no-color`.
- Defaults: if `--contract`/`--out` omitted, resolve from config (paths live in `prisma-next.config.*`).
- Output (TTY):
  - `✔ Emitted contract.json → <path>`
  - `✔ Emitted contract.d.ts → <path>`
  - `  coreHash: <sha>` (+ `profileHash` if present)
- JSON (object): `{ ok, coreHash, profileHash, outDir, files: { json: string, dts: string }, timings }`.
- Errors: PN-CLI-4xxx codes with Why/Fix/Where, docs URL; exit 1 for runtime errors, 2 for usage/config.

## Programmatic API
- Package: `@prisma-next/cli`
- Export: `emitContract(opts)`
  - Input: `{ contractPath?: string; outDir?: string; configPath?: string; logger?: LoggerLike }`
  - Output: `{ coreHash, profileHash?, outDir, files: { json: string; dts: string }, timings }`
- Unit tests: validate config fallback, type import assembly, error envelopes.

## CLI Implementation Plan (TDD)
1) Command shape
- Introduce `contract emit` subcommand; register `emit` as an alias (kept for now).
- Update CLI help to prefer `contract emit` in examples and suggestions.

2) Parser/Flags
- Add global flags handling (verbosity, color, JSON) via a shared utility.
- Make `--contract` and `--out` optional when config supplies paths.

3) Behavior
- Load config with family descriptor; validate via arktype.
- Load TS contract (existing loader) and validate with `family.validateContractIR`.
- Assemble packs/types; call emitter; write files.
- Render human or JSON output based on flags.

4) Errors
- Map read/import/validation failures to PN-CLI-4xxx envelopes with Why/Fix/Where and docs URLs.
- Separate stdout/stderr; use exit code 1 for runtime errors, 2 for usage/config.

5) Tests
- Programmatic unit tests for `emitContract()` including config fallback and error mapping.
- CLI e2e tests covering:
  - `prisma-next contract emit` (canonical)
  - `prisma-next emit` (alias)
  - Missing config/paths → PN codes
  - `--json` output shape
  - Color/TTY behavior (sanity: disable in CI mode)

## Acceptance Criteria
- Command matches style guide output/flags.
- Programmatic API covered by unit tests; CLI by e2e.
- No legacy adapter/extension flags; purely config-driven.

---

## File Map
- packages/framework/tooling/cli/src/api/emit-contract.ts (new)
- packages/framework/tooling/cli/test/api/emit-contract.test.ts (new)
- packages/framework/tooling/cli/src/commands/contract-emit.ts (new; register alias `emit`)
- packages/framework/tooling/cli/test/emit-command.e2e.test.ts (new)
- packages/framework/tooling/cli/README.md (update examples to `contract emit`)
