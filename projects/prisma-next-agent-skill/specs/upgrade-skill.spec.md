# Summary

Define `@prisma-next/upgrade-skill` — a published agent skill, version-locked to Prisma Next, whose body is a versioned index of *upgrade recipes* an agent can read and execute to translate a project (or an extension) from one PN version to the next. Define the in-repo authoring workflow that mandates a validated recipe whenever a PR touches a public or extension-facing API surface, and the release-pipeline gate that enforces it.

# Context

## At a glance

Today, every PN breaking change costs the team a round of individual outreach: chase each user, chase each extension author, write or paste the fix into their codebase, hope nothing regressed. PN is at `0.6.1` and on the dev tag at `0.6.0-dev.17`; breaking changes are weekly. The existing user base is small but real (Cipherstash extension, two known customers), and the extension contract is rapidly evolving. The outreach process doesn't scale to even five active consumers, and won't scale at all once the strategy lands a partner like Supabase.

This spec defines a two-skill mechanism that replaces that outreach with an artefact agents consume:

1. **`@prisma-next/upgrade-skill`** — published, version-locked to PN. Its body is a versioned table of *upgrade recipes*, one per `(from-minor, to-minor)` transition. Each recipe is a single Markdown file (`recipe.md`) of agent instructions, with frontmatter declaring the breaking changes, audiences, and detection signals. The instructions may direct the agent to run a *colocated script* (TypeScript, bash, or a codemod — whichever is portable enough for the task); scripts sit next to `recipe.md` and are addressed by relative path. When a user (or their agent) upgrades PN, the agent reads the recipe(s) for the transition chain, follows the instructions, runs the result against the project, and verifies before committing.

2. **An in-repo agent skill at `.agents/skills/record-recipe/`** that fires when the change-making agent's PR touches surfaces a downstream consumer or extension author depends on. The signal is mechanical: if the agent's refactoring produced changes in [`examples/`](../../../examples/) or [`packages/3-extensions/`](../../../packages/3-extensions/), a recipe is required. The skill instructs the agent to (a) add a recipe entry for the in-progress version transition, (b) author any required colocated script, and (c) *run the recipe against those same `examples/` and `packages/3-extensions/` checkouts* and demonstrate it works — before the PR is allowed to merge.

The release-pipeline gate ties the two together: the `publish.yml` workflow refuses to ship a version whose diff against the previous published version touches `examples/` or `packages/3-extensions/` without a corresponding recipe directory present in `@prisma-next/upgrade-skill`. The PR-CI workflow enforces the same shape on every PR.

A user-facing flow, end-to-end:

```text
user> "upgrade Prisma Next"
agent> Current: @prisma-next/postgres@0.6.1
       Target:  @prisma-next/postgres@0.7.0  (latest)
       Transitions: 0.6 → 0.7
       Recipes to apply (1):
         - 0.6→0.7: migration.json manifest format change (script: strip-manifest-bookends.ts)
agent> Updates @prisma-next/upgrade-skill to 0.7.0 (matches target PN version)
agent> Bumps package.json: @prisma-next/postgres ^0.6.1 → ^0.7.0
agent> pnpm install
agent> Reads recipes/0.6-to-0.7/recipe.md, runs colocated strip-manifest-bookends.ts
       → 42 files rewritten
agent> Runs `pnpm typecheck && pnpm test` → green
agent> Done. 1 commit staged: "chore: upgrade @prisma-next/postgres to 0.7.0"
```

The same skill, different audience, for extension authors:

```text
ext-author> "upgrade Prisma Next"
agent> Detects extension role: @prisma-next/extension-cipherstash declares peerDependencies
agent> Reads recipes/0.6-to-0.7/recipe.md, filters changes[] by audience=extension-author
       - migration-json-bookend-drop: 1 file rewritten (same colocated script as users)
       - migration-metadata-spi-update: agent follows recipe prose to update SPI usage
agent> Runs `pnpm build && pnpm test` in extension → green
agent> Done. 1 commit staged.
```

## Problem

