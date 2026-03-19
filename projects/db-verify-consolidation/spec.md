# Summary

Consolidate database verification onto `prisma-next db verify` and remove the parallel `prisma-next db schema-verify` command. `db verify` remains correctness-first by default (marker check + tolerant schema verification), keeps `--shallow` as an explicit marker-only escape hatch, and absorbs schema-only / strict structural checks under flags so there is one verb for all verification workflows.

# Description

`db verify` already does the right thing by default in the current codebase: it checks the marker, then runs tolerant schema verification, and only `--shallow` opts back into the old fast-but-incomplete behavior. The remaining problem is surface area: `db schema-verify` still exists as a second command, is still documented as canonical in several places, is still exported as its own CLI entrypoint, and is still referenced by journey tests, error messages, and recordings.

That split is now actively misleading. It suggests there are two top-level verification commands when the product decision is that there should be one correctness-first default. It also forces users to understand subtle reliability differences before they can pick a command.

This project completes the consolidation:

- `db verify` is the single canonical verification command
- the fast marker-only path remains available only as an explicit opt-in (`--shallow`)
- marker-independent structural validation remains available as a mode on `db verify`, so brownfield adoption and corrupt-marker triage do not lose a read-only workflow
- `db schema-verify` is deleted entirely from the CLI surface, docs, tests, exports, and recordings

**Assumption:** use transient project slug `db-verify-consolidation`.

# Requirements

## Functional Requirements

### FR-1: Canonical command syntax and modes

The CLI exposes one verification command:

```bash
prisma-next db verify [--db <url>] [--config <path>] [--shallow | --schema-only] [--strict] [--json] [-v] [-q] [--color/--no-color]
```

Mode semantics:

- default (no mode flags): verify marker, then run tolerant schema verification
- `--shallow`: verify marker only; skip structural schema verification
- `--schema-only`: skip marker checks; run structural schema verification only
- `--strict`: when schema verification runs, extra schema elements cause failure

Examples:

- `prisma-next db verify --db $DATABASE_URL`
- `prisma-next db verify --db $DATABASE_URL --strict`
- `prisma-next db verify --db $DATABASE_URL --schema-only`
- `prisma-next db verify --db $DATABASE_URL --schema-only --strict`
- `prisma-next db verify --db $DATABASE_URL --shallow`

Database connection resolution stays unchanged: `--db` overrides `config.db.connection`. No new env vars or config keys are added.

### FR-2: Correctness-first default for `db verify`

`prisma-next db verify` without `--shallow` must always run structural schema verification after marker verification. This remains the default, first-line command shown in help, docs, examples, journey tests, and error recovery guidance.

Human output and JSON output must clearly state whether schema verification ran, and whether it ran in tolerant or strict mode.

### FR-3: Marker-independent structural verification under `db verify`

Full `db verify` remains marker-first. If marker verification fails, the command exits with the marker failure instead of continuing into structural verification. Engineers who need structural diagnostics without trusting marker state must use `--schema-only`.

The current CLI use cases that rely on `db schema-verify` without a valid marker must remain possible under `db verify`:

- brownfield adoption before `db sign`
- missing-marker diagnosis
- corrupt-marker diagnosis
- stale-marker diagnosis where the engineer wants a read-only structural comparison before running `db update` or `db sign`

`prisma-next db verify --schema-only` is the replacement path. It is read-only and does not inspect, require, or mutate the marker row. It may be combined with `--strict`.

TTY and JSON formatting for `--schema-only` should reuse the current schema verification renderer/result shape unless a broader JSON-envelope unification is intentionally taken on in a separate project.

### FR-4: Flag validation and exit codes

Flag combinations are validated before any database work begins:

- `--shallow` and `--schema-only` are mutually exclusive
- `--shallow` and `--strict` are mutually exclusive
- `--schema-only --strict` is valid
- default mode with `--strict` is valid

Exit codes:

- `0`: verification succeeded
- `1`: verification/runtime failure
- `2`: invalid CLI usage (including invalid flag combinations)

Usage errors must explain the invalid combination and show the valid verification modes.

### FR-5: Remove `db schema-verify` from the CLI surface

Delete `prisma-next db schema-verify` completely:

