# Summary

Replace `prisma-next init`'s hand-rolled agent-skill template emission with an invocation of `@prisma-next/agent-skill` from [`usage-skill.spec.md`](usage-skill.spec.md). After this lands, every `prisma-next init` invocation registers the published, version-locked usage skill with the agent runtime at the project level, by default; the two hand-rolled per-target templates (`agent-skill-postgres.md`, `agent-skill-mongo.md`) and their renderer (`templates/agent-skill.ts`) are deleted. The change also adds two optional flags: `--install-user-skill` to additionally install the skill at the user level (with a marker file to prevent re-prompting), and `--no-skill` to skip installation for restricted environments (air-gapped, no-npm-registry). The new behavior is target-aware in the trivial sense — both Postgres and Mongo projects install the same `@prisma-next/agent-skill` package, because the published skill handles target-keyed content internally.

This spec depends on [`usage-skill.spec.md`](usage-skill.spec.md): the published `@prisma-next/agent-skill` package must exist on npm before `init` can install it. Until that lands, the existing hand-rolled-template behavior is retained.

# Context

## At a glance

Today, `prisma-next init` writes a hand-rolled `.agents/skills/prisma-next/SKILL.md` file into every scaffolded project using one of two static templates ([`packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md`](../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md), [`agent-skill-mongo.md`](../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-mongo.md)). The templates are interpolated with `{{schemaPath}}`, `{{schemaDir}}`, `{{dbImportPath}}`, `{{pkgRun}}`, `{{authoringLabel}}` and emitted via [`agentSkillMd()`](../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill.ts).

Two problems with the current shape:

1. **The templates fragment relative to the framework.** They are written once at scaffold time and never updated. As PN evolves, the user's `.agents/skills/prisma-next/SKILL.md` falls out of sync with the framework version they're on. There is no upgrade path; the user has to manually re-`init` (which would clobber their customizations) to get the new template content.
2. **The templates are far below the quality bar of what a real agent skill should look like.** They are ~67-line Markdown files with a fixed list of commands and one ORM example. They do not implement the SKILL.md skeleton, the description-tuning convention, capability-gap honesty, the bad/good code pattern, or any of the structure [`usage-skill.spec.md`](usage-skill.spec.md) defines. They are a stub that pre-dated the agent-skill design work.

