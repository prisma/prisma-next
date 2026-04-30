# Project plan — Migration CLI: replace hand-rolled arg parser

- **Spec**: [`./spec.md`](./spec.md)
- **Reference**: [Commander friction points](research/commander-friction-points.md)
- **Linear**: [TML-2318](https://linear.app/prisma-company/issue/TML-2318/migration-cli-replace-handrolled-arg-parser-with-shared-cli-library)

## Approach

Tests-first, following the spec's acceptance criteria. The work decomposes
into five sequential commits, each independently reviewable. Total scope
is small (one parser swap + supporting test/error/doc updates) so a single
PR is appropriate.

The Style-Guide correction and main-CLI `--help` routing fix already
landed (commit `d6ae32e59` on this branch). The plan below covers what
remains.

## PN-CLI code allocation

`PN-CLI-4013` is the next free code in the cross-command 4xxx range
(used codes: 4001-4012, 4020, 4021). Allocated to:

```
errorMigrationCliUnknownFlag (PN-CLI-4013) — migration-file CLI received
 a flag it does not recognise. Includes the offending flag name and the
 list of known flags in `meta` for downstream consumers.
```

## Commits

### Commit 1 — Add `clipanion` dependency

**Goal**: install the library so subsequent commits can `import` it. Doing
this as its own commit makes the dependency change auditable and isolates
the lockfile churn from logic changes.

**Steps**:

- Add `clipanion` to `dependencies` in
 `packages/1-framework/3-tooling/cli/package.json`. Use the latest
 published 4.x version; let `pnpm add` choose.
- Run `pnpm install` from the workspace root to update
 `pnpm-lock.yaml` and `node_modules`.
- Confirm with `pnpm lint:deps` that no layering rule is violated by
 the new transitive dep graph.
- No code changes in this commit.

**Validation**:

- `pnpm build --filter @prisma-next/cli` succeeds.
- `pnpm typecheck --filter @prisma-next/cli` succeeds.

### Commit 2 — Add `errorMigrationCliUnknownFlag` factory + tests

**Goal**: land the new error before the parser uses it, in test-first style.

**Steps**:

- Add the factory to
 `packages/1-framework/1-core/errors/src/control.ts`, sited next to
 `errorMigrationCliInvalidConfigArg` (`PN-CLI-4012`). Signature:

 ```typescript
 export function errorMigrationCliUnknownFlag(options: {
 readonly flag: string;
 readonly knownFlags: readonly string[];
 }): CliStructuredError
 ```

 - `summary`: `Unknown migration CLI flag`
 - `domain: 'CLI'`, code `'4013'`
 - `why`: tells the user which flag was unknown, names it explicitly.
 - `fix`: lists known flags in copy-pasteable form, suggests
 `--help` to see them.
 - `meta`: `{ flag, knownFlags }` — agents can render their own
 "did you mean" suggestions from this.

- Re-export from `packages/1-framework/1-core/errors/src/exports/control.ts`
 alphabetically (between `errorMigrationCliInvalidConfigArg` and
 `errorMigrationPlanningFailed`).

- Re-export from
 `packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts` (it
 re-exports the full set used by the CLI).

- Tests in
 `packages/1-framework/1-core/errors/test/control.test.ts`, mirroring
 the style of the existing `errorMigrationCliInvalidConfigArg` tests
 around line 373:
 - `errorMigrationCliUnknownFlag` produces `PN-CLI-4013` envelope.
 - The envelope's `meta.flag` and `meta.knownFlags` round-trip the
 input correctly.
 - The `fix` text mentions the known flags by name.

**Validation**:

- `pnpm test --filter @prisma-next/errors` passes.
- `pnpm typecheck --filter @prisma-next/errors @prisma-next/cli` passes.

### Commit 3 — Rewrite `migration-cli.test.ts` for the new public surface

**Goal**: lock in the new test-friendly contract first, with the existing
parser still in place. Tests will fail; that's intentional — the next
commit makes them pass. (The repo's `AGENTS.md` rule says "Always write
tests before creating or modifying implementation".)

**Test-doubles approach**: replace the current pattern (mutate
`process.argv`, `vi.spyOn(process.stderr, 'write')`, read
`process.exitCode`) with a buffer-collecting `Writable` helper (custom
`PassThrough`-style) and explicit `argv` injection. Each test case calls:

```typescript
const stdout = new BufferStream();
const stderr = new BufferStream();
const exitCode = await MigrationCLI.run(
 pathToFileURL(migrationFile).href,
 FakeMigration,
 { argv: ['node', migrationFile, '--dry-run'], stdout, stderr },
);
expect(exitCode).toBe(0);
expect(stdout.text).toContain('--- migration.json ---');
```

**Steps**:

- Add a tiny `BufferStream` helper at the top of the test file (or in
 a new `test/helpers.ts` if it gets reused). Implements the minimum
 `Writable` surface clipanion needs (`write`, `end`); exposes a
 `.text: string` getter that returns the joined buffer contents.
- Rewrite each of the existing 14 test cases to use the new shape:
 1. Successful write of `ops.json` + `migration.json` → exit 0.
 2. `--dry-run` prints to stdout, no files written → exit 0.
 3. Target mismatch → PN-MIG-2006 in stderr, exit 1.
 4. Config not found → loader error in stderr, exit 1.
 5. Imported (not entrypoint) → silent no-op, exit 0.
 6. `--help` → "Usage" in stdout, exit 0. **Was previously stdout-by-accident; now stdout-by-spec.**
 7. `--config <path>` forwarded to `loadConfig` → exit 0.
 8. `--config=<path>` forwarded → exit 0.
 9. Existing `migration.json` bookends preserved → exit 0.
 10. Unparseable existing `migration.json` falls back to synthesized → exit 0.
 11. **`--config --dry-run` → PN-CLI-4012 in stderr, exit 2 (was 1).**
 12. **Bare trailing `--config` → PN-CLI-4012 in stderr, exit 2 (was 1).**
 13. Target-mismatch fails before stack-driven construction → exit 1.
 14. (Existing #13 was the last; we keep one slot for the test that
 verifies `process.argv` is *not* read when `argv` is injected.)

- Add two new test cases:
 - **Unknown flag** (`--frobnicate`) → PN-CLI-4013 in stderr,
 `meta.flag === '--frobnicate'`, `meta.knownFlags` includes
 `--help`, `--dry-run`, `--config`, exit 2.
 - **Help renders to stdout, not stderr** — explicit guard that
 `stderr.text` does not contain "Usage" when `--help` is passed
 (regression guard for the corrected Style Guide rule).

- Remove the test-suite-level `process.argv` save/restore and the
 `vi.spyOn(process.stderr, 'write')` setup. They're no longer needed
 because the new shape doesn't touch process globals from the test.

**Expected state**: at the end of this commit, `pnpm test --filter
@prisma-next/cli` is **failing** on the migration-cli tests. That's
correct: the implementation lands in commit 4.

**Why this isn't a smell**: this is the canonical "tests-first" pattern.
Reviewers can read commits 3 and 4 together to see the contract first,
then the implementation that satisfies it. The CI noise on commit 3 is
local to this branch and will be green by commit 4.

### Commit 4 — Replace the parser with clipanion

**Goal**: swap the implementation. Tests from commit 3 turn green.

**Implementation shape**:

```typescript
// migration-cli.ts (sketch — not literal code)
import { Cli, Command, Option, UnknownSyntaxError, UsageError } from 'clipanion';

class MigrationFileCommand extends Command {
 static usage = Command.Usage({
 description: 'Self-emit ops.json and migration.json from a class-flow migration',
 details: '...',
 examples: [
 ['Self-emit', '$0'],
 ['Preview without writing', '$0 --dry-run'],
 ['Use a non-default config path', '$0 --config ./custom.config.ts'],
 ],
 });

 dryRun = Option.Boolean('--dry-run', false, {
 description: 'Print operations to stdout without writing files',
 });

 config = Option.String('--config', {
 description: 'Path to prisma-next.config.ts',
 });

 async execute(): Promise<number> {
 // Orchestration — same as today, but reads `this.dryRun`,
 // `this.config`, `this.context.stdout`, `this.context.stderr`
 // instead of process globals. Returns the exit code.
 }
}

export class MigrationCLI {
 static async run(
 importMetaUrl: string,
 MigrationClass: MigrationConstructor,
 options: { argv?: readonly string[]; stdout?: Writable; stderr?: Writable } = {},
 ): Promise<number> {
 if (!importMetaUrl) return 0;
 if (!isDirectEntrypoint(importMetaUrl)) return 0;

 const argv = options.argv ?? process.argv;
 const stdout = options.stdout ?? process.stdout;
 const stderr = options.stderr ?? process.stderr;

 const cli = Cli.from([wireMigrationCommand(importMetaUrl, MigrationClass)]);
 // Use cli.process to do parse-only, so we can intercept clipanion's
 // UnknownSyntaxError/UsageError and translate to our PN envelope
 // before clipanion writes its own message.
 try {
 const cmd = cli.process(argv.slice(2));
 // ... feed cmd into the run path with injected streams ...
 } catch (err) {
 const exitCode = renderClipanionErrorAsPnEnvelope(err, stderr);
 process.exitCode = exitCode;
 return exitCode;
 }
 // ... rest of orchestration ...
 }
}
```

**Steps**:

- Implement `MigrationFileCommand` in `migration-cli.ts` (single file —
 no need to split until the surface grows). Move the existing
 orchestration (`loadConfig`, probe, `createControlStack`,
 `buildMigrationArtifacts`, write to disk) into a private function
 the command's `execute()` calls, parameterised on `{ stdout, stderr,
 importMetaUrl, MigrationClass }` derived from the run-time context.
- Implement the error-translation layer:
 - Catch `UnknownSyntaxError` (clipanion's "I don't know that flag"
 error) → translate to `errorMigrationCliUnknownFlag`. The
 known-flags list is derived from the `MigrationFileCommand`
 option declarations (extract from clipanion's command definition
 metadata, or hard-code the list — pragmatic call: hard-code it,
 derive a comment that says "must stay in sync with the option
 declarations above"). Exit 2.
 - Catch `UsageError` for the `--config` cases (missing-arg,
 followed-by-flag) → translate to the existing
 `errorMigrationCliInvalidConfigArg`. Exit 2.
 - Re-throw anything else (it's not a parse error → falls to the
 outer try/catch which handles runtime errors as exit 1).
- Replace `printMigrationHelp()` call with a no-op: clipanion handles
 `--help` automatically and renders to `context.stdout` (the
 corrected Style Guide path). The existing `if (args.help) { ... }`
 branch is removed because clipanion sets `cmd.help = true` and skips
 `execute()` itself.
- Update `MigrationCLI.run`'s signature: accept the optional third
 argument; default `argv`/`stdout`/`stderr` to process globals.
 Return `Promise<number>`.
- Update the catch-all error handler at the bottom of `run()` to use
 the injected `stderr` instead of `process.stderr.write` directly.
- Update the stale comment at the top of
 `packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts` —
 currently mentions "Commander.js argument validation"; replace with
 wording that covers both Commander (still used by the main CLI) and
 clipanion (used by the migration-file CLI). Surfaced by the m2
 implementer; tracked here to avoid being missed.
- Run the rewritten tests from commit 3 — they should now pass.

**Validation**:

- `pnpm test --filter @prisma-next/cli` passes (the rewritten tests
 from commit 3 + everything else in the package).
- `pnpm typecheck --filter @prisma-next/cli` passes.
- `pnpm lint:deps` passes.
- Manual smoke test: from one of the example apps, run a
 `migration.ts` with no flags, `--dry-run`, `--help`, and a bogus
 `--frobnicate` flag. Confirm against the spec's AC4/AC5/AC6.

**Decision points to resolve during implementation**:

- **Disable clipanion's default usage-on-error emission?** When
 `cli.process` throws `UnknownSyntaxError`, clipanion is no longer
 in charge of rendering — we are. Risk neutralised; nothing to
 disable. (If we ever switch to `cli.run`, revisit.)
- **`--help` short flag (`-h`)?** The current parser supports both
 `--help` and `-h`. Replicate by passing `Option.Boolean('--help,-h')`
 to clipanion, or use clipanion's built-in `-h` short flag (which
 it auto-registers; need to check). If clipanion auto-registers `-h`
 we get this for free; if not, declare it explicitly.

### Commit 5 — Delete `printMigrationHelp` from `@prisma-next/migration-tools`

**Goal**: complete the migration. With commit 4 landed, the migration-file
CLI no longer imports `printMigrationHelp`. Delete it from migration-tools.

**Steps**:

- Delete the `printMigrationHelp` function from
 `packages/1-framework/3-tooling/migration/src/migration-base.ts`.
- Remove the export from
 `packages/1-framework/3-tooling/migration/src/exports/migration.ts`.
- Update the `@prisma-next/migration-tools` README/docs if any
 reference the symbol (grep first).
- Confirm `pnpm typecheck --filter @prisma-next/migration-tools
 @prisma-next/cli` passes.
- Confirm `pnpm test:packages` passes (no in-tree consumer remains).

**Why this is its own commit**: the deletion is mechanically safe to
revert independently. Reviewers can see the removed export and trace
the lack of consumers in one diff.

### (Optional) Commit 6 — Doc maintenance

**Goal**: keep docs aligned per the `doc-maintenance` rule.

**Steps**:

- Update `@prisma-next/cli` README's "Internal Architecture" section
 (or equivalent) to mention clipanion's role in the migration-file
 CLI surface. Specifically: "the CLI's main multi-command surface
 uses Commander; the per-migration `MigrationCLI.run` entrypoint
 uses clipanion to keep authored migration files lightweight and
 in-process testable."
- Update `docs/architecture docs/subsystems/Migration System.md` (or
 wherever the migration-file CLI is described) if it mentions the
 hand-rolled parser.
- The Style Guide itself does not need further changes (the prep
 commit covered it).

This commit can be folded into commit 4 if it's small enough — gauge
during execution.

## Test plan

Lifted from spec AC6 + AC7, restated as a checklist:

- [ ] `pnpm test --filter @prisma-next/errors` passes (new factory test).
- [ ] `pnpm test --filter @prisma-next/cli` passes (rewritten
 migration-cli tests, plus 2 new scenarios).
- [ ] `pnpm test --filter @prisma-next/migration-tools` passes (after
 `printMigrationHelp` deletion).
- [ ] `pnpm test:packages` passes (no broader regression).
- [ ] `pnpm test:integration` passes for at least one example
 migration round-trip (manual: pick a representative one).
- [ ] `pnpm lint:deps` passes (new dep doesn't violate layering).
- [ ] `pnpm typecheck` passes for the affected packages.
- [ ] Manual smoke against an example migration:
 - [ ] `node examples/.../migration.ts` (no flags) → success, files written.
 - [ ] `node examples/.../migration.ts --dry-run` → success, stdout shows artifacts.
 - [ ] `node examples/.../migration.ts --help` → exit 0, help on stdout, `Usage` present.
 - [ ] `node examples/.../migration.ts --frobnicate` → exit 2, PN-CLI-4013 on stderr.
 - [ ] `node examples/.../migration.ts --config` (no path) → exit 2, PN-CLI-4012 on stderr.

## Sequencing rationale

Why this order? Each commit can land independently green, except commit
3 which is intentionally red (tests-first). The dependency graph:

```
1: dep ────────────────┐
 ├──► 4: parser swap ──► 5: delete dead export
2: error factory ──┬──► 3: tests-first (red)
 └────────► 4
```

Reviewer reads in order; nothing reverse-references future commits.

## Linear updates

- Move TML-2318 to **In Progress** when commit 1 lands on the branch.
- Link the PR to the issue (branch name `tml-2318-…` already does
 this; PR title or body should additionally mention `(TML-2318)` per
 the project workflow rule).
- Don't manually transition to Done — the GitHub integration handles
 it on PR merge.

## Close-out

After the PR merges:

1. Verify acceptance criteria from `spec.md` against `main` HEAD.
2. Move the friction-points doc to its long-term home. Two options:
 - `docs/architecture docs/research/commander-friction-points.md` —
 if we anticipate the broader Commander-replacement project
 starting soon and want the doc indexed by the docs system.
 - Leave it in `projects/migration-cli-arg-parser/research/` until
 the broader project is created, then copy/link from there.
 Recommend the second: it keeps `docs/` clean of speculative
 research material and the broader project will create its own
 `projects/<name>/` workspace where the friction-points doc
 naturally relocates.
3. Delete `projects/migration-cli-arg-parser/` per the transient-
 project rule. The friction-points doc moves with it (see step 2).