PN's API surface is converging — that's the explicit reason the project sits at `0.x`. Every week, [`scripts/determine-version.ts`](../../../scripts/determine-version.ts) computes the next minor bump from the latest stable. The team takes the freedom seriously: PR [#502](https://github.com/prisma/prisma-next/pull/502) ([TML-2512](https://linear.app/prisma-company/issue/TML-2512)) is a recent representative case — it strips `fromContract` / `toContract` from every `migration.json` on disk (the manifest goes from ~1400 lines to ~10), enforces the new schema via arktype `'+': 'reject'`, and ships a one-shot script ([`wip/strip-manifest-bookends.ts`](../../../wip/strip-manifest-bookends.ts) at PR time, *intended* to be re-housed) that regenerates manifests in place. PN ≥ 0.7 will fail to load any manifest that still carries the old fields; the script is the only sanctioned upgrade path. The PR's own description says: *"the only known external consumer is the Cipherstash extension; we are sending a heads-up directly with regeneration instructions."* That heads-up is the manual outreach this spec replaces.

The current escape valves are all manual and don't compose:

- **GitHub Releases** carry `--generate-notes` PR titles. Useful as a changelog; useless as an upgrade instruction. They describe *what changed*; they don't tell the consumer *how to keep working*.
- **PR descriptions** sometimes include scripts (PR #502 inlines a path to `wip/strip-manifest-bookends.ts --check`). The scripts are accurate at PR-merge time, then rot. They are not findable by an agent reading the user's project six weeks later.
- **Linear tickets** ([TML-2515](https://linear.app/prisma-company/issue/TML-2515) is the placeholder for the policy this spec produces) summarise the problem but produce no consumable artefact.
- **Direct messages** to extension authors (Cipherstash, internal Supabase work, etc.) scale to ~1 person.

Two consumer classes share the same pain on different surfaces:

- **PN users** depend on the public package API (`@prisma-next/postgres`, `@prisma-next/mongo`, the contract types in their `prisma/contract.d.ts`, the on-disk shape of `migration.json` and `ops.json`).
- **Extension authors** depend on the framework SPI (the package boundary at `@prisma-next/framework-components`, `@prisma-next/migration-tools`, the in-repo extensions under [`packages/3-extensions/`](../../../packages/3-extensions/) as canonical reference shapes).

A single PR can break either, both, or neither. PR #502 broke both. The cost today is the *change author* spending time chasing each affected party; the cost we want is the change author writing one recipe alongside the change.

## Approach

The settled approach is the two-skill mechanism described in *At a glance*, plus the publish-gate that enforces co-shipping. The four mechanisms are:

**(A) Published skill, recipe-keyed.** `@prisma-next/upgrade-skill` is the consumer-facing artefact, distributed via npm. Its source lives in this repo as a workspace package at [`packages/0-shared/upgrade-skill/`](../../../packages/0-shared/upgrade-skill/) (creating the `0-shared` tier; see Open Questions for naming) and is published alongside every PN release via the `publish.yml` workflow. Each release of the skill contains *every* recipe from `0.6 → 0.7` onward; older users see no recipe set and are pointed at the release notes for hand-migration. The skill's content is organised for organic exploration: a small `SKILL.md` entry names the available transitions; recipe bodies sit under `recipes/<from>-to-<to>/` so the agent only loads what it needs.

**(B) Per-transition recipe shape.** One directory per `(from-minor, to-minor)` transition. The directory contains exactly one `recipe.md` (the agent-instruction file, with frontmatter declaring the breaking changes, audiences, and detection signals — FR7), plus any number of *colocated scripts* the markdown references by relative path. Scripts are portable by choice — TypeScript via `pnpm exec tsx`, bash, codemods (`jscodeshift`, AST-based)  — whichever fits the change. Patch transitions never need recipes (NFR4); minor bumps without any `examples/` or `packages/3-extensions/` diff don't need them either (Q5 default: no empty recipes). Multiple breaking changes within a single transition collapse into one `recipe.md` with multiple entries in its frontmatter's `changes[]` array.

**(C) In-repo recipe-authoring skill.** A new agent skill at [`.agents/skills/record-recipe/`](../../../.agents/skills/record-recipe/) (the cross-tool skills location both Claude and Cursor read) fires when the change-making agent's PR has changes in `examples/` or `packages/3-extensions/`. That signal is the natural consequence of breaking-change refactoring: a real API break either fails the type-check or the test suite in at least one downstream consumer, and the agent fixing those failures necessarily produces diffs there. The skill's content instructs the agent to: (1) add or update the recipe directory for the in-progress version transition; (2) author any colocated script the recipe needs; (3) *run the recipe against the in-repo substrate* — every example app under [`examples/`](../../../examples/) whose tests were red without the recipe, every extension under [`packages/3-extensions/`](../../../packages/3-extensions/) similarly affected — starting from each substrate's *pre-API-change* state and ending with a green `pnpm typecheck && pnpm test`; (4) commit the substrate's post-recipe state on the PR branch alongside the recipe itself.

**(D) Publish-gate.** The `publish.yml` workflow gains a step `check:recipe-coverage`. The check is intentionally simple: if the diff between the version about to be published and the previous published version touches `examples/` or `packages/3-extensions/`, a recipe directory must exist at `packages/0-shared/upgrade-skill/recipes/<from-minor>-to-<to-minor>/`. If the diff doesn't touch those paths, the check is vacuously satisfied. Patch releases (NFR4) skip the check. The same check runs in PR CI against the version `scripts/determine-version.ts` would produce if the PR merged. The gate does *not* attempt to verify recipe contents against a synthesised API-surface diff — that quality bar is delivered by FR11's validation-by-execution at PR time, run by the change-making agent.

The cross-cutting invariants this whole mechanism rests on:

- **Source co-location.** The upgrade skill's body is source-controlled in this repo as a workspace package. The recipe authored on a PR and the API change it covers are in the same diff, reviewed together, merged together, published together.
- **Version locking by construction.** Every PN release publishes `@prisma-next/upgrade-skill@<same-version>`. A user at PN `0.6.1` who installs `@prisma-next/upgrade-skill` gets the `0.6.1`-tagged version, whose recipe set covers all transitions up to and including `0.6.x → 0.7.x`. They cannot be left at a recipe set that doesn't cover their target.
- **Validation-by-execution, not by review.** The agent demonstrates the recipe works by running it on the in-repo substrate; the human reviewer never has to vouch for correctness on cases they didn't run. Substrate quality is enforced by the existing example-app and extension test suites (`pnpm test:examples`, `pnpm test --filter='./packages/3-extensions/*'`). The reviewer's job is to confirm the recipe exists, looks reasonable, and the PR was green; they do not re-derive the API-surface diff by hand.
- **Detection is mechanical.** The signal that a recipe is required is *not* an API-surface inference engine. It is `examples/` or `packages/3-extensions/` touched. The agent making the breaking change discovers the signal naturally — they had to update those files to keep the workspace's tests green. The skill's content names the signal; the publish gate checks it; the human reviewer sees it.

### Release sequencing

This spec's mechanism lands on the current branch ([`tml-2514`](https://linear.app/prisma-company/issue/TML-2514)) *without* any recipe entries. The mechanism's first practical use is PR [#502](https://github.com/prisma/prisma-next/pull/502) ([TML-2512](https://linear.app/prisma-company/issue/TML-2512)): PR #502 is rebased onto the mechanism, its existing `wip/strip-manifest-bookends.ts` script is re-housed at `packages/0-shared/upgrade-skill/recipes/0.6-to-0.7/strip-manifest-bookends.ts`, a `recipe.md` is authored describing the change, and PR #502 merges with the recipe in place. The next stable release (`0.7.0`) is the first to exercise the publish gate end-to-end and the first to publish `@prisma-next/upgrade-skill@0.7.0` to npm.

Until PR #502 lands, the publish gate sees no `examples/` or `packages/3-extensions/` diff in any release and is vacuously satisfied. The mechanism is dormant infrastructure during that window, which is acceptable — no consumer has installed it yet.

# Requirements

## Functional Requirements

### Published skill — `@prisma-next/upgrade-skill`

- **FR1. Distribution.** The skill is published to npm as `@prisma-next/upgrade-skill` and installable via `npx skills add @prisma-next/upgrade-skill`. Publishes from the same workflow run that publishes the rest of the PN packages — npm OIDC trusted publishing, no separate channel.
- **FR2. Version-locking.** Every published PN release publishes `@prisma-next/upgrade-skill` at the same version. The publish workflow refuses to ship one without the other (see FR15).
- **FR3. Skill shape — organic exploration.** The skill's `SKILL.md` is a small entry point that lists the available recipe transitions and tells the agent how to find a recipe for a given `(from, to)`. Recipe bodies live in `recipes/<from>-to-<to>/recipe.md` and are referenced by name from `SKILL.md`; the agent does not load them all up front. The entry point fits in well under 500 lines (target: <100).
- **FR4. Recipe registry.** Each release contains the cumulative recipe set from `0.6 → 0.7` up to the release's version. Earlier transitions (`0.5 → 0.6` and below) are not backfilled (Q10); users on pre-0.6 versions are pointed at GitHub Release notes for hand-migration. Old recipes, once written, are never removed.

### Recipe layout

- **FR5. Per-transition directory.** Each recipe lives at `recipes/<from-minor>-to-<to-minor>/`. Patch versions do not have recipes (NFR4). Minor bumps without any `examples/` or `packages/3-extensions/` diff produce no recipe directory (Q5). Multi-step transitions (e.g. `0.6 → 0.9`) are applied by chaining the per-minor recipes in order (FR18).

- **FR6. Recipe contents.** A recipe directory contains:

  - **`recipe.md`** — always present. The agent-instruction Markdown file. Includes a frontmatter block (FR7) and a prose body that describes each breaking change and what the agent should do per audience. The prose may inline code snippets the agent runs verbatim, name shell commands to invoke, or reference a colocated script by relative path.
  - **Zero or more colocated scripts**, in whichever portable form fits the change: `*.ts` (run with `pnpm exec tsx`), `*.sh` (run with `bash`), codemods (e.g. `*.codemod.cjs` invoked via `jscodeshift`), or any other portable executable. Filename is the script's name; no `user.*` / `extension.*` prefix convention is required. The recipe's prose names the script by relative path, e.g. *"For each match, run `./strip-manifest-bookends.ts <path>`"*. Scripts must be portable: no environment-specific assumptions beyond `pnpm` and the user's checkout (NFR7).

  A `recipe.md` without any colocated scripts is valid — the agent follows the prose directly. A directory with scripts but no `recipe.md` is not valid; `recipe.md` is always the entry point.

- **FR7. Recipe metadata (frontmatter of `recipe.md`).** Each `recipe.md` carries a YAML frontmatter block of the following illustrative shape:

  _Illustrative — exact field names are up to the implementer; the information content is what's pinned:_

  ```yaml
  ---
  from: "0.6"
  to: "0.7"
  changes:
    - id: "migration-json-bookend-drop"
      summary: "migration.json no longer carries fromContract / toContract"
      audiences: [user, extension-author]
      detection:
        # The detector is a glob + a content predicate. If any matching file
        # exists and matches the predicate, this change applies. If a recipe
        # entry has no detection, it applies unconditionally — useful for
        # changes that require agent reasoning across the whole codebase.
        - { glob: "**/migrations/**/migration.json", contains: '"fromContract"' }
      script: ./strip-manifest-bookends.ts   # optional; if absent, agent follows the prose body
    - id: "migration-metadata-spi-update"
      summary: "MigrationMetadata interface drops two fields"
      audiences: [extension-author]
      detection:
        - { glob: "**/*.ts", contains: "MigrationMetadata" }
      # no script — agent follows the prose body in recipe.md
  ---
  ```

  The frontmatter's `changes[]` is what the agent enumerates to plan the upgrade. The shape pins the *information* required (per-change id, summary, audiences, detection, optional script reference); it does not pin field names — those are implementer's choice. Audiences are at least `user` and `extension-author`; future audiences (e.g. *target-author* if PN ever opens the target SPI publicly) may be added by extending the enum.

### In-repo recipe-authoring skill

- **FR8. Skill location.** An agent skill at `.agents/skills/record-recipe/` (the cross-tool skills location both Claude and Cursor read from in this repo). The skill's `description` field is the firing surface; it does *not* require any CI hook to be consulted (FR14's outcome check covers the same concern by other means).

- **FR9. Detection signal.** The skill's content names a single, mechanical signal that a recipe is required:

  > **If your PR has changes in `examples/` or `packages/3-extensions/` that you made as a consequence of refactoring the framework (i.e., type-check or test failures you fixed by following the compiler / test runner into those paths), you must add a recipe.**

  No exhaustive API-surface list. No diff-tool inference. The natural consequence of a real breaking change is that at least one downstream consumer in `examples/` or `packages/3-extensions/` fails; the agent fixing those failures sees the signal directly. The reviewer sees the same signal in the PR diff. The publish gate (FR13) and PR-CI gate (FR14) enforce the *outcome* (recipe present when the signal fires); they do not try to validate the trigger logic.

- **FR10. Authoring workflow.** When fired, the skill walks the agent through:

  1. Determine the in-progress version transition. From-version is the current `latest` (`npm view @prisma-next/postgres dist-tags.latest`); to-version is what `scripts/determine-version.ts` would produce if the PR merged. If both fall in the same `<minor>.x` range, the PR is a patch — no recipe needed.
  2. Find or create the recipe directory at `packages/0-shared/upgrade-skill/recipes/<from-minor>-to-<to-minor>/`. If the directory already exists (an earlier PR on the same transition created it), append a new entry to the existing `recipe.md`'s `changes[]` instead of creating a duplicate directory.
  3. Write the change entry in `recipe.md`'s frontmatter, and add a prose section describing what the agent must do per audience.
  4. Author any colocated scripts the recipe references.
  5. Validate by execution (FR11).
  6. Commit on the PR branch.

- **FR11. Validation-by-execution.** The skill instructs the agent to run the new recipe against the in-repo substrate:

  - For changes affecting `audiences: [user]`: against every example app under `examples/` whose tests are red without the recipe (which is the same set the agent's refactoring already touched). The acceptance criterion is `pnpm test:examples` green after recipe application.
  - For changes affecting `audiences: [extension-author]`: against every in-repo extension at `packages/3-extensions/*` whose source is red without the recipe. The acceptance criterion is `pnpm test --filter='./packages/3-extensions/*'` green after recipe application.
  - Workflow concretely: the agent (i) checks out the PR branch with the API change applied, (ii) reverts the substrate's changes in `examples/` and `packages/3-extensions/` to the pre-PR state, (iii) runs the recipe against that reverted substrate, (iv) verifies the resulting substrate matches the substrate state on the PR branch *and* that `pnpm typecheck && pnpm test` is green. If both hold, the recipe is correct; if either fails, the agent iterates on the recipe.

- **FR12. PR commit shape.** The PR that introduces the breaking change must include, in addition to the API change itself:

  - The new recipe directory (`recipe.md` plus any colocated scripts).
  - The post-recipe state of every affected example app and in-repo extension — these would have been left broken without the recipe; the recipe's effect on the substrate *is* the diff that brings them back to green.
  - A reference in the PR description naming the recipe directory (e.g. *"Adds `packages/0-shared/upgrade-skill/recipes/0.6-to-0.7/`."*).

  Human reviewer + agent both check this shape. The CI gate (FR14) catches the structural case where the substrate diff is present without a recipe; the reviewer catches the case where the recipe exists but its prose / scripts don't match the API change.

### Release-pipeline gate

- **FR13. Pre-publish coverage check.** The `publish.yml` workflow gains a step `check:recipe-coverage` that runs after `check:publish-deps` and before the actual publish. The check is intentionally simple:

  1. Resolve the target version (the workflow's `steps.version.outputs.version`) and its minor (`X.Y`).
  2. Resolve the previous published version's minor (`X.Y-prev`) — for stable releases, the prior `latest` tag from npm; for `dev`/`beta` tags, the prior tag at the matching dist-tag.
  3. If `X.Y == X.Y-prev` (this is a patch release), skip the check (NFR4).
  4. Compute `git diff <prev-release-tag>..HEAD -- examples/ packages/3-extensions/` (excluding the conventional generated paths — `contract.json`, `contract.d.ts`, `end-contract.json`, `end-contract.d.ts` — which regenerate mechanically and don't signal an API break).
  5. If the diff is non-empty, assert a recipe directory exists at `packages/0-shared/upgrade-skill/recipes/<X.Y-prev>-to-<X.Y>/`. If the diff is empty, the check is vacuously satisfied.
  6. If the recipe directory is missing, the workflow fails with a structured error naming the expected path and pointing at the in-repo `record-recipe` skill.

- **FR14. PR-CI fail-fast.** The PR-CI workflow runs the same check against the version `scripts/determine-version.ts` would produce if the PR merged, comparing the PR diff against the current `main` tip. A missing recipe fails the PR. This is the early-warning version of FR13 — the change author sees the failure on their PR, not at release time, and can author the recipe before review.

- **FR15. Upgrade-skill publish.** A new job in `publish.yml` publishes `@prisma-next/upgrade-skill` from `packages/0-shared/upgrade-skill/` to npm at the same version as the rest of the PN packages. The job is part of the same `pnpm -r publish` step that the workflow already runs — `@prisma-next/upgrade-skill` is just another workspace package picked up by the recursive publish. NFR8's atomicity invariant follows from the existing workflow's `concurrency` group and single-job-per-run structure: if the publish step fails for any package, the whole run is marked failed and the maintainer is alerted.

### Consumer-side flow

- **FR16. Agent-driven upgrade trigger.** The published skill's `SKILL.md` `description` field fires when an agent is asked to "upgrade Prisma Next", or detects a PN version bump in a user's `package.json` it itself is about to make. (Skill registries don't pin trigger semantics — `description` is text the registry indexes, and agents match against it.) Exact wording of the `description` is implementer's choice but must include the words `upgrade Prisma Next`.

- **FR17. Version detection.** When invoked, the agent reads the user's project state to determine:

  - **From-version.** The currently-installed PN version, from `pnpm-lock.yaml` (or `package-lock.json` / `yarn.lock`). If the lockfile shows multiple PN packages at different minor versions (which would already be broken), the lowest minor wins as the from-version.
  - **To-version.** Either the version the user specified ("upgrade to 0.7"), or the latest stable from `npm view @prisma-next/postgres dist-tags.latest`.

- **FR18. Transition chain.** If the from-to delta spans multiple minor versions, the agent applies recipes in order: `0.6 → 0.7 → 0.8 → 0.9`, halting at the first failed recipe.

- **FR19. Role detection.** The agent determines audience by inspecting `package.json`:

  - **User**: `package.json` does not declare `@prisma-next/*` packages as `peerDependencies`. (Extensions declare them as peers.)
  - **Extension author**: `package.json` declares `@prisma-next/*` packages as `peerDependencies`, or the package name matches `^@.*/extension-`.

  If detection is ambiguous, the agent asks the user.

- **FR20. Per-transition execution.** For each `(from, to)` step in the chain, the agent:

  1. Updates `@prisma-next/upgrade-skill` itself to the to-version (so the skill content matches the target PN version).
  2. Reads `recipes/<from>-to-<to>/recipe.md`, parses the frontmatter, filters `changes[]` by `audiences` matching the detected role.
  3. For each change, runs detection against the project. If no files match, skips the change. If a change has no `detection`, applies unconditionally.
  4. For each matched change, executes the recipe's instructions: either invoke the colocated script named by `script` (via `pnpm exec tsx` for `*.ts`, `bash` for `*.sh`, `jscodeshift` or similar for codemods), or follow the prose in `recipe.md`.
  5. After all changes in the recipe complete, bumps the PN package versions in `package.json` and runs `pnpm install`.
  6. Runs validation: `pnpm typecheck && pnpm test` (or the project's equivalent — implementer to specify the discovery rule). If green, proceed to the next transition. If red, stop and surface to the user (NFR5).

## Non-Functional Requirements

- **NFR1. Recipe authoring overhead.** Adding a recipe entry to an in-progress PR — including running validation — must not add more than ~30 minutes of agent time per breaking change to the typical PR.
- **NFR2. Consumer-side upgrade time.** A single-transition upgrade (e.g. `0.6 → 0.7`) against a representative project (one of the example apps) must complete in under 5 minutes of wall-clock time, including install, recipe execution, and validation.
- **NFR3. Idempotency.** Every recipe script must be safe to re-run. Running a recipe twice in succession against the same project produces the same final state as running it once. This is enforced by FR11's validation step rerunning the recipe and asserting a no-op diff.
- **NFR4. Patch-version stability.** Patch versions (`0.6.0 → 0.6.1`) must not require a recipe — by policy, patches are bug-fix-only and must not produce any `examples/` or `packages/3-extensions/` diff except for the conventional generated paths excluded by FR13. The publish-gate skips the coverage check for patch bumps; if a patch bump *did* produce a substrate diff, the team has either mis-classified the change (should have been a minor bump) or the change shouldn't be merging at all.
- **NFR5. Recipe failure surfaces a structured error.** A recipe script failure must produce a PN-style structured error envelope with a stable code (`PN-UPGRADE-NNNN`), naming the failing change, the file(s) the script was operating on, and the inferred remediation. The agent surfaces this to the user; the user is not asked to read script stack traces.
- **NFR6. Skill body size.** The published `SKILL.md` body is small enough to load into any reasonable agent's context window in one go (target: <8KB). Recipe bodies and colocated scripts are referenced by name, not inlined.
- **NFR7. No secrets in recipes.** Recipe scripts must not require environment variables, network access, or any input beyond the project's filesystem and the recipe's bundled assets. (This is what makes them safe to ship publicly and to run automatically.)
- **NFR8. Publish atomicity.** `@prisma-next/upgrade-skill` is published as part of the same `pnpm -r publish` step that publishes every other PN package; if any package fails to publish, the workflow fails as a whole and the maintainer is alerted. There is no separate publish channel that could leave the upgrade skill out of sync with the rest of the release.

## Non-goals

- **Downgrade ("downgrade Prisma Next" or `0.7 → 0.6`).** Recipes are forward-only. A user who installs an older PN version is on their own.
- **Cross-major-version compounds without intermediate stable releases.** When PN reaches `1.0`, there will be a `0.x → 1.0` recipe; pre-1.0, we're in single-line minor bumps and don't need to model branching version histories.
- **Non-PN breaking changes.** Postgres major bumps, Node major bumps, `pnpm` major bumps — out of scope. Recipes describe PN's own evolution only.
- **Replacing release notes.** Recipes complement, not replace, the auto-generated GitHub Release notes (the conventional-commit-derived changelog from `.github/PULL_REQUEST_TEMPLATE.md`).
- **Recipes for changes to *internal* package boundaries** (i.e. dependencies among PN's own workspace packages that aren't visible at the published-package surface). The detection signal — `examples/` or `packages/3-extensions/` diff — already excludes these; internal-only refactors don't break consumers.
- **Translating queries written in `db.sql` raw mode.** Raw SQL is opaque to the contract; if a PN release changes the contract-driven generation pipeline in a way that breaks a raw SQL string a user wrote, the user is on their own (the existing `db.orm` path is the recipe-safe surface).
- **Bundling user-provided assets into recipes.** A recipe can read the user's project; it cannot push or fetch arbitrary assets.

# Acceptance Criteria

- [ ] **AC1. End-to-end upgrade against a representative app.** Take a checkout of [`examples/prisma-next-demo/`](../../../examples/prisma-next-demo/) at PN `0.6.x` (pre-PR-#502 manifest shape), bump PN to `0.7.x` in `package.json`, run the agent with `@prisma-next/upgrade-skill@0.7.0` installed. The agent reads `recipes/0.6-to-0.7/recipe.md`, follows its instructions (which invoke the colocated `strip-manifest-bookends.ts`), `pnpm install` + `pnpm typecheck && pnpm test` are green, the resulting `migration.json` files match the post-PR-#502 manifest shape, no manual intervention was required. Covers FR1, FR3, FR5–FR7, FR16–FR20, NFR2.

- [ ] **AC2. Multi-transition chain.** Once a `0.7 → 0.8` recipe exists, run the same scenario starting from PN `0.6.x` and upgrading to `0.8.x`. The agent applies `0.6 → 0.7 → 0.8` recipes in order; final state is green. Covers FR18, FR4. *(Deferred-until-available; harmless to skip until the second recipe lands.)*

- [ ] **AC3. Extension-author flow.** Take a checkout of [`packages/3-extensions/cipherstash/`](../../../packages/3-extensions/cipherstash/) at PN `0.6.x`. Bump PN to `0.7.x`. The agent detects extension-author role from `package.json` `peerDependencies`, applies entries in `changes[]` whose `audiences` include `extension-author`, runs `pnpm test --filter @prisma-next/extension-cipherstash` green. Covers FR19, FR20, audience filtering in FR7.

- [ ] **AC4. Patch bump skips recipe check.** Open a PR that does no more than bump version constants and update a changelog (no `examples/` or `packages/3-extensions/` diff). PR CI passes; `check:recipe-coverage` (FR14) is skipped because the bump is a patch (NFR4). Confirm in CI logs.

- [ ] **AC5. Substrate-touching change without recipe fails CI.** Open a PR that introduces a breaking change to a public PN surface, follows the type errors into `examples/` to fix them, and *does not* add a recipe. PR CI fails with a structured error naming the expected recipe path (`packages/0-shared/upgrade-skill/recipes/<from>-to-<to>/`). The author adds the recipe; CI passes. Covers FR9, FR12, FR14.

- [ ] **AC6. Validation-by-execution prevents bad recipes from landing.** Author a PR with a deliberately-broken recipe (e.g. the colocated script's glob misses a file, or the script crashes on a shape present in `examples/multi-extension-monorepo/`). The agent's FR11 validation step finds `pnpm test:examples` red after recipe application. The PR cannot proceed until the recipe is fixed. Covers FR10–FR12.

- [ ] **AC7. Pre-publish gate blocks a release without a recipe.** Simulate a release workflow run for a version whose diff against the previous release tag touches `examples/` or `packages/3-extensions/` but has no matching recipe directory. `check:recipe-coverage` fails before the `pnpm -r publish` step; no package reaches the registry. Covers FR13.

- [ ] **AC8. Upgrade skill and PN ship at matching versions.** After a stable publish to `0.7.0`, `npm view @prisma-next/upgrade-skill dist-tags.latest` returns `0.7.0`. Covers FR2, FR15.

- [ ] **AC9. Idempotent re-run.** Re-running a recipe immediately after the first run produces an empty git diff. Covers NFR3.

- [ ] **AC10. Recipe failure structured-error surface.** Inject a deliberate failure in a recipe script (e.g. malformed input). The recipe surfaces a `PN-UPGRADE-NNNN` envelope with the failing change id, file paths, and remediation hint; the agent does not auto-rollback (Q6). Covers NFR5.

- [ ] **AC11. Organic-exploration shape.** The published `SKILL.md` body is under 8KB and references recipe directories by path; the agent loads only the `recipe.md` for the active transition. Manually verify by inspecting the agent's tool-call log on AC1. Covers FR3, NFR6.

- [ ] **AC12. Mechanism dormant until first recipe.** After the spec is implemented but before PR #502 lands, run the publish workflow against a release with no `examples/` or `packages/3-extensions/` diff: `check:recipe-coverage` passes vacuously, no `@prisma-next/upgrade-skill` recipes are required. Covers the *release sequencing* note in Approach.

# Other Considerations

## Security

- **Recipe trust.** Recipes run scripts in the user's project root. The trust model is the same as installing any npm package: by installing `@prisma-next/upgrade-skill` the user (or their agent on their behalf) trusts the Prisma Next team's publish pipeline. The skill is published with npm provenance attestations (FR15 inherits the existing publish workflow's `NPM_CONFIG_PROVENANCE: "true"`), so consumers can verify the skill came from the PN GitHub release pipeline.
- **No network in recipes.** NFR7 closes the obvious supply-chain hole. Recipes are pure filesystem-and-bundled-assets transformations. A recipe wanting to fetch a remote payload would have to break this contract, which the in-repo `record-recipe` skill explicitly disallows.
- **Agent prompts run inside the agent.** `*.prompt.md` files are agent prompts, not executable code, and run in the agent's existing security context. They are bounded by whatever the agent itself is permitted to do.

## Cost

- **Distribution.** Trivial. The skill is a few hundred KB of text per release. npm storage cost is rounding error.
- **CI cost.** The `check:recipe-coverage` step at publish-time is O(files-in-diff) and runs once per release — negligible.
- **PR-CI cost.** The same check on every PR adds seconds, not minutes. The validation-by-execution step in `record-recipe` runs the existing `pnpm test:examples` and `pnpm test --filter='./packages/3-extensions/*'` suites, which the workspace already runs in CI; the marginal cost is the recipe application itself (one script run per substrate).
- **Per-user runtime cost.** Each upgrade applies N recipes against M project files; for representative projects this is bounded under NFR2 at 5 minutes total.

## Observability

- **Recipe-application telemetry.** Out of scope for v1 (see Open Questions). The agent surfaces success or failure to the user directly; centralised telemetry is a phase-2 question that intersects with broader product-analytics decisions outside this spec.
- **Publish-pipeline observability.** Existing GitHub Actions logs cover the new `check:recipe-coverage` step and the new `publish-upgrade-skill` job by default. No new dashboards.

## Data Protection

- No personal data flows through recipes; recipes are deterministic transformations of the user's own project filesystem. NFR7 (no network, no external input) closes the obvious data-exfiltration concern.

## Analytics

- **Recipe execution events.** Deferred. The right shape is "did the recipe succeed; did the validation pass; how long did it take," all of which the agent already knows locally. Whether to ship those events anywhere is the same question as broader PN runtime telemetry and is settled outside this spec.

# References

- [TML-2514](https://linear.app/prisma-company/issue/TML-2514) — parent Linear ticket for the Prisma Next agent-skill project this spec belongs to.
- [TML-2515](https://linear.app/prisma-company/issue/TML-2515) — placeholder Linear ticket for the backwards-compatibility policy this spec produces.
- [PR #502 — drop inlined fromContract/toContract from migration.json](https://github.com/prisma/prisma-next/pull/502) — the canonical worked example used in AC1, AC3, AC6.
- [`.github/workflows/publish.yml`](../../../.github/workflows/publish.yml) — the workflow this spec extends with `check:recipe-coverage` and the upgrade-skill publish job.
- [`scripts/determine-version.ts`](../../../scripts/determine-version.ts), [`scripts/set-version.ts`](../../../scripts/set-version.ts) — the existing version-determination tooling the publish-gate and PR-CI use.
- [`packages/1-framework/3-tooling/cli/README.md`](../../../packages/1-framework/3-tooling/cli/README.md) — CLI surfaces (FR9).
- [`docs/architecture docs/subsystems/7. Migration System.md`](../../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md) — context for the on-disk migration shape referenced in FR9 and AC1.
- [`docs/architecture docs/adrs/ADR 199 - Storage-only migration identity.md`](../../../docs/architecture%20docs/adrs/ADR%20199%20-%20Storage-only%20migration%20identity.md) — anchor for understanding why the PR #502 change was hash-stable.
- [`projects/prisma-next-agent-skill/references/`](../references/) — reference skills (Supabase, Vercel, Convex, TanStack) studied for pattern conventions.

# Open Questions

The substantive design questions were resolved during refinement (see *Decisions resolved during refinement* below). Two residual implementer choices remain:

1. **Exact workspace-package location.** The spec uses `packages/0-shared/upgrade-skill/` as a default, which creates a new `0-shared` tier alongside the existing `0-config`. Alternatives the implementer might prefer:
   - Fold it into `packages/0-config/upgrade-skill/` (treating the upgrade skill as a build/release-time artefact alongside `tsconfig` and `tsdown`).
   - Create `packages/0-shared/upgrade-skill/` as proposed.
   - Carve out a dedicated `packages/0-skills/upgrade-skill/` tier for skill artefacts (anticipating future skills like `@prisma-next/agent-skill` from the parent project).
   The choice affects `architecture.config.json` (the new tier needs a domain/layer/plane assignment) and `dependency-cruiser.config.mjs` (boundary rules). **Default: `packages/0-shared/upgrade-skill/`, classified as `framework` / `tooling` / `shared`.** Implementer to pick and update both config files.

2. **CI implementation surface for FR13 / FR14.** Two patterns the implementer might choose:
   - Add a new step inside `.github/workflows/publish.yml` and `.github/workflows/ci.yml` (`run: node scripts/check-recipe-coverage.mjs`), with the script in `scripts/`.
   - Implement as a workspace-script (`pnpm check:recipes`) that the workflows invoke, parallel to the existing `check:publish-deps`.
   The script is small (50–100 lines of glob + git diff + filesystem check). **Default: workspace-script `pnpm check:recipes` invoked from the workflows, matching the existing `check:publish-deps` shape.** Implementer to confirm.

## Decisions resolved during refinement

- **Skill publish target.** npm-direct via `@prisma-next/upgrade-skill`; no separate `prisma/agent-skills` GitHub mirror.
- **Recipe scripting form.** Each recipe is one `recipe.md` (agent-instruction Markdown) with zero or more colocated portable scripts in any form (`*.ts`, `*.sh`, codemods). Not the original `user.script.ts` / `extension.prompt.md` four-file split.
- **In-repo skill location.** `.agents/skills/record-recipe/` — the cross-tool location both Claude and Cursor read in this repo. No separate `.cursor/rules/` mirror.
- **API-surface diff implementation.** Dropped. Replaced by the `examples/` + `packages/3-extensions/` git-diff signal (FR9, FR13). No bespoke `api-extractor` / `pkg-pr-new` integration needed.
- **Empty-recipe directories.** Not produced. A minor bump with no substrate diff produces no recipe directory; the publish gate is vacuously satisfied.
- **Recipe failure recovery.** Surface the structured error; do not auto-rollback. The user may have uncommitted work the agent cannot safely discard; the agent surfaces `git checkout -- .` as the recovery command and lets the user run it.
- **CI proof of skill consultation.** Cannot be enforced. CI asserts the *outcome* (FR13 / FR14: recipe present when substrate changed); the skill-consultation itself is the agent's responsibility via `description`-firing, the same way every other skill works.
- **Workspace-package location.** Inside `packages/` because that's where the publish pipeline iterates and how `@prisma-next/upgrade-skill` reaches npm. Exact tier is residual (Open Question 1).
- **First recipe sequencing.** Mechanism lands on the current branch (`tml-2514`) recipe-free; PR #502 is rebased onto the mechanism, re-houses its existing `wip/strip-manifest-bookends.ts` as `recipes/0.6-to-0.7/strip-manifest-bookends.ts`, authors `recipe.md`, and the resulting `0.7.0` release is the first to exercise the gate end-to-end.
- **Backward-fill.** None. Registry starts at `0.6 → 0.7`. Pre-0.6 users are pointed at GitHub Release notes for hand-migration.