The change is structurally simple: replace the FS-template emission with a subprocess invocation of `npx skills add @prisma-next/agent-skill`. The published skill is version-locked to the PN release the user just installed (because the project's `package.json` advertises that PN version after `pnpm install`, and the skill ships at the same version), so the local skill registration is always consistent with the framework. The two template files and their renderer are deleted from the CLI sources.

User-facing flow after the change:

```text
$ mkdir my-app && cd my-app
$ pnpm dlx prisma-next init
  ◇ Detected package manager: pnpm
  ◇ Scaffolding prisma-next.config.ts, prisma/schema.psl, prisma/db.ts ...
  ◇ Installing @prisma-next/postgres, @prisma-next/cli ...
  ◇ Registering @prisma-next/agent-skill with the agent runtime
    → 8 skills registered: prisma-next, prisma-next-quickstart, prisma-next-contract,
      prisma-next-migrations, prisma-next-migration-review, prisma-next-queries,
      prisma-next-runtime, prisma-next-debug
  ◇ Next steps: open the project in your IDE and start a chat.

$ open .
```

With `--install-user-skill`:

```text
$ pnpm dlx prisma-next init --install-user-skill
  ...
  ◇ Registering @prisma-next/agent-skill with the agent runtime
    → 8 skills registered at the project level
    → 8 skills registered at the user level
  ◇ Wrote ~/.config/prisma-next/init-state.json (marker; suppresses future prompts)
```

With `--no-skill`:

```text
$ pnpm dlx prisma-next init --no-skill
  ...
  ◇ Skipped agent-skill installation (--no-skill).
    To install later, run `npx skills add @prisma-next/agent-skill` in this project.
```

## Problem

The hand-rolled template is a pre-emptive scaffold from before the agent-skill design was settled. It does three things this spec replaces:

1. **It is the only thing telling agents about Prisma Next.** Without it, an IDE agent in a freshly-scaffolded PN project has no signal that PN is the framework in use. The hand-rolled template covers that bar weakly (it lists a few commands and one ORM example), but inadequately for any non-trivial task. The published `@prisma-next/agent-skill` covers it properly (eight skills, structured `SKILL.md`s, capability-gap honesty, foreign-ORM trigger words). The replacement makes the agent-side experience match the project-side promise.
2. **It cannot stay current.** A scaffolded project's `.agents/skills/prisma-next/SKILL.md` is whatever the template emitted at scaffold time; PN evolves, the template doesn't. Replacing with a published skill means the user's `npm view @prisma-next/agent-skill` tracks PN's actual version, and a `pnpm update @prisma-next/agent-skill` (or the upgrade-skill mechanism from [`upgrade-skill.spec.md`](upgrade-skill.spec.md)) pulls the latest skill content.
3. **It is not target-extensible.** Adding a third target (e.g. SQLite, a future warehouse target) means adding `agent-skill-sqlite.md`, plus the per-target branching across every workflow. The published skill is one artifact across targets (per [`usage-skill.spec.md`](usage-skill.spec.md)); a new target adds branching inside the skill bodies, not new template files in the CLI.

A secondary requirement is operational: some users will run `init` in restricted environments — air-gapped CI, networks without the npm registry, devcontainers without `npx` access — and need an escape hatch. The hand-rolled template "worked" in those environments (no network needed); the published-skill install requires network. The `--no-skill` flag provides the escape hatch with a clear error path.

## Approach

The change has five concrete pieces:

### 1. Replace `agentSkillMd()` emission with `npx skills add @prisma-next/agent-skill`

The current `filesToWrite` entry that emits `.agents/skills/prisma-next/SKILL.md` is removed. In its place, a new install step invokes the `skills` CLI as a subprocess after the package install step (so `@prisma-next/agent-skill` is on disk in `node_modules`). The invocation is the canonical `npx skills add @prisma-next/agent-skill` — or, if pnpm's `pnpm dlx skills add @prisma-next/agent-skill` is the project-installed equivalent, that. The implementer picks whichever matches the project's detected package manager (`pnpm` / `npm` / `yarn` / `bun`) following the same dispatch the existing install step uses (`formatAddArgs`, `formatAddDevArgs` in [`detect-package-manager.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/init/detect-package-manager.ts)).

The skill content reaches the project filesystem via whatever discovery layout `npx skills add` produces — that is the `skills` CLI's responsibility, not `prisma-next init`'s. The current `.agents/skills/prisma-next/` directory the hand-rolled template writes to is left for the `skills` CLI to populate (or for the agent runtime to discover separately, depending on `skills`' conventions); `init` does not pre-create the directory.

The two hand-rolled template files and their renderer are deleted:

- `packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md`
- `packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-mongo.md`
- `packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill.ts`

The corresponding `filesToWrite` entry and the `agentSkillMd` import in [`init.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/init/init.ts) are deleted. The `prisma-next.md` quick-reference (a human-glanceable per-project doc, sibling to `README.md`) is *retained* — it is not a skill and is not in scope of this change.

### 2. The install is project-level by default, user-level by opt-in flag

Project-level install is unconditional (modulo `--no-skill`; see piece 5). The `init` command always invokes `npx skills add @prisma-next/agent-skill` inside the scaffolded project's directory after the dependencies install step.

User-level install is opt-in via `--install-user-skill`. When the flag is passed, `init` additionally invokes `npx skills add @prisma-next/agent-skill` at the user level (the `skills` CLI's user-level flag; current convention is `--user` but the spec defers to the canonical CLI shape at implementation time). The two installs are independent — a user-level install does not affect the project-level install, and vice versa.

### 3. First-run prompt for user-level install

When the user runs `init` for the first time on a host (no marker file yet — see piece 4), and the run is interactive (TTY attached, no `--non-interactive` / `--yes` flag), the `init` CLI surfaces a Clack prompt offering the user-level install:

> Install `@prisma-next/agent-skill` at the user level so your agent uses it across every project you work on? (You can change this later with `npx skills remove --user @prisma-next/agent-skill`.) [Y/n]

A "yes" answer triggers the user-level install (equivalent to passing `--install-user-skill`). A "no" answer does nothing further. Either answer writes the marker file (piece 4) so the prompt does not appear again on subsequent `init` runs.

In non-interactive runs (no TTY, or `--non-interactive` / `--yes` passed), the prompt is skipped and the user-level install is not performed unless `--install-user-skill` was passed explicitly.

### 4. Marker file at `~/.config/prisma-next/init-state.json` (XDG-compliant)

After the user-level prompt fires (regardless of the answer), `init` writes a marker file at `${XDG_CONFIG_HOME ?? ~/.config}/prisma-next/init-state.json` with the shape:

```json
{
  "userSkillPromptShown": true,
  "shownAt": "2026-05-14T20:00:00Z",
  "answeredYes": true
}
```

The presence of this file suppresses the prompt on subsequent `init` runs on the same user account. The user can remove the file to re-trigger the prompt.

Passing `--install-user-skill` explicitly does *not* require the marker file — the flag is an unambiguous user intent and runs the install directly; the marker is then written so subsequent first-run prompts are also suppressed.

### 5. `--no-skill` flag for restricted environments

`init --no-skill` skips both the project-level install and the user-level prompt. The CLI emits a single info line:

> Skipped agent-skill installation (`--no-skill`). To install later, run `npx skills add @prisma-next/agent-skill` in this project.

The flag exists for environments where the `skills` install would fail or be inappropriate — air-gapped CI, no npm registry access, devcontainers without `npx`. It is the only escape hatch; the project-level install is otherwise unconditional.

A *failed* install (network down, registry unreachable, `npx skills` not installed) does not silently fall back to the hand-rolled template — it surfaces a structured `CliStructuredError` with exit code `INIT_EXIT_SKILL_INSTALL_FAILED` (new constant) and a remediation message naming `--no-skill` as the workaround. The user re-runs with `--no-skill` to proceed with scaffolding; the project is otherwise scaffolded successfully, just without the skill.

### 6. Target-awareness is internal to the skill, not to the CLI

Both Postgres and Mongo (and any future target) projects invoke the same `npx skills add @prisma-next/agent-skill` command. The published skill handles target-keyed content internally per [`usage-skill.spec.md`](usage-skill.spec.md) (skill bodies read `prisma-next.config.ts`'s `target:` field and branch their instructions). There is no `@prisma-next/agent-skill-postgres` / `-mongo` split.

This is structurally the cleanest piece of the change: removing the per-target template file fan-out shrinks the CLI's template surface area by two files and removes the implicit assumption that any future target requires a new template file in the CLI repo.

# Requirements

## Functional Requirements

### Default install behavior

- **FR1. Project-level install is unconditional.** Every successful `prisma-next init` invocation (with all preconditions satisfied) invokes `npx skills add @prisma-next/agent-skill` (or the package-manager-equivalent — `pnpm dlx skills add ...`, etc.) inside the scaffolded project's working directory, after the dependency install step. The exact CLI invocation follows the same package-manager dispatch the existing install step uses ([`detect-package-manager.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/init/detect-package-manager.ts)).

- **FR2. Target-agnostic install command.** The invocation is identical for Postgres and Mongo (and any future target). No per-target install logic. The skill itself handles target-keyed branching internally per [`usage-skill.spec.md`](usage-skill.spec.md).

- **FR3. Install happens after package install.** The skill install runs after `pnpm install` (or the package-manager equivalent) completes successfully. The skill install does *not* count as a precondition — its failure does not roll back the project scaffold; it exits with the skill-specific error code (FR8) and leaves the rest of the project on disk.

### User-level install

- **FR4. `--install-user-skill` flag.** A CLI flag that, when passed, additionally invokes the user-level install (`npx skills add --user @prisma-next/agent-skill` or the canonical equivalent at implementation time). The flag is opt-in.

- **FR5. First-run interactive prompt.** When `init` runs interactively (TTY attached, no `--yes` / `--non-interactive` flag) and the marker file (FR7) is absent, `init` shows a Clack prompt asking whether to install the skill at the user level. A "yes" triggers the user-level install; a "no" does nothing. Either answer writes the marker file (FR7).

- **FR6. Non-interactive default.** In non-interactive runs (no TTY, or `--yes` / `--non-interactive`), the user-level install does *not* happen unless `--install-user-skill` was passed explicitly. No prompt is shown, no marker file is written.

- **FR7. Marker file.** On first run (and on any explicit `--install-user-skill`), `init` writes a JSON marker file at `${XDG_CONFIG_HOME ?? ~/.config}/prisma-next/init-state.json`:

  ```json
  {
    "userSkillPromptShown": true,
    "shownAt": "<ISO-8601 timestamp>",
    "answeredYes": <true | false>
  }
  ```

  On Windows, the path is `%APPDATA%\prisma-next\init-state.json` (following the standard XDG-on-Windows fallback used elsewhere in Node tooling).

  The file's presence suppresses the FR5 prompt on subsequent `init` runs. The schema is forward-compatible — additional fields may be added in future versions; readers ignore unknown fields. The file is read-only at `0600` permissions to prevent unrelated processes from observing the prompt state.

### Opt-out for restricted environments

- **FR8. `--no-skill` flag.** A CLI flag that skips both the project-level install (FR1) and the user-level prompt/install (FR4, FR5). When passed, `init` emits a single info-level message naming the manual fallback (`npx skills add @prisma-next/agent-skill` in this project) and proceeds with the rest of the scaffold. No marker file is written.

- **FR9. Skill-install failure error.** A failure of the project-level install (network error, registry unreachable, `npx skills` not on PATH, exit code non-zero from the install subprocess) raises a `CliStructuredError` with a new exit code `INIT_EXIT_SKILL_INSTALL_FAILED` (added to [`exit-codes.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/init/exit-codes.ts)). The error message names:
  - The failing subcommand and its stderr.
  - `--no-skill` as the workaround.
  - The manual install command (`npx skills add @prisma-next/agent-skill`) for after-the-fact installation.

  The error is *non-rolling-back* — the project's scaffolded files stay on disk; the user can rerun `init --no-skill --reinit` or simply run the manual install command later. This matches the existing semantics of the dependency-install failure (`INIT_EXIT_INSTALL_FAILED`): scaffolding succeeded, just the post-scaffold step did not.

- **FR10. User-level install failure does not fail the run.** If `--install-user-skill` was passed (or the user answered yes to the prompt) and the user-level install fails, the run logs a warning naming the failure and the manual command (`npx skills add --user @prisma-next/agent-skill`) but does *not* exit non-zero. The user's project is otherwise scaffolded successfully; the failure is opt-in surface and should not block the user from continuing.

### Hand-rolled template removal

- **FR11. Template files deleted.** The two hand-rolled template files and the renderer are deleted from the CLI sources:
  - `packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md`
  - `packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-mongo.md`
  - `packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill.ts`

  The corresponding `agentSkillMd` import and `filesToWrite` entry in [`init.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/init/init.ts) are deleted. The `variables` array in [`templates/agent-skill.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill.ts) is no longer referenced from anywhere.

- **FR12. Quick-reference (`prisma-next.md`) is retained.** The per-project `prisma-next.md` quick-reference document (rendered by [`quickReferenceMd()`](../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/quick-reference.ts)) is *not* in scope of this change. It is a human-glanceable doc, not an agent skill, and the published skill set does not replace it. It continues to be emitted as before.

- **FR13. Re-init cleanup of the old skill file.** When `init --reinit` is invoked on a project that was scaffolded with an earlier version that wrote `.agents/skills/prisma-next/SKILL.md` directly, the reinit-cleanup step (see [`reinit-cleanup.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/init/reinit-cleanup.ts)) treats that legacy file as a stale artifact and deletes it. The published skill registers content in whatever location the `skills` CLI uses; the legacy file is not retained.

### Reinit semantics

- **FR14. Reinit re-runs the skill install.** `init --reinit` runs the skill install (FR1) the same way a fresh `init` does. The `skills` CLI is responsible for idempotency on its end (running `skills add` against an already-installed skill should be a no-op or a version refresh). If the `skills` CLI doesn't currently provide that idempotency, the implementer files a follow-up against the upstream tool and treats the redundant install as acceptable behavior for v1.

- **FR15. Reinit respects `--no-skill`.** `init --reinit --no-skill` skips the skill install on reinit, matching the fresh-init behavior. The flag is orthogonal to `--reinit`.

## Non-Functional Requirements

- **NFR1. No silent degradation.** A skill-install failure surfaces a structured error (FR9) — it does not silently fall back to the hand-rolled template, does not omit the skill quietly, does not assume the user wanted `--no-skill`. The error is the only way the user finds out.

- **NFR2. Install duration budget.** The project-level skill install adds at most ~10 seconds to a typical `init` run on a warm npm cache (the dominant cost is `npx skills add`'s own fetch + write). On a cold cache, the budget extends to whatever `npx skills add` itself takes; `init` does not impose an additional timeout.

- **NFR3. No backward-compat shim for the legacy template.** Once [`usage-skill.spec.md`](usage-skill.spec.md) lands and the published skill is on npm, the hand-rolled template is removed in the same PR that wires the new behavior. There is no flag to revert to the hand-rolled template, no fallback if the package can't be resolved (other than `--no-skill`).

- **NFR4. XDG-compliant marker file path.** The marker file location follows XDG Base Directory conventions (`$XDG_CONFIG_HOME` with `~/.config` fallback) on POSIX, and `%APPDATA%` on Windows. The path is implemented via the same helper the rest of the CLI uses (if one exists; otherwise the implementer adds a small helper at [`packages/1-framework/3-tooling/cli/src/utils/`](../../../packages/1-framework/3-tooling/cli/src/utils/)).

- **NFR5. Marker file is best-effort, not authoritative.** The marker file's job is to suppress a UX prompt. If it is missing on a subsequent run (deleted, permission failure, fresh user account), the prompt re-fires — that is the correct behavior. The CLI does not infer install state from the marker; it asks the user.

- **NFR6. Project-level install is idempotent in practice.** Running `init` twice on the same project (e.g. `init` then `init --reinit`) runs the skill install twice; whatever the `skills` CLI's idempotency guarantees are dictate the outcome. The CLI does not try to detect "skill already installed" and skip — that is a `skills`-side concern.

## Non-goals

- **Per-target skill packages.** No `@prisma-next/agent-skill-postgres` / `-mongo` split. Target-keyed content is internal to the skill (per [`usage-skill.spec.md`](usage-skill.spec.md)).
- **Bundling the skill content inside the CLI package.** The skill ships from the dedicated `@prisma-next/agent-skill` package on npm; the CLI does not vendor its content. The hand-rolled-template pattern is exactly what this spec removes.
- **A bespoke skill-install CLI.** `init` shells out to `npx skills add` (the canonical agent-skills install tool) rather than implementing its own discovery / placement logic. If the upstream tool's behavior or invocation changes, the implementer updates the subprocess invocation, not the project layout.
- **Auto-upgrading already-installed skills.** This spec does not modify any path that updates an existing project's skill version. The upgrade-skill mechanism from [`upgrade-skill.spec.md`](upgrade-skill.spec.md) is the supported mechanism for that, via the user running an upgrade flow.
- **Detecting and migrating from the legacy `.agents/skills/prisma-next/SKILL.md` file.** The reinit-cleanup step deletes it (FR13); there is no automated migration of customizations the user may have made to the legacy file. If the user customized the legacy template, they need to manually re-apply changes — typically by writing their own skill alongside `@prisma-next/agent-skill`, since editing the published skill in `node_modules/` won't persist across installs.

# Acceptance Criteria

- **AC1. Default install behavior.** `pnpm dlx prisma-next init` (run inside a fresh project directory) on a host with the published `@prisma-next/agent-skill` reachable on npm:
  - Scaffolds the project as before.
  - After the dependency install step, invokes `npx skills add @prisma-next/agent-skill` (or the package-manager equivalent).
  - The agent runtime's skill directory now contains the eight skills from `@prisma-next/agent-skill`.
  - Exit code: `INIT_EXIT_OK`.

  Covers FR1, FR2, FR3, the project spec's FR11.

- **AC2. Postgres and Mongo install the same package.** Running `init` with `--target postgres` and again with `--target mongo` produces the same `npx skills add @prisma-next/agent-skill` subprocess call (same arguments) in both runs. Covers FR2, the project spec's FR13.

- **AC3. `--install-user-skill` performs the user-level install.** `init --install-user-skill` invokes the project-level install *and* the user-level install. The marker file is written. The skills are reachable from another project on the same host without re-running `init`. Covers FR4, FR7, the project spec's FR12.

- **AC4. First-run interactive prompt fires.** With no marker file present, an interactive `init` run shows the Clack prompt asking about user-level install. A "yes" performs the install and writes the marker. A "no" performs no install and writes the marker. Subsequent runs do not show the prompt. Covers FR5, FR7.

- **AC5. Non-interactive run does not prompt.** `init --yes my-app` (or `init` invoked from a non-TTY context like a CI pipeline) does not show the prompt, does not perform a user-level install (unless `--install-user-skill` was passed), and does not write the marker file. Covers FR6.

- **AC6. `--no-skill` skips everything skill-related.** `init --no-skill` does not invoke `npx skills add` at all, does not show the prompt, does not write the marker file. It emits a single info line naming the manual fallback. Exit code: `INIT_EXIT_OK`. The scaffolded project is otherwise complete. Covers FR8.

- **AC7. Skill-install failure surfaces a structured error.** Simulate a `npx skills add` failure (e.g. by mocking the subprocess to exit non-zero, or running `init` against a registry the host can't reach). `init` exits with the new `INIT_EXIT_SKILL_INSTALL_FAILED` code. The error message names the failing subcommand, names `--no-skill` as the workaround, and names the manual install command. The scaffolded project's other files remain on disk. Covers FR9, NFR1.

- **AC8. User-level install failure is a warning, not a fatal.** Simulate a user-level install failure (e.g. lock-file conflicts in the user-level skills directory). The run exits `INIT_EXIT_OK`, logs a warning naming the failure and the manual command, and otherwise completes successfully. Covers FR10.

- **AC9. Hand-rolled templates are deleted.** After the change lands, `packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md`, `agent-skill-mongo.md`, and `agent-skill.ts` are removed from the source tree. The `agentSkillMd` import in `init.ts` is removed. `pnpm test` passes (no test references the deleted templates). Covers FR11, NFR3.

- **AC10. Quick-reference is retained.** The per-project `prisma-next.md` quick-reference is still emitted by `init`. Covers FR12.

- **AC11. Reinit cleans up legacy SKILL.md.** Take a project scaffolded with an earlier `init` (carrying a legacy `.agents/skills/prisma-next/SKILL.md`). Run `init --reinit`. The legacy file is removed. The new behavior (`npx skills add`) runs. Covers FR13, FR14.

- **AC12. `--reinit --no-skill` skips the install on reinit.** `init --reinit --no-skill` runs the reinit-cleanup (deleting the legacy SKILL.md if present) but does not run `npx skills add`. Covers FR15.

- **AC13. Marker file path is XDG-compliant.** On a Linux host, the marker file lands at `$XDG_CONFIG_HOME/prisma-next/init-state.json` (or `~/.config/prisma-next/init-state.json` if `XDG_CONFIG_HOME` is unset). On macOS, the same `~/.config/...` path (or honoring `$XDG_CONFIG_HOME` if set). On Windows, `%APPDATA%\prisma-next\init-state.json`. The file has the FR7 shape. Covers FR7, NFR4.

- **AC14. Marker file deletion re-triggers the prompt.** Delete the marker file between runs. The next interactive `init` shows the prompt again. The CLI does not assume the install state from any other signal. Covers NFR5.

- **AC15. New exit code is documented.** `INIT_EXIT_SKILL_INSTALL_FAILED` is added to [`exit-codes.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/init/exit-codes.ts), is documented in the CLI's README under the `init` exit codes table (if one exists), and is reachable from the structured error envelope (`CliStructuredError`). Covers FR9.

# Other Considerations

## Security

- **Subprocess invocation.** `init` runs `npx skills add @prisma-next/agent-skill` as a subprocess. Trust model: the user has just run `pnpm dlx prisma-next init`, which already trusts npm and the PN publish pipeline. The skill install adds no incremental trust requirement beyond what `init` already assumes.
- **Marker file permissions.** The marker file is written at `0600` (POSIX) so unrelated processes can't read the user-level-install state. Windows ACLs follow the default for files under `%APPDATA%`.
- **No secrets in the marker file.** The file records UX state only — whether the prompt has fired, when, and the answer. No credentials, no tokens.

## Cost

- **CLI binary size.** Removing the two template files and `agent-skill.ts` shrinks the CLI's vendored content by ~10KB. Negligible.
- **Install runtime cost.** The project-level install adds ~5–10s on warm caches, ~30s on cold caches. The user-level install is similar. Both are dominated by `npx skills add`'s own fetch + write, not by `init`.
- **CI cost.** The CLI's own test suite gains a few unit tests for the new flags and subprocess invocation; existing test patterns cover this with minimal additional fixture setup.

## Observability

- **Subprocess output.** `npx skills add`'s stdout/stderr is forwarded to the user's terminal (or captured into structured CLI output in `--json` mode). The implementer decides how to forward in non-interactive runs — at minimum, the subprocess's exit code is captured and surfaced.
- **Marker file is local.** Not telemetered anywhere. The CLI does not phone home about prompt outcomes.

## Data Protection

- The marker file records prompt-shown / answered state only. No personal data, no project state.

## Analytics

- Not applicable. Skill-install events are observable via the agent runtime (per [`usage-skill.spec.md`](usage-skill.spec.md)), not via `init`'s own telemetry.

# References

- [`usage-skill.spec.md`](usage-skill.spec.md) — the published skill package this spec installs. Hard dependency.
- [`upgrade-skill.spec.md`](upgrade-skill.spec.md) — the upgrade-skill mechanism the user runs to update an already-installed agent-skill to a newer version.
- [`package-json-versioning.spec.md`](package-json-versioning.spec.md) — the prerequisite that makes the agent-skill's version readable from the project's `package.json`.
- [TML-2514](https://linear.app/prisma-company/issue/TML-2514) — parent Linear ticket for the Prisma Next agent-skill project.
- [`packages/1-framework/3-tooling/cli/src/commands/init/init.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/init/init.ts) — the file this spec modifies.
- [`packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill.ts), [`agent-skill-postgres.md`](../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md), [`agent-skill-mongo.md`](../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-mongo.md) — the files this spec deletes.
- [`packages/1-framework/3-tooling/cli/src/commands/init/detect-package-manager.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/init/detect-package-manager.ts) — the package-manager dispatch the new install step reuses.
- [`packages/1-framework/3-tooling/cli/src/commands/init/exit-codes.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/init/exit-codes.ts) — the file that gains the new `INIT_EXIT_SKILL_INSTALL_FAILED` exit code.

# Open Questions

The substantive design questions were resolved during shaping (see [Decisions resolved during refinement](#decisions-resolved-during-refinement) below). Two residual implementer choices remain:

1. **Exact CLI invocation for `npx skills add` at user-level scope.** The `skills` CLI's flag for user-level scope is currently `--user`, but the spec defers to the canonical CLI at implementation time. If the canonical flag changes (e.g. to `--global` or `--scope user`), the implementer follows whatever the upstream tool documents. The spec pins the behavior (project-level by default; user-level on opt-in), not the exact flag.

2. **Subprocess output handling in `--json` mode.** When `init` is run with `--json` (machine-readable output), forwarding `npx skills add`'s human-readable stdout would pollute the JSON output. Two options:
   - Suppress the subprocess's stdout in `--json` mode and surface a single structured field (e.g. `agentSkillInstall: { ok: true, skillsRegistered: 8 }`) in the JSON output.
   - Stream the subprocess's stdout to stderr regardless of mode, and report only the structured field on stdout.

   **Default:** the second option (stream to stderr, structured field on stdout) — matches the existing CLI's pattern for the `pnpm install` subprocess. Implementer to confirm against the existing output schema in [`output.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/init/output.ts).

## Decisions resolved during refinement

- **Replace the hand-rolled template with a published-skill install.** The hand-rolled template never matched the eventual agent-skill design and cannot stay current as the framework evolves. The published skill is version-locked to PN (per [`usage-skill.spec.md`](usage-skill.spec.md)), so the user's installed skill tracks the framework version automatically. Rejected alternative: keep both, with the template as a "stub" until the published skill matures — leaves two surfaces to maintain and confuses the agent's input.
- **Project-level install is unconditional by default.** The user opted into Prisma Next by running `prisma-next init`; the skill is part of the Prisma Next experience. Skipping the install requires explicit `--no-skill`. Rejected alternative: opt-in by default — fails the Layer 1 onboarding-to-zero goal (the user has to know to run an extra command before the agent has any signal that PN is the framework).
- **User-level install is opt-in via flag + first-run prompt.** Project-level is enough for the user's current project; user-level is an extension to "every project on this host." Some users want it, some don't; the prompt asks once. Rejected alternative: user-level by default — too invasive for a one-off install.
- **Marker file is XDG-compliant JSON.** Standard pattern for CLI prompt-state persistence; works across POSIX and Windows. Rejected alternative: track state in `~/.prisma-next/` (non-XDG) — collides with PN-internal state if we ever add some.
- **`--no-skill` is the only escape hatch.** Restricted environments (air-gapped, no registry) need a way to skip the install; the flag is the documented path. Rejected alternative: auto-detect network failures and degrade silently — masks legitimate misconfigurations as success.
- **Skill-install failure is non-rolling-back.** The scaffold succeeded; the skill install is a post-scaffold step. Rolling back the scaffold on a skill-install failure would punish the user for a transient issue with a step they can re-run trivially. Rejected alternative: roll back on any failure — overzealous.
- **User-level install failure is a warning, not a fatal.** User-level install is opt-in surface; a failure should not block the user's main workflow (scaffolding their project). Rejected alternative: treat both project-level and user-level failures the same (both fatal) — punishes the user for opting into a nice-to-have.
- **Target-agnostic install command.** Both Postgres and Mongo invoke the same `npx skills add @prisma-next/agent-skill`; the skill handles target branching internally. Rejected alternative: per-target packages (`agent-skill-postgres`, `-mongo`) — fragments the install surface, doubles the publish artifact count, and the user mental model is unitary anyway.
- **Subprocess invocation, not vendored.** Use the canonical `skills` CLI rather than vendoring its placement logic into `prisma-next init`. Rejected alternative: implement skill discovery/placement inside the CLI — duplicates the upstream tool, drifts as the tool evolves, and the `skills` ecosystem is settling on its own conventions we should follow.
- **Quick-reference (`prisma-next.md`) is retained.** It is a human-glanceable per-project doc; the agent-skill replaces the *skill* but not the human-glanceable doc. Rejected alternative: also delete `prisma-next.md` — premature; the doc serves a different audience (developers reading their project root for a quick orientation) and the skill is not its replacement.
- **No automated migration of legacy SKILL.md customizations.** The hand-rolled template was a stub; customizations to it are unlikely to exist, and migrating them automatically would be over-engineered for a near-zero population. The reinit-cleanup deletes the legacy file; users who customized it are on their own to re-apply changes in a sibling skill alongside the published one. Rejected alternative: detect non-template content in the legacy file and copy it into a "user customizations" location — premature, and the agent-skill ecosystem already supports user-side skills sitting alongside published ones.
