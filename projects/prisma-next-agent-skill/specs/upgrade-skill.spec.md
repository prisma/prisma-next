# Summary

Define two published agent skills — `@prisma-next/upgrade-skill` (for users of Prisma Next) and `@prisma-next/extension-upgrade-skill` (for authors of Prisma Next extensions) — both version-locked to Prisma Next, each carrying a versioned set of *upgrade instructions* an agent can read and execute to translate a project (or an extension) from one PN version to the next. Define the in-repo authoring workflow that mandates a validated upgrade-instruction entry in the appropriate skill whenever a PR touches the relevant surface, and the release-pipeline gate that enforces it. Define the *exact-pin rule* for in-repo extensions' `@prisma-next/*` workspace deps and the publish-time mechanic that produces exact pins in the published artefact. The extension-upgrade-skill ships a small `prisma-next-check-pins` CLI (as a `bin`) that extension authors run in their own CI to enforce the exact-pin rule on their package.

The mechanism delivers two parallel multi-step upgrade flows (one per skill, identical shape, different audience), where each step in a chain bumps `@prisma-next/*` deps to the next minor, runs that minor's upgrade instructions against the new types, validates, and commits before moving on. Upgrade instructions are pure code-translation content for a single transition; the bump-then-instructions-then-validate-then-commit loop is general flow content in the skill's `SKILL.md`, not per-instructions content.

This spec depends on [`package-json-versioning.spec.md`](package-json-versioning.spec.md), which establishes the root `package.json` `version` field as the **currently-published** version on a given ref (the value `pnpm bump-minor` reads when preparing the next release). Upgrade-instructions directory keying and the in-repo authoring skill's version detection both consume that source-of-truth: the in-flight transition on a given ref is `<currently-published>-to-<currently-published + 1>`.

# Context

## At a glance

Today, every PN breaking change costs the team a round of individual outreach: chase each user, chase each extension author, write or paste the fix into their codebase, hope nothing regressed. PN is currently published at `0.7.0` (the value of root `package.json` `version`); the in-flight transition on this branch is `0.7 → 0.8`. Breaking changes are weekly. The existing user base is small but real (Cipherstash extension, two known customers), and the extension contract is rapidly evolving. The outreach process doesn't scale to even five active consumers, and won't scale at all once the strategy lands a partner like Supabase.

This spec defines a three-piece mechanism that replaces that outreach with an artifact agents consume:

1. **`@prisma-next/upgrade-skill`** — published, version-locked to PN, scoped to **users** (consumers of PN's public package API). Its body is a versioned set of *upgrade instructions*, one directory per `(from-minor, to-minor)` transition. Each transition is a single Markdown file (`instructions.md`) of agent instructions, with frontmatter declaring the breaking changes and detection signals. The instructions may direct the agent to run a *colocated script* (TypeScript, bash, or a codemod — whichever is portable enough for the task); scripts sit next to `instructions.md` and are addressed by relative path. Upgrade instructions here cover public-API changes and on-disk-shape changes that affect user projects.

2. **`@prisma-next/extension-upgrade-skill`** — published, version-locked to PN, scoped to **extension authors** (consumers of PN's framework SPI). Same shape as the user skill; different content. Upgrade instructions here cover middleware lifecycle changes, codec / migration-tools / framework-components SPI churn, and any on-disk-shape change that affects an extension's seed migrations. Extension authors are also PN users for their own apps, so they typically install both skills; the two operate independently. The package additionally publishes a small `prisma-next-check-pins` binary (a `bin` entry) that extension authors install as a devDependency and wire into their own CI to enforce the exact-pin rule on their `@prisma-next/*` workspace deps.

3. **An in-repo agent skill at `.agents/skills/record-upgrade-instructions/`** that fires when the change-making agent's PR touches surfaces a downstream consumer or extension author depends on. Signals are mechanical: changes in [`examples/`](../../../examples/) demand an upgrade-instruction entry in `@prisma-next/upgrade-skill`; changes in [`packages/3-extensions/`](../../../packages/3-extensions/) demand one in `@prisma-next/extension-upgrade-skill`; both demand both. The skill instructs the agent to (a) add an entry for the in-progress version transition in the relevant package(s), (b) author any required colocated script, and (c) *run the entry against the corresponding substrate* and demonstrate it works — before the PR is allowed to merge.

The release-pipeline gate ties them together: the `publish.yml` workflow (and PR CI) refuses to ship a version whose `examples/` diff is not covered by an entry in `@prisma-next/upgrade-skill`, or whose `packages/3-extensions/` diff is not covered by an entry in `@prisma-next/extension-upgrade-skill`. Substrate diffs in any path — including diffs limited to generated artefacts like `contract.json` / `contract.d.ts` — count: a format change to a generated artefact is itself an upgrade instruction, and "no consumer-side action needed" is recorded by an entry with `changes: []`. The same gate also enforces a *new-entries-go-in-a-current-or-in-flight-directory* discipline: an *added* file under `upgrades/<X>-to-<Y>/` whose label doesn't match either the coverage transition or the in-flight transition (both derived from the PR branch's `package.json`) fails the check. *Modifications and removals* of any directory are allowed — bug fixes to old upgrade-instruction sets are normal PRs.

A user-facing flow, end-to-end (multi-step upgrade `0.6 → 0.8`, two transitions):

```text
user> "upgrade Prisma Next"
agent> Step 0: ensure @prisma-next/upgrade-skill is at @latest, then re-load.
agent> Current: @prisma-next/postgres@0.6.1  (from pnpm-lock.yaml)
       Target:  @prisma-next/postgres@0.8.0  (latest)
       Detected role: user (no @prisma-next/* peerDependencies; @prisma-next/* in dependencies)
       Skill: @prisma-next/upgrade-skill
       Transition chain: 0.6 → 0.7 → 0.8

agent> Pre-flight: reading prisma-next.config.ts → extensions in use:
         - cipherstash (@prisma-next/extension-cipherstash)
       For each, reading node_modules/<pkg>/package.json:
         - @prisma-next/extension-cipherstash → @prisma-next/contract pinned to 0.8.0 — compatible
       OK; proceeding.

agent> Step 0.6 → 0.7:
         Bumps @prisma-next/* deps in package.json: 0.6.1 → 0.7.0 (exact pins)
         pnpm install
         Reads upgrades/0.6-to-0.7/instructions.md, runs colocated strip-manifest-bookends.ts
           → 42 files rewritten
         pnpm typecheck && pnpm test → green
         Commit: "chore: upgrade @prisma-next/* to 0.7.0"

agent> Step 0.7 → 0.8:
         Bumps @prisma-next/* deps in package.json: 0.7.0 → 0.8.0
         pnpm install
         Reads upgrades/0.7-to-0.8/instructions.md, follows prose to update query-builder imports
         pnpm typecheck && pnpm test → green
         Commit: "chore: upgrade @prisma-next/* to 0.8.0"

agent> Done. 2 commits staged.
```

Extension-author flow against the same `0.6 → 0.7` step:

```text
ext-author> "upgrade Prisma Next"
agent> Step 0: ensure @prisma-next/extension-upgrade-skill is at @latest, then re-load.
agent> Detected role: extension-author (this package declares @prisma-next/* in dependencies and is itself listed as a PN extension under packages/3-extensions/ shape)
       Skill: @prisma-next/extension-upgrade-skill
       Transition chain: 0.6 → 0.7

agent> Step 0.6 → 0.7:
         Bumps @prisma-next/* deps in package.json: 0.6.1 → 0.7.0 (exact pins)
         pnpm install
         Reads extension-upgrade-skill upgrades/0.6-to-0.7/instructions.md:
           - migration-json-bookend-drop: runs colocated strip-manifest-bookends.ts
             (same script as the user-skill's instructions; duplicated here intentionally)
             → 1 file rewritten in the extension's seed migrations
           - migration-metadata-spi-update: agent follows instructions prose, edits SPI consumer code
         pnpm build && pnpm test → green
         Runs `pnpm exec prisma-next-check-pins` → green (all @prisma-next/* deps at 0.7.0 exact)
         Commit: "chore: upgrade @prisma-next/* to 0.7.0"

agent> Done. 1 commit staged.
```

If the same person is both a user and an extension author (typical case — they have an example consumer app alongside their extension package), they install both skills and the agent runs both flows in turn (user flow first, then extension flow). A lagging extension blocks the user-side flow's pre-flight with a structured error naming the highest reachable PN version.

## Problem

PN's API surface is converging — that's the explicit reason the project sits at `0.x`. Every week, a new minor bump is computed from the latest stable. The team takes the freedom seriously: PR [#502](https://github.com/prisma/prisma-next/pull/502) ([TML-2512](https://linear.app/prisma-company/issue/TML-2512)) is a recent representative case — it strips `fromContract` / `toContract` from every `migration.json` on disk (the manifest goes from ~1400 lines to ~10), enforces the new schema via arktype `'+': 'reject'`, and ships a one-shot script (`[wip/strip-manifest-bookends.ts](../../../wip/strip-manifest-bookends.ts)` at PR time, *intended* to be re-housed) that regenerates manifests in place. PN ≥ 0.7 will fail to load any manifest that still carries the old fields; the script is the only sanctioned upgrade path. The PR's own description says: *"the only known external consumer is the Cipherstash extension; we are sending a heads-up directly with regeneration instructions."* That heads-up is the manual outreach this spec replaces.

The current escape valves are all manual and don't compose:

- **GitHub Releases** carry `--generate-notes` PR titles. Useful as a changelog; useless as an upgrade instruction. They describe *what changed*; they don't tell the consumer *how to keep working*.
- **PR descriptions** sometimes include scripts (PR #502 inlines a path to `wip/strip-manifest-bookends.ts --check`). The scripts are accurate at PR-merge time, then rot. They are not findable by an agent reading the user's project six weeks later.
- **Linear tickets** ([TML-2515](https://linear.app/prisma-company/issue/TML-2515) is the placeholder for the policy this spec produces) summarise the problem but produce no consumable artifact.
- **Direct messages** to extension authors (Cipherstash, internal Supabase work, etc.) scale to ~1 person.

Two consumer classes share the same pain on different surfaces, and the surfaces churn at different rates:

- **PN users** depend on the public package API (`@prisma-next/postgres`, `@prisma-next/mongo`, the contract types in their `prisma/contract.d.ts`, the on-disk shape of `migration.json` and `ops.json`). The public surface changes infrequently — most PN releases don't break users.
- **Extension authors** depend on the framework SPI (the package boundary at `@prisma-next/framework-components`, `@prisma-next/migration-tools`, the in-repo extensions under [`packages/3-extensions/`](../../../packages/3-extensions/) as canonical reference shapes). The SPI is internal and churns frequently — middleware lifecycle, codec interfaces, migration-tools helpers all move. Many PN releases break extensions and do not affect users at all.

A single PR can break either, both, or neither. PR #502 broke both (it's the unusual structural-disk-shape case). The typical break is asymmetric: SPI churn that's invisible to users, or — less often — public-API tightening that's invisible to extension authors. Splitting the upgrade-skill into two packages (one per audience) is what keeps each consumer's skill body free of content irrelevant to them; the cost today is *every* affected party spending time figuring out which fix applies to them, and the cost we want is the change author writing one (or two) entries alongside the change.

## Approach

The settled approach is the three-piece mechanism described in *At a glance*, plus the publish-gate that enforces co-shipping, plus the publish-time exact-pin mechanic for in-repo extensions. The five mechanisms are:

### The in-flight transition — derived from `package.json`

Every part of this mechanism that needs to know "what transition are we currently authoring against" reads the `version` field from root `package.json` on the relevant branch. This works because [`package-json-versioning.spec.md`](package-json-versioning.spec.md) makes the `version` field reflect the **currently-published** version on a given ref — the value `pnpm bump-minor` reads when preparing the next release. Call its minor `M`. The **in-flight transition** is therefore `M → M+1`, and the **in-flight directory** in each skill package is `upgrades/<M>-to-<M+1>/`.

- The **agent authoring a breaking-change PR** reads `package.json` on the PR branch to know which directory to write to. If the branch's `package.json` says `0.7.0`, the in-flight directory is `upgrades/0.7-to-0.8/`.
- The **publish gate** reads `package.json` on `main` at workflow run-time and on the previous published tag, then expects entries in the directory keyed to `<prev.minor>-to-<head.minor>` (the release being shipped).
- The **PR-CI new-entries gate** reads `package.json` on the PR branch. Same logic for the in-flight directory.

This replaces any reliance on `npm view ... dist-tags.latest` for in-repo workflows. Consumer-side flow (FR17) continues to consult npm — consumers don't have access to PN's source `package.json`.

**(A) Two published audience-scoped skills.** `@prisma-next/upgrade-skill` (users) and `@prisma-next/extension-upgrade-skill` (extension authors) are the consumer-facing artifacts, distributed via npm. Their sources live in this repo as workspace packages at [`packages/0-shared/upgrade-skill/`](../../../packages/0-shared/upgrade-skill/) and [`packages/0-shared/extension-upgrade-skill/`](../../../packages/0-shared/extension-upgrade-skill/) (creating the new `0-shared` tier alongside the existing `0-config`) and are published alongside every PN release via the `publish.yml` workflow. The two packages have no runtime dependencies and are not imported by any other workspace package; they are leaf publish-only artefacts. Each release of each skill contains *every* upgrade-instruction entry from `0.6 → 0.7` onward, with the latest version of every entry (the cumulative set is what makes "always grab `@latest`" the right discipline for consumers — see § Bug-fix discipline below). Each skill's content is organised for organic exploration: a small `SKILL.md` entry point names the available transitions and carries the per-step bump-then-install-then-instructions-then-validate-then-commit loop; `instructions.md` bodies sit under `upgrades/<from>-to-<to>/` so the agent only loads what it needs.

The two packages are independent: each has its own version-locked publish, its own upgrade-instructions set, its own consumer flow. **Hard requirement: no cross-package dependency between the two upgrade skills.** When a breaking change crosses the boundary (the rare PR #502 case), entries are authored in both packages — duplicated, including any colocated script.

**(B) Per-transition upgrade-instructions shape.** One directory per `(from-minor, to-minor)` transition, *per skill package*. The directory contains exactly one `instructions.md` (the agent-instruction file, with frontmatter declaring the breaking changes and detection signals — FR7), plus any number of *colocated scripts* the markdown references by relative path. Scripts are portable by choice — TypeScript via `pnpm exec tsx`, bash, codemods (`jscodeshift`, AST-based) — whichever fits the change. Patch transitions usually have no substrate diff and so don't produce a directory; if a patch *does* touch the substrate (against NFR4's policy), an entry is still required, and `changes: []` is the right shape when the change is genuinely consumer-invisible. Multiple breaking changes within a single transition collapse into one `instructions.md` per package, with multiple entries in its frontmatter's `changes[]` array.

**(C) In-repo upgrade-instructions-authoring skill.** A new agent skill at [`.agents/skills/record-upgrade-instructions/`](../../../.agents/skills/record-upgrade-instructions/) (the cross-tool skills location both Claude and Cursor read) fires when the change-making agent's PR has changes in `examples/` or `packages/3-extensions/`. That signal is the natural consequence of breaking-change refactoring: a real API break either fails the type-check or the test suite in at least one downstream consumer, and the agent fixing those failures necessarily produces diffs there. The skill's content instructs the agent to: (1) route to the correct skill package based on which substrate changed (`examples/` → `@prisma-next/upgrade-skill`; `packages/3-extensions/` → `@prisma-next/extension-upgrade-skill`; both → both); (2) add or update the directory for the in-progress version transition in each affected package; (3) author any colocated scripts the entries need (duplicating across packages when the same script applies to both substrates); (4) *run the entry against the matching in-repo substrate* — user-skill entries against `examples/`, extension-skill entries against `packages/3-extensions/` — starting from each substrate's *pre-API-change* state and ending with green tests; (5) commit the post-instructions state alongside the entries.

**(D) Publish-gate.** The `publish.yml` workflow gains a step `check:upgrade-coverage`. The check runs two parallel sub-checks: if the diff between the version about to be published and the previous published version touches `examples/`, an upgrade-instructions directory must exist at `packages/0-shared/upgrade-skill/upgrades/<from-minor>-to-<to-minor>/`; if it touches `packages/3-extensions/`, an upgrade-instructions directory must exist at `packages/0-shared/extension-upgrade-skill/upgrades/<from-minor>-to-<to-minor>/`; both diffs demand both directories. The required directory is the **coverage transition**: in publish mode (`prev.minor < head.minor`) it is `<prev.minor>-to-<head.minor>` (the release being shipped); in PR-mode steady-state (`prev.minor === head.minor`) it is the in-flight directory `<head.minor>-to-<head.minor + 1>`. Substrate diffs in any path count, including the conventional generated artefacts (`contract.json`, `contract.d.ts`, `end-contract.json`, `end-contract.d.ts`) — a format change to an emitted artefact is itself an upgrade instruction; consumer-invisible regenerations are recorded with `changes: []`. If a substrate is untouched, its check is vacuously satisfied. The same check runs in PR CI. The gate does *not* attempt to verify entry contents against a synthesised API-surface diff — that quality bar is delivered by FR11's validation-by-execution at PR time, run by the change-making agent.

**(E) New-entries-go-in-a-current-or-in-flight-directory discipline.** A PR-CI check `check:upgrade-coverage` (the same script as (D), running over file-add diffs) fails if the PR *adds* a file under `upgrades/<X>-to-<Y>/` whose label matches neither the **coverage transition** nor the **in-flight transition** (`<head.minor>-to-<head.minor + 1>`). In PR-mode steady-state the two labels collapse to one and only the in-flight directory is acceptable; in publish mode both `<prev.minor>-to-<head.minor>` and `<head.minor>-to-<head.minor + 1>` are accepted, so files added between the previous tag and the bumped head can describe either the release shipping now or the next in-flight release. The check is file-add-level (does not parse YAML frontmatter); a new colocated script in a stale directory or a brand-new stale directory both fail. *Modifications and removals* of any directory are allowed — bug fixes to old entries land via normal PRs.

This is materially weaker than a freeze rule. It catches the most common drift (a topic branch creating a new `upgrades/<X>-to-<Y>/` directory when main has already shipped past `Y`), without preventing legitimate ongoing maintenance of older directories.

### Bug-fix discipline (replaces the freeze rule)

Upgrade-instruction entries are **mutable forever**. A bug found in an `0.6 → 0.7` entry six months after `0.7.0` shipped is fixed via a normal PR against whichever skill release is in flight, and propagates to all later releases via the cumulative-set property (FR4): every published version contains every prior entry in its latest form. Consumers always install the skill at `@latest` (per the SKILL.md flow's Step 0); they get the most recent version of every entry, including bug fixes for transitions older than their target.

The only structural protection is (E)'s new-entries discipline. Anything beyond that is reviewer attention.

**(F) Exact-pin rule and `prisma-next-check-pins`.** Every `@prisma-next/*` entry in an extension's *workspace* dep declarations (whether `dependencies` or `peerDependencies`) is a single exact version, and every such entry shares the same version. The pin advances only after the extension author has run the relevant upgrade instructions against their extension's source and tests, which validates that the extension is compatible with the new PN version.

Why exact pins for extensions specifically: PN is in `0.x` with weekly breaking-change cadence. SemVer ranges assume the framework's "no breaking in patches" discipline (NFR4) is trustworthy. That discipline is aspirational until it has a track record. The exact pin makes every PN bump a deliberate, instruction-gated action by the extension author rather than a silent transitive update through SemVer.

The rule is enforced by a small CLI `prisma-next-check-pins` shipped as a `bin` of `@prisma-next/extension-upgrade-skill` — extension authors install the skill as a devDependency and wire `pnpm exec prisma-next-check-pins` into their own CI. The CLI reads the package's `package.json`, asserts every `@prisma-next/*` entry in `dependencies` and `peerDependencies` is an exact-version pin (no `^`, `~`, ranges, `workspace:` specifiers, or wildcards) and that all `@prisma-next/*` entries share the same version. Exits non-zero with a structured error naming any offending entry.

The CLI has two integration points:

1. **Extension's own CI.** Extension author adds `pnpm exec prisma-next-check-pins` to their CI; any accidental range pin (`^0.7.0`) fails the PR.
2. **Extension-upgrade-skill recipe validation.** After the upgrade-instructions' bump-and-`pnpm install` step, the skill body instructs the agent to run `prisma-next-check-pins` as a sanity check that pins were rewritten correctly.

The user-side pre-flight (the third integration point in earlier drafts) is **not** code — it is SKILL.md prose in `@prisma-next/upgrade-skill`. The agent reads `prisma-next.config.ts` to find the list of extensions in use, then for each extension reads `node_modules/<pkg>/package.json` to find its pinned `@prisma-next/*` version. The lowest pinned version is the highest PN version reachable; if the user's target exceeds it, halt with a clear message naming the lagging extension(s). This avoids a cross-package dependency between the user-skill and the extension-skill (hard requirement) and avoids an extra published package whose only consumer is a single function call.

**The two PN in-repo extensions (`packages/3-extensions/cipherstash`, `packages/3-extensions/supabase`) demonstrate the pattern when published.** All in-repo workspace packages declare their `@prisma-next/*` workspace deps as `workspace:<X.Y.Z>` (literal-version form, not `workspace:*`). pnpm publish rewrites `workspace:<X.Y.Z>` → exactly `X.Y.Z` (no caret) at publish time, naturally producing exact pins in the published artefact. `scripts/set-version.ts` (already invoked by `bump-minor.ts` and `publish.yml`) is extended to rewrite both the `version` field and the `workspace:<X.Y.Z>` specs in lockstep across every workspace package on every invocation. `check:publish-deps` is extended to verify every published `@prisma-next/*` spec in any dep field is an exact-version pin.

The cross-cutting invariants this whole mechanism rests on:

- **Source co-location.** Each upgrade skill's body is source-controlled in this repo as a workspace package. The entries authored on a PR and the API change(s) they cover are in the same diff, reviewed together, merged together, published together.
- **Version locking by construction.** Every PN release publishes both upgrade skills at the same version. Consumers always grab `@latest` regardless of their PN target, so the skill version's primary purpose is publication-discipline (lockstep with PN releases), not consumer-side compatibility selection.
- **In-flight minor is `package.json`.** The agent on a topic branch, the publish workflow, and the PR-CI new-entries check all derive the in-flight minor from `package.json` on the relevant ref. There is no second-source ambiguity (e.g., `npm view`); the source-of-truth refactor in [`package-json-versioning.spec.md`](package-json-versioning.spec.md) is what makes this work.
- **Upgrade-instructions are mutable.** Bug fixes to old entries are normal PRs. Consumers always grab `@latest`, so fixes propagate. The cumulative-set property (FR4) is load-bearing.
- **Upgrade-instructions are one-transition-at-a-time.** Each entry is authored against, runs against, and is validated against a single `<from> → <to>` step. Multi-minor upgrades (`0.6 → 0.8`) iterate: bump deps to `0.7.0`, install, run `0.6→0.7` entry, validate, commit; then bump to `0.8.0`, install, run `0.7→0.8` entry, validate, commit. Entries never need to reason about types from a version other than their own `<to>`; the consumer flow guarantees that environment.
- **Extensions pin exactly; advance the pin only via a verified upgrade-instructions run.** Every `@prisma-next/*` entry in an extension's workspace deps pins to a single exact version, advanced by the extension author after running the relevant upgrade instructions. The `prisma-next-check-pins` CLI enforces the shape locally; the user-upgrade-skill's pre-flight (SKILL.md prose) refuses to upgrade past any installed extension's pin.
- **Pin-bump and instructions-execution are general flow content, not per-instructions content.** Each skill's `SKILL.md` carries the upgrade flow (Step 0 ensure-latest → pre-flight → per-step: bump → install → instructions → validate → commit); individual entries contain only the code-translation work specific to their transition. `record-upgrade-instructions` does not generate or enforce pin-bump steps inside entry bodies — that's flow content, not entry content.
- **Validation-by-execution, not by review.** The agent demonstrates each entry works by running it on the corresponding in-repo substrate; the human reviewer never has to vouch for correctness on cases they didn't run. Substrate quality is enforced by the existing test suites (`pnpm test:examples` for user-skill entries, `pnpm test --filter='./packages/3-extensions/*'` for extension-skill entries). The reviewer's job is to confirm each required entry exists, looks reasonable, and the PR was green.
- **Detection is mechanical, per substrate.** The signal that a user-skill entry is required is `examples/` touched. The signal that an extension-skill entry is required is `packages/3-extensions/` touched. The agent making the breaking change discovers either signal naturally — they had to update those files to keep the workspace's tests green. The skill's content names both signals; the publish gate checks each independently; the human reviewer sees both in the diff.

### Release sequencing

PN is currently published at `0.7.0`, so the in-flight transition on this branch is `0.7 → 0.8`. This spec's mechanism lands on the current branch (`tml-2519`) with a *placeholder* upgrade-instructions directory at `packages/0-shared/upgrade-skill/upgrades/0.7-to-0.8/` and `packages/0-shared/extension-upgrade-skill/upgrades/0.7-to-0.8/` (each containing an `instructions.md` with `changes: []` — a no-op). The placeholders let the gate be exercised against real directories rather than synthetic fixtures. The two skill packages publish for the first time alongside the next minor (`0.8.0`); the placeholder content is what they ship at that initial release.

The mechanism's first practical use is PR [#502](https://github.com/prisma/prisma-next/pull/502) ([TML-2512](https://linear.app/prisma-company/issue/TML-2512)): PR #502 is rebased onto the mechanism, its existing `wip/strip-manifest-bookends.ts` script is re-housed at *both* `packages/0-shared/upgrade-skill/upgrades/0.7-to-0.8/strip-manifest-bookends.ts` and `packages/0-shared/extension-upgrade-skill/upgrades/0.7-to-0.8/strip-manifest-bookends.ts` (PR #502 touches both substrates), each with a real `changes[]` entry appended to the placeholder `instructions.md`. The extension-upgrade-skill's instructions add the MigrationMetadata SPI-update entry on top of the shared bookend strip. Because new-entries discipline (E) only blocks **adds** of files in stale directories (not modifications), appending real `changes[]` entries to the placeholder `instructions.md` is allowed.

The placeholder `instructions.md` may also be deleted later via a maintainer PR with explicit CI bypass (the gate is bypassable for deliberate cleanup operations).

Until PR #502 lands, the publish gate sees no `examples/` or `packages/3-extensions/` diff in the release range and is vacuously satisfied. The mechanism is dormant infrastructure during that window, which is acceptable — no consumer has installed either skill yet.

# Requirements

## Functional Requirements

### Published skills — `@prisma-next/upgrade-skill` and `@prisma-next/extension-upgrade-skill`

The two skills are structurally identical (same FR1–FR4 properties, same upgrade-instructions shape FR5–FR7, same consumer flow FR16–FR20); they differ only in audience and in which substrate their entries target. Where the requirements speak of "the upgrade skill" singular, they apply to *each* skill independently unless otherwise noted.

- **FR1. Distribution.** Both skills are published to npm:
  - `@prisma-next/upgrade-skill` — installable via `npx skills add @prisma-next/upgrade-skill`. Audience: **users** of PN's public package API.
  - `@prisma-next/extension-upgrade-skill` — installable via `npx skills add @prisma-next/extension-upgrade-skill`. Audience: **authors of PN extensions**. Additionally publishes a `prisma-next-check-pins` `bin`.

  Both publish from the same workflow run that publishes the rest of the PN packages — npm OIDC trusted publishing, no separate channel. A consumer who is both a user and an extension author installs both.

- **FR2. Version-locking.** Every published PN release publishes *both* upgrade skills at the same version as the rest of the PN packages. The publish workflow refuses to ship any of them without the others (see FR15). The version-lock is publication-discipline (lockstep release cadence); consumers always grab `@latest` per FR16.

- **FR3. Skill shape — organic exploration.** Each skill's `SKILL.md` is a small entry point that lists the available transitions, carries the per-step upgrade flow (Step 0 ensure-latest → pre-flight → per-step bump/install/instructions/validate/commit), and tells the agent how to find an entry for a given `(from, to)`. Entry bodies live in `upgrades/<from>-to-<to>/instructions.md` and are referenced by name from `SKILL.md`; the agent does not load them all up front. Each entry point fits in well under 500 lines (target: <100).

- **FR4. Cumulative upgrade-instructions set.** Each release of each skill contains the cumulative set from `0.6 → 0.7` up to the release's version, with the **latest version of every entry**. Earlier transitions are not backfilled (Q10); pre-0.6 consumers are pointed at GitHub Release notes for hand-migration. Entries, once written, are never removed in normal operation (the placeholder lifecycle is the explicit exception). Bug fixes to existing entries land via normal PRs and propagate to all later releases via the cumulative property — this property is what makes "always grab `@latest`" the right consumer discipline (FR16). The two skills' sets evolve independently — many transitions will have entries in only one of them.

- **FR4a. Hard requirement: no cross-package dependency between the two upgrade skills.** Neither published `package.json` may declare the other as a `dependency`, `peerDependency`, or `devDependency`. Each skill is self-contained; consumers can install either, both, or neither without one transitively pulling in the other.

### Upgrade-instructions layout

- **FR5. Per-transition directory.** Each entry lives at `upgrades/<from-minor>-to-<to-minor>/`, *within its skill package*. Patch versions do not have entries (NFR4). Minor bumps without a matching substrate diff produce no directory in that skill's package (Q5). Multi-step transitions (e.g. `0.6 → 0.9`) are applied by chaining the per-minor entries in order (FR18).
- **FR6. Directory contents.** A directory contains:
  - **`instructions.md`** — always present. The agent-instruction Markdown file. Includes a frontmatter block (FR7) and a prose body that describes each breaking change and what the agent should do. The prose may inline code snippets the agent runs verbatim, name shell commands to invoke, or reference a colocated script by relative path.
  - **Zero or more colocated scripts**, in whichever portable form fits the change: `*.ts` (run with `pnpm exec tsx`), `*.sh` (run with `bash`), codemods (e.g. `*.codemod.cjs` invoked via `jscodeshift`), or any other portable executable. The instructions' prose names the script by relative path, e.g. *"For each match, run `./strip-manifest-bookends.ts <path>`"*. Scripts must be portable: no environment-specific assumptions beyond `pnpm` and the consumer's checkout (NFR7).

  An `instructions.md` without any colocated scripts is valid — the agent follows the prose directly. A directory with scripts but no `instructions.md` is not valid; `instructions.md` is always the entry point.

  Cross-audience entries — where the same on-disk transformation applies to both users and extension authors — are authored *separately* in each skill package's `upgrades/<from>-to-<to>/` directory, including the colocated script (copied, not symlinked). Bug fixes to either copy land via normal PRs; the duplication carries small ongoing maintenance cost that the team accepts in exchange for the no-cross-dep hard requirement (FR4a).

- **FR7. Entry metadata (frontmatter of `instructions.md`).** Each `instructions.md` carries a YAML frontmatter block of the following illustrative shape:

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
        # and matches the predicate, this change applies. If a change
        # has no detection block, it applies unconditionally — useful for
        # changes that require agent reasoning across the whole codebase.
        - { glob: "**/migrations/**/migration.json", contains: '"fromContract"' }
      script: ./strip-manifest-bookends.ts   # optional; if absent, agent follows the prose body
    - id: "migration-metadata-spi-update"
      summary: "MigrationMetadata interface drops two fields"
      detection:
        - { glob: "**/*.ts", contains: "MigrationMetadata" }
      # no script — agent follows the prose body in instructions.md
  ---
  ```

  The frontmatter's `changes[]` is what the agent enumerates to plan the upgrade. The shape pins the *information* required (per-change id, summary, optional detection, optional script reference); it does not pin field names — those are implementer's choice. An empty `changes: []` is valid (the placeholder shape).

  No `audiences:` field. The skill package the entry lives in *is* the audience filter: an entry in `@prisma-next/upgrade-skill` is for users, an entry in `@prisma-next/extension-upgrade-skill` is for extension authors. Future audiences (e.g. *target-author* if PN ever opens the target SPI publicly) get their own skill package alongside these two.

### In-repo upgrade-instructions-authoring skill

- **FR8. Skill location.** An agent skill at `.agents/skills/record-upgrade-instructions/` (the cross-tool skills location both Claude and Cursor read from in this repo, per the parent project spec's NFR4). The skill's `description` field is the firing surface; it does *not* require any CI hook to be consulted (FR14's outcome check covers the same concern by other means). One skill, not two — the skill routes to the correct upgrade-skill package(s) based on which substrate the agent's PR touched.

- **FR9. Detection signals — and routing.** The skill's content names two mechanical signals, each tied to a destination package:

  > **If your PR has changes in `examples/` that you made as a consequence of refactoring the framework, you must add an upgrade-instructions entry in `@prisma-next/upgrade-skill`** (the user skill).
  >
  > **If your PR has changes in `packages/3-extensions/` that you made as a consequence of refactoring the framework, you must add an upgrade-instructions entry in `@prisma-next/extension-upgrade-skill`** (the extension-author skill).
  >
  > **If both, both.** Entry content and any colocated script are duplicated across the two packages.

  No exhaustive API-surface list. No diff-tool inference. The natural consequence of a real breaking change is that at least one downstream consumer in `examples/` or `packages/3-extensions/` fails; the agent fixing those failures sees the signal directly. The reviewer sees the same signal in the PR diff. The publish gate (FR13) and PR-CI gate (FR14) enforce the *outcome* (entry present in the matching package when the matching signal fires); they do not try to validate the trigger logic.

- **FR10. Authoring workflow.** When fired, the skill walks the agent through:

  1. Determine the in-flight transition by reading the `version` field from root `package.json` on the PR branch. That value is the *currently published* version. Its minor `M` names the in-flight transition `M → M+1`, and the in-flight directory in each destination package is `upgrades/<M>-to-<M+1>/` — e.g. `"0.7.0"` ⇒ `upgrades/0.7-to-0.8/`. If there is no substrate diff at all, no entry is needed — skip to step 7. (Patches that *do* produce a substrate diff still need an entry; an empty `changes: []` is the right shape if the change is genuinely consumer-invisible.)
  2. Identify which of `examples/` and `packages/3-extensions/` the PR touched. Each touched substrate corresponds to a destination skill package per FR9.
  3. For *each* destination package, find or create the directory at `packages/0-shared/<package-name>/upgrades/<M>-to-<M+1>/`. If the directory already exists (an earlier PR on the same transition created it, or it is the placeholder shipped with this spec's PR), append a new entry to the existing `instructions.md`'s `changes[]` instead of creating a duplicate directory.
  4. Write the change entry in each `instructions.md`'s frontmatter, and add a prose section describing what the agent must do.
  5. Author any colocated scripts the entries reference. If the same script applies to both substrates (the cross-audience case), copy it into both package's directories.
  6. Validate each entry by execution (FR11), against its corresponding substrate.
  7. Commit on the PR branch.

  Rebase scenario: if a release PR lands on `main` mid-flight (advancing the currently-published minor from `M` to `M+1`), the topic branch's next rebase brings the new `package.json` value with it. The agent then re-runs step 1 (the currently-published minor is now `M+1`, so the in-flight transition is `M+1 → M+2` and the in-flight directory is `upgrades/<M+1>-to-<M+2>/`) and authors any *new* entries there. Existing entries the topic branch added before the rebase to `upgrades/<M>-to-<M+1>/` may be left in place if they are genuinely about the just-shipped `<M> → <M+1>` transition; the new-entries check (FR21) only enforces that *added* paths land in a current-or-in-flight directory, so the agent revisits its prior adds and decides per-entry.

- **FR11. Validation-by-execution.** The skill instructs the agent to run each new entry against the matching substrate:

  - **User-skill entry** (`packages/0-shared/upgrade-skill/upgrades/<from>-to-<to>/`): against every example app under `examples/` whose tests are red without the entry (the same set the agent's refactoring already touched). The acceptance criterion is `pnpm test:examples` green after entry application.
  - **Extension-skill entry** (`packages/0-shared/extension-upgrade-skill/upgrades/<from>-to-<to>/`): against every in-repo extension at `packages/3-extensions/*` whose source is red without the entry. The acceptance criterion is `pnpm test --filter='./packages/3-extensions/*'` green after entry application.

  Workflow concretely, per entry: the agent (i) checks out the PR branch with the API change applied, (ii) reverts the matching substrate's changes to the pre-PR state, (iii) runs the entry against that reverted substrate, (iv) verifies the resulting substrate matches the substrate state on the PR branch *and* that the matching test command is green. If both hold, the entry is correct; if either fails, the agent iterates on the entry. The cross-audience case runs both validations.

- **FR12. PR commit shape.** The PR that introduces the breaking change must include, in addition to the API change itself:

  - The new directory in each affected skill package (`instructions.md` plus any colocated scripts).
  - The post-instructions state of every affected example app and in-repo extension — these would have been left broken without the entry; the entry's effect on the substrate *is* the diff that brings them back to green.
  - A reference in the PR description naming each directory (e.g. *"Adds entries to `packages/0-shared/upgrade-skill/upgrades/0.7-to-0.8/` and `packages/0-shared/extension-upgrade-skill/upgrades/0.7-to-0.8/`."*).

  Human reviewer + agent both check this shape. The CI gate (FR14) catches the structural case where a substrate diff is present without the matching entry; the reviewer catches the case where an entry exists but its prose / scripts don't match the API change.

### Release-pipeline gate

- **FR13. Pre-publish coverage check.** The `publish.yml` workflow gains a step `check:upgrade-coverage` that runs after `check:publish-deps` and before the actual publish. The check is intentionally simple and runs two parallel sub-checks:

  1. Read root `package.json` on `HEAD`. Its minor `head.minor` is the *currently-published* minor on the head ref.
  2. Resolve the previous published minor `prev.minor` from the most recent `v[0-9]*` annotated tag (publish mode) or from `origin/main`'s `package.json` (PR mode).
  3. Compute the **coverage transition**: in publish mode (`prev.minor < head.minor`) it is `<prev.minor>-to-<head.minor>`; in PR-mode steady-state (`prev.minor === head.minor`) it is the in-flight transition `<head.minor>-to-<head.minor + 1>`.
  4. **User-skill sub-check.** Compute `git diff <prev>..<head> -- examples/`. If non-empty, assert a directory exists at `packages/0-shared/upgrade-skill/upgrades/<coverage-transition>/`. If empty, the sub-check is vacuously satisfied.
  5. **Extension-skill sub-check.** Compute `git diff <prev>..<head> -- packages/3-extensions/`. If non-empty, assert a directory exists at `packages/0-shared/extension-upgrade-skill/upgrades/<coverage-transition>/`. If empty, the sub-check is vacuously satisfied.
  6. The substrate diff includes every path under those roots — including the conventional generated artefacts (`contract.json`, `contract.d.ts`, `end-contract.json`, `end-contract.d.ts`). A format change to a generated artefact is itself an upgrade instruction and so requires an entry; consumer-invisible regenerations are recorded with `changes: []`. There is no carve-out for "generated paths" or "patch releases" — any substrate diff requires a record.
  7. If either sub-check fails, the workflow fails with a structured error naming the expected path(s) and pointing at the in-repo `record-upgrade-instructions` skill.

- **FR14. PR-CI fail-fast.** The PR-CI workflow runs the same two-sub-check coverage check using `package.json` on the PR branch and on `origin/main`, comparing the PR diff against the current `main` tip. A missing entry in either package fails the PR. This is the early-warning version of FR13 — the change author sees the failure on their PR, not at release time, and can author the entries before review.

- **FR21. New-entries-in-current-or-in-flight-directory check.** A check that runs alongside `check:upgrade-coverage` (and as part of the same `pnpm check:upgrade-coverage` script for ergonomics) enforces (E):

  1. Read root `package.json` on `head` and `prev` (the same refs as FR13).
  2. Compute the **coverage transition** (FR13 step 3) and the **in-flight transition** (`<head.minor>-to-<head.minor + 1>`). The set of allowed transitions is `{ coverage, in-flight }` — in PR-mode steady-state these collapse to a single value.
  3. Compute the set of file paths the PR **adds** under `packages/0-shared/upgrade-skill/upgrades/` or `packages/0-shared/extension-upgrade-skill/upgrades/`. Modifications and removals are not in this set.
  4. For every added path, verify its `<X>-to-<Y>` segment matches one of the allowed transitions. Adds in any other transition directory fail the check.
  5. The error message names the offending directory and the allowed transitions, e.g. *"`upgrades/0.6-to-0.7/foo.ts` was added but only `upgrades/0.8-to-0.9/` is accepted on this branch (your branch's `package.json` is at `0.8.0`). Move the entry."*

  The check is structurally distinct from FR14's coverage check (FR14 checks that *required* entries exist; FR21 checks that *new file adds* land in a current-or-in-flight directory). Both run on every PR; both run again at publish time as defense-in-depth. **Modifications and removals are deliberately not enforced** — bug fixes to old entries are normal PRs and must be unblocked.

- **FR15. Upgrade-skills publish.** Both `@prisma-next/upgrade-skill` (from `packages/0-shared/upgrade-skill/`) and `@prisma-next/extension-upgrade-skill` (from `packages/0-shared/extension-upgrade-skill/`) are picked up by the existing `pnpm -r publish` step in `publish.yml`. They are just two more workspace packages alongside everything else. NFR8's atomicity invariant follows from the existing workflow's `concurrency` group and single-job-per-run structure: if the publish step fails for any package, the whole run is marked failed and the maintainer is alerted.

### Consumer-side flow

- **FR16. Agent-driven upgrade trigger and Step 0 ensure-latest.** Both skills' `SKILL.md` `description` fields fire when an agent is asked to "upgrade Prisma Next", or detects a PN version bump in a user's `package.json` it itself is about to make. (Skill registries don't pin trigger semantics — `description` is text the registry indexes, and agents match against it.) Each skill's description is tuned to its audience: the user skill's description includes phrases like "upgrade Prisma Next in your app"; the extension-author skill's includes "upgrade Prisma Next in your extension." Both must include the words `upgrade Prisma Next` so a single firing prompt reaches whichever skill(s) the consumer has installed. **Step 0 of the flow** instructs the agent to ensure the skill is at `@latest` before running anything else (re-installing if necessary). This is the discipline that makes bug fixes to old entries reach consumers via the cumulative-set property (FR4).

- **FR17. Version detection.** When invoked, the agent reads the consumer's project state to determine:
  - **From-version.** The currently-installed PN version, from `pnpm-lock.yaml` (or `package-lock.json` / `yarn.lock`). If the lockfile shows multiple PN packages at different minor versions (which would already be broken), the lowest minor wins as the from-version.
  - **To-version.** Either the version the consumer specified ("upgrade to 0.7"), or the latest stable from `npm view @prisma-next/postgres dist-tags.latest`.

- **FR18. Transition chain.** If the from-to delta spans multiple minor versions, the agent applies entries one minor at a time, in order: `0.6 → 0.7 → 0.8 → 0.9`. Each step is fully self-contained — deps bumped, install run, entry applied, validation green, commit made — before the next step starts. The chain halts at the first failed step. Chain order is the same regardless of which skill(s) is/are invoked.

- **FR19. Role detection and skill selection.** The agent determines which skill(s) apply by inspecting `package.json`:
  - **User role** — `@prisma-next/upgrade-skill` applies. Triggered when `package.json` declares `@prisma-next/*` packages as `dependencies` or `devDependencies` and the package is *not* itself a PN extension (does not appear in any consumer's `prisma-next.config.ts`).
  - **Extension-author role** — `@prisma-next/extension-upgrade-skill` applies. Triggered when the package is itself a PN extension — heuristics: `package.json` declares `@prisma-next/contract` (or other `@prisma-next/*` SPI) as a dependency or peer-dep and the package's `name` matches `^@.*/extension-` or `^@.*/-ext-` (matching the in-repo convention used by `extension-cipherstash`, `extension-supabase`, etc.); or the package is referenced as an extension from another package's `prisma-next.config.ts` in the same monorepo.
  - **Both roles** — both skills apply. Common for repos that ship an extension alongside a consumer app (the in-repo `examples/cipherstash-integration/` is an example shape). The agent runs the user flow first, then the extension flow, in the same upgrade session.

  If detection is ambiguous, the agent asks the consumer which role to operate under, and offers to apply both.

- **FR20. Per-skill, per-transition execution.** For each applicable skill, for each `(from, to)` step in the chain, the agent:

  1. **Bump.** Update every `@prisma-next/*` entry in the consumer's `package.json` to the exact `<to>` version. For the user skill this rewrites `dependencies` / `devDependencies` entries; for the extension skill this rewrites the matching dep field — `dependencies` or `peerDependencies`, whichever the extension uses today (per FR22 the field used must consistently use exact pins). All `@prisma-next/*` entries advance to the same version. Also update the skill package's own dependency entry to the `<to>` version (so the skill content matches the target).
  2. **Install.** Run `pnpm install`. Code is now broken against the `<to>` version's types/SPI — expected and required (the entry's job is to fix it).
  3. **Read.** Load `<skill-package>/upgrades/<from>-to-<to>/instructions.md`, parse the frontmatter.
  4. **Apply.** For each entry in `changes[]`, run detection against the project. If no files match, skip the change. If a change has no `detection`, apply unconditionally. For each matched change, execute the entry's instructions: invoke the colocated script named by `script` (via `pnpm exec tsx` for `*.ts`, `bash` for `*.sh`, `jscodeshift` or similar for codemods), or follow the prose in `instructions.md`.
  5. **Validate.** Run `pnpm typecheck && pnpm test` (or the project's equivalent — implementer to specify the discovery rule). If red, halt the chain and surface to the consumer (NFR5).
  6. **Commit.** Create a commit containing this step's changes only: `chore: upgrade @prisma-next/* to <to-version>` (or the project's commit-message convention). Per FR28, one commit per step.

  When two skills apply (user + extension), the agent finishes the user-skill chain end-to-end first, then runs the extension-skill chain. Pin updates on the user side cover `dependencies` / `devDependencies`; on the extension side they cover whichever dep field the extension uses today (FR22 says exact pins regardless of field).

- **FR27. Pre-flight extension-compatibility check (user side, SKILL.md prose).** Before any code changes, the user-upgrade-skill's `SKILL.md` instructs the agent to:

  1. Read `prisma-next.config.ts` (or its TS-discoverable equivalent) to find the list of extensions in use.
  2. For each extension, read its `package.json` from the user's `node_modules/<extension-name>/package.json` and find its `@prisma-next/contract` (or any `@prisma-next/*`) dep version. Per FR22, that value is an exact pin.
  3. The lowest pinned PN version across all extensions is the **highest reachable** PN version for the user.
  4. If the user's target exceeds the highest reachable, halt the upgrade with a clear message naming each lagging extension and its pinned PN version. Offer two paths: (a) wait for the lagging extension to publish a compatible release, (b) re-run the upgrade with `--to=<highest-reachable>`.

  The pre-flight is user-side only. The extension-upgrade-skill does not run this check — extension authors are the source of the pins, not the consumers. *Their* equivalent sanity check is FR24's CLI invoked after each step.

  This is **prose**, not code. There is no programmatic API; there is no helper exported from any package. The agent reasons through it directly per the SKILL.md instructions. This avoids cross-package dependencies (FR4a) and avoids extra surface for a single function call.

- **FR28. One commit per transition step.** Each `(from, to)` step in the chain produces exactly one commit containing the dep bump, the post-install lockfile changes, and the entry's effect on the consumer's source. The agent does not squash steps. The consumer is free to squash on merge; the in-flight history is per-step so a failed step is bisectable and revertable independently.

### Exact-pin rule and `prisma-next-check-pins`

- **FR22. Exact-pin rule.** Every `@prisma-next/*` entry in an extension's published workspace deps (`dependencies`, `peerDependencies`, or `optionalDependencies` — whichever the extension uses) is an exact-version pin (e.g. `"0.7.0"`). Range forms (`^0.7.0`, `~0.7.0`, `>=0.7.0`), wildcards (`*`, `"x"`), and workspace specifiers (`workspace:*`, `workspace:^`, `workspace:~`) are all forbidden in *published* `package.json` files. Literal-version workspace specifiers (`workspace:0.7.0`) are permitted in source `package.json` files (they are pnpm-internal and rewrite to the literal version at publish time per FR26). All `@prisma-next/*` entries pin to the same version. The pin advances only after the extension author has run the relevant upgrade instructions and validated their extension's tests against the new PN version.

  The rule applies to **published** extension `package.json` files. Extensions developed inside a workspace use `workspace:<X.Y.Z>` literal-version specifiers at dev time (FR26's mechanic); the publish-time rewrite is responsible for producing exact pins in the artefact that reaches npm.

- **FR23. *(Removed.)*** The pin-check tool does not live in a separate workspace package. It is a `bin` of `@prisma-next/extension-upgrade-skill`. See FR24.

- **FR24. `prisma-next-check-pins` CLI.** A small CLI shipped as a `bin` entry in `@prisma-next/extension-upgrade-skill`'s `package.json`. Run by extension authors as `pnpm exec prisma-next-check-pins`. Behaviour:

  1. Reads the current working directory's `package.json`.
  2. Enumerates every `@prisma-next/*` entry in `dependencies`, `peerDependencies`, and `optionalDependencies`.
  3. For each entry, asserts the spec is a literal exact-version string matching the regex `/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/` (i.e., no operators, no `workspace:`, no wildcards). Pre-release suffixes are permitted.
  4. Asserts every entry resolves to the same exact version.
  5. Exits with status `0` and no output on success; on any failure, exits non-zero with a structured error naming every offending entry, its observed value, and the rule it violated.

  The CLI is intended for: (a) extension authors' own CI, (b) sanity check after the extension-upgrade-skill recipe's bump step. The CLI has no runtime dependencies beyond `node:fs`, `node:path`, and `pathe` (the workspace's path-handling convention).

- **FR25. *(Removed.)*** The user-side pre-flight has no programmatic API. See FR27 for the SKILL.md-prose replacement.

- **FR26. Publish-time exact-pin via `workspace:<literal-version>`.** All in-repo workspace packages declare their `@prisma-next/*` workspace deps as `workspace:<X.Y.Z>` (literal-version form, e.g. `workspace:0.7.0`), not `workspace:*`. pnpm publish rewrites `workspace:<X.Y.Z>` → exactly `X.Y.Z` (no caret) at publish time, naturally producing exact pins in the published artefact. `scripts/set-version.ts` (already invoked by both `bump-minor.ts` and `publish.yml`) is extended to rewrite both the `version` field and every `@prisma-next/*` `workspace:<X.Y.Z>` spec in lockstep on every invocation, across `dependencies`, `peerDependencies`, `devDependencies`, and `optionalDependencies`. `check:publish-deps` is extended to assert no caret/tilde/range/wildcard appears in any `@prisma-next/*` spec of any published package's deps, peer-deps, or optional-deps.

  This rule applies to *every* in-repo workspace package that declares `@prisma-next/*` workspace deps, not just extensions. Generalising the rule keeps `set-version.ts`'s logic uniform (same rewrite for every package) and removes any per-package configuration burden.

## Non-Functional Requirements

- **NFR1. Upgrade-instructions authoring overhead.** Adding an entry to an in-progress PR — including running validation — must not add more than ~30 minutes of agent time per breaking change to the typical PR.
- **NFR2. Consumer-side upgrade time.** A single-transition upgrade (e.g. `0.6 → 0.7`) against a representative project (one of the example apps) must complete in under 5 minutes of wall-clock time, including install, entry execution, and validation.
- **NFR3. Idempotency.** Every upgrade-instructions script must be safe to re-run. Running an entry twice in succession against the same project produces the same final state as running it once. This is enforced by FR11's validation step rerunning the entry and asserting a no-op diff. Idempotency is load-bearing: a user who hits a bug, gets a fix shipped in a patch release, and re-installs `@latest` then re-runs the entry must end in the right final state.
- **NFR4. Patch-version policy.** Patches are bug-fix-only by policy and should not produce any `examples/` or `packages/3-extensions/` diff. If a patch *does* produce a substrate diff, the gate fires and an entry is required (no skip): either the change has been mis-classified (should have been a minor bump and an entry written for `<head.minor>-to-<head.minor + 1>`) or the substrate diff is genuinely consumer-invisible incidental output, in which case the entry ships with `changes: []` and costs almost nothing. There is no script-level patch carve-out.
- **NFR5. Failure surfaces a structured error.** An upgrade-instructions script failure must produce a PN-style structured error envelope with a stable code (`PN-UPGRADE-NNNN`), naming the failing change, the file(s) the script was operating on, and the inferred remediation. The agent surfaces this to the consumer; the consumer is not asked to read script stack traces.
- **NFR6. Skill body size.** The published `SKILL.md` body is small enough to load into any reasonable agent's context window in one go (target: <8KB). Entry bodies and colocated scripts are referenced by name, not inlined.
- **NFR7. No secrets in entries.** Entry scripts must not require environment variables, network access, or any input beyond the project's filesystem and the entry's bundled assets. (This is what makes them safe to ship publicly and to run automatically.)
- **NFR8. Publish atomicity.** Both `@prisma-next/upgrade-skill` and `@prisma-next/extension-upgrade-skill` are published as part of the same `pnpm -r publish` step that publishes every other PN package; if any package fails to publish, the workflow fails as a whole and the maintainer is alerted. There is no separate publish channel that could leave either upgrade skill out of sync with the rest of the release.
- **NFR9. Pin-check runtime cost.** `prisma-next-check-pins` completes in under 1 second on a typical extension repo. The user-side pre-flight (FR27) involves reading `prisma-next.config.ts` plus per-extension `package.json` reads — well under 5 seconds for a typical user app with up to 10 extensions.
- **NFR10. Skill update reliability.** "Always grab `@latest`" (FR16 Step 0) assumes the agent runtime allows the skill to self-update at invocation time. Some runtimes cache installed skills; the SKILL.md prose can *instruct* the update but cannot enforce it. Realistic floor: most users will install the skill close to when they want to upgrade, so the gap between install and use is small. The discipline is best-effort across runtimes.

## Non-goals

- **Downgrade ("downgrade Prisma Next" or `0.7 → 0.6`).** Entries are forward-only. A user who installs an older PN version is on their own.
- **Cross-major-version compounds without intermediate stable releases.** When PN reaches `1.0`, there will be a `0.x → 1.0` entry; pre-1.0, we're in single-line minor bumps and don't need to model branching version histories.
- **Non-PN breaking changes.** Postgres major bumps, Node major bumps, `pnpm` major bumps — out of scope. Entries describe PN's own evolution only.
- **Replacing release notes.** Entries complement, not replace, the auto-generated GitHub Release notes.
- **Entries for changes to *internal* package boundaries** (i.e. dependencies among PN's own workspace packages that aren't visible at the published-package surface). The detection signal — `examples/` or `packages/3-extensions/` diff — already excludes these; internal-only refactors don't break consumers.
- **Translating queries written in `db.sql` raw mode.** Raw SQL is opaque to the contract; if a PN release changes the contract-driven generation pipeline in a way that breaks a raw SQL string a user wrote, the user is on their own (the existing `db.orm` path is the entry-safe surface).
- **Bundling user-provided assets into entries.** An entry can read the user's project; it cannot push or fetch arbitrary assets.
- **Range pinning for extension PN deps.** Extensions never use `^`, `~`, `>=`, or range forms for `@prisma-next/*` deps; exact pins only (FR22). Users' app-level `dependencies` and `devDependencies` may use ranges if they wish, but the upgrade-skill itself writes exact versions when it advances them (FR20), and installed extensions transitively constrain the user to exact pins anyway.
- **Pin-check for non-PN-extension packages.** `prisma-next-check-pins` looks only at `@prisma-next/*` entries. Other ecosystem pins (`@types/*`, partner SDKs, etc.) are out of scope; extension authors manage those with their own tooling.
- **A separate `@prisma-next/extension-pin-check` workspace package.** The pin-check CLI ships as a `bin` of `@prisma-next/extension-upgrade-skill`. A separate package was rejected because its only function is the CLI for extension authors, which extension-upgrade-skill already gives them via its `bin` entry.
- **A programmatic `checkInstalledExtensionPins(...)` API.** Replaced by SKILL.md prose in `@prisma-next/upgrade-skill` (FR27). A programmatic API was rejected because the only consumer was the user-skill itself, and its existence would have either created a cross-package dep (forbidden by FR4a) or required the function to live in both upgrade-skill packages (drift surface).
- **A recipe-freeze rule.** Entries are mutable forever; bug fixes are normal PRs. The freeze rule was rejected because the cost of blocking deliberate bug fixes outweighed the structural protection it offered. The single residual structural protection is FR21's narrower new-entries-go-in-the-in-flight-directory check.
- **Migrating extensions from `dependencies` → `peerDependencies` for `@prisma-next/*`.** This is a real architectural concern (an extension that bundles its own copy of `@prisma-next/contract` has a separate type identity from the user's), but it is independent of the upgrade-skill mechanism and out of scope for this spec. The exact-pin rule (FR22) applies regardless of which dep field the extension uses today.

# Acceptance Criteria

- **AC1. End-to-end user upgrade against a representative app.** Take a checkout of [`examples/prisma-next-demo/`](../../../examples/prisma-next-demo/) at PN `0.7.x` (the currently-published version when this spec lands), bump PN to `0.8.x` in `package.json`, run the agent with `@prisma-next/upgrade-skill@0.8.0` (the first published version of the skill, shipping alongside the next minor release) installed. The agent detects user role (FR19), reads `upgrades/0.7-to-0.8/instructions.md` from the user skill, follows its instructions (which, post-PR-#502 rebase, invoke the colocated `strip-manifest-bookends.ts`), `pnpm install` + `pnpm typecheck && pnpm test` are green, the resulting `migration.json` files match the post-PR-#502 manifest shape, no manual intervention was required. The agent does *not* load `@prisma-next/extension-upgrade-skill` content. Covers FR1, FR3, FR5–FR7, FR16–FR20, NFR2, NFR6. *(Verified end-to-end after PR #502 lands; verified on the placeholder before then — placeholder iterates zero changes and exits cleanly.)*

- **AC2. Multi-transition chain.** Once a second transition (`0.8 → 0.9`) entry exists in the user skill, run the same scenario starting from PN `0.7.x` and upgrading to `0.9.x`. The agent applies `0.7 → 0.8 → 0.9` entries in order; final state is green. Covers FR18, FR4. *(Deferred-until-available; harmless to skip until the second entry lands.)*

- **AC3. End-to-end extension-author upgrade.** Take a checkout of [`packages/3-extensions/cipherstash/`](../../../packages/3-extensions/cipherstash/) at PN `0.7.x`. Bump PN to `0.8.x`. The agent with `@prisma-next/extension-upgrade-skill@0.8.0` installed detects extension-author role (FR19), reads `upgrades/0.7-to-0.8/instructions.md` from the *extension* skill (containing, post-PR-#502 rebase, both the bookend-strip and the MigrationMetadata SPI update), runs `pnpm test --filter @prisma-next/extension-cipherstash` green. Covers FR19, FR20, and the extension-skill leg of FR1, FR3, FR5–FR7. *(Verified end-to-end after PR #502 lands.)*

- **AC4. Both-role flow in a single repo.** Take a checkout that is *both* a user and an extension author (e.g. a repo containing both an example app and an extension package, mirroring the in-repo `examples/cipherstash-integration/` shape). Bump PN to `0.8.x`. The agent runs the user-skill chain first against the app, then the extension-skill chain against the extension package, both green. Covers the both-role case in FR19, FR20.

- **AC5. Patch bump with no substrate diff passes vacuously.** Open a PR that does no more than bump version constants and update a changelog (no `examples/` or `packages/3-extensions/` diff). PR CI passes; `check:upgrade-coverage` (FR14) is vacuously satisfied because there is no substrate diff to require an entry against. (There is no script-level patch carve-out — a patch that *did* touch the substrate would require an entry, per NFR4 and FR13.6.)

- **AC6. User-substrate change without user-skill entry fails CI.** Open a PR that introduces a breaking change visible to a user app, follows the type errors into `examples/` to fix them, and *does not* add an entry in `@prisma-next/upgrade-skill`. PR CI fails with a structured error naming the expected path (`packages/0-shared/upgrade-skill/upgrades/<from>-to-<to>/`). The author adds the entry; CI passes. Covers the user-skill leg of FR9, FR12, FR14.

- **AC7. Extension-substrate change without extension-skill entry fails CI.** Open a PR that changes the framework SPI in a way that requires `packages/3-extensions/cipherstash` edits, and *does not* add an entry in `@prisma-next/extension-upgrade-skill`. PR CI fails with a structured error naming the expected path (`packages/0-shared/extension-upgrade-skill/upgrades/<from>-to-<to>/`). The author adds the entry; CI passes. Covers the extension-skill leg of FR9, FR12, FR14.

- **AC8. Both-substrate change requires both entries.** Open a PR (e.g. PR #502's rebased shape) that touches both `examples/` and `packages/3-extensions/`. PR CI fails if either entry is missing; passes only once both are present. Covers the both-signal case of FR9, FR13, FR14.

- **AC9. Validation-by-execution prevents bad entries from landing.** Author a PR with a deliberately-broken entry (e.g. the colocated script's glob misses a file, or the script crashes on a shape present in `examples/multi-extension-monorepo/`). The agent's FR11 validation step finds the matching test suite red after entry application. The PR cannot proceed until the entry is fixed. Covers FR10–FR12.

- **AC10. Pre-publish gate blocks a release without a required entry.** Simulate a release workflow run for a version whose diff against the previous release tag touches `examples/` but `packages/0-shared/upgrade-skill/upgrades/<from>-to-<to>/` is missing. `check:upgrade-coverage` fails before the `pnpm -r publish` step; no package reaches the registry. Repeat for the extension-skill leg. Covers FR13.

- **AC11. Both upgrade skills and PN ship at matching versions.** After the next stable publish (the first to include the new skill packages — `0.8.0` if it is the first minor after this PR lands), both `npm view @prisma-next/upgrade-skill dist-tags.latest` and `npm view @prisma-next/extension-upgrade-skill dist-tags.latest` return that same version, equal to `npm view @prisma-next/postgres dist-tags.latest`. Covers FR2, FR15.

- **AC12. Idempotent re-run.** Re-running an entry immediately after the first run produces an empty git diff. Covers NFR3.

- **AC13. Failure structured-error surface.** Inject a deliberate failure in an entry script (e.g. malformed input). The script surfaces a `PN-UPGRADE-NNNN` envelope with the failing change id, file paths, and remediation hint; the agent does not auto-rollback (Q6). Covers NFR5.

- **AC14. Mechanism dormant until first non-placeholder entry.** After this spec is implemented but before PR #502 lands, run the publish workflow against a release with no `examples/` or `packages/3-extensions/` diff: `check:upgrade-coverage` passes vacuously, no entries are required in either skill (the placeholder satisfies the directory-exists check trivially). Covers the *release sequencing* note in Approach.

- **AC15. New-entries check rejects an add to a stale directory.** Take a `main` whose `package.json` is at `0.8.0`. Open a PR (also at `0.8.0`) that **adds** a file at `packages/0-shared/upgrade-skill/upgrades/0.6-to-0.7/new-script.ts`. PR CI fails with the structured error from FR21 naming both the offending directory and the allowed transitions (the in-flight `upgrades/0.8-to-0.9/`; in PR-mode steady-state the coverage transition collapses onto the same value). Moving the file to `upgrades/0.8-to-0.9/` and re-pushing passes. Covers FR21.

- **AC16. New-entries check passes for adds to the in-flight directory.** Same `main` at `0.8.0`. Open a PR that adds a file under `upgrades/0.8-to-0.9/`. PR CI passes the new-entries check. Covers FR21.

- **AC17. Modifications and removals to old directories are allowed.** Same `main` at `0.8.0`. Open a PR that *modifies* the `instructions.md` of `upgrades/0.7-to-0.8/` (e.g. adds an entry to `changes[]`, fixes a bug in a colocated script). PR CI passes the new-entries check (FR21 only enforces *adds*, not modifications or removals). Covers FR21's modifications-allowed carve-out.

- **AC18. In-flight transition reads from package.json on the PR branch.** The agent invoking the `record-upgrade-instructions` skill on a branch whose `package.json` is at `0.7.0` writes entries to `upgrades/0.7-to-0.8/`. The same agent on a branch whose `package.json` is at `0.8.0` writes to `upgrades/0.8-to-0.9/`. No `npm view` consultation is observed in the agent's tool-call log. Covers FR10's step 1 + [`package-json-versioning.spec.md`](package-json-versioning.spec.md)'s FR1.

- **AC19. `prisma-next-check-pins` exits clean on exact pins.** A test extension with `dependencies: { "@prisma-next/contract": "0.7.0", "@prisma-next/sql-contract": "0.7.0" }` invokes `pnpm exec prisma-next-check-pins`. Exits status 0, no output. Covers FR24.

- **AC20. `prisma-next-check-pins` rejects a range pin.** A test extension declaring `dependencies: { "@prisma-next/contract": "^0.7.0" }` invokes the CLI. Exits non-zero with a structured error naming the offending entry and the rule violated. Same for `~0.7.0`, `>=0.7.0`, `*`, `workspace:*`. Covers FR22, FR24.

- **AC21. `prisma-next-check-pins` rejects mismatched versions.** A test extension declaring `dependencies: { "@prisma-next/contract": "0.7.0", "@prisma-next/sql-contract": "0.7.1" }` invokes the CLI. Exits non-zero with a structured error naming the two divergent entries. Covers FR22, FR24.

- **AC22. SKILL.md prose names the user-side pre-flight via `prisma-next.config.ts`.** Inspect `packages/0-shared/upgrade-skill/SKILL.md`. The body explicitly instructs the agent to (a) read `prisma-next.config.ts` for the list of extensions in use, (b) for each extension read `node_modules/<pkg>/package.json` to find its `@prisma-next/*` pinned version, (c) halt with a clear lagging-extension message if the user's target exceeds the lowest pin. No programmatic API or imported helper is invoked. Covers FR27.

- **AC23. Hard requirement — no cross-package dep between the two upgrade skills.** Inspect both packages' `package.json` files. Neither lists the other in `dependencies`, `peerDependencies`, or `devDependencies`. Covers FR4a.

- **AC24. Multi-step upgrade commits per step.** A user app at `0.6.1` upgrading to `0.8.0` (with both `0.6→0.7` and `0.7→0.8` entries available, and all extensions compatible with `0.8.0`) produces exactly two commits on `HEAD`: `chore: upgrade @prisma-next/* to 0.7.0` and `chore: upgrade @prisma-next/* to 0.8.0`. Each commit contains both the dep bump and the matching entry's effect on the source. Covers FR18, FR20, FR28.

- **AC25. In-repo packages publish with exact `@prisma-next/*` pins.** Take any release publish that includes `@prisma-next/extension-cipherstash` (or whichever in-repo extension is published). Inspect the published `package.json` on npm via `npm view @prisma-next/extension-cipherstash@<version> dependencies`. Every `@prisma-next/*` entry is exactly `<version>`, with no caret, tilde, range, or `workspace:` specifier. Same property holds for `peerDependencies` and `optionalDependencies` if present. Covers FR26.

- **AC26. `set-version.ts` rewrites both `version` and workspace dep specs in lockstep.** Run `pnpm bump-minor` against a clean tree at `0.7.0`. The resulting diff updates every workspace package's `version` field to `0.8.0` AND every `@prisma-next/*` workspace spec from `workspace:0.7.0` to `workspace:0.8.0`. Covers FR26.

- **AC27. `check:publish-deps` rejects non-exact `@prisma-next/*` pins in the published tarball.** Mutate one extension's `package.json` to use `"@prisma-next/contract": "^0.7.0"` instead of `workspace:0.7.0`. Run `pnpm check:publish-deps`. The check fails naming the offending package and the rule violated. Restore the original spec; the check passes. Covers FR26.

- **AC28. Placeholder upgrade-instructions ship in the first release of the skill packages.** Inspect both published skill packages at the first release that includes them (the next minor after this PR lands — `0.8.0` if uninterrupted). Each contains an `upgrades/0.7-to-0.8/instructions.md` with frontmatter `from: "0.7"`, `to: "0.8"`, `changes: []`. The placeholders are valid (a consumer agent loading them iterates zero times in the `changes[]` loop and exits cleanly). Covers the *release sequencing* note + FR4 cumulative-set property.

# Other Considerations

## Security

- **Entry trust.** Entries run scripts in the consumer's project root. The trust model is the same as installing any npm package: by installing either upgrade skill, the consumer (or their agent on their behalf) trusts the Prisma Next team's publish pipeline. Both skills are published with npm provenance attestations (FR15 inherits the existing publish workflow's `NPM_CONFIG_PROVENANCE: "true"`), so consumers can verify each skill came from the PN GitHub release pipeline.
- **No network in entries.** NFR7 closes the obvious supply-chain hole. Entries are pure filesystem-and-bundled-assets transformations. An entry wanting to fetch a remote payload would have to break this contract, which the in-repo `record-upgrade-instructions` skill explicitly disallows.
- **Entry prose runs inside the agent.** The prose body of `instructions.md` is agent instructions, not executable code; it runs in the agent's existing security context, bounded by whatever the agent itself is permitted to do.

## Cost

- **Distribution.** Trivial. Each skill is a few hundred KB of text per release; two skills double that, still rounding error against npm storage cost.
- **CI cost.** The `check:upgrade-coverage` step at publish-time runs two parallel sub-checks plus the FR21 new-entries check; each is O(files-in-diff) and runs once per release — negligible.
- **PR-CI cost.** The same checks on every PR add seconds, not minutes. The validation-by-execution step in `record-upgrade-instructions` runs the existing `pnpm test:examples` and `pnpm test --filter='./packages/3-extensions/*'` suites, which the workspace already runs in CI; the marginal cost is the entry application itself (one script run per substrate per entry).
- **Per-consumer runtime cost.** Each upgrade applies N entries against M project files; for representative projects this is bounded under NFR2 at 5 minutes total *per applicable skill chain*. Both-role consumers run two chains sequentially.

## Observability

- **Entry-application telemetry.** Out of scope for v1. The agent surfaces success or failure to the consumer directly; centralised telemetry is a phase-2 question that intersects with broader product-analytics decisions outside this spec.
- **Publish-pipeline observability.** Existing GitHub Actions logs cover the new `check:upgrade-coverage` step and the two upgrade-skill packages picked up by `pnpm -r publish`. No new dashboards.

## Data Protection

- No personal data flows through entries; entries are deterministic transformations of the user's own project filesystem. NFR7 (no network, no external input) closes the obvious data-exfiltration concern.

## Analytics

- **Entry execution events.** Deferred. The right shape is "did the entry succeed; did the validation pass; how long did it take," all of which the agent already knows locally. Whether to ship those events anywhere is the same question as broader PN runtime telemetry and is settled outside this spec.

# References

- [`package-json-versioning.spec.md`](package-json-versioning.spec.md) — the prerequisite task spec that establishes `package.json` as the version source-of-truth this spec consumes.
- [TML-2514](https://linear.app/prisma-company/issue/TML-2514) — parent Linear ticket for the Prisma Next agent-skill project this spec belongs to.
- [TML-2515](https://linear.app/prisma-company/issue/TML-2515) — placeholder Linear ticket for the backwards-compatibility policy this spec produces.
- [TML-2519](https://linear.app/prisma-company/issue/TML-2519) — the Linear ticket for this spec's implementation.
- [PR #502 — drop inlined fromContract/toContract from migration.json](https://github.com/prisma/prisma-next/pull/502) — the canonical worked example used in AC1, AC3, AC8, AC9.
- [`.github/workflows/publish.yml`](../../../.github/workflows/publish.yml) — the workflow this spec extends with `check:upgrade-coverage`.
- [`scripts/set-version.ts`](../../../scripts/set-version.ts) — the script this spec extends to also rewrite `@prisma-next/*` workspace dep specs.
- [`scripts/check-publish-deps.mjs`](../../../scripts/check-publish-deps.mjs) — the script this spec extends to enforce exact `@prisma-next/*` pins on the published tarball.
- [`packages/1-framework/3-tooling/cli/README.md`](../../../packages/1-framework/3-tooling/cli/README.md) — CLI surfaces (FR9).
- [`docs/architecture docs/subsystems/7. Migration System.md`](../../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md) — context for the on-disk migration shape referenced in FR9 and AC1.
- [`docs/architecture docs/adrs/ADR 199 - Storage-only migration identity.md`](../../../docs/architecture%20docs/adrs/ADR%20199%20-%20Storage-only%20migration%20identity.md) — anchor for understanding why the PR #502 change was hash-stable.
- [`projects/prisma-next-agent-skill/references/`](../references/) — reference skills (Supabase, Vercel, Convex, TanStack) studied for pattern conventions.

# Open Questions

The substantive design questions were resolved during refinement (see *Decisions resolved during refinement* below). One residual implementer choice remains:

1. **CI implementation surface for FR13 / FR14 / FR21.** Two patterns the implementer might choose:
   - Add a new step inside `.github/workflows/publish.yml` and `.github/workflows/ci.yml` (`run: node scripts/check-upgrade-coverage.mjs`), with the script in `scripts/`.
   - Implement as a workspace-script (`pnpm check:upgrade-coverage`) that the workflows invoke, parallel to the existing `check:publish-deps`.

   The script is small — a handful of glob + git diff + filesystem checks, ~80–150 lines. **Default: workspace-script `pnpm check:upgrade-coverage` invoked from the workflows, matching the existing `check:publish-deps` shape.** Implementer to confirm.

## Decisions resolved during refinement

- **Drop the recipe-freeze rule entirely.** The freeze rule was rejected because the cost of blocking deliberate bug fixes outweighed the structural protection it offered. Rationale: the freeze's stated property ("consumers can rely on a published recipe never silently changing") is undesirable in practice — consumers running an upgrade once want fixes to propagate, not stability. Replaced by FR21's narrower new-entries-go-in-the-in-flight-directory check (which catches the most common drift — a topic branch creating a new directory in the wrong place — without blocking maintenance) and the cumulative-set + always-grab-`@latest` discipline (FR4 + FR16).
- **No separate `@prisma-next/extension-pin-check` workspace package.** The pin-check CLI ships as a `bin` of `@prisma-next/extension-upgrade-skill`. Rejected alternative: a dedicated package. Rejected because the only function needing a separate package was the user-side programmatic pre-flight, which has been replaced by SKILL.md prose (next decision).
- **No `checkInstalledExtensionPins` programmatic API; user-side pre-flight is SKILL.md prose.** Rejected alternative: a programmatic helper either (a) exported from a third package, (b) duplicated across both skill packages, or (c) creating a cross-package dependency. (a) was rejected per the previous decision; (b) creates real maintenance drift for actively-maintained runtime utility code (vs write-once entries); (c) violates the hard requirement that the two upgrade skills have no cross-dep. The SKILL.md-prose path uses the agent's natural reasoning over `prisma-next.config.ts` and per-extension `package.json`, which is well-suited to capable agents and degrades gracefully (worst case: package-manager peer-dep failure with a worse message).
- **Hard requirement: no cross-package dependency between the two upgrade skills.** Each is self-contained. Cross-audience entries (the rare PR #502 shape) are duplicated across the two packages, including their colocated scripts.
- **Workspace tier `packages/0-shared/`.** New tier created for the two upgrade-skill packages. They have no runtime dependencies and are not imported by any other workspace package — same treatment as `packages/0-config/` (not registered in `architecture.config.json`).
- **In-repo skill at `.agents/skills/record-upgrade-instructions/`.** First inhabitant of a new `.agents/skills/` directory (NFR4-conformant per parent project spec). Existing in-repo skills in `.claude/skills/` are not migrated as part of this PR; that's a separate cleanup concern.
- **Rename "recipe" → "upgrade instructions" globally.** The `recipe` terminology was too general; "upgrade instructions" reads more cleanly across spec, CI output, and prose mentions. Concrete renames: `recipes/<from>-to-<to>/` → `upgrades/<from>-to-<to>/`; `recipe.md` → `instructions.md`; `record-recipe` → `record-upgrade-instructions`; `check:recipe-coverage` → `check:upgrade-coverage`. The published package names (`@prisma-next/upgrade-skill`, `@prisma-next/extension-upgrade-skill`) do not change — they don't carry "recipe."
- **One PR for everything.** All chunks (workspace packages, in-repo skill, CI gates, publish-time exact-pin mechanic) ship in a single PR with logical commits, not as a slicing.
- **Placeholder upgrade-instructions ship at the first release of the skill packages.** A no-op `instructions.md` with `changes: []` lives at `upgrades/<currently-published>-to-<currently-published + 1>/` in both skill packages — currently `upgrades/0.7-to-0.8/`. Lets the gate be exercised against real directories rather than synthetic fixtures; first real entries land via PR #502's rebase by appending to the placeholder's `changes[]`. The placeholder may be deleted later via a maintainer PR with explicit CI bypass.
- **FR26 mechanic: `workspace:<literal-version>` everywhere.** All in-repo workspace packages declare their `@prisma-next/*` workspace deps as `workspace:<X.Y.Z>` (e.g. `workspace:0.7.0`), not `workspace:*`. pnpm publish rewrites `workspace:<X.Y.Z>` → exactly `X.Y.Z` at publish time. `set-version.ts` is extended to rewrite both `version` fields and `workspace:<X.Y.Z>` specs in lockstep across every workspace package. `check:publish-deps` is extended to verify exact pinning of `@prisma-next/*` specs in the published tarball. Rejected alternatives: `publishConfig.dependencies` overrides per package (requires per-package boilerplate; pnpm support is uneven); a new publish-time script (adds workflow surface that `set-version.ts` already covers).
- **CI check shape: file-add-level, not content-level.** FR21 fires on file *adds* in stale directories; it does not parse YAML frontmatter to detect `changes[]` entries appended in a stale directory's existing `instructions.md`. Rejected alternative: a content-level YAML-parsing check that catches all new-entry misroutes including appended entries. Rejected because the cost (~50 extra lines + YAML parser dep) wasn't worth the marginal coverage in the user's judgement; the most common drift path (a brand-new directory in the wrong place) is covered, and reviewer attention covers the rest.
- **Skill publish target.** npm-direct; no separate `prisma/agent-skills` GitHub mirror.
- **Scripting form.** Each entry is one `instructions.md` (agent-instruction Markdown) with zero or more colocated portable scripts in any form (`*.ts`, `*.sh`, codemods).
- **Workspace-package location.** Inside `packages/0-shared/` because it's a new tier sibling to `packages/0-config/`. Both `0-shared` packages have no deps in either direction (no runtime dependencies and not imported by any other workspace package).
- **First non-placeholder entry sequencing.** Mechanism lands on this branch (`tml-2519`) with placeholders for the in-flight `0.7 → 0.8` transition; PR #502 is rebased onto the mechanism, appends entries to the placeholder `instructions.md`'s `changes[]` and adds the colocated `strip-manifest-bookends.ts` script. The next minor release after this PR lands (`0.8.0` if uninterrupted) is the first to publish both skill packages — and is the first to exercise the gate end-to-end if PR #502 is in scope by then.
- **Backward-fill.** None. Both skill registries start at `0.6 → 0.7`. Pre-0.6 consumers are pointed at GitHub Release notes for hand-migration.
