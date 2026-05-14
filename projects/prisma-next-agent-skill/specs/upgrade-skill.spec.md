# Summary

Define two published agent skills — `@prisma-next/upgrade-skill` (for users of Prisma Next) and `@prisma-next/extension-upgrade-skill` (for authors of Prisma Next extensions) — both version-locked to Prisma Next, each carrying a versioned index of *upgrade recipes* an agent can read and execute to translate a project (or an extension) from one PN version to the next. Define the in-repo authoring workflow that mandates a validated recipe in the appropriate skill whenever a PR touches the relevant surface, and the release-pipeline gate that enforces it. Define the *recipe-freeze rule* — recipes for transitions whose `<to>` minor is no longer the in-flight minor on `main` are immutable. Define the *exact-pin rule* for extension peer-deps and ship a small `@prisma-next/extension-pin-check` tool that enforces it in extension CI and consumes the same logic for the user-skill's pre-flight check.

The mechanism delivers two parallel multi-step upgrade flows (one per skill, identical shape, different audience), where each step in a chain bumps `@prisma-next/*` peer-deps to the next minor, runs that minor's recipe against the new types, validates, and commits before moving on. Recipes are pure code-translation instructions for a single transition; the bump-then-recipe-then-validate-then-commit loop is general flow content in the skill's `SKILL.md`, not per-recipe content.

This spec depends on [`package-json-versioning.spec.md`](package-json-versioning.spec.md), which establishes `package.json` as the source-of-truth for the in-flight minor. Recipe-directory keying, the in-repo authoring skill's version detection, and the recipe-freeze rule all consume that source-of-truth.

# Context

## At a glance

Today, every PN breaking change costs the team a round of individual outreach: chase each user, chase each extension author, write or paste the fix into their codebase, hope nothing regressed. PN is at `0.6.1` and on the dev tag at `0.6.0-dev.17`; breaking changes are weekly. The existing user base is small but real (Cipherstash extension, two known customers), and the extension contract is rapidly evolving. The outreach process doesn't scale to even five active consumers, and won't scale at all once the strategy lands a partner like Supabase.

This spec defines a three-skill mechanism that replaces that outreach with an artifact agents consume:

