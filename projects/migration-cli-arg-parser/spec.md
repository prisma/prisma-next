# Project spec — Migration CLI: replace hand-rolled arg parser

- **Linear**: [TML-2318](https://linear.app/prisma-company/issue/TML-2318/migration-cli-replace-handrolled-arg-parser-with-shared-cli-library)
- **Status**: shaping
- **Owner**: William Madden
- **Related artifacts**:
 - [Commander friction points](research/commander-friction-points.md) — durable catalogue of pain points, for the broader future @prisma-next/cli replacement work

## Why

`MigrationCLI.run` (in `packages/1-framework/3-tooling/cli/src/migration-cli.ts`) parses a tiny three-flag CLI surface (`--help`, `--dry-run`, `--config <path>`) with a hand-rolled `for`-loop. PR #377 review flagged this as something a CLI library should be doing for us. The migration-file CLI is invoked by every authored `migration.ts` script when run directly with Node; today's parser is acceptable but accretes branches, ignores unknown flags silently, and ships hand-formatted help.

Two underlying motivations drive the work:

1. **Surface-level**: address the ticket as written — replace the loop, generate help instead of hand-writing it, fail fast on unknown flags.
2. **Strategic**: this is a low-risk experiment surface for evaluating CLI libraries beyond Commander, before the much larger work of replacing Commander in `@prisma-next/cli` proper. The migration-file CLI is small, isolated, has zero upstream dependencies, and rolling forward or back is half a day's work.

## Decision: clipanion

The new library will be **[clipanion](https://github.com/arcanis/clipanion)** (the CLI framework that powers Yarn Berry).

Evaluation criteria:

| Criterion | Weight | Notes |
|---|---|---|
| Runtime-agnostic (Node + Bun + Deno) | hard requirement | Rules out `node:util.parseArgs` and citty (which uses `node:util` under the hood) |
| In-process testable (no `process.exit`, injectable streams, returns exit codes) | hard requirement | Commander pain we are deliberately not buying again |
| Generates `--help` from the same option declaration the parser uses | strong preference | Ticket calls this out explicitly |
| Surfaces unknown flags / parse failures as structured, throwable errors | strong preference | Required to route failures through our PN-coded envelope |
| Active maintenance, production track record on multiple runtimes | strong preference | Yarn Berry runs clipanion in production on Node and Bun |

Rejected candidates:

- **Commander**: keeps the surface inconsistent and inherits all the friction documented in `research/commander-friction-points.md`. The point of this work is to *not* extend Commander's footprint.
- **`node:util.parseArgs`**: ruled out for runtime-agnosticism. Bun supports it; Deno supports it via `node:` compat only.
- **citty (UnJS)**: parser is `node:util.parseArgs` under the hood (`unjs/citty/src/_parser.ts:1`), so it inherits the same constraint. Additionally, `runMain` calls `process.exit`, `runCommand` does not render help at all, and there is no per-invocation `{ stdout, stderr }` injection point — output goes through `console.*` and `process.stdout/stderr` directly. Ergonomic API but fails the in-process-testability criterion.
- **cac**: workable but less actively maintained; help renders to `process.stdout` directly with no per-invocation override.
- **clipanion**: passes every criterion. Class-based command syntax is slightly more ceremonial than `defineCommand`-style, accepted as the cost of buying production-tested testability and runtime-agnosticism.

## Public-surface change

`MigrationCLI.run` extends from two arguments to three; the third is optional and additive.

```typescript
// Before
MigrationCLI.run(import.meta.url, MyMigration);

// After (existing call sites unchanged)
MigrationCLI.run(import.meta.url, MyMigration);

// New: in-process invocation for tests
const exitCode = await MigrationCLI.run(import.meta.url, MyMigration, {
 argv: ['node', 'migration.ts', '--dry-run'],
 stdout: collectingStream,
 stderr: collectingStream,
});
```

Contract:

- `argv` defaults to `process.argv`. When provided, the parser uses the explicit argv and ignores `process.argv`.
- `stdout` / `stderr` default to `process.stdout` / `process.stderr`. When provided, all output (help, error envelopes, dry-run artifacts, write confirmations) is routed to the injected streams instead of the globals.
- `MigrationCLI.run` now **returns** the exit code as a `Promise<number>`, in addition to setting `process.exitCode` for the script-style usage pattern. Existing callers that don't `await` the return value continue to work; callers that do can read the exit code without inspecting `process.exitCode`.
- The `isDirectEntrypoint` guard remains. Callers that import `migration.ts` instead of running it directly still get a no-op (returning exit code 0).

## Behaviour changes

The following user-visible behaviour changes ship as part of this work, all aligned with the [CLI Style Guide](../../docs/CLI%20Style%20Guide.md):

### Unknown flags fail fast

| | Before | After |
|---|---|---|
| `node migration.ts --frobnicate` | silently ignored, success | structured error, exit 2 |
| Error code | n/a | new factory `errorMigrationCliUnknownFlag` (PN-CLI-4xxx, see plan for code allocation) |

### Bad `--config` cases align with Style Guide exit codes

| Case | Before | After |
|---|---|---|
| `--config` with no following path | exit 1 | exit 2 |
| `--config --dry-run` (followed by another flag) | exit 1 | exit 2 |

The error itself (`errorMigrationCliInvalidConfigArg`, PN-CLI-4012) is unchanged — only the exit code maps differently because we now distinguish PRECONDITION (2) from INTERNAL_ERROR (1) per Style Guide §Exit Codes.

Runtime-class failures keep exit code 1:

| Case | Exit code |
|---|---|
| Config file not found | 1 |
| Migration target mismatch (PN-MIG-2006) | 1 |
| Unexpected error inside `buildMigrationArtifacts` or file I/O | 1 |

### Help routing matches the corrected Style Guide

`--help` is the data the caller asked for; help-as-error-decoration is decoration around an error.

| Case | Stream | Exit code |
|---|---|---|
| `node migration.ts --help` (explicit help request) | stdout | 0 |
| `node migration.ts --frobnicate` (unknown flag triggers help-shaped usage hint, if clipanion's default emits one) | stderr | 2 |

The latter case requires care: clipanion by default writes a usage summary to `context.stderr` after a parse failure. That's correct routing per the Style Guide (decoration around the error). The structured PN error envelope is *also* written to `context.stderr` immediately above it. We accept clipanion's default usage-on-error emission as long as the PN envelope is the first thing the user sees and the exit code is 2.

### Help is generated, not hand-written

`printMigrationHelp` (in `@prisma-next/migration-tools/migration-base.ts`, exported via `@prisma-next/migration-tools/migration`) is **deleted**. The replacement is clipanion's `usage` rendering, derived from the same `Command` definition that drives the parser. Adding a flag in the future automatically updates `--help` output.

This is the only breaking change to a non-CLI package's public surface. Per `AGENTS.md` "no backward-compat shims" rule, no shim is added. The single in-tree consumer (`MigrationCLI.run`) is updated in the same change. No external consumers exist.

## Out of scope

Lifted from the ticket plus a few we want to make explicit:

- **Renaming `MigrationCLI` symbol or its module path**.
- **Replacing Commander in `@prisma-next/cli`**. Future work; the friction-points doc is the input artifact for that project.
- **Subcommands or new flags** in the migration-file CLI. The surface stays at exactly `--help`, `--dry-run`, `--config <path>`. No `--version`, no `--quiet`, no `--json`. The migration-file CLI is intentionally minimal.
- **Wiring global decoration flags** (`--quiet`, `--verbose`, `--json`, `--color`, `--interactive`, `-y`, etc.) into the migration-file CLI. Same rationale: keep the surface tiny.
- **Touching the `@prisma-next/cli` main CLI's Commander integration** (other than the Style-Guide-driven `--help` routing fix already landed in commit `d6ae32e59`).
- **Changing exit codes for the no-args and parent-without-subcommand paths in the main CLI** (currently exit 0; arguably should be exit 2). Flagged as FOLLOW-UP comments in `cli.ts` during the prep commit; out of scope here.
- **PR-test discoverability for `--help`**: there is no e2e test today asserting that `prisma-next --help` produces output. Adding broader main-CLI `--help` test coverage is out of scope; the prep commit's bug fix (silent `--help`) is verified manually for now and TML-2318 itself only adds tests for the migration-file CLI.

## Acceptance criteria

A reviewer should be able to confirm each of the following:

### AC1 — Library swap

- `MigrationCLI.run`'s parser is implemented with clipanion. The hand-rolled `parseArgs` loop is gone. `commander` is **not** added as a dependency of `migration-cli.ts` (the rest of `@prisma-next/cli` keeps using Commander).
- `clipanion` is added to `@prisma-next/cli`'s `dependencies` (not `devDependencies`).
- The `printMigrationHelp` export is removed from `@prisma-next/migration-tools` (`migration-base.ts` and `exports/migration.ts`).

### AC2 — Public surface stays compatible

- Existing call sites (`MigrationCLI.run(import.meta.url, MyMigration)`) compile and behave identically. No examples or fixtures need to change.
- The new optional third argument (`{ argv?, stdout?, stderr? }`) accepts an explicit `argv: readonly string[]`, a `Writable`-shaped `stdout`, and a `Writable`-shaped `stderr`. Each defaults to its `process` global when omitted.
- `MigrationCLI.run` returns `Promise<number>` (the exit code).

### AC3 — Unknown flags fail with a structured error

- `node migration.ts --frobnicate` writes a PN-coded envelope to stderr, sets `process.exitCode = 2`, and resolves to exit code 2.
- A new error factory `errorMigrationCliUnknownFlag({ flag, knownFlags })` exists in `@prisma-next/errors/control` and is documented alongside `errorMigrationCliInvalidConfigArg`. The error meta carries the offending flag name and the list of known flags so callers can render "did you mean" suggestions later if desired.
- The factory's PN code is the next available value in the `PN-CLI-4xxx` range (allocated in the plan).

### AC4 — Bad `--config` cases now exit 2

- `--config` with no path → exit code 2 (was 1). PN code unchanged (`PN-CLI-4012`).
- `--config --dry-run` → exit code 2 (was 1). PN code unchanged.
- The existing test cases in `packages/1-framework/3-tooling/cli/test/migration-cli.test.ts` are updated to assert exit code 2 for these two cases. All other assertions in those tests stay as-is.

### AC5 — Help is generated and routed correctly

- `node migration.ts --help` writes the help string to **stdout**, sets `process.exitCode = 0`, and resolves to 0.
- The help string is produced by clipanion's usage renderer, derived from the option declarations. It contains: the command name, a short description, each option (long form, short form if any, value placeholder, description), and at least one usage line.
- Adding or removing a flag in the option declaration changes the `--help` output without any other code change.
- The `printMigrationHelp` import in `migration-cli.ts` is gone.

### AC6 — In-process testability

- The existing `migration-cli.test.ts` is rewritten to use the injected `{ argv, stdout, stderr }` instead of mutating `process.argv`, spying on `process.stderr.write`, and reading `process.exitCode`. Test setup/teardown shrinks meaningfully (no more `originalArgv` save/restore, no more `vi.spyOn(process.stderr, 'write')`).
- All 14 existing test scenarios in `migration-cli.test.ts` continue to assert equivalent behaviour:
 - Successful write of `ops.json` + `migration.json`
 - `--dry-run` prints to stdout, no files written
 - Target mismatch → PN-MIG-2006, exit 1
 - Config not found → loader-supplied PN error, exit 1
 - Imported (not entrypoint) → silent no-op
 - `--help` → exits 0; help text contains "Usage" (now asserted on stdout, was stdout before too — the existing test was right by accident)
 - `--config <path>` and `--config=<path>` both forwarded to `loadConfig`
 - `migration.json` bookends preserved across re-emits
 - Unparseable existing `migration.json` falls back to a synthesized manifest
 - `--config --dry-run` → PN-CLI-4012, exit 2 (was 1)
 - bare trailing `--config` → PN-CLI-4012, exit 2 (was 1)
 - target-mismatch fails before any stack-driven construction
- Two new test scenarios are added:
 - Unknown flag (`--frobnicate`) → new PN-CLI-4xxx, exit 2
 - Help renders to stdout, not stderr (regression guard against stream regression)

### AC7 — Layering and quality gates

- `pnpm lint:deps` passes (no new package-layering violations introduced by the clipanion dep).
- `pnpm typecheck` passes for `@prisma-next/cli` and `@prisma-next/migration-tools`.
- `pnpm test:packages` passes (every existing test that exercised migration-file CLI behaviour, plus the rewritten/new ones).
- The `@prisma-next/cli` package README's "Internal Architecture" section (or equivalent) is updated to mention clipanion's role in the migration-file CLI surface.

### AC8 — Documentation stays current

- The `@prisma-next/migration-tools` README/exports docs no longer reference `printMigrationHelp`.
- Any place in `docs/` (e.g. the Migration System subsystem doc) that refers to the migration-file CLI's parser is reviewed and updated if it described the hand-rolled loop.
- The friction-points doc (`research/commander-friction-points.md`) is left in place — it's the durable artifact that outlasts this project.

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| clipanion's default usage-on-error emission conflicts with our PN envelope rendering | Medium | Low | Investigate during implementation; either disable clipanion's default usage emission (it's controllable per-Command) or accept it as additional decoration after the PN envelope. Decision recorded in the implementation commit. |
| clipanion's class-based command syntax doesn't compose well with our `MigrationCLI.run` factory shape | Low | Low | The single `Command` subclass for the migration-file CLI is internal; it doesn't need to be exported. The factory remains the public surface. |
| `clipanion` adds non-trivial install size to every authored `migration.ts` consumer | Low | Low | clipanion is a dep of `@prisma-next/cli`, which is already a dep of every project that uses `prisma-next`. No new install for end users. |
| Test rewrite drops coverage by accident | Medium | Medium | AC6 enumerates the exact 14 scenarios that must continue to pass + 2 new scenarios; reviewer can grep for them. |
| Bun/Deno compatibility regression slips through | Low | Medium | Out of CI scope (no Bun/Deno testing today); take it on faith from clipanion's production track record on Bun via Yarn Berry. Adding a smoke test on Bun is a follow-up project. |
| `printMigrationHelp` deletion breaks something we didn't grep for | Very low | Low | Confirmed via codebase grep that `MigrationCLI.run` is the only consumer. |

## Validation

After implementation, sanity-check by running:

- `pnpm test --filter @prisma-next/cli` — verifies the rewritten `migration-cli.test.ts`.
- `pnpm test --filter @prisma-next/migration-tools` — verifies nothing in migration-tools broke from the `printMigrationHelp` deletion.
- `pnpm test:integration` (selective) — at least one example migration round-trip test that runs `node examples/.../migration.ts` with `--dry-run` to confirm the binary surface still works on a real authored migration.
- Manual smoke: run an example migration with `--help`, `--dry-run`, no flags, an unknown flag, and bad `--config`. Confirm the streams and exit codes against AC4/AC5.

## Open questions (resolved during shaping)

1. ~~Which library?~~ → clipanion (research summarised above).
2. ~~Does the public surface change?~~ → Yes: optional third arg `{ argv?, stdout?, stderr? }`, return type becomes `Promise<number>`. Existing call sites unaffected.
3. ~~Help to stdout or stderr?~~ → Explicit `--help` to stdout per Style Guide §Output Conventions rule 8 (corrected as part of this work's prep commit).
4. ~~Exit codes for usage errors?~~ → 2 (PRECONDITION) for usage errors; 1 (INTERNAL_ERROR) for runtime errors. Aligned with Style Guide §Exit Codes.
5. ~~Delete `printMigrationHelp`?~~ → Yes. Single consumer; no shim.