- remove the subcommand from `packages/1-framework/3-tooling/cli/src/cli.ts`
- remove `packages/1-framework/3-tooling/cli/src/commands/db-schema-verify.ts`
- remove the `@prisma-next/cli/commands/db-schema-verify` package export
- remove build/test wiring that only exists to compile or snapshot that command
- remove command-specific recordings, fixture directories, and helpers that only exist for the removed command

Do not keep an alias, deprecation path, or compatibility shim. Update repo call sites directly.

### FR-6: Move strict structural checking onto `db verify`

Anything that currently requires `prisma-next db schema-verify --strict` must use `prisma-next db verify --strict` or `prisma-next db verify --schema-only --strict`, depending on whether marker verification is desired.

Strict mode behavior must remain unchanged:

- tolerant mode allows unmanaged extra schema elements
- strict mode fails on unmanaged extra schema elements
- the failure tree / JSON still identifies extra elements clearly

### FR-7: Repo-wide guidance and test migration

All repo-owned guidance must use the consolidated command surface:

- default structural drift detection: `db verify`
- marker-only fast path: `db verify --shallow`
- read-only structural comparison without marker state: `db verify --schema-only`
- strict structural comparison: `db verify --strict` or `db verify --schema-only --strict`

This includes:

- CLI help text and examples
- CLI README and style guide
- command summaries
- error / fix text
- journey tests and command helpers
- recordings config and generated ascii / svg artifacts

### FR-8: Keep lower-level schema verification APIs

This project only removes the separate CLI command. It does not remove:

- `client.schemaVerify()` from the control API
- family-level `schemaVerify()` methods
- schema verification formatters used by `db verify` and `db sign`

`db sign` continues to use structural verification as a precondition before writing the marker.

## Non-Functional Requirements

### NFR-1: One canonical verb

The CLI and docs must teach one verification verb: `db verify`. A new engineer reading help, docs, or examples should not encounter a second top-level verification command.

### NFR-2: Script-friendly output remains stable within each mode

stdout remains reserved for primary output / JSON, stderr remains for decoration / errors, and `--json` continues to produce a single JSON object. This project may change which command name produces a given payload, but it should not add noisy logging or TTY-only behavior that breaks automation.

### NFR-3: No backward-compatibility scaffolding

Because the repo has no external consumers, the implementation should directly remove the old command and update all references. No aliases, hidden commands, or "legacy" test coverage remain after the change.

### NFR-4: Minimal semantic churn outside the command surface

The underlying verification semantics that already exist in the repo should stay intact:

- full `db verify` remains marker + tolerant schema
- `--shallow` remains the explicit fast-but-incomplete path
- `db sign` still uses schema verification before writing the marker

The work is surface consolidation, not a rewrite of control-plane verification.

### NFR-5: Repo health

`pnpm lint:deps` and the relevant CLI / integration test suites must pass after the command consolidation. Build config, exports, and test config must not retain dead references to removed files.

## Non-goals

- Removing or redesigning `client.schemaVerify()` or family-level `schemaVerify()`
- Renaming `--shallow` in the same project
- Unifying every `db verify` JSON success / failure payload into a brand-new single envelope
- Changing `db sign`, `db update`, or `db introspect` semantics beyond updated guidance text
- Adding a deprecation alias or migration path for `db schema-verify`

# Acceptance Criteria

- [ ] `prisma-next db verify` help and docs present it as the single canonical verification command
- [ ] `prisma-next db verify` without mode flags performs marker verification followed by tolerant schema verification
- [ ] `prisma-next db verify --shallow` performs only marker verification and no longer tells users to run `db schema-verify`
- [ ] `prisma-next db verify --schema-only` performs read-only structural verification without requiring a valid marker
- [ ] `prisma-next db verify --strict` fails on extra schema elements that tolerant `db verify` accepts
- [ ] `prisma-next db verify --schema-only --strict` reproduces the current strict structural verification behavior without marker checks
- [ ] `prisma-next db verify --shallow --strict` exits with code `2` and an actionable usage error
- [ ] `prisma-next db verify --shallow --schema-only` exits with code `2` and an actionable usage error
- [ ] `prisma-next db schema-verify` is absent from the `db` command tree and CLI help output
- [ ] The repo no longer builds or tests a `db-schema-verify` command entrypoint or package subpath export
- [ ] Brownfield-adoption coverage uses `db verify --schema-only` before `db sign`
- [ ] Drift-marker coverage uses `db verify --schema-only` for missing / corrupt marker diagnosis
- [ ] Drift-schema coverage uses `db verify --strict` for strict extra-element checks
- [ ] CLI help text, CLI README, `docs/CLI Style Guide.md`, `docs/commands/SUMMARY.md`, and error recovery text use only the consolidated `db verify` surface
- [ ] Generated CLI recordings and snapshots no longer contain `prisma-next db schema-verify`
- [ ] `pnpm lint:deps` and the relevant CLI / integration suites pass after dead references are removed

