## Sources

- Linear: [TML-2318](https://linear.app/prisma-company/issue/TML-2318/migration-cli-replace-handrolled-arg-parser-with-shared-cli-library)
- Commit range: `origin/main...HEAD`

## Intent

Land the shaping artifacts for replacing the hand-rolled `parseArgs` loop in `MigrationCLI.run` with a runtime-agnostic, in-process-testable CLI library, and clear two preconditions that block clean execution: a Style-Guide rule that mis-categorised explicit `--help`, and a latent bug in the main CLI's `--help` routing that fell out of the rule fix. The implementation itself ships in follow-on commits per the plan; this PR is the spec, the plan, the durable research artifact, and the documentation/code prep work that's small enough to bundle.

## Change map

- **Documentation (rule correction)**:
  - [docs/CLI Style Guide.md](docs/CLI%20Style%20Guide.md) — §Output Conventions rule 8 (new), §Help & Usage routing line, §Exit Codes preamble cleanup.

- **Implementation (rule alignment + latent-bug fix)**:
  - [packages/1-framework/3-tooling/cli/src/cli.ts](packages/1-framework/3-tooling/cli/src/cli.ts) — `configureOutput.writeOut` becomes a stdout forwarder (was a no-op), `prisma-next help` action flips to stdout, the no-args and parent-no-subcommand fallback paths get FOLLOW-UP comments explaining their stderr+exit-0 routing.

- **Project shaping artifacts**:
  - [projects/migration-cli-arg-parser/README.md](projects/migration-cli-arg-parser/README.md) — entry point.
  - [projects/migration-cli-arg-parser/spec.md](projects/migration-cli-arg-parser/spec.md) — what + why + acceptance criteria.
  - [projects/migration-cli-arg-parser/plan.md](projects/migration-cli-arg-parser/plan.md) — five-commit execution sequence.
  - [projects/migration-cli-arg-parser/research/commander-friction-points.md](projects/migration-cli-arg-parser/research/commander-friction-points.md) — durable Commander pain catalogue with a 10-point evaluation rubric, intended to outlive this project.

- **Tests**: none added in this PR. The execution PR (per the plan) lands them in test-first order before the parser swap.

## The story

1. **Discover the underlying rule is wrong.** The original Style Guide categorised all `--help` output as decoration → stderr. That conflated two semantically different cases: explicit `--help` (the data the caller asked for) and help-as-error-decoration (printed alongside an unknown-command/missing-subcommand failure). Same printed bytes, different invocation intent, different streams. Aligns with POSIX, GNU coreutils, git, npm.
2. **Correct the rule, then notice it exposes a latent bug.** Fixing the routing rule means `prisma-next --help` should write to stdout. Tracing the existing code revealed it doesn't — `program.configureOutput({ writeOut: () => {} })` had silently suppressed help output entirely. Commander routes success-path help through `writeOut`, so `prisma-next --help` and `prisma-next <subcommand> --help` produced no output at all today. Replacing `writeOut` with `process.stdout.write` both implements the new rule and fixes the latent bug; errors stay routed through `writeErr` (still suppressed → handled by `exitOverride`).
3. **Pick a CLI library against two hard requirements.** The migration-file CLI (subject of TML-2318) is the unit being replaced. The library evaluation produced one decisive answer: **clipanion**. The two hard requirements are runtime-agnostic (Node + Bun + Deno) and in-process testable (no `process.exit` from inside parse, injectable `{ stdout, stderr }`, returns exit codes). `node:util.parseArgs` and citty (which is `node:util.parseArgs` underneath) fail the first; cac/citty fail the second; Commander fails both *and* keeps inheriting documented friction. Clipanion passes both — its `Cli.run(argv, { stdout, stderr })` returns the exit code as a `Promise<number>`, and it ships in Yarn Berry, which Maël Nison (clipanion's author) continues to maintain. **Caveat**: clipanion itself is not on a fast iteration cadence — last commit was 2024-09-06; its 4.x line has been in RC since July 2023; community-reported issues accumulate without upstream response. We accept this trade with mitigations: tiny stable API slice, exact-version pin (`4.0.0-rc.4`), single-file blast radius (`migration-cli.ts`), and the most relevant open upstream bug (#176 errors-to-stdout) is already worked around in our m4 by using `cli.process` parse-only and owning error rendering. See [spec.md § Decision: clipanion](spec.md) and [research/commander-friction-points.md § Concrete evaluation criteria](research/commander-friction-points.md) criterion 10 for the full risk write-up.
4. **Document the Commander pain durably.** The friction-points research artifact catalogues nine specific places `@prisma-next/cli` fights Commander today, with code citations. It outlives TML-2318 — its intended downstream consumer is the broader Commander-replacement project, not this PR's reviewers.
5. **Write the spec and plan.** Spec captures the public-surface change (additive third arg `{ argv?, stdout?, stderr? }`, return type becomes `Promise<number>`), the behaviour changes (unknown flags fail with `PN-CLI-4013` + exit 2; bad-`--config` exit codes 1 → 2), and acceptance criteria. Plan decomposes execution into five commits in test-first order.

## Behavior changes & evidence

- **Explicit `--help` and `--version` are data; help-as-decoration stays decoration.** New Style Guide rule 8 in §Output Conventions: explicit `--help` / `--version` → stdout, exit 0. Help printed alongside an error (unknown command, missing subcommand, bad flag) → stderr with the corresponding non-zero exit code. Same printed bytes; different invocation intent; different stream.
  - **Why**: matches POSIX/GNU/git/npm convention, makes `prisma-next --help | less`, `prisma-next --help > usage.txt`, and `diff <(prisma-next --help) <(prisma-next --version)` work as expected, and removes the stream-vs-purpose category error from the guide.
  - **Documentation**: [docs/CLI Style Guide.md](docs/CLI%20Style%20Guide.md) — §Output Conventions rule 8, §Help & Usage routing line, §Exit Codes preamble.

- **Main CLI now actually prints `--help` output (latent-bug fix).** Before this change, `prisma-next --help` and `prisma-next <subcommand> --help` produced no output, because `configureOutput.writeOut` was a no-op intended to silence Commander's default writer. Commander routes success-path help through `writeOut`, so suppressing it silenced explicit `--help` entirely. Replacing the no-op with `process.stdout.write` both implements the new rule and restores the missing output.
  - **Why**: explicit `--help` was broken in production. Discovered while implementing the rule fix, in scope because it's the same code path.
  - **Implementation**: [packages/1-framework/3-tooling/cli/src/cli.ts](packages/1-framework/3-tooling/cli/src/cli.ts) — the `program.configureOutput({...})` block (was lines 49–56, now expanded with explanation), the `prisma-next help` command's `.action()` (flipped from `process.stderr.write` to `process.stdout.write`), and the no-args + parent-no-subcommand fallback paths (left on stderr+exit 0 with FOLLOW-UP comments noting the arguable PRECONDITION/exit-2 cleanup is out of scope).

- **Migration-file CLI replacement is shaped, not yet implemented.** The spec defines the new public surface (`MigrationCLI.run(importMetaUrl, MigrationClass, { argv?, stdout?, stderr? }) → Promise<number>`), the new error code (`PN-CLI-4013` for `errorMigrationCliUnknownFlag`), and the exit-code re-classification (bad-`--config` cases 1 → 2 per the Style Guide). The plan lays out the test-first execution sequence (clipanion dep → error factory + tests → tests-first rewrite → parser swap → delete `printMigrationHelp` from `@prisma-next/migration-tools`).
  - **Why**: shaping output is the artifact, not the implementation. Validating the spec/plan with the team before code lands is cheaper than reworking implementation later.
  - **Spec/plan**: [projects/migration-cli-arg-parser/spec.md](projects/migration-cli-arg-parser/spec.md), [projects/migration-cli-arg-parser/plan.md](projects/migration-cli-arg-parser/plan.md).

## Compatibility / migration / risk

- **Breaking change in routing**: `--help` output stream changed from stderr to stdout for the explicit-`--help` paths in the main CLI. Scripts that relied on `prisma-next --help 2>capture` will need to switch to `>capture`. In practice, no such scripts can exist today because the underlying `--help` paths produced no output at all (latent bug). Tagged as `!` in the commit message accordingly.
- **No public API changes** in this PR. The `MigrationCLI.run` signature change ships in the execution PR.
- **No dep changes** in this PR. Adding `clipanion` is the first commit of the execution PR.
- **No test changes** in this PR. The execution PR adds tests test-first.
- **Migration-file CLI is unchanged in this PR** — the hand-rolled parser still ships. Existing behaviour is preserved end-to-end until the execution PR lands.

## Follow-ups / open questions

- **No-args and parent-no-subcommand exit codes** in the main CLI (e.g. `prisma-next` with no args, `prisma-next migration` with no subcommand) currently render help to stderr (correct under the new rule) but exit 0 (arguably should be PRECONDITION/exit 2 for consistency with the unknown-command path). FOLLOW-UP comments are inlined in [packages/1-framework/3-tooling/cli/src/cli.ts](packages/1-framework/3-tooling/cli/src/cli.ts); deferred to a separate exit-code-tightening pass.
- **No e2e test coverage for `prisma-next --help`** today. The latent-bug fix is verified manually for now; broader main-CLI `--help` test coverage is out of scope. The execution PR adds coverage for `MigrationCLI`'s `--help` only.

## Non-goals / intentionally out of scope

- Replacing Commander in `@prisma-next/cli`'s main multi-command surface. The friction-points doc is the input artifact for that future project.
- Adding new flags, subcommands, or global decoration flags (`--quiet`, `--json`, etc.) to the migration-file CLI. The surface stays at exactly `--help`, `--dry-run`, `--config <path>`.
- Renaming the `MigrationCLI` symbol or its module path.