1. **`@prisma-next/upgrade-skill`** — published, version-locked to PN, scoped to **users** (consumers of PN's public package API). Its body is a versioned table of *upgrade recipes*, one per `(from-minor, to-minor)` transition. Each recipe is a single Markdown file (`recipe.md`) of agent instructions, with frontmatter declaring the breaking changes and detection signals. The instructions may direct the agent to run a *colocated script* (TypeScript, bash, or a codemod — whichever is portable enough for the task); scripts sit next to `recipe.md` and are addressed by relative path. Recipes here cover public-API changes and on-disk-shape changes that affect user projects.

2. **`@prisma-next/extension-upgrade-skill`** — published, version-locked to PN, scoped to **extension authors** (consumers of PN's framework SPI). Same shape as the user skill; different content. Recipes here cover middleware lifecycle changes, codec / migration-tools / framework-components SPI churn, and any on-disk-shape change that affects an extension's seed migrations. Extension authors are also PN users for their own apps, so they typically install both skills; the two operate independently.

3. **An in-repo agent skill at `.agents/skills/record-recipe/`** that fires when the change-making agent's PR touches surfaces a downstream consumer or extension author depends on. Signals are mechanical: changes in [`examples/`](../../../examples/) demand a recipe in `@prisma-next/upgrade-skill`; changes in [`packages/3-extensions/`](../../../packages/3-extensions/) demand one in `@prisma-next/extension-upgrade-skill`; both demand both. The skill instructs the agent to (a) add recipe entries for the in-progress version transition in the relevant package(s), (b) author any required colocated script, and (c) *run each recipe against the corresponding substrate* and demonstrate it works — before the PR is allowed to merge.

The release-pipeline gate ties them together: the `publish.yml` workflow refuses to ship a version whose `examples/` diff is not covered by a recipe in `@prisma-next/upgrade-skill`, or whose `packages/3-extensions/` diff is not covered by a recipe in `@prisma-next/extension-upgrade-skill`. The PR-CI workflow enforces the same shape on every PR.

A user-facing flow, end-to-end (multi-step upgrade `0.6 → 0.8`, two recipes):

```text
user> "upgrade Prisma Next"
agent> Current: @prisma-next/postgres@0.6.1  (from pnpm-lock.yaml)
       Target:  @prisma-next/postgres@0.8.0  (latest)
       Detected role: user (no @prisma-next/* peerDependencies)
       Skill: @prisma-next/upgrade-skill
       Transition chain: 0.6 → 0.7 → 0.8

agent> Pre-flight: checking installed @prisma-next-ext/* extensions...
       - @prisma-next-ext/cipherstash: peer-dep pin 0.8.0 — compatible
       OK; proceeding.

agent> Step 0.6 → 0.7:
         Bumps @prisma-next/* peer-deps in package.json: 0.6.1 → 0.7.0 (exact pins)
         pnpm install
         Reads recipes/0.6-to-0.7/recipe.md, runs colocated strip-manifest-bookends.ts
           → 42 files rewritten
         pnpm typecheck && pnpm test → green
         Commit: "chore: upgrade @prisma-next/* to 0.7.0"

agent> Step 0.7 → 0.8:
         Bumps @prisma-next/* peer-deps in package.json: 0.7.0 → 0.8.0
         pnpm install
         Reads recipes/0.7-to-0.8/recipe.md, follows prose to update query-builder imports
         pnpm typecheck && pnpm test → green
         Commit: "chore: upgrade @prisma-next/* to 0.8.0"

agent> Done. 2 commits staged.
```

Extension-author flow against the same `0.6 → 0.7` step:

```text
ext-author> "upgrade Prisma Next"
agent> Detected role: extension-author (@prisma-next/* in peerDependencies, exact pin)
       Skill: @prisma-next/extension-upgrade-skill
       Transition chain: 0.6 → 0.7

agent> Step 0.6 → 0.7:
         Bumps @prisma-next/* peer-deps in package.json: 0.6.1 → 0.7.0 (exact pins)
         pnpm install
         Reads extension-upgrade-skill recipes/0.6-to-0.7/recipe.md:
           - migration-json-bookend-drop: runs colocated strip-manifest-bookends.ts
             (same script as the user recipe; duplicated here intentionally)
             → 1 file rewritten in the extension's seed migrations
           - migration-metadata-spi-update: agent follows recipe prose, edits SPI consumer code
         pnpm build && pnpm test → green
         Runs `pnpm exec prisma-next-check-pins` → green (all @prisma-next/* pins at 0.7.0 exact)
         Commit: "chore: upgrade @prisma-next/* to 0.7.0"

agent> Done. 1 commit staged.
```

If the same person is both a user and an extension author (typical case — they have an example consumer app alongside their extension package), they install both skills and the agent runs both flows in turn (user flow first, then extension flow). A lagging extension blocks the user-side flow's pre-flight with a structured error naming the highest reachable PN version.

## Problem

PN's API surface is converging — that's the explicit reason the project sits at `0.x`. Every week, `[scripts/determine-version.ts](../../../scripts/determine-version.ts)` computes the next minor bump from the latest stable. The team takes the freedom seriously: PR [#502](https://github.com/prisma/prisma-next/pull/502) ([TML-2512](https://linear.app/prisma-company/issue/TML-2512)) is a recent representative case — it strips `fromContract` / `toContract` from every `migration.json` on disk (the manifest goes from ~1400 lines to ~10), enforces the new schema via arktype `'+': 'reject'`, and ships a one-shot script (`[wip/strip-manifest-bookends.ts](../../../wip/strip-manifest-bookends.ts)` at PR time, *intended* to be re-housed) that regenerates manifests in place. PN ≥ 0.7 will fail to load any manifest that still carries the old fields; the script is the only sanctioned upgrade path. The PR's own description says: *"the only known external consumer is the Cipherstash extension; we are sending a heads-up directly with regeneration instructions."* That heads-up is the manual outreach this spec replaces.

The current escape valves are all manual and don't compose:

- **GitHub Releases** carry `--generate-notes` PR titles. Useful as a changelog; useless as an upgrade instruction. They describe *what changed*; they don't tell the consumer *how to keep working*.
- **PR descriptions** sometimes include scripts (PR #502 inlines a path to `wip/strip-manifest-bookends.ts --check`). The scripts are accurate at PR-merge time, then rot. They are not findable by an agent reading the user's project six weeks later.
- **Linear tickets** ([TML-2515](https://linear.app/prisma-company/issue/TML-2515) is the placeholder for the policy this spec produces) summarise the problem but produce no consumable artifact.
- **Direct messages** to extension authors (Cipherstash, internal Supabase work, etc.) scale to ~1 person.

Two consumer classes share the same pain on different surfaces, and the surfaces churn at different rates:

- **PN users** depend on the public package API (`@prisma-next/postgres`, `@prisma-next/mongo`, the contract types in their `prisma/contract.d.ts`, the on-disk shape of `migration.json` and `ops.json`). The public surface changes infrequently — most PN releases don't break users.
- **Extension authors** depend on the framework SPI (the package boundary at `@prisma-next/framework-components`, `@prisma-next/migration-tools`, the in-repo extensions under [`packages/3-extensions/`](../../../packages/3-extensions/) as canonical reference shapes). The SPI is internal and churns frequently — middleware lifecycle, codec interfaces, migration-tools helpers all move. Many PN releases break extensions and do not affect users at all.

A single PR can break either, both, or neither. PR #502 broke both (it's the unusual structural-disk-shape case). The typical break is asymmetric: SPI churn that's invisible to users, or — less often — public-API tightening that's invisible to extension authors. Splitting the upgrade-skill into two packages (one per audience) is what keeps each consumer's skill body free of content irrelevant to them; the cost today is *every* affected party spending time figuring out which fix applies to them, and the cost we want is the change author writing one (or two) recipes alongside the change.

## Approach

The settled approach is the three-skill mechanism described in *At a glance*, plus the publish-gate that enforces co-shipping. The four mechanisms are:

### The in-flight minor — read from `package.json`

Every part of this mechanism that needs to know "what minor are we currently authoring against" reads the version from `package.json` on the relevant branch. This works because [`package-json-versioning.spec.md`](package-json-versioning.spec.md) makes the `version` field on every publishable `package.json` reflect the current in-flight minor (e.g. `"0.7.0"` while the team is working on `0.7.x`; advances to `"0.8.0"` when a version-bump PR lands).

- The **agent authoring a breaking-change PR** reads `package.json` on the PR branch to know which recipe directory to write to. If the branch's `package.json` says `0.7.0`, the in-flight recipe directory is `recipes/0.6-to-0.7/`.
- The **publish gate** reads `package.json` on `main` at workflow run-time. Same logic.
- The **PR-CI freeze check** reads `package.json` on the PR branch. Same logic.

This replaces any reliance on `npm view ... dist-tags.latest` for in-repo workflows. Consumer-side flow (FR17) continues to consult npm — consumers don't have access to PN's source `package.json`.

**(A) Two published audience-scoped skills, recipe-keyed.** `@prisma-next/upgrade-skill` (users) and `@prisma-next/extension-upgrade-skill` (extension authors) are the consumer-facing artifacts, distributed via npm. Their sources live in this repo as workspace packages at [`packages/0-shared/upgrade-skill/`](../../../packages/0-shared/upgrade-skill/) and [`packages/0-shared/extension-upgrade-skill/`](../../../packages/0-shared/extension-upgrade-skill/) (creating the `0-shared` tier; see Open Questions for naming) and are published alongside every PN release via the `publish.yml` workflow. Each release of each skill contains *every* recipe from `0.6 → 0.7` onward; older users see no recipe set and are pointed at the release notes for hand-migration. Each skill's content is organised for organic exploration: a small `SKILL.md` entry names the available transitions; recipe bodies sit under `recipes/<from>-to-<to>/` so the agent only loads what it needs.

The two packages are independent: each has its own version-locked publish, its own recipe registry, its own consumer flow. When a breaking change crosses the boundary (the rare PR #502 case), recipes are authored in both packages — duplicated, including any colocated script. Recipes are write-once (never edited after publication), so duplication does not produce maintenance drift.

**(B) Per-transition recipe shape.** One directory per `(from-minor, to-minor)` transition, *per skill package*. The directory contains exactly one `recipe.md` (the agent-instruction file, with frontmatter declaring the breaking changes and detection signals — FR7), plus any number of *colocated scripts* the markdown references by relative path. Scripts are portable by choice — TypeScript via `pnpm exec tsx`, bash, codemods (`jscodeshift`, AST-based)  — whichever fits the change. Patch transitions never need recipes (NFR4); minor bumps without any matching substrate diff don't need them either (Q5 default: no empty recipes). Multiple breaking changes within a single transition collapse into one `recipe.md` per package, with multiple entries in its frontmatter's `changes[]` array.

**(C) In-repo recipe-authoring skill.** A new agent skill at [`.agents/skills/record-recipe/`](../../../.agents/skills/record-recipe/) (the cross-tool skills location both Claude and Cursor read) fires when the change-making agent's PR has changes in `examples/` or `packages/3-extensions/`. That signal is the natural consequence of breaking-change refactoring: a real API break either fails the type-check or the test suite in at least one downstream consumer, and the agent fixing those failures necessarily produces diffs there. The skill's content instructs the agent to: (1) route to the correct skill package based on which substrate changed (`examples/` → `@prisma-next/upgrade-skill`; `packages/3-extensions/` → `@prisma-next/extension-upgrade-skill`; both → both); (2) add or update the recipe directory for the in-progress version transition in each affected package; (3) author any colocated scripts the recipes need (duplicating across packages when the same script applies to both substrates); (4) *run the recipe against the matching in-repo substrate* — user-skill recipes against `examples/`, extension-skill recipes against `packages/3-extensions/` — starting from each substrate's *pre-API-change* state and ending with green tests; (5) commit the post-recipe state alongside the recipes.

**(D) Publish-gate.** The `publish.yml` workflow gains a step `check:recipe-coverage`. The check runs two parallel sub-checks: if the diff between the version about to be published and the previous published version touches `examples/`, a recipe directory must exist at `packages/0-shared/upgrade-skill/recipes/<from-minor>-to-<to-minor>/`; if it touches `packages/3-extensions/`, a recipe directory must exist at `packages/0-shared/extension-upgrade-skill/recipes/<from-minor>-to-<to-minor>/`; both diffs demand both directories. If a substrate is untouched, its check is vacuously satisfied. Patch releases (NFR4) skip the check. The same check runs in PR CI. The gate does *not* attempt to verify recipe contents against a synthesised API-surface diff — that quality bar is delivered by FR11's validation-by-execution at PR time, run by the change-making agent.

**(E) Recipe-freeze rule.** A PR may only modify recipe directories whose `<to>` matches the in-flight minor on the PR's `package.json`. Recipe directories for older transitions are immutable.

Why this rule exists: a topic branch may be open for several weeks. During that time, a version-bump PR may advance `main`'s minor (e.g., `0.7.x` → `0.8.x`), which means `main`'s in-flight recipe directory shifts from `recipes/0.6-to-0.7/` to `recipes/0.7-to-0.8/`. If the topic branch is unaware and merges with stale recipe edits in `recipes/0.6-to-0.7/`, the change rolls into the `0.8.0` release — but `0.7.0` has already shipped to npm with the old recipe set, so the new entries never reach consumers who applied the `0.6 → 0.7` recipe before the topic branch merged. The freeze rule structurally prevents this:

- A PR-CI check (FR21) reads the PR branch's `package.json`, derives the in-flight minor `M`, and asserts that any added / modified / removed path under `recipes/` lives in `recipes/<M-1>-to-<M>/`. Any modification to a directory outside that range fails the PR with a structured error naming the frozen directory and instructing the agent to move the entry to the current in-flight directory.
- The same check runs as part of the publish gate (FR13's defense-in-depth — by the time publish runs, PR-CI has already enforced this, but the redundant check costs nothing).

The freeze rule is consumed by both upgrade-skill packages independently: `@prisma-next/upgrade-skill`'s recipe directories freeze on the same minor advance, and so do `@prisma-next/extension-upgrade-skill`'s.

**(F) Exact-pin rule and `@prisma-next/extension-pin-check`.** Extension authors declare every `@prisma-next/*` entry in `peerDependencies` as an exact version (e.g. `"0.7.0"`, not `"^0.7.0"`, `"~0.7.0"`, `">=0.7.0"`, `"workspace:*"`, or any range form). All such entries pin to the same version. The pin advances only after the extension author has run the relevant upgrade recipe(s) against their extension's source and tests, which validates that the extension is compatible with the new PN version.

Why exact pins for extensions specifically: PN is in `0.x` with weekly breaking-change cadence. SemVer ranges assume the framework's "no breaking in patches" discipline (NFR4) is trustworthy. That discipline is aspirational until it has a track record. The exact pin makes every PN bump a deliberate, recipe-gated action by the extension author rather than a silent transitive update through SemVer.

The rule is enforced by a small npm package `@prisma-next/extension-pin-check` (working name) sourced at `packages/0-shared/extension-pin-check/`, published lockstep with PN. It exposes:

- A CLI `prisma-next-check-pins` extension authors install as a devDependency and wire into their own CI. It reads the package's `package.json`, asserts every `@prisma-next/*` entry in `peerDependencies` is an exact-version pin (no `^`, `~`, ranges, or `workspace:*`) and that all `@prisma-next/*` entries share the same version. Exits non-zero with a structured error naming any offending entry.
- A programmatic `checkInstalledExtensionPins(rootDir, targetPnVersion)` function the user-upgrade-skill imports for its pre-flight check (FR27). It walks `node_modules`, detects installed PN extensions, reads each one's `peerDependencies` pin, and reports the highest PN version reachable given current extensions plus the names of any extension lagging behind the requested target.

Extension detection is **peer-dep-based**: any installed package that declares `@prisma-next/contract` in its `peerDependencies` is treated as a PN extension. No central namespace registry, no `package.json` marker required — zero ceremony for extension authors.

Three integration points:

1. **Extension's own CI.** Extension author adds `pnpm exec prisma-next-check-pins` to their CI; any accidental range pin (`^0.7.0`) fails the PR.
2. **Extension-upgrade-skill recipe validation.** After the recipe's bump-and-`pnpm install` step, the skill body instructs the agent to run `prisma-next-check-pins` as a sanity check that pins were rewritten correctly.
3. **User-upgrade-skill pre-flight.** Before any code changes, the skill imports the programmatic API to verify every installed PN extension is compatible with the target. Lagging extensions block the upgrade with a structured error.

**The two PN in-repo extensions (`packages/3-extensions/cipherstash`, `packages/3-extensions/supabase`) demonstrate the pattern when published.** At workspace-development time they use `workspace:*` for ergonomics; at publish time, the `pnpm -r publish` invocation must rewrite those entries to *exact* `X.Y.Z` versions (not the default `^X.Y.Z`). Implementer to wire this — `publishConfig.directory`, a per-package `publishConfig.dependencies`-style block, or the `--workspace-packages-exact` style flag (whichever pnpm currently offers).

The cross-cutting invariants this whole mechanism rests on:

- **Source co-location.** Each upgrade skill's body is source-controlled in this repo as a workspace package. The recipe(s) authored on a PR and the API change(s) they cover are in the same diff, reviewed together, merged together, published together.
- **Version locking by construction.** Every PN release publishes both upgrade skills at the same version. A user at PN `0.6.1` who installs `@prisma-next/upgrade-skill` gets the `0.6.1`-tagged version, whose recipe set covers all transitions up to and including `0.6.x → 0.7.x`. Same for `@prisma-next/extension-upgrade-skill`. Consumers cannot be left at a recipe set that doesn't cover their target.
- **In-flight minor is `package.json`.** The agent on a topic branch, the publish workflow, and the PR-CI freeze check all derive the in-flight minor from `package.json` on the relevant ref. There is no second-source ambiguity (e.g., `npm view`); the source-of-truth refactor in [`package-json-versioning.spec.md`](package-json-versioning.spec.md) is what makes this work.
- **Recipes are write-once after their minor ships.** Once a stable `0.7.0` ships to npm with the `0.6 → 0.7` recipe set in tow, the recipe directory is frozen on `main` by the version-bump PR that follows. New transitions go to the next recipe directory; the previous one is immutable. Consumers can rely on a published recipe never silently changing under them.
- **Recipes are one-transition-at-a-time.** Each recipe is authored against, runs against, and is validated against a single `<from> → <to>` step. Multi-minor upgrades (`0.6 → 0.8`) iterate: bump peer-deps to `0.7.0`, install, run `0.6→0.7` recipe, validate, commit; then bump to `0.8.0`, install, run `0.7→0.8` recipe, validate, commit. Recipes never need to reason about types from a version other than their own `<to>`; the consumer flow guarantees that environment.
- **Extensions pin exactly; advance the pin only via a verified recipe run.** The extension's `peerDependencies` on `@prisma-next/*` are pinned to a single exact version, advanced by the extension author after running the relevant upgrade recipe. The `@prisma-next/extension-pin-check` tool enforces the shape locally; the user-upgrade-skill's pre-flight refuses to upgrade past any installed extension's pin.
- **Pin-bump and recipe-execution are general flow content, not per-recipe content.** Each skill's `SKILL.md` carries the upgrade flow (pre-flight → per-step: bump → install → recipe → validate → commit); individual recipes contain only the code-translation work specific to their transition. `record-recipe` does not generate or enforce pin-bump steps inside recipe bodies — that's flow content, not recipe content.
- **Validation-by-execution, not by review.** The agent demonstrates each recipe works by running it on the corresponding in-repo substrate; the human reviewer never has to vouch for correctness on cases they didn't run. Substrate quality is enforced by the existing test suites (`pnpm test:examples` for user recipes, `pnpm test --filter='./packages/3-extensions/*'` for extension recipes). The reviewer's job is to confirm each required recipe exists, looks reasonable, and the PR was green.
- **Detection is mechanical, per substrate.** The signal that a user recipe is required is `examples/` touched. The signal that an extension recipe is required is `packages/3-extensions/` touched. The agent making the breaking change discovers either signal naturally — they had to update those files to keep the workspace's tests green. The skill's content names both signals; the publish gate checks each independently; the human reviewer sees both in the diff.

### Release sequencing

This spec's mechanism lands on the current branch ([`tml-2514`](https://linear.app/prisma-company/issue/TML-2514)) *without* any recipe entries in either package. The mechanism's first practical use is PR [#502](https://github.com/prisma/prisma-next/pull/502) ([TML-2512](https://linear.app/prisma-company/issue/TML-2512)): PR #502 is rebased onto the mechanism, its existing `wip/strip-manifest-bookends.ts` script is re-housed at *both* `packages/0-shared/upgrade-skill/recipes/0.6-to-0.7/strip-manifest-bookends.ts` and `packages/0-shared/extension-upgrade-skill/recipes/0.6-to-0.7/strip-manifest-bookends.ts` (PR #502 touches both substrates), each accompanied by its own `recipe.md`. The extension-upgrade-skill's recipe adds the MigrationMetadata SPI-update entry on top of the shared bookend strip. The next stable release (`0.7.0`) is the first to exercise the publish gate end-to-end and the first to publish both skills at `0.7.0` to npm.

Until PR #502 lands, the publish gate sees no `examples/` or `packages/3-extensions/` diff in any release and is vacuously satisfied. The mechanism is dormant infrastructure during that window, which is acceptable — no consumer has installed either skill yet.

# Requirements

## Functional Requirements

### Published skills — `@prisma-next/upgrade-skill` and `@prisma-next/extension-upgrade-skill`

The two skills are structurally identical (same FR1–FR4 properties, same recipe shape FR5–FR7, same consumer flow FR16–FR20); they differ only in audience and in which substrate their recipes target. Where the requirements speak of "the upgrade skill" singular, they apply to *each* skill independently unless otherwise noted.

- **FR1. Distribution.** Both skills are published to npm:
  - `@prisma-next/upgrade-skill` — installable via `npx skills add @prisma-next/upgrade-skill`. Audience: **users** of PN's public package API.
  - `@prisma-next/extension-upgrade-skill` — installable via `npx skills add @prisma-next/extension-upgrade-skill`. Audience: **authors of PN extensions**.

  Both publish from the same workflow run that publishes the rest of the PN packages — npm OIDC trusted publishing, no separate channel. A consumer who is both a user and an extension author installs both.

- **FR2. Version-locking.** Every published PN release publishes *both* upgrade skills at the same version as the rest of the PN packages. The publish workflow refuses to ship any of them without the others (see FR15).

- **FR3. Skill shape — organic exploration.** Each skill's `SKILL.md` is a small entry point that lists the available recipe transitions and tells the agent how to find a recipe for a given `(from, to)`. Recipe bodies live in `recipes/<from>-to-<to>/recipe.md` and are referenced by name from `SKILL.md`; the agent does not load them all up front. Each entry point fits in well under 500 lines (target: <100).

- **FR4. Recipe registry.** Each release of each skill contains the cumulative recipe set from `0.6 → 0.7` up to the release's version. Earlier transitions are not backfilled (Q10); pre-0.6 consumers are pointed at GitHub Release notes for hand-migration. Old recipes, once written, are never removed. The two skills' recipe registries evolve independently — many transitions will have a recipe in only one of them.

### Recipe layout

- **FR5. Per-transition directory.** Each recipe lives at `recipes/<from-minor>-to-<to-minor>/`, *within its skill package*. Patch versions do not have recipes (NFR4). Minor bumps without a matching substrate diff produce no recipe directory in that skill's package (Q5). Multi-step transitions (e.g. `0.6 → 0.9`) are applied by chaining the per-minor recipes in order (FR18).
- **FR6. Recipe contents.** A recipe directory contains:
  - **`recipe.md`** — always present. The agent-instruction Markdown file. Includes a frontmatter block (FR7) and a prose body that describes each breaking change and what the agent should do. The prose may inline code snippets the agent runs verbatim, name shell commands to invoke, or reference a colocated script by relative path.
  - **Zero or more colocated scripts**, in whichever portable form fits the change: `*.ts` (run with `pnpm exec tsx`), `*.sh` (run with `bash`), codemods (e.g. `*.codemod.cjs` invoked via `jscodeshift`), or any other portable executable. The recipe's prose names the script by relative path, e.g. *"For each match, run `./strip-manifest-bookends.ts <path>`"*. Scripts must be portable: no environment-specific assumptions beyond `pnpm` and the consumer's checkout (NFR7).

  A `recipe.md` without any colocated scripts is valid — the agent follows the prose directly. A directory with scripts but no `recipe.md` is not valid; `recipe.md` is always the entry point.

  Cross-audience recipes — where the same on-disk transformation applies to both users and extension authors — are authored *separately* in each skill package's `recipes/<from>-to-<to>/` directory, including the colocated script (copied, not symlinked). Recipes are write-once after publication, so the duplication does not create a maintenance tail.

- **FR7. Recipe metadata (frontmatter of `recipe.md`).** Each `recipe.md` carries a YAML frontmatter block of the following illustrative shape:

  _Illustrative — exact field names are up to the implementer; the information content is what's pinned:_

  ```yaml
  ---
  from: "0.6"
  to: "0.7"
  changes:
    - id: "migration-json-bookend-drop"
      summary: "migration.json no longer carries fromContract / toContract"
      detection:
        # Optional. A glob + content predicate. If any matching file exists
        # and matches the predicate, this change applies. If a recipe entry
        # has no detection block, it applies unconditionally — useful for
        # changes that require agent reasoning across the whole codebase.
        - { glob: "**/migrations/**/migration.json", contains: '"fromContract"' }
      script: ./strip-manifest-bookends.ts   # optional; if absent, agent follows the prose body
    - id: "migration-metadata-spi-update"
      summary: "MigrationMetadata interface drops two fields"
      detection:
        - { glob: "**/*.ts", contains: "MigrationMetadata" }
      # no script — agent follows the prose body in recipe.md
  ---
  ```

  The frontmatter's `changes[]` is what the agent enumerates to plan the upgrade. The shape pins the *information* required (per-change id, summary, optional detection, optional script reference); it does not pin field names — those are implementer's choice.

  No `audiences:` field. The skill package the recipe lives in *is* the audience filter: a recipe in `@prisma-next/upgrade-skill` is for users, a recipe in `@prisma-next/extension-upgrade-skill` is for extension authors. Future audiences (e.g. *target-author* if PN ever opens the target SPI publicly) get their own skill package alongside these two.

### In-repo recipe-authoring skill

- **FR8. Skill location.** An agent skill at `.agents/skills/record-recipe/` (the cross-tool skills location both Claude and Cursor read from in this repo). The skill's `description` field is the firing surface; it does *not* require any CI hook to be consulted (FR14's outcome check covers the same concern by other means). One skill, not two — the skill routes to the correct upgrade-skill package(s) based on which substrate the agent's PR touched.

- **FR9. Detection signals — and routing.** The skill's content names two mechanical signals, each tied to a destination package:

  > **If your PR has changes in `examples/` that you made as a consequence of refactoring the framework, you must add a recipe in `@prisma-next/upgrade-skill`** (the user skill).
  >
  > **If your PR has changes in `packages/3-extensions/` that you made as a consequence of refactoring the framework, you must add a recipe in `@prisma-next/extension-upgrade-skill`** (the extension-author skill).
  >
  > **If both, both.** Recipe content and any colocated script are duplicated across the two packages.

  No exhaustive API-surface list. No diff-tool inference. The natural consequence of a real breaking change is that at least one downstream consumer in `examples/` or `packages/3-extensions/` fails; the agent fixing those failures sees the signal directly. The reviewer sees the same signal in the PR diff. The publish gate (FR13) and PR-CI gate (FR14) enforce the *outcome* (recipe present in the matching package when the matching signal fires); they do not try to validate the trigger logic.

- **FR10. Authoring workflow.** When fired, the skill walks the agent through:

  1. Determine the in-progress version transition by reading `package.json` on the PR branch. The branch's version (e.g. `0.7.0`) names the in-flight minor `M = 0.7`; the recipe directory is `recipes/<M-1>-to-<M>/`, i.e. `recipes/0.6-to-0.7/`. If the PR is intended as a patch (no `examples/` or `packages/3-extensions/` diff except the conventional generated paths), no recipe is needed — the agent skips to step 7.
  2. Identify which of `examples/` and `packages/3-extensions/` the PR touched. Each touched substrate corresponds to a destination skill package per FR9.
  3. For *each* destination package, find or create the recipe directory at `packages/0-shared/<package-name>/recipes/<M-1>-to-<M>/`. If the directory already exists (an earlier PR on the same transition created it), append a new entry to the existing `recipe.md`'s `changes[]` instead of creating a duplicate directory. Recipe directories for older transitions are frozen (FR21); the skill must not attempt to edit them.
  4. Write the change entry in each `recipe.md`'s frontmatter, and add a prose section describing what the agent must do.
  5. Author any colocated scripts the recipes reference. If the same script applies to both substrates (the cross-audience case), copy it into both package's recipe directories.
  6. Validate each recipe by execution (FR11), against its corresponding substrate.
  7. Commit on the PR branch.

  Rebase scenario: if a version-bump PR lands on `main` mid-flight (advancing `main`'s minor from `M` to `M+1`), the topic branch's next rebase brings the new `package.json` value with it. The agent then re-runs step 1 (the in-flight minor is now `M+1`), moves any in-progress recipe entries from `recipes/<M-1>-to-<M>/` to `recipes/<M>-to-<M+1>/`, and re-validates against the post-rebase substrate. The FR21 freeze check is what surfaces the need to move the entries; the agent must not attempt to edit the now-frozen directory.

- **FR11. Validation-by-execution.** The skill instructs the agent to run each new recipe against the matching substrate:

  - **User-skill recipe** (`packages/0-shared/upgrade-skill/recipes/<from>-to-<to>/`): against every example app under `examples/` whose tests are red without the recipe (the same set the agent's refactoring already touched). The acceptance criterion is `pnpm test:examples` green after recipe application.
  - **Extension-skill recipe** (`packages/0-shared/extension-upgrade-skill/recipes/<from>-to-<to>/`): against every in-repo extension at `packages/3-extensions/*` whose source is red without the recipe. The acceptance criterion is `pnpm test --filter='./packages/3-extensions/*'` green after recipe application.

  Workflow concretely, per recipe: the agent (i) checks out the PR branch with the API change applied, (ii) reverts the matching substrate's changes to the pre-PR state, (iii) runs the recipe against that reverted substrate, (iv) verifies the resulting substrate matches the substrate state on the PR branch *and* that the matching test command is green. If both hold, the recipe is correct; if either fails, the agent iterates on the recipe. The cross-audience case runs both validations.

- **FR12. PR commit shape.** The PR that introduces the breaking change must include, in addition to the API change itself:

  - The new recipe directory in each affected skill package (`recipe.md` plus any colocated scripts).
  - The post-recipe state of every affected example app and in-repo extension — these would have been left broken without the recipe; the recipe's effect on the substrate *is* the diff that brings them back to green.
  - A reference in the PR description naming each recipe directory (e.g. *"Adds `packages/0-shared/upgrade-skill/recipes/0.6-to-0.7/` and `packages/0-shared/extension-upgrade-skill/recipes/0.6-to-0.7/`."*).

  Human reviewer + agent both check this shape. The CI gate (FR14) catches the structural case where a substrate diff is present without the matching recipe; the reviewer catches the case where a recipe exists but its prose / scripts don't match the API change.

### Release-pipeline gate

- **FR13. Pre-publish coverage check.** The `publish.yml` workflow gains a step `check:recipe-coverage` that runs after `check:publish-deps` and before the actual publish. The check is intentionally simple and runs two parallel sub-checks:

  1. Resolve the in-flight minor `X.Y` by reading `package.json` on `HEAD` (the source-of-truth per [`package-json-versioning.spec.md`](package-json-versioning.spec.md)).
  2. Resolve the previous published minor `X.Y-prev` — for stable releases, by reading the prior `latest` tag from npm; for `dev` releases, by inspecting the prior commit on `main` where `package.json` differed (rare — `dev` releases between bump-PRs share the same `X.Y`).
  3. If `X.Y == X.Y-prev` (this is a patch release or a same-minor dev release), skip the entire check (NFR4).
  4. **User-skill sub-check.** Compute `git diff <prev-release-tag>..HEAD -- examples/` (excluding the conventional generated paths — `contract.json`, `contract.d.ts`, `end-contract.json`, `end-contract.d.ts` — which regenerate mechanically and don't signal an API break). If non-empty, assert a recipe directory exists at `packages/0-shared/upgrade-skill/recipes/<X.Y-prev>-to-<X.Y>/`. If empty, the sub-check is vacuously satisfied.
  5. **Extension-skill sub-check.** Compute `git diff <prev-release-tag>..HEAD -- packages/3-extensions/` (excluding the same generated paths). If non-empty, assert a recipe directory exists at `packages/0-shared/extension-upgrade-skill/recipes/<X.Y-prev>-to-<X.Y>/`. If empty, the sub-check is vacuously satisfied.
  6. If either sub-check fails, the workflow fails with a structured error naming the expected path(s) and pointing at the in-repo `record-recipe` skill.

- **FR14. PR-CI fail-fast.** The PR-CI workflow runs the same two-sub-check coverage check using the in-flight minor from the PR branch's `package.json`, comparing the PR diff against the current `main` tip. A missing recipe in either package fails the PR. This is the early-warning version of FR13 — the change author sees the failure on their PR, not at release time, and can author the recipe(s) before review.

- **FR21. Recipe-freeze check.** A new CI check `check:recipe-freeze` that runs alongside `check:recipe-coverage` (FR14 / FR13 stage) enforces (E):

  1. Read the in-flight minor `M` from `package.json` on the PR branch (or `HEAD` for the publish-gate variant).
  2. Compute the set of recipe paths the PR adds, modifies, or removes — under either `packages/0-shared/upgrade-skill/recipes/` or `packages/0-shared/extension-upgrade-skill/recipes/`.
  3. For every such path, verify it lives in `recipes/<M-1>-to-<M>/` (the in-flight recipe directory for that skill package). Paths in any other transition directory fail the check.
  4. The error message names the frozen directory and the in-flight directory, e.g. *"`recipes/0.6-to-0.7/` is frozen because `package.json` is at `0.8.0`. Move your recipe entry to `recipes/0.7-to-0.8/`."*

  The check is structurally distinct from FR14's coverage check (FR14 checks that *required* recipes exist; FR21 checks that *no edits* land in frozen directories). Both run on every PR; both run again at publish time as defense-in-depth.

- **FR15. Upgrade-skills publish.** Both `@prisma-next/upgrade-skill` (from `packages/0-shared/upgrade-skill/`) and `@prisma-next/extension-upgrade-skill` (from `packages/0-shared/extension-upgrade-skill/`) are picked up by the existing `pnpm -r publish` step in `publish.yml`. They are just two more workspace packages alongside everything else. NFR8's atomicity invariant follows from the existing workflow's `concurrency` group and single-job-per-run structure: if the publish step fails for any package, the whole run is marked failed and the maintainer is alerted.

### Consumer-side flow

- **FR16. Agent-driven upgrade trigger.** Both skills' `SKILL.md` `description` fields fire when an agent is asked to "upgrade Prisma Next", or detects a PN version bump in a user's `package.json` it itself is about to make. (Skill registries don't pin trigger semantics — `description` is text the registry indexes, and agents match against it.) Each skill's description is tuned to its audience: the user skill's description includes phrases like "upgrade Prisma Next in your app"; the extension-author skill's includes "upgrade Prisma Next in your extension." Both must include the words `upgrade Prisma Next` so a single firing prompt reaches whichever skill(s) the consumer has installed.

- **FR17. Version detection.** When invoked, the agent reads the consumer's project state to determine:
  - **From-version.** The currently-installed PN version, from `pnpm-lock.yaml` (or `package-lock.json` / `yarn.lock`). If the lockfile shows multiple PN packages at different minor versions (which would already be broken), the lowest minor wins as the from-version.
  - **To-version.** Either the version the consumer specified ("upgrade to 0.7"), or the latest stable from `npm view @prisma-next/postgres dist-tags.latest`.

- **FR18. Transition chain.** If the from-to delta spans multiple minor versions, the agent applies recipes one minor at a time, in order: `0.6 → 0.7 → 0.8 → 0.9`. Each step is fully self-contained — peer-deps bumped, install run, recipe applied, validation green, commit made — before the next step starts. The chain halts at the first failed step. Chain order is the same regardless of which skill(s) is/are invoked.

- **FR19. Role detection and skill selection.** The agent determines which skill(s) apply by inspecting `package.json`:
  - **User role** — `@prisma-next/upgrade-skill` applies. Triggered when `package.json` declares `@prisma-next/*` packages as `dependencies` or `devDependencies`.
  - **Extension-author role** — `@prisma-next/extension-upgrade-skill` applies. Triggered when `package.json` declares `@prisma-next/*` packages as `peerDependencies`, or when the package name matches `^@.*/extension-` (matching the in-repo convention used by `extension-cipherstash`, `extension-supabase`, etc.).
  - **Both roles** — both skills apply. Common for repos that ship an extension alongside a consumer app (the in-repo `examples/cipherstash-integration/` is an example shape). The agent runs the user flow first, then the extension flow, in the same upgrade session.

  If detection is ambiguous, the agent asks the consumer which role to operate under, and offers to apply both.

- **FR20. Per-skill, per-transition execution.** For each applicable skill, for each `(from, to)` step in the chain, the agent:

  1. **Bump.** Update every `@prisma-next/*` entry in the consumer's `package.json` to the exact `<to>` version. For the user skill this rewrites `dependencies` / `devDependencies` entries; for the extension skill this rewrites `peerDependencies` entries (exact pin per FR22). All `@prisma-next/*` entries advance to the same version. Also update the skill package's own dependency entry to the `<to>` version (so the skill content matches the target).
  2. **Install.** Run `pnpm install`. Code is now broken against the `<to>` version's types/SPI — expected and required (the recipe's job is to fix it).
  3. **Read.** Load `<skill-package>/recipes/<from>-to-<to>/recipe.md`, parse the frontmatter.
  4. **Apply.** For each entry in `changes[]`, run detection against the project. If no files match, skip the change. If a change has no `detection`, apply unconditionally. For each matched change, execute the recipe's instructions: invoke the colocated script named by `script` (via `pnpm exec tsx` for `*.ts`, `bash` for `*.sh`, `jscodeshift` or similar for codemods), or follow the prose in `recipe.md`.
  5. **Validate.** Run `pnpm typecheck && pnpm test` (or the project's equivalent — implementer to specify the discovery rule). If red, halt the chain and surface to the consumer (NFR5).
  6. **Commit.** Create a commit containing this step's changes only: `chore: upgrade @prisma-next/* to <to-version>` (or the project's commit-message convention). Per FR28, one commit per step.

  When two skills apply (user + extension), the agent finishes the user-skill chain end-to-end first, then runs the extension-skill chain. Pin updates on the user side cover `dependencies` / `devDependencies`; on the extension side they cover `peerDependencies`. Both must be exact versions per FR22.

- **FR27. Pre-flight extension-compatibility check (user side).** Before any code changes, the user-upgrade-skill invokes `checkInstalledExtensionPins(rootDir, targetPnVersion)` from `@prisma-next/extension-pin-check` (FR25). The function returns one of:

  - `{ ok: true }` — every installed PN extension's peer-dep pin is exactly the target version. Proceed.
  - `{ ok: false, lagging: [...], highestReachable: "0.X.Y" }` — at least one extension pins to a version older than the target. The skill aborts the upgrade with a structured error naming each lagging extension and the `highestReachable` PN version the consumer could safely upgrade to right now. The consumer is offered two paths: (a) wait for the lagging extension to publish a compatible release, (b) re-run the upgrade with `--to=<highestReachable>` to upgrade as far as the installed extensions permit.

  The pre-flight is user-side only. The extension-upgrade-skill does not run this check — extension authors are the source of the pins, not the consumers. *Their* equivalent sanity check is FR24's CLI invoked after each step.

- **FR28. One commit per transition step.** Each `(from, to)` step in the chain produces exactly one commit containing the pin bump, the post-install lockfile changes, and the recipe's effect on the consumer's source. The agent does not squash steps. The consumer is free to squash on merge; the in-flight history is per-step so a failed step is bisectable and revertable independently.

### Exact-pin rule and `@prisma-next/extension-pin-check`

- **FR22. Exact-pin rule.** Every `@prisma-next/*` entry in an extension's `peerDependencies` is an exact-version pin (e.g. `"0.7.0"`). Range forms (`^0.7.0`, `~0.7.0`, `>=0.7.0`), wildcards (`*`, `"x"`), and workspace specifiers (`workspace:*`, `workspace:^`) are all forbidden in *published* `package.json` files. All `@prisma-next/*` entries pin to the same version. The pin advances only after the extension author has run the relevant upgrade recipe(s) and validated their extension's tests against the new PN version.

  The rule applies to **published** extension `package.json` files. Extensions developed inside a workspace (e.g. PN's own `packages/3-extensions/cipherstash` while it lives in this monorepo) may use `workspace:*` at dev time; the publish-time rewrite (FR26) is responsible for producing exact pins in the artefact that reaches npm.

- **FR23. `@prisma-next/extension-pin-check` package.** A new published workspace package at `packages/0-shared/extension-pin-check/`, version-locked to PN (FR2), distributed via the same `pnpm -r publish` step as the rest of the release (FR15). Its public surface:

  - A CLI binary `prisma-next-check-pins` (declared via `bin` in `package.json`).
  - A programmatic API `checkInstalledExtensionPins(rootDir: string, targetPnVersion: string): PinCheckReport`, exported from the package's main entry point.

  The package has no runtime dependencies beyond `node:fs`, `node:path`, and `pathe` (per the workspace's path-handling rule). It is small enough that an extension author installing it as a `devDependencies` entry adds no meaningful weight.

- **FR24. `prisma-next-check-pins` CLI.** Run by extension authors as `pnpm exec prisma-next-check-pins`. Behaviour:

  1. Reads the current working directory's `package.json`.
  2. Enumerates every `@prisma-next/*` entry in `peerDependencies`.
  3. For each entry, asserts the spec is a literal exact-version string matching the regex `/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/` (i.e., no operators, no `workspace:`, no wildcards). Pre-release suffixes are permitted.
  4. Asserts every entry resolves to the same exact version.
  5. Exits with status `0` and no output on success; on any failure, exits non-zero with a structured error naming every offending entry, its observed value, and the rule it violated.

  The CLI is intended for: (a) extension authors' own CI, (b) sanity check after the extension-upgrade-skill recipe's bump step.

- **FR25. `checkInstalledExtensionPins` programmatic API.** Imported by `@prisma-next/upgrade-skill` for the user-side pre-flight (FR27). Behaviour:

  1. Walks `rootDir/node_modules` (using `pnpm list --json` or equivalent for accuracy under pnpm's symlinked layout).
  2. Identifies installed PN extensions by **peer-dep detection**: any installed package whose `package.json` declares `@prisma-next/contract` in its `peerDependencies` is treated as a PN extension.
  3. For each detected extension, reads its `peerDependencies` `@prisma-next/contract` pin (which under FR22 is an exact version).
  4. Returns:

     ```ts
     type PinCheckReport =
       | { ok: true }
       | {
           ok: false;
           lagging: Array<{
             extension: string;        // e.g. "@prisma-next-ext/cipherstash"
             pinnedTo: string;         // e.g. "0.6.1"
           }>;
           highestReachable: string;   // the highest PN version every installed extension's pin satisfies
         };
     ```

  5. The function does not mutate disk state and does not call out to the network.

- **FR26. Publish-time exact-pin rewrite for in-repo extensions.** PN's own in-repo extensions (`packages/3-extensions/*`) declare their `@prisma-next/*` peer-deps as `workspace:*` at development time. At publish time, the `pnpm -r publish` invocation must rewrite those entries to *exact* `X.Y.Z` versions in the published `package.json`, not the default `^X.Y.Z`. Implementer to wire this via whichever pnpm-supported mechanism is current (`publishConfig` block per package, `--workspace-packages-exact` flag, or equivalent). Verified by the existing `check:publish-deps` gate extending to also assert no caret/tilde in `@prisma-next/*` peer-deps of any published extension.

## Non-Functional Requirements

- **NFR1. Recipe authoring overhead.** Adding a recipe entry to an in-progress PR — including running validation — must not add more than ~30 minutes of agent time per breaking change to the typical PR.
- **NFR2. Consumer-side upgrade time.** A single-transition upgrade (e.g. `0.6 → 0.7`) against a representative project (one of the example apps) must complete in under 5 minutes of wall-clock time, including install, recipe execution, and validation.
- **NFR3. Idempotency.** Every recipe script must be safe to re-run. Running a recipe twice in succession against the same project produces the same final state as running it once. This is enforced by FR11's validation step rerunning the recipe and asserting a no-op diff.
- **NFR4. Patch-version stability.** Patch versions (`0.6.0 → 0.6.1`) must not require a recipe — by policy, patches are bug-fix-only and must not produce any `examples/` or `packages/3-extensions/` diff except for the conventional generated paths excluded by FR13. The publish-gate skips the coverage check for patch bumps; if a patch bump *did* produce a substrate diff, the team has either mis-classified the change (should have been a minor bump) or the change shouldn't be merging at all.
- **NFR5. Recipe failure surfaces a structured error.** A recipe script failure must produce a PN-style structured error envelope with a stable code (`PN-UPGRADE-NNNN`), naming the failing change, the file(s) the script was operating on, and the inferred remediation. The agent surfaces this to the consumer; the consumer is not asked to read script stack traces.
- **NFR6. Skill body size.** The published `SKILL.md` body is small enough to load into any reasonable agent's context window in one go (target: <8KB). Recipe bodies and colocated scripts are referenced by name, not inlined.
- **NFR7. No secrets in recipes.** Recipe scripts must not require environment variables, network access, or any input beyond the project's filesystem and the recipe's bundled assets. (This is what makes them safe to ship publicly and to run automatically.)
- **NFR8. Publish atomicity.** Both `@prisma-next/upgrade-skill` and `@prisma-next/extension-upgrade-skill` are published as part of the same `pnpm -r publish` step that publishes every other PN package; if any package fails to publish, the workflow fails as a whole and the maintainer is alerted. There is no separate publish channel that could leave either upgrade skill out of sync with the rest of the release. `@prisma-next/extension-pin-check` is part of the same publish step.
- **NFR9. Pin-check runtime cost.** `prisma-next-check-pins` completes in under 1 second on a typical extension repo. `checkInstalledExtensionPins` completes in under 5 seconds on a typical user app (a `pnpm list --json --depth=0` invocation plus per-extension peer-dep reads from disk). These bounds matter because both run frequently — every PR for extensions, every upgrade invocation for users.

## Non-goals

- **Downgrade ("downgrade Prisma Next" or `0.7 → 0.6`).** Recipes are forward-only. A user who installs an older PN version is on their own.
- **Cross-major-version compounds without intermediate stable releases.** When PN reaches `1.0`, there will be a `0.x → 1.0` recipe; pre-1.0, we're in single-line minor bumps and don't need to model branching version histories.
- **Non-PN breaking changes.** Postgres major bumps, Node major bumps, `pnpm` major bumps — out of scope. Recipes describe PN's own evolution only.
- **Replacing release notes.** Recipes complement, not replace, the auto-generated GitHub Release notes (the conventional-commit-derived changelog from `.github/PULL_REQUEST_TEMPLATE.md`).
- **Recipes for changes to *internal* package boundaries** (i.e. dependencies among PN's own workspace packages that aren't visible at the published-package surface). The detection signal — `examples/` or `packages/3-extensions/` diff — already excludes these; internal-only refactors don't break consumers.
- **Translating queries written in `db.sql` raw mode.** Raw SQL is opaque to the contract; if a PN release changes the contract-driven generation pipeline in a way that breaks a raw SQL string a user wrote, the user is on their own (the existing `db.orm` path is the recipe-safe surface).
- **Bundling user-provided assets into recipes.** A recipe can read the user's project; it cannot push or fetch arbitrary assets.
- **Range pinning for extension peer-deps.** Extensions never use `^`, `~`, `>=`, or range forms for `@prisma-next/*` peer-deps; exact pins only (FR22). Users' app-level `dependencies` and `devDependencies` may use ranges if they wish, but the upgrade-skill itself writes exact versions when it advances them (FR20), and installed extensions transitively constrain the user to exact pins anyway.
- **Pin-check for non-PN-extension packages.** `prisma-next-check-pins` and `checkInstalledExtensionPins` look only at `@prisma-next/*` peer-deps. Other ecosystem pins (`@types/*`, partner SDKs, etc.) are out of scope; extension authors manage those with their own tooling.

# Acceptance Criteria

- **AC1. End-to-end user upgrade against a representative app.** Take a checkout of [`examples/prisma-next-demo/`](../../../examples/prisma-next-demo/) at PN `0.6.x` (pre-PR-#502 manifest shape), bump PN to `0.7.x` in `package.json`, run the agent with `@prisma-next/upgrade-skill@0.7.0` installed. The agent detects user role (FR19), reads `recipes/0.6-to-0.7/recipe.md` from the user skill, follows its instructions (which invoke the colocated `strip-manifest-bookends.ts`), `pnpm install` + `pnpm typecheck && pnpm test` are green, the resulting `migration.json` files match the post-PR-#502 manifest shape, no manual intervention was required. The agent does *not* load `@prisma-next/extension-upgrade-skill` content. Covers FR1, FR3, FR5–FR7, FR16–FR20, NFR2, NFR6.

- **AC2. Multi-transition chain.** Once a `0.7 → 0.8` recipe exists in the user skill, run the same scenario starting from PN `0.6.x` and upgrading to `0.8.x`. The agent applies `0.6 → 0.7 → 0.8` recipes in order; final state is green. Covers FR18, FR4. *(Deferred-until-available; harmless to skip until the second recipe lands.)*

- **AC3. End-to-end extension-author upgrade.** Take a checkout of [`packages/3-extensions/cipherstash/`](../../../packages/3-extensions/cipherstash/) at PN `0.6.x`. Bump PN to `0.7.x`. The agent with `@prisma-next/extension-upgrade-skill@0.7.0` installed detects extension-author role (FR19), reads `recipes/0.6-to-0.7/recipe.md` from the *extension* skill (containing both the bookend-strip and the MigrationMetadata SPI update), runs `pnpm test --filter @prisma-next/extension-cipherstash` green. Covers FR19, FR20, and the extension-skill leg of FR1, FR3, FR5–FR7.

- **AC4. Both-role flow in a single repo.** Take a checkout that is *both* a user and an extension author (e.g. a repo containing both an example app and an extension package, mirroring the in-repo `examples/cipherstash-integration/` shape). Bump PN to `0.7.x`. The agent runs the user-skill chain first against the app, then the extension-skill chain against the extension package, both green. Covers the both-role case in FR19, FR20.

- **AC5. Patch bump skips recipe check.** Open a PR that does no more than bump version constants and update a changelog (no `examples/` or `packages/3-extensions/` diff). PR CI passes; `check:recipe-coverage` (FR14) is skipped because the bump is a patch (NFR4). Confirm in CI logs.

- **AC6. User-substrate change without user-skill recipe fails CI.** Open a PR that introduces a breaking change visible to a user app, follows the type errors into `examples/` to fix them, and *does not* add a recipe in `@prisma-next/upgrade-skill`. PR CI fails with a structured error naming the expected recipe path (`packages/0-shared/upgrade-skill/recipes/<from>-to-<to>/`). The author adds the recipe; CI passes. Covers the user-skill leg of FR9, FR12, FR14.

- **AC7. Extension-substrate change without extension-skill recipe fails CI.** Open a PR that changes the framework SPI in a way that requires `packages/3-extensions/cipherstash` edits, and *does not* add a recipe in `@prisma-next/extension-upgrade-skill`. PR CI fails with a structured error naming the expected recipe path (`packages/0-shared/extension-upgrade-skill/recipes/<from>-to-<to>/`). The author adds the recipe; CI passes. Covers the extension-skill leg of FR9, FR12, FR14.

- **AC8. Both-substrate change requires both recipes.** Open a PR (e.g. PR #502's rebased shape) that touches both `examples/` and `packages/3-extensions/`. PR CI fails if either recipe is missing; passes only once both are present. Covers the both-signal case of FR9, FR13, FR14.

- **AC9. Validation-by-execution prevents bad recipes from landing.** Author a PR with a deliberately-broken recipe (e.g. the colocated script's glob misses a file, or the script crashes on a shape present in `examples/multi-extension-monorepo/`). The agent's FR11 validation step finds the matching test suite red after recipe application. The PR cannot proceed until the recipe is fixed. Covers FR10–FR12.

- **AC10. Pre-publish gate blocks a release without a required recipe.** Simulate a release workflow run for a version whose diff against the previous release tag touches `examples/` but `packages/0-shared/upgrade-skill/recipes/<from>-to-<to>/` is missing. `check:recipe-coverage` fails before the `pnpm -r publish` step; no package reaches the registry. Repeat for the extension-skill leg. Covers FR13.

- **AC11. Both upgrade skills and PN ship at matching versions.** After a stable publish to `0.7.0`, both `npm view @prisma-next/upgrade-skill dist-tags.latest` and `npm view @prisma-next/extension-upgrade-skill dist-tags.latest` return `0.7.0`. Covers FR2, FR15.

- **AC12. Idempotent re-run.** Re-running a recipe immediately after the first run produces an empty git diff. Covers NFR3.

- **AC13. Recipe failure structured-error surface.** Inject a deliberate failure in a recipe script (e.g. malformed input). The recipe surfaces a `PN-UPGRADE-NNNN` envelope with the failing change id, file paths, and remediation hint; the agent does not auto-rollback (Q6). Covers NFR5.

- **AC14. Mechanism dormant until first recipe.** After the spec is implemented but before PR #502 lands, run the publish workflow against a release with no `examples/` or `packages/3-extensions/` diff: `check:recipe-coverage` passes vacuously, no recipes are required in either skill. Covers the *release sequencing* note in Approach.

- **AC15. Freeze check rejects edits to a frozen recipe.** Take a `main` whose `package.json` is at `0.8.0` with `recipes/0.6-to-0.7/` already populated. Open a PR that edits `recipes/0.6-to-0.7/recipe.md` (adds or removes a `changes[]` entry, or modifies the colocated script). PR CI fails with the structured error from FR21 naming both the frozen directory and the current in-flight directory (`recipes/0.7-to-0.8/`). Moving the edits to `recipes/0.7-to-0.8/` and re-pushing passes. Covers FR21.

- **AC16. Freeze check passes for in-flight directory.** Same `main` at `0.8.0`. Open a PR that adds an entry to `recipes/0.7-to-0.8/recipe.md`. PR CI passes the freeze check (the in-flight directory is mutable). Covers FR21.

- **AC17. Bump-PR transition.** Sequence: (a) topic branch A opens with a recipe entry in `recipes/0.6-to-0.7/`, against `main` at `0.7.0`. (b) Topic branch A merges. (c) A version-bump PR lands, advancing `main` to `0.8.0`. (d) Topic branch B (open since before (c), also with edits in `recipes/0.6-to-0.7/`) runs PR CI and fails the freeze check from FR21. (e) Topic branch B rebases onto post-bump `main`, moves its entries to `recipes/0.7-to-0.8/`, and CI passes. Covers FR10's rebase scenario + FR21.

- **AC18. In-flight minor reads from package.json on the PR branch.** The agent invoking the `record-recipe` skill on a branch whose `package.json` is at `0.7.0` writes recipe entries to `recipes/0.6-to-0.7/`. The same agent on a branch whose `package.json` is at `0.8.0` writes to `recipes/0.7-to-0.8/`. No `npm view` consultation is observed in the agent's tool-call log. Covers FR10's step 1 + [`package-json-versioning.spec.md`](package-json-versioning.spec.md)'s FR1.

- **AC19. `prisma-next-check-pins` exits clean on exact pins.** A test extension with `peerDependencies: { "@prisma-next/contract": "0.7.0", "@prisma-next/sql-contract": "0.7.0" }` invokes `pnpm exec prisma-next-check-pins`. Exits status 0, no output. Covers FR24.

- **AC20. `prisma-next-check-pins` rejects a range pin.** A test extension declaring `peerDependencies: { "@prisma-next/contract": "^0.7.0" }` invokes the CLI. Exits non-zero with a structured error naming the offending entry and the rule violated. Same for `~0.7.0`, `>=0.7.0`, `*`, `workspace:*`. Covers FR22, FR24.

- **AC21. `prisma-next-check-pins` rejects mismatched versions.** A test extension declaring `peerDependencies: { "@prisma-next/contract": "0.7.0", "@prisma-next/sql-contract": "0.7.1" }` invokes the CLI. Exits non-zero with a structured error naming the two divergent entries. Covers FR22, FR24.

- **AC22. `checkInstalledExtensionPins` detects a lagging extension.** A test user app at PN `0.6.1` with `@prisma-next-ext/cipherstash@0.6.1` installed (which peer-deps `@prisma-next/contract: "0.6.1"`) calls `checkInstalledExtensionPins(rootDir, "0.8.0")`. Returns `{ ok: false, lagging: [{ extension: "@prisma-next-ext/cipherstash", pinnedTo: "0.6.1" }], highestReachable: "0.6.1" }`. Covers FR25.

- **AC23. User-upgrade pre-flight blocks on a lagging extension.** Same test setup as AC22. Invoke `@prisma-next/upgrade-skill` to upgrade from `0.6.1` to `0.8.0`. The agent surfaces a structured `PN-UPGRADE-NNNN` error naming the lagging extension and the highest reachable PN version (`0.6.1`). No `package.json` is modified; no `pnpm install` is run. Covers FR27.

- **AC24. Multi-step upgrade commits per step.** A user app at `0.6.1` upgrading to `0.8.0` (with both `0.6→0.7` and `0.7→0.8` recipes available, and all extensions compatible with `0.8.0`) produces exactly two commits on `HEAD`: `chore: upgrade @prisma-next/* to 0.7.0` and `chore: upgrade @prisma-next/* to 0.8.0`. Each commit contains both the pin bump and the matching recipe's effect on the source. Covers FR18, FR20, FR28.

- **AC25. In-repo extension publishes with exact peer-dep pins.** Take any release publish that includes `@prisma-next-ext/cipherstash` (or whichever in-repo extension is published). Inspect the published `package.json` on npm via `npm view @prisma-next-ext/cipherstash@<version> peerDependencies`. Every `@prisma-next/*` entry is exactly `<version>`, with no caret, tilde, range, or `workspace:` specifier. Covers FR26.

# Other Considerations

## Security

- **Recipe trust.** Recipes run scripts in the consumer's project root. The trust model is the same as installing any npm package: by installing either upgrade skill, the consumer (or their agent on their behalf) trusts the Prisma Next team's publish pipeline. Both skills are published with npm provenance attestations (FR15 inherits the existing publish workflow's `NPM_CONFIG_PROVENANCE: "true"`), so consumers can verify each skill came from the PN GitHub release pipeline.
- **No network in recipes.** NFR7 closes the obvious supply-chain hole. Recipes are pure filesystem-and-bundled-assets transformations. A recipe wanting to fetch a remote payload would have to break this contract, which the in-repo `record-recipe` skill explicitly disallows.
- **Recipe prose runs inside the agent.** The prose body of `recipe.md` is agent instructions, not executable code; it runs in the agent's existing security context, bounded by whatever the agent itself is permitted to do.

## Cost

- **Distribution.** Trivial. Each skill is a few hundred KB of text per release; two skills double that, still rounding error against npm storage cost.
- **CI cost.** The `check:recipe-coverage` step at publish-time runs two parallel sub-checks; each is O(files-in-diff) and runs once per release — negligible.
- **PR-CI cost.** The same two-sub-check check on every PR adds seconds, not minutes. The validation-by-execution step in `record-recipe` runs the existing `pnpm test:examples` and `pnpm test --filter='./packages/3-extensions/*'` suites, which the workspace already runs in CI; the marginal cost is the recipe application itself (one script run per substrate per recipe).
- **Per-consumer runtime cost.** Each upgrade applies N recipes against M project files; for representative projects this is bounded under NFR2 at 5 minutes total *per applicable skill chain*. Both-role consumers run two chains sequentially.

## Observability

- **Recipe-application telemetry.** Out of scope for v1. The agent surfaces success or failure to the consumer directly; centralised telemetry is a phase-2 question that intersects with broader product-analytics decisions outside this spec.
- **Publish-pipeline observability.** Existing GitHub Actions logs cover the new `check:recipe-coverage` step and the two upgrade-skill packages picked up by `pnpm -r publish`. No new dashboards.

## Data Protection

- No personal data flows through recipes; recipes are deterministic transformations of the user's own project filesystem. NFR7 (no network, no external input) closes the obvious data-exfiltration concern.

## Analytics

- **Recipe execution events.** Deferred. The right shape is "did the recipe succeed; did the validation pass; how long did it take," all of which the agent already knows locally. Whether to ship those events anywhere is the same question as broader PN runtime telemetry and is settled outside this spec.

# References

- [`package-json-versioning.spec.md`](package-json-versioning.spec.md) — the prerequisite task spec that establishes `package.json` as the version source-of-truth this spec consumes.
- [TML-2514](https://linear.app/prisma-company/issue/TML-2514) — parent Linear ticket for the Prisma Next agent-skill project this spec belongs to.
- [TML-2515](https://linear.app/prisma-company/issue/TML-2515) — placeholder Linear ticket for the backwards-compatibility policy this spec produces.
- [PR #502 — drop inlined fromContract/toContract from migration.json](https://github.com/prisma/prisma-next/pull/502) — the canonical worked example used in AC1, AC3, AC8, AC9.
- `[.github/workflows/publish.yml](../../../.github/workflows/publish.yml)` — the workflow this spec extends with `check:recipe-coverage` and the upgrade-skill publish job.
- `[scripts/determine-version.ts](../../../scripts/determine-version.ts)`, `[scripts/set-version.ts](../../../scripts/set-version.ts)` — the existing version-determination tooling the publish-gate and PR-CI use.
- `[packages/1-framework/3-tooling/cli/README.md](../../../packages/1-framework/3-tooling/cli/README.md)` — CLI surfaces (FR9).
- `[docs/architecture docs/subsystems/7. Migration System.md](../../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md)` — context for the on-disk migration shape referenced in FR9 and AC1.
- `[docs/architecture docs/adrs/ADR 199 - Storage-only migration identity.md](../../../docs/architecture%20docs/adrs/ADR%20199%20-%20Storage-only%20migration%20identity.md)` — anchor for understanding why the PR #502 change was hash-stable.
- `[projects/prisma-next-agent-skill/references/](../references/)` — reference skills (Supabase, Vercel, Convex, TanStack) studied for pattern conventions.

# Open Questions

The substantive design questions were resolved during refinement (see *Decisions resolved during refinement* below). Two residual implementer choices remain:

1. **Exact workspace-package location.** The spec uses `packages/0-shared/upgrade-skill/` and `packages/0-shared/extension-upgrade-skill/` as defaults, which creates a new `0-shared` tier alongside the existing `0-config`. Alternatives the implementer might prefer:
   - Fold both into `packages/0-config/` (treating the upgrade skills as build/release-time artifacts alongside `tsconfig` and `tsdown`).
   - Create `packages/0-shared/` as proposed.
   - Carve out a dedicated `packages/0-skills/` tier for skill artifacts (anticipating future skills like `@prisma-next/agent-skill` from the parent project).

   The choice affects `architecture.config.json` (the new tier needs a domain/layer/plane assignment) and `dependency-cruiser.config.mjs` (boundary rules). **Default: `packages/0-shared/{upgrade-skill,extension-upgrade-skill}/`, both classified as `framework` / `tooling` / `shared`.** Implementer to pick and update both config files.

2. **CI implementation surface for FR13 / FR14.** Two patterns the implementer might choose:
   - Add a new step inside `.github/workflows/publish.yml` and `.github/workflows/ci.yml` (`run: node scripts/check-recipe-coverage.mjs`), with the script in `scripts/`.
   - Implement as a workspace-script (`pnpm check:recipes`) that the workflows invoke, parallel to the existing `check:publish-deps`.

   The script is small — two parallel sub-checks of the same shape, ~60–120 lines of glob + git diff + filesystem check. **Default: workspace-script `pnpm check:recipes` invoked from the workflows, matching the existing `check:publish-deps` shape.** Implementer to confirm.

## Decisions resolved during refinement

- **Exact-pin rule for extension peer-deps.** Extensions pin every `@prisma-next/*` `peerDependencies` entry to a single exact version. The pin advances only after the extension author has run the recipe and validated their tests against the new version. Rationale: PN is `0.x` with weekly breaking-change cadence; the "no breaking in patches" discipline (NFR4) is aspirational until proven; the exact pin makes every PN bump a deliberate recipe-gated action rather than a transitive SemVer surprise. Rejected alternative: caret ranges with strict adherence to NFR4. Rejected because the discipline has no track record yet and the consequence of getting it wrong (a silently-incompatible patch reaches extensions) is severe.
- **Pin-bump as general flow content, not per-recipe content.** Each skill's `SKILL.md` carries the upgrade flow (pre-flight → per-step bump → install → recipe → validate → commit); individual recipes are pure code-translation instructions for one transition and never mention pin management. Rejected alternative: every recipe's prose ends with a "bump the pin" line, enforced by `record-recipe`. Rejected because recipes already have a clean responsibility (transition-specific code work) and pin management is the same flow step regardless of recipe content — duplicating it in every recipe pollutes recipe bodies and adds a content-shape rule for no benefit.
- **Iterative one-minor-at-a-time upgrade flow.** A multi-minor upgrade (`0.6 → 0.8`) runs as: bump to `0.7`, install, run `0.6→0.7` recipe against `0.7` types, validate, commit; then bump to `0.8`, install, run `0.7→0.8` recipe against `0.8` types, validate, commit. Each recipe is authored against, runs against, and is validated against a single `<from> → <to>` transition; recipes never need to reason about types from a version other than their own `<to>`. Rejected alternative: bump straight to the target, run recipes in sequence against the target's types. Rejected because earlier recipes' colocated scripts may import or assume APIs that exist only in their `<to>` version's types; running them against a later version's types produces subtle, unhelpful failures.
- **One commit per transition step.** Each `(from, to)` step produces exactly one commit. Failed steps are bisectable; the consumer can squash on merge if they prefer. Rejected alternative: one commit per upgrade run. Rejected because losing per-step granularity makes a partial failure (recipe `0.7→0.8` red after `0.6→0.7` green) hard to recover from.
- **Pin-check tool is a separate workspace package.** `@prisma-next/extension-pin-check` lives at `packages/0-shared/extension-pin-check/`, exposes both a CLI and a programmatic API. Three consumers: extension authors' CI (CLI), extension-upgrade-skill recipe validation (CLI), user-upgrade-skill pre-flight (programmatic API). Rejected alternative: bundle the check inside one of the skill packages as a colocated script. Rejected because the CLI needs to be installable on its own (extension CI doesn't want to install a skill), and the programmatic API needs to be importable from another workspace package (the user-upgrade-skill).
- **Peer-dep-based extension detection.** The pin-check tool identifies a PN extension as any installed package that declares `@prisma-next/contract` in its `peerDependencies`. No namespace registry (`@prisma-next-ext/*`), no `package.json` marker. Rejected alternatives: a namespace-based check (forces partners into a `@prisma-next-ext/` namespace they may not want) and a marker-based check (adds a ceremony step extension authors will forget). The peer-dep is something every PN extension *already* has — no new contract.
- **Version source-of-truth is `package.json`.** Recipe-directory keying, the in-repo authoring skill's version detection, and the recipe-freeze rule all read the in-flight minor from `package.json` on the relevant branch. This decision creates a hard dependency on [`package-json-versioning.spec.md`](package-json-versioning.spec.md), which establishes the source-of-truth refactor. The rejected alternative was to keep computing the version from `npm view ... dist-tags.latest` (today's `scripts/determine-version.ts` approach): rejected because an agent on a topic branch can't reliably reason about npm state at the moment their PR will merge, especially with bump-PRs landing concurrently. `package.json` on the branch is the unambiguous, locally-readable source.
- **Recipe-freeze rule.** Recipes for transitions whose `<to>` minor is no longer the in-flight minor on `main` are immutable. The CI check (FR21) is the enforcement; the in-repo `record-recipe` skill names the rule and walks the agent through the rebase scenario when it fires. Rejected alternative: allow late edits to frozen recipes (with a manual override) — rejected because consumers may have already applied the recipe by the time the edit lands, and there is no path to re-apply silently corrected recipes.
- **Two skill packages, not one.** `@prisma-next/upgrade-skill` (users) and `@prisma-next/extension-upgrade-skill` (extension authors) are separate npm packages, each with its own recipe registry. The skill package *is* the audience filter; recipes do not carry an `audiences:` field. Cross-audience recipes (the rare PR #502 shape) are duplicated across the two packages, including their colocated scripts — write-once after publication, so duplication does not create maintenance drift. Asymmetric breaking-change cadence (most SPI churn is invisible to users; most public-API tightening is invisible to extension authors) means each consumer sees a body free of content irrelevant to them.
- **Skill publish target.** npm-direct; no separate `prisma/agent-skills` GitHub mirror.
- **Recipe scripting form.** Each recipe is one `recipe.md` (agent-instruction Markdown) with zero or more colocated portable scripts in any form (`*.ts`, `*.sh`, codemods). Not the original `user.script.ts` / `extension.prompt.md` four-file split.
- **In-repo skill location.** `.agents/skills/record-recipe/` — the cross-tool location both Claude and Cursor read in this repo. One in-repo skill, not two; it routes to the correct upgrade-skill package(s) based on the touched substrate. No separate `.cursor/rules/` mirror.
- **API-surface diff implementation.** Dropped. Replaced by the `examples/` + `packages/3-extensions/` git-diff signal (FR9, FR13). No bespoke `api-extractor` / `pkg-pr-new` integration needed.
- **Empty-recipe directories.** Not produced. A minor bump with no matching substrate diff produces no recipe directory in that skill's package; the publish-gate sub-check is vacuously satisfied.
- **Recipe failure recovery.** Surface the structured error; do not auto-rollback. The consumer may have uncommitted work the agent cannot safely discard; the agent surfaces `git checkout -- .` as the recovery command and lets the consumer run it.
- **CI proof of skill consultation.** Cannot be enforced. CI asserts the *outcome* (FR13 / FR14: matching recipe present when matching substrate changed); the skill-consultation itself is the agent's responsibility via `description`-firing, the same way every other skill works.
- **Workspace-package location.** Inside `packages/` because that's where the publish pipeline iterates and how each upgrade skill reaches npm. Exact tier is residual (Open Question 1).
- **First recipe sequencing.** Mechanism lands on the current branch (`tml-2514`) recipe-free in both packages; PR #502 is rebased onto the mechanism, authors recipes in both `@prisma-next/upgrade-skill` and `@prisma-next/extension-upgrade-skill`, re-houses its existing `wip/strip-manifest-bookends.ts` into both recipe directories. The resulting `0.7.0` release is the first to exercise the gate end-to-end.
- **Backward-fill.** None. Both registries start at `0.6 → 0.7`. Pre-0.6 consumers are pointed at GitHub Release notes for hand-migration.

