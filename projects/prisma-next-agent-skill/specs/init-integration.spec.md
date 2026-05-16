# Summary

Replace `prisma-next init`'s hand-rolled agent-skill template emission with an invocation of `@prisma-next/agent-skill` from [`usage-skill.spec.md`](usage-skill.spec.md). After this lands, every `prisma-next init` invocation registers the published, version-locked usage skill with the agent runtime at the project level, by default; the two hand-rolled per-target templates (`agent-skill-postgres.md`, `agent-skill-mongo.md`) and their renderer (`templates/agent-skill.ts`) are deleted. The install is **always project-level** (locked to the project's Prisma Next version — see the decisions section); the change adds a single optional flag, `--no-skill`, to skip installation for restricted environments (air-gapped, no-npm-registry). The new behavior is target-aware in the trivial sense — both Postgres and Mongo projects install the same `@prisma-next/agent-skill` package, because the published skill handles target-keyed content internally.

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

With `--no-skill`:

```text
$ pnpm dlx prisma-next init --no-skill
  ...
  ◇ Skipped agent-skill installation (--no-skill).
    To install later, run `npx skills add @prisma-next/agent-skill --all` in this project.
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

### 2. The install is always project-level

Project-level install is unconditional (modulo `--no-skill`; see piece 3). The `init` command always invokes `npx skills add @prisma-next/agent-skill --all` inside the scaffolded project's directory after the dependencies install step.

There is no user-level / global install path. The skill's surface (commands it references, exit codes it expects, capability claims it makes) tracks the project's `@prisma-next/*` version, and a host-wide install would have to pick a single version for every project on the machine — breaking the version-locking invariant the rest of the framework relies on (skills, CLI, runtime, and extension packs all ship at the same version per release). Pinning per-project keeps every workspace coherent. Earlier drafts of this spec proposed an `--install-user-skill` flag and a first-run prompt with an XDG marker file; that surface was removed before implementation. The decisions section records the rationale.

The invocation passes `--all`, which auto-selects every skill in the published cluster and every agent runtime the `skills` CLI detects on the host machine, skipping the multi-select prompts the CLI shows by default. `init` runs as a non-interactive subprocess; prompting mid-scaffold would either hang or fail silently. The skill cluster is also designed to be installed as a unit — the router (`prisma-next`) routes between the workflow-scoped siblings, so any partial install would break the routing contract.

### 3. `--no-skill` flag for restricted environments

`init --no-skill` skips the project-level install. The CLI emits a single info line:

> Skipped agent-skill installation (`--no-skill`). To install later, run `npx skills add @prisma-next/agent-skill --all` in this project.

The flag exists for environments where the `skills` install would fail or be inappropriate — air-gapped CI, no npm registry access, devcontainers without `npx`. It is the only escape hatch; the project-level install is otherwise unconditional.

A *failed* install (network down, registry unreachable, `npx skills` not installed) does not silently fall back to the hand-rolled template — it surfaces a structured `CliStructuredError` with exit code `INIT_EXIT_SKILL_INSTALL_FAILED` (new constant) and a remediation message naming `--no-skill` as the workaround. The user re-runs with `--no-skill` to proceed with scaffolding; the project is otherwise scaffolded successfully, just without the skill.

### 4. Target-awareness is internal to the skill, not to the CLI

Both Postgres and Mongo (and any future target) projects invoke the same `npx skills add @prisma-next/agent-skill` command. The published skill handles target-keyed content internally per [`usage-skill.spec.md`](usage-skill.spec.md) (skill bodies read `prisma-next.config.ts`'s `target:` field and branch their instructions). There is no `@prisma-next/agent-skill-postgres` / `-mongo` split.

This is structurally the cleanest piece of the change: removing the per-target template file fan-out shrinks the CLI's template surface area by two files and removes the implicit assumption that any future target requires a new template file in the CLI repo.

# Requirements

## Functional Requirements

### Default install behavior

- **FR1. Project-level install is unconditional.** Every successful `prisma-next init` invocation (with all preconditions satisfied) invokes `npx skills add @prisma-next/agent-skill` (or the package-manager-equivalent — `pnpm dlx skills add ...`, etc.) inside the scaffolded project's working directory, after the dependency install step. The exact CLI invocation follows the same package-manager dispatch the existing install step uses ([`detect-package-manager.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/init/detect-package-manager.ts)).

- **FR2. Target-agnostic install command.** The invocation is identical for Postgres and Mongo (and any future target). No per-target install logic. The skill itself handles target-keyed branching internally per [`usage-skill.spec.md`](usage-skill.spec.md).

- **FR3. Install happens after package install.** The skill install runs after `pnpm install` (or the package-manager equivalent) completes successfully. The skill install does *not* count as a precondition — its failure does not roll back the project scaffold; it exits with the skill-specific error code (FR9) and leaves the rest of the project on disk.

### Install scope

- **FR4–FR7, FR10. Removed.** Earlier drafts of this spec required a user-level (global) install path, a `--install-user-skill` flag, a first-run interactive prompt for it, a Clack prompt UX, and an XDG marker file at `~/.config/prisma-next/init-state.json` to suppress re-prompting. That surface was removed before implementation: the skill cluster's behaviour and surface track the project's Prisma Next version, and a host-wide install would break the version-locking invariant the framework relies on (skills, CLI, runtime, and extension packs all ship at the same version per release). The install is **always project-level**. See the decisions section for the full rationale.

### Opt-out for restricted environments

- **FR8. `--no-skill` flag.** A CLI flag that skips the project-level install (FR1). When passed, `init` emits a single info-level message naming the manual fallback (`npx skills add @prisma-next/agent-skill --all` in this project) and proceeds with the rest of the scaffold.

- **FR9. Skill-install failure error.** A failure of the project-level install (network error, registry unreachable, `npx skills` not on PATH, exit code non-zero from the install subprocess) raises a `CliStructuredError` with a new exit code `INIT_EXIT_SKILL_INSTALL_FAILED` (added to [`exit-codes.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/init/exit-codes.ts)). The error message names:
  - The failing subcommand and its stderr.
  - `--no-skill` as the workaround.
  - The manual install command (`npx skills add @prisma-next/agent-skill --all`) for after-the-fact installation.

  The error is *non-rolling-back* — the project's scaffolded files stay on disk; the user can rerun `init --no-skill --reinit` or simply run the manual install command later. This matches the existing semantics of the dependency-install failure (`INIT_EXIT_INSTALL_FAILED`): scaffolding succeeded, just the post-scaffold step did not.

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

- **NFR4, NFR5. Removed.** These covered the deleted XDG marker file and its best-effort semantics.

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

- **AC3–AC5, AC8. Removed.** These criteria covered the deleted user-level install surface (`--install-user-skill`, first-run prompt, marker file, user-level failure warning). Numbering preserved (rather than re-shuffled) to keep the cross-references in adjacent ACs stable.

- **AC6. `--no-skill` skips the install.** `init --no-skill` does not invoke `npx skills add` at all. It emits a single info line naming the manual fallback. Exit code: `INIT_EXIT_OK`. The scaffolded project is otherwise complete. Covers FR8.

- **AC7. Skill-install failure surfaces a structured error.** Simulate a `npx skills add` failure (e.g. by mocking the subprocess to exit non-zero, or running `init` against a registry the host can't reach). `init` exits with the new `INIT_EXIT_SKILL_INSTALL_FAILED` code. The error message names the failing subcommand, names `--no-skill` as the workaround, and names the manual install command. The scaffolded project's other files remain on disk. Covers FR9, NFR1.

- **AC9. Hand-rolled templates are deleted.** After the change lands, `packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md`, `agent-skill-mongo.md`, and `agent-skill.ts` are removed from the source tree. The `agentSkillMd` import in `init.ts` is removed. `pnpm test` passes (no test references the deleted templates). Covers FR11, NFR3.

- **AC10. Quick-reference is retained.** The per-project `prisma-next.md` quick-reference is still emitted by `init`. Covers FR12.

- **AC11. Reinit cleans up legacy SKILL.md.** Take a project scaffolded with an earlier `init` (carrying a legacy `.agents/skills/prisma-next/SKILL.md`). Run `init --reinit`. The legacy file is removed. The new behavior (`npx skills add`) runs. Covers FR13, FR14.

- **AC12. `--reinit --no-skill` skips the install on reinit.** `init --reinit --no-skill` runs the reinit-cleanup (deleting the legacy SKILL.md if present) but does not run `npx skills add`. Covers FR15.

- **AC13, AC14. Removed.** These criteria covered the deleted XDG marker file path and re-triggering semantics.

- **AC15. New exit code is documented.** `INIT_EXIT_SKILL_INSTALL_FAILED` is added to [`exit-codes.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/init/exit-codes.ts), is documented in the CLI's README under the `init` exit codes table (if one exists), and is reachable from the structured error envelope (`CliStructuredError`). Covers FR9.

# Other Considerations

## Security

- **Subprocess invocation.** `init` runs `npx skills add @prisma-next/agent-skill --all` as a subprocess. Trust model: the user has just run `pnpm dlx prisma-next init`, which already trusts npm and the PN publish pipeline. The skill install adds no incremental trust requirement beyond what `init` already assumes.

## Cost

- **CLI binary size.** Removing the two template files and `agent-skill.ts` shrinks the CLI's vendored content by ~10KB. Negligible.
- **Install runtime cost.** The project-level install adds ~5–10s on warm caches, ~30s on cold caches, dominated by `npx skills add`'s own fetch + write, not by `init`.
- **CI cost.** The CLI's own test suite gains a few unit tests for the new flag and subprocess invocation; existing test patterns cover this with minimal additional fixture setup.

## Observability

- **Subprocess output.** `npx skills add`'s stdout/stderr is forwarded to the user's terminal (or captured into structured CLI output in `--json` mode). The implementer decides how to forward in non-interactive runs — at minimum, the subprocess's exit code is captured and surfaced.

## Data Protection

- The CLI writes no host-local state for the skill-install step. No personal data, no project state.

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

The substantive design questions were resolved during shaping (see [Decisions resolved during refinement](#decisions-resolved-during-refinement) below). One residual implementer choice remains:

1. **Subprocess output handling in `--json` mode.** When `init` is run with `--json` (machine-readable output), forwarding `npx skills add`'s human-readable stdout would pollute the JSON output. Two options:
   - Suppress the subprocess's stdout in `--json` mode and surface a single structured field (e.g. `agentSkillInstall: { ok: true, skillsRegistered: 8 }`) in the JSON output.
   - Stream the subprocess's stdout to stderr regardless of mode, and report only the structured field on stdout.

   **Default:** the second option (stream to stderr, structured field on stdout) — matches the existing CLI's pattern for the `pnpm install` subprocess. Implementer to confirm against the existing output schema in [`output.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/init/output.ts).

## Decisions resolved during refinement

- **Replace the hand-rolled template with a published-skill install.** The hand-rolled template never matched the eventual agent-skill design and cannot stay current as the framework evolves. The published skill is version-locked to PN (per [`usage-skill.spec.md`](usage-skill.spec.md)), so the user's installed skill tracks the framework version automatically. Rejected alternative: keep both, with the template as a "stub" until the published skill matures — leaves two surfaces to maintain and confuses the agent's input.
- **Project-level install is unconditional by default.** The user opted into Prisma Next by running `prisma-next init`; the skill is part of the Prisma Next experience. Skipping the install requires explicit `--no-skill`. Rejected alternative: opt-in by default — fails the Layer 1 onboarding-to-zero goal (the user has to know to run an extra command before the agent has any signal that PN is the framework).
- **No user-level / global install path.** The skill cluster's surface tracks the project's `@prisma-next/*` version — the commands it references, the exit codes it expects, the capability claims it makes, and the workflows it teaches all change with the framework. A user-level (`-g`) install would have to pick a single version for every project on the host, which breaks the version-locking invariant the rest of the framework relies on (skills, CLI, runtime, and extension packs all ship at the same version per release). Pinning per-project keeps every workspace coherent — the skill the agent reads in project A is the skill that matches project A's framework. Earlier drafts of this spec carried an `--install-user-skill` flag, a first-run Clack prompt, and an XDG marker file; all three were removed in favour of this single decision. Rejected alternatives: (a) user-level by default — too invasive and breaks version locking; (b) opt-in user-level via flag — same version-locking problem, plus the prompt UX added cost on every `init` for a feature that turned out not to be safe.
- **`--no-skill` is the only escape hatch.** Restricted environments (air-gapped, no registry) need a way to skip the install; the flag is the documented path. Rejected alternative: auto-detect network failures and degrade silently — masks legitimate misconfigurations as success.
- **Skill-install failure is non-rolling-back.** The scaffold succeeded; the skill install is a post-scaffold step. Rolling back the scaffold on a skill-install failure would punish the user for a transient issue with a step they can re-run trivially. Rejected alternative: roll back on any failure — overzealous.
- **Target-agnostic install command.** Both Postgres and Mongo invoke the same `npx skills add @prisma-next/agent-skill`; the skill handles target branching internally. Rejected alternative: per-target packages (`agent-skill-postgres`, `-mongo`) — fragments the install surface, doubles the publish artifact count, and the user mental model is unitary anyway.
- **Subprocess invocation, not vendored.** Use the canonical `skills` CLI rather than vendoring its placement logic into `prisma-next init`. Rejected alternative: implement skill discovery/placement inside the CLI — duplicates the upstream tool, drifts as the tool evolves, and the `skills` ecosystem is settling on its own conventions we should follow.
- **Quick-reference (`prisma-next.md`) is retained.** It is a human-glanceable per-project doc; the agent-skill replaces the *skill* but not the human-glanceable doc. Rejected alternative: also delete `prisma-next.md` — premature; the doc serves a different audience (developers reading their project root for a quick orientation) and the skill is not its replacement.
- **No automated migration of legacy SKILL.md customizations.** The hand-rolled template was a stub; customizations to it are unlikely to exist, and migrating them automatically would be over-engineered for a near-zero population. The reinit-cleanup deletes the legacy file; users who customized it are on their own to re-apply changes in a sibling skill alongside the published one. Rejected alternative: detect non-template content in the legacy file and copy it into a "user customizations" location — premature, and the agent-skill ecosystem already supports user-side skills sitting alongside published ones.
