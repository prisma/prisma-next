# Distribution-fix plan

## Summary

Fix the agent-skill distribution channel so `prisma-next init` actually installs Prisma Next's user-facing skills end-to-end. Replace the broken npm-package channel (`npx skills add @prisma-next/skills` — which fails because the upstream `vercel-labs/skills` CLI parses `@a/b` identifiers as a GitHub `owner/repo`, not as an npm package id) with a working git-source channel keyed to the CLI's own `package.json` version. Add an integration-test gate that boots `init` end-to-end against branch HEAD and asserts the *exact* set of installed skills, so the install path can never silently regress again.

**Spec:** [`../spec.md`](../spec.md) (project spec, amended on this branch — see § Falsified assumptions)

## Collaborators

| Role         | Person/Team                                | Context                                                                                                                |
| ------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Maker        | Prisma Next maintainer driving this PR     | Drives execution.                                                                                                      |
| Reviewer     | Prisma Next team                           | The CLI / runtime / skills surfaces all touch each other; one reviewer with framework context is sufficient.           |
| Collaborator | None                                       | The substrate is fully internal; no extension authors or partner runtimes need visibility before this lands.           |

## Shipping Strategy

Single milestone, single PR. Every step is structurally backward-compatible because the existing distribution channel is already broken end-to-end (no shipped consumer relies on the npm-package install path actually succeeding), so there is no working-state to preserve while migrating.

The implicit gate that separates old behaviour from new is the **CLI's own `package.json` version**: the new install URL is `prisma/prisma-next#v<cli-version>`, so a published CLI always points at a tag whose `/skills/` directory is the skill set the CLI was built against. The branch under development uses `PRISMA_NEXT_SKILLS_REF` to override the pin to branch HEAD for the integration test (only the test honours this env var; the production code path always uses the version baked into the CLI).

The 0.8.0 `@prisma-next/skills` npm package stays on npm in its broken state. Deprecation is intentionally not part of this PR (per maker direction; deprecation handling for stale published packages is a separate concern with no in-flight consumers to protect).

## Test Design

| AC        | TC    | Test Case                                                                                                                                                                                                                                          | Type        | Milestone | Expected Outcome                                                                                                                                                                |
| --------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-DIST-1 | TC-1  | `prisma-next init` end-to-end against a tmpdir with `PRISMA_NEXT_SKILLS_REF` pointing at branch HEAD: `init` exits zero, the skill-install subprocess exits zero.                                                                                  | Integration | M1        | Init completes without error; the install subprocess returns 0.                                                                                                                 |
| AC-DIST-2 | TC-2  | After TC-1, the agent-runtime skill directory in the tmpdir contains the *exact* set of user-facing skill names from `/skills/` (set equality — no contributor skills leaked from `.agents/skills/`).                                              | Integration | M1        | Set equality holds. Asserts the `metadata: { internal: true }` markers actually filter contributor skills out of the default `--all` install.                                   |
| AC-DIST-3 | TC-3  | `formatSkillInstallCommand('pnpm')` returns `pnpm dlx skills add prisma/prisma-next#v<cli-version> --all`, where `<cli-version>` is the CLI's own `package.json` version. Snapshots updated for every supported package manager (npm, pnpm, yarn, bun, deno). | Unit        | M1        | Snapshot match. The version is read from the CLI package's `package.json`, not hard-coded.                                                                                      |
| AC-DIST-4 | TC-4  | Repo-wide assertion that the broken install command (`npx skills add @prisma-next/skills`) and the `pkg.pr.new` URL form no longer appear in any tracked file under `packages/`, `docs/`, `projects/`, or `examples/`.                             | Unit        | M1        | `rg` returns zero matches.                                                                                                                                                      |
| AC-DIST-5 | TC-5  | `INSTALL_INTERNAL_SKILLS=1 npx skills add prisma/prisma-next#v<cli-version> --all` installs both user-facing and contributor skills. Run once locally against the branch before opening the PR.                                                    | Manual      | M1        | Both `/skills/` and `.agents/skills/` registers populate.                                                                                                                       |
| AC-DIST-6 | TC-6  | The published-package surface is removed: `architecture.config.json`, `.github/workflows/publish.yml`, `pnpm-workspace.yaml` no longer reference `packages/0-shared/skills`. `pnpm-lock.yaml` reflects the workspace removal.                       | Unit        | M1        | A workspace-list assertion (`pnpm m ls --json` post-remove) does not include `@prisma-next/skills`.                                                                             |

## Milestones

### Milestone 1 — Working install path

Replace the broken distribution channel with a git-source URL pinned to the CLI's version, gated by an integration test that catches future regressions. Demonstrable by a green CI on the branch, plus the manual journey from TC-5.

**Tasks:**

- [ ] **1. Move user-facing skills to `/skills/` at the monorepo root.** `git mv packages/0-shared/skills/skills /skills` so the install URL collapses to `prisma/prisma-next` (no subpath). Adjust the `architecture.config.json` glob, any `tsconfig` `include`s, and ensure `pnpm lint:deps` still passes. The contributor cluster at `.agents/skills/` stays in place. (Satisfies: TC-2 setup.)

- [ ] **2. Mark every contributor `SKILL.md` as internal.** Add `metadata: { internal: true }` to every `.agents/skills/*/SKILL.md` frontmatter (preserve any existing `metadata.version` value). This is the only mechanism the `vercel-labs/skills` CLI provides to filter the default `--all` install — without it, every contributor skill leaks into a fresh user project. (Satisfies: TC-2.)