# Other Considerations

## Security

All verification modes remain read-only except `db sign`, which is out of scope here. Connection strings must continue to be masked in human-readable output, and no new flags should accept secrets beyond the existing `--db <url>` behavior.

## Cost

Incremental runtime cost is negligible. The repo has already accepted full `db verify` as the default behavior, so this project mostly removes duplicate surface area and preserves alternative read-only modes under flags. Expected 30-day operating cost impact: effectively $0 beyond existing local / CI database usage.

## Observability

Verbose and JSON modes should keep exposing enough information to distinguish:

- marker failure
- tolerant schema drift
- strict-only extra-element failure
- explicit marker-only execution via `--shallow`
- explicit schema-only execution via `--schema-only`

If command metrics or telemetry are added later, they should record the selected verification mode and strictness without logging connection secrets.

## Data Protection

Verification inspects schema metadata and marker hashes, not row data. The change does not expand the data surface area. Existing masking / scrubbing rules for database URLs must continue to apply.

## Analytics

No new telemetry is required for this project. If adoption of verification modes is measured later, it should be opt-in and limited to coarse command / mode usage, not contract contents or database identifiers.

# References

- `packages/1-framework/3-tooling/cli/src/commands/db-verify.ts`
- `packages/1-framework/3-tooling/cli/src/commands/db-schema-verify.ts`
- `packages/1-framework/3-tooling/cli/src/cli.ts`
- `packages/1-framework/3-tooling/cli/src/utils/formatters/verify.ts`
- `packages/1-framework/3-tooling/cli/package.json`
- `packages/1-framework/3-tooling/cli/tsdown.config.ts`
- `packages/1-framework/3-tooling/cli/vitest.config.ts`
- `packages/1-framework/3-tooling/cli/recordings/config.ts`
- `packages/1-framework/1-core/migration/control-plane/src/errors.ts`
- `packages/1-framework/1-core/migration/control-plane/test/errors.test.ts`
- `test/integration/test/utils/journey-test-helpers.ts`
- `test/integration/test/cli.db-verify.e2e.test.ts`
- `test/integration/test/cli.db-schema-verify.e2e.test.ts`
- `test/integration/test/cli-journeys/greenfield-setup.e2e.test.ts`
- `test/integration/test/cli-journeys/brownfield-adoption.e2e.test.ts`
- `test/integration/test/cli-journeys/drift-schema.e2e.test.ts`
- `test/integration/test/cli-journeys/drift-marker.e2e.test.ts`
- `docs/CLI Style Guide.md`
- `packages/1-framework/3-tooling/cli/README.md`
- `docs/commands/SUMMARY.md`

# Open Questions

1. Should marker-independent structural validation be preserved as `prisma-next db verify --schema-only`, or are you comfortable deleting that read-only workflow entirely?
   Why it matters: brownfield adoption and corrupt-marker diagnosis currently rely on `db schema-verify` when marker state is missing, stale, or corrupt.
   Default assumption in this spec: preserve it as `--schema-only`.

2. Should `db verify --schema-only` keep the current schema-verify JSON / tree payload, or should this project also unify all `db verify` modes onto a single JSON envelope?
   Why it matters: keeping the current schema payload minimizes scope and churn; unifying envelopes is cleaner long-term but broadens the project substantially.
   Default assumption in this spec: keep the current schema verification payload and defer envelope unification.