- [ ] **3. Rewrite `formatSkillInstallCommand` to use the git-source URL form.** Read the version from the CLI's own `package.json` (synchronous read at module load — embedded by tsdown into the build output). Replace the `AGENT_SKILL_PACKAGE` constant with the git-source URL `prisma/prisma-next#v<cli-version>` and rename it (e.g. `AGENT_SKILL_SOURCE`) so the name no longer claims it is an npm package id. Update the unit-test snapshots in `packages/1-framework/3-tooling/cli/test/commands/init/__snapshots__/` and any test that asserts the literal package id. (Satisfies: TC-3.)

- [ ] **4. Add an end-to-end integration test for `init`'s skill-install step.** Lives next to the existing `init.test.ts` work or under `test/integration/test/cli-journeys/`. Boots `prisma-next init` against a tmpdir, sets `PRISMA_NEXT_SKILLS_REF=$(git rev-parse HEAD)` so the install URL points at branch HEAD instead of the published tag, asserts subprocess exit-zero, and asserts the *exact* installed skill set against the names of the directories under `/skills/`. Wire `PRISMA_NEXT_SKILLS_REF` into `formatSkillInstallCommand` (env-var override only — production code path always uses the embedded `package.json` version). (Satisfies: TC-1, TC-2.)

- [ ] **5. Delete the `@prisma-next/skills` workspace package.** Remove `packages/0-shared/skills/package.json` and any other build/publish-time artefacts that no longer have a home (the user-facing skill content moved in task 1). Drop the entry from `architecture.config.json`. Confirm `.github/workflows/publish.yml` no longer ships it (check the `pnpm -r publish` filter and any explicit allow-list). Run `pnpm install` to refresh `pnpm-lock.yaml` and `node_modules`. (Satisfies: TC-6.)

- [ ] **6. Update documentation that pointed at the broken channel.** Rewrite the manual journey-tests README (`packages/0-shared/skills/journey-tests/README.md`, or wherever it lands after task 1's move) to use the new `npx skills add prisma/prisma-next#v<cli-version> --all` form for the canonical install line. Strike the `pkg.pr.new` lie (it never worked because npm wasn't a real channel for skills) and replace with the `PRISMA_NEXT_SKILLS_REF` / explicit `prisma/prisma-next#<sha>` form for branch testing. Update `packages/0-shared/skills/README.md` (or its equivalent post-move) the same way. Sweep `docs/onboarding/` for any inherited references. (Satisfies: TC-4.)

- [ ] **7. Verify the project-spec amendments still reflect as-merged state.** This branch lands the spec amendments (§ Falsified assumptions in `../spec.md`, surgical updates in `../specs/usage-skill.spec.md` and `../specs/init-integration.spec.md`) alongside the implementation. At the end of the milestone, re-read the affected FR/AC text in those files and confirm the wording matches what actually shipped — no further drift hiding in the spec.

- [ ] **8. Manual journey TC-5.** Run `INSTALL_INTERNAL_SKILLS=1 npx skills add prisma/prisma-next#<branch-sha> --all` once locally before opening the PR. Confirm both user-facing and contributor skills register; confirm a plain `--all` invocation registers only user-facing. (Satisfies: TC-5.)

- [ ] **9. Open the PR.** No close-out tasks for the parent project (`projects/prisma-next-agent-skill/`) here — that project remains in flight; this PR is one task within it. The PR title carries the project's Linear ticket so the auto-close integration links the issue correctly.

**Validation gate:**

- `pnpm typecheck`
- `pnpm test --filter @prisma-next/cli` (covers TC-3 and the existing `init` snapshot suite)
- `pnpm --dir test/integration exec vitest run test/cli.init-skill-distribution.integration.test.ts` (covers TC-1, TC-2 directly; targeted because the workspace-wide `pnpm test:integration` carries pre-existing postgres-connection instability orthogonal to this milestone — see `wip/unattended-decisions.md` decision 4)
- `pnpm lint:deps`
- `pnpm build` (the CLI build must succeed because `formatSkillInstallCommand` now reads from `package.json` at module load)

> Earlier drafts of this plan listed `pnpm lint:rules:sync` as a gate. That script lives on a separate rule-sync branch and is not present in this branch's `package.json`; the milestone does not touch `.agents/rules/` so the invariant the gate would have asserted is structurally satisfied. See `wip/unattended-decisions.md` decision 3.

## Open Items

1. **Upstream npm-package support.** When `vercel-labs/skills` PR #200 (npm-package install support) lands, the install URL can collapse back to a `@prisma-next/skills` form with no other moving parts. Re-evaluate then; not blocking this PR.
2. **Existing 0.8.0 npm publish.** `@prisma-next/skills@0.8.0` will remain on npm in its broken state. Deprecation messaging on the npm package is intentionally out of scope per the maker direction ("we have lots of deprecated packages"); no consumer is currently depending on it.
3. **`/skills/` at the monorepo root.** Putting markdown content in a top-level `/skills/` directory is unusual relative to the rest of the repo's layout (everything else lives under `packages/`, `examples/`, `test/`, `docs/`). It is the cost of getting `prisma/prisma-next` as the install URL. If the upstream CLI later supports an explicit `--path` argument, the directory could move back under `packages/`. Until then, the trade-off is locked.
