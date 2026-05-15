# Plan — Upgrade-skill mechanism (user + extension + pin-check)

This plan implements [`upgrade-skill.spec.md`](../specs/upgrade-skill.spec.md) on the `tml-2519` branch. All work ships in a single PR. The work decomposes into five milestones; each ends in a coherent commit set and a green validation gate.

## Milestone identifiers

- **m1** — workspace package skeletons + `0-shared` tier (FR1, FR3, FR4a, FR15, NFR6, NFR8)
- **m2** — `prisma-next-check-pins` CLI + tests (FR22, FR24, NFR9; supports AC19, AC20, AC21)
- **m3** — in-repo `record-upgrade-instructions` skill (FR8, FR9, FR10, FR11, FR12)
- **m4** — `check:upgrade-coverage` CI gate (FR13, FR14, FR21; supports AC5–AC8, AC10, AC15–AC18)
- **m5** — publish-time exact-pin mechanic via `workspace:<literal-version>` (FR22, FR26; supports AC25, AC26, AC27)

## Test design (derived from spec ACs)

Test types and the ACs each covers:

- **Unit (vitest, in-package).**
  - Pin-check CLI behaviour against synthetic `package.json` fixtures: exact-pin pass, range-pin reject, mismatched-version reject, `workspace:` spec reject, multi-field check (`dependencies` + `peerDependencies`). Covers AC19, AC20, AC21.
  - `check:upgrade-coverage` script behaviour against synthetic git fixtures (in-process). Covers AC5, AC6, AC7, AC8, AC10, AC15, AC16, AC17, AC18.
  - `set-version.ts` extension: workspace-spec rewrite alongside `version` field. Covers AC26.
  - `check-publish-deps.mjs` extension: rejects non-exact `@prisma-next/*` pins in synthetic `package.json` fixtures. Covers AC27.

- **Integration / end-to-end.**
  - `check:upgrade-coverage` running against the branch's actual git state (no synthetic fixture). Covers AC11 transitively (publish gate sees real branch state).
  - `prisma-next-check-pins` running against an in-repo extension's `package.json` after the m5 migration. Covers AC25 transitively (the same exact-pin shape).

- **Manual / inspection.**
  - Existence of placeholder `instructions.md` at `packages/0-shared/upgrade-skill/upgrades/0.6-to-0.7/` and `packages/0-shared/extension-upgrade-skill/upgrades/0.6-to-0.7/`. Covers AC28.
  - Inspection of `packages/0-shared/upgrade-skill/SKILL.md` for pre-flight prose. Covers AC22.
  - Inspection of both skill `package.json` files for cross-dep absence. Covers AC23.

- **Deferred-until-PR-#502 lands** — AC1, AC2, AC3, AC4, AC9, AC12, AC13, AC14, AC24. These require non-placeholder upgrade-instructions content. The placeholder mechanics let the gate, the publish path, and the publish-deps shape be exercised; AC1+ are validated by PR #502's rebase-onto-this-PR work.

## Validation gates

Validation gates per milestone use the project's standard harness:

- **Typecheck:** `pnpm typecheck`
- **Test (package):** `pnpm test --filter <package-or-glob>`
- **Test (workspace):** `pnpm test:packages`
- **Lint (deps):** `pnpm lint:deps`
- **Lint (biome):** `pnpm format` (read-only check via `biome format`)
- **Build:** `pnpm build --filter <package-or-glob>`
- **Existing publish-shape check:** `pnpm check:publish-deps`

Each milestone's gate is named explicitly below.

---

## m1 — Workspace package skeletons + `0-shared` tier

**Goal.** Create the two leaf publish-only workspace packages, wire them into the workspace, ship placeholder upgrade-instructions, and confirm the workspace builds clean.

### Tasks

- **m1.1.** Create `packages/0-shared/upgrade-skill/` with:
  - `package.json` declaring `name: "@prisma-next/upgrade-skill"`, `version: "0.7.0"`, `type: "module"`, `private: false`, `publishConfig: { access: "public", provenance: true }`, no `dependencies`, no `peerDependencies`, `files: ["SKILL.md", "upgrades", "README.md"]`.
  - `SKILL.md` carrying FR3 entry-point content + FR16 Step 0 ensure-latest + FR17 version detection + FR18 transition chain + FR19 role detection (user) + FR20 per-step flow + FR27 SKILL.md-prose pre-flight (covers AC22).
  - `README.md` (consumer-facing summary; references CLI install via `npx skills add`).
  - `upgrades/0.6-to-0.7/instructions.md` placeholder with frontmatter `from: "0.6"`, `to: "0.7"`, `changes: []`. Empty body. (Covers AC28.)
- **m1.2.** Create `packages/0-shared/extension-upgrade-skill/` with:
  - `package.json` declaring `name: "@prisma-next/extension-upgrade-skill"`, `version: "0.7.0"`, `type: "module"`, `private: false`, `publishConfig: { access: "public", provenance: true }`, `bin: { "prisma-next-check-pins": "./bin/prisma-next-check-pins.mjs" }`, no `dependencies`, no `peerDependencies`, `files: ["SKILL.md", "upgrades", "bin", "README.md"]`.
  - `SKILL.md` carrying FR3 entry-point content + Step 0 ensure-latest + FR17 version detection + FR18 transition chain + FR19 role detection (extension-author) + FR20 per-step flow including `pnpm exec prisma-next-check-pins` after the bump step.
  - `README.md`.
  - `upgrades/0.6-to-0.7/instructions.md` placeholder with empty `changes: []`.
  - `bin/prisma-next-check-pins.mjs` stub that exits 0 with no output (real implementation lands in m2).
- **m1.3.** Add the two packages to the workspace via `pnpm-workspace.yaml` if it doesn't already cover `packages/0-shared/*`. (Spot-check: read `pnpm-workspace.yaml` for the `packages/0-shared/*` glob; if absent, add it alongside `packages/0-config/*`.)
- **m1.4.** Confirm the new tier `0-shared` is consistent with `architecture.config.json`'s pattern of unregistered tiers (per `0-config` precedent). If `dependency-cruiser.config.mjs` enumerates tiers explicitly, ensure `0-shared` is either treated identically to `0-config` or has its own no-incoming/no-outgoing rule.
- **m1.5.** Run `pnpm install` to materialise the workspace. Confirm `pnpm-lock.yaml` updates cleanly (no spurious version churn).

### Validation gate (m1)

- `pnpm install` — succeeds; lockfile is consistent.
- `pnpm typecheck --filter @prisma-next/upgrade-skill --filter @prisma-next/extension-upgrade-skill` — passes (both packages have no `.ts` source yet so this should be vacuous; if Turborepo skips for "no input files", that's acceptable).
- `pnpm build --filter @prisma-next/upgrade-skill --filter @prisma-next/extension-upgrade-skill` — passes (likewise vacuous; SKILL.md / Markdown are not built).
- `pnpm lint:deps` — passes (verifies the new tier's structure is consistent with the architecture config).
- File existence check: both `package.json`, both `SKILL.md`, both placeholder `instructions.md`, the `bin` stub.
- `cat` both `package.json` files: confirm neither lists the other as any kind of dependency (covers AC23).

---

## m2 — `prisma-next-check-pins` CLI + tests

**Goal.** Replace the m1 stub with the real CLI and ship unit tests covering AC19–AC21.

### Tasks

- **m2.1.** Implement `packages/0-shared/extension-upgrade-skill/bin/prisma-next-check-pins.mjs`:
  - Reads `process.cwd()/package.json`.
  - Enumerates `dependencies`, `peerDependencies`, `optionalDependencies`.
  - For each `@prisma-next/*` entry, validates the spec matches `^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$`. Rejects `workspace:*`, `workspace:^`, `workspace:~`, `workspace:<version>`, `^X.Y.Z`, `~X.Y.Z`, range syntax, wildcards.
  - Asserts every entry resolves to the same exact version.
  - On success, exits 0 with no output. On failure, prints a structured error naming every offending entry and exits non-zero.
  - Plain ESM `.mjs`, no compile step. Imports from `node:fs`, `node:path`, `node:process`. Shebang `#!/usr/bin/env node`. Mark executable (`chmod +x`).
- **m2.2.** Write unit tests at `packages/0-shared/extension-upgrade-skill/test/check-pins.test.ts` (or `.test.mjs` if the package skips TS tooling):
  - Synthetic `package.json` fixtures via `fs.mkdtemp` + `JSON.stringify`.
  - Tests cover: exact-pin pass; range-pin reject (`^`, `~`, `>=`); workspace-spec reject (`workspace:*`, `workspace:^`, `workspace:0.7.0`); wildcard reject (`*`, `"x"`); mismatched-version reject; multi-field check (a range in `peerDependencies` while `dependencies` is exact still rejects); empty `@prisma-next/*` set passes vacuously; non-`@prisma-next/*` entries are ignored regardless of shape.
  - Tests invoke the CLI via `child_process.spawnSync("node", ["bin/prisma-next-check-pins.mjs"], { cwd: tmpdir })`.
- **m2.3.** Confirm the CLI is wired correctly: from a sibling directory in the workspace, `pnpm exec prisma-next-check-pins` resolves and runs.

### Validation gate (m2)

- `pnpm typecheck --filter @prisma-next/extension-upgrade-skill` — passes.
- `pnpm test --filter @prisma-next/extension-upgrade-skill` — passes (covers AC19, AC20, AC21).
- `pnpm test:packages` — passes (cross-package smoke).
- Manual: invoke `pnpm exec prisma-next-check-pins` from any in-repo extension directory; expect failure if that extension still uses `workspace:*` (m5 work). The failure is informational, not a gate failure.

---

## m3 — In-repo `record-upgrade-instructions` skill

**Goal.** Author the in-repo authoring skill content. No tests; verification is by file inspection and content review.

### Tasks

- **m3.1.** Create `.agents/skills/record-upgrade-instructions/SKILL.md` with:
  - YAML frontmatter `name: record-upgrade-instructions`, `description: …` (description names the firing surface — phrases like "record upgrade instructions", "I made a breaking change to Prisma Next", etc., per FR8).
  - Body covering FR9 detection signals (per substrate, with destination skill package), FR10 authoring workflow (numbered steps), FR11 validation-by-execution (commands per substrate), FR12 commit shape.
  - Sections: *When to use*, *Detection signals & routing*, *Authoring workflow*, *Validation by execution*, *PR commit shape*, *Rebase scenario*, *Cross-audience entries (duplication)*.
  - Length target: <400 lines, terse and operational.
- **m3.2.** Confirm the skill firing path. The repo's `.agents/` directory does not yet exist (per the `ls .agents/` observation early in the loop showing only `rules/` and `skills/`); confirm the `skills/` subdir exists and create `record-upgrade-instructions/` inside it. (No-op if `.agents/skills/` already exists.)
- **m3.3.** Add a one-line entry in the workspace-level skills index if such an index exists (low-priority — skip if no convention).

### Validation gate (m3)

- File exists at `.agents/skills/record-upgrade-instructions/SKILL.md`.
- Content review: check sections cover FR9, FR10, FR11, FR12.
- Grep: `rg 'package\.json' .agents/skills/record-upgrade-instructions/SKILL.md` — confirms the in-flight-minor-from-package.json discipline is named.
- Grep: `rg '0\.6-to-0\.7' .agents/skills/record-upgrade-instructions/SKILL.md` — confirms a worked example of directory naming.
- No test command.

---

## m4 — `check:upgrade-coverage` CI gate (FR13/FR14/FR21)

**Goal.** Implement the workspace-script that enforces (1) coverage of substrate diffs by the matching upgrade-instructions directory and (2) new-entries-go-in-the-in-flight-directory discipline. Wire into PR CI and publish workflow. Ship unit tests.

### Tasks

- **m4.1.** Implement `scripts/check-upgrade-coverage.mjs`:
  - **Inputs:** Two CLI flags + envs, defaulted from git context:
    - `--mode <pr|publish>` — chooses comparison base. `pr` compares against `origin/main`; `publish` compares against the prior `latest` git tag.
    - `--head <ref>` — defaults to `HEAD`.
    - `--prev <ref>` — defaults per mode.
  - **Logic:**
    1. Read in-flight minor `M` from `package.json` on `--head` (`X.Y.Z` → minor `X.Y`).
    2. Compute prior minor `M-1` from the prior release (mode `publish`) or from the closest prior `package.json` version (mode `pr` — read from `origin/main` tip's `package.json`).
    3. If `M == M-1` (patch), skip the coverage check (NFR4); still run the new-entries check.
    4. **Coverage sub-check (FR13/FR14):** for each substrate `examples/` and `packages/3-extensions/`, compute `git diff <prev>..<head> -- <substrate>` excluding generated paths (`*.contract.json`, `*.contract.d.ts`, `*.end-contract.json`, `*.end-contract.d.ts`). If non-empty, assert the matching directory exists at `packages/0-shared/<package>/upgrades/<M-1>-to-<M>/`. Otherwise, vacuously satisfied.
    5. **New-entries sub-check (FR21):** compute the set of file paths added under `packages/0-shared/upgrade-skill/upgrades/` or `packages/0-shared/extension-upgrade-skill/upgrades/` between `<prev>` and `<head>` via `git diff <prev>..<head> --diff-filter=A --name-only`. For each added path, assert it lies in `upgrades/<M-1>-to-<M>/`. Adds in any other transition directory fail.
    6. On any sub-check failure, exit non-zero with a structured error naming the offending paths and the expected directory.
  - **Implementation:** plain ESM `.mjs`, uses `child_process.execFileSync` for git, no external deps. ~150 lines target.
- **m4.2.** Wire into root `package.json` as a workspace script: `"check:upgrade-coverage": "node scripts/check-upgrade-coverage.mjs"`.
- **m4.3.** Wire into `.github/workflows/ci.yml` as a step in the PR workflow, parallel to or just before the existing `pnpm check:publish-deps` step.
- **m4.4.** Wire into `.github/workflows/publish.yml` as a step before `pnpm -r publish`, after `pnpm check:publish-deps`. Mode `publish`.
- **m4.5.** Write tests at `scripts/check-upgrade-coverage.test.ts` (vitest, run via `pnpm test:scripts` or `pnpm test:packages` depending on workspace test discovery — match the precedent set by `scripts/lint-workflow-triggers.test.mjs` and `scripts/determine-version-utils.test.ts`):
  - Synthetic git fixtures: spawn an ephemeral git repo in `os.tmpdir()`, populate with two commits where the first establishes baseline and the second introduces the change being tested.
  - Tests cover: AC5 (patch bump skips coverage), AC6 (user-substrate change without entry fails), AC7 (extension-substrate change without entry fails), AC8 (both-substrate requires both entries), AC10 (publish-mode parity), AC15 (new-entries add to stale dir fails), AC16 (new-entries add to in-flight passes), AC17 (modifications to old dir pass), AC18 (in-flight minor reads from `package.json` on the head ref).
- **m4.6.** Run `pnpm check:upgrade-coverage` against the current branch state. The current branch's diff (vs `origin/main`) at this point contains: workspace package additions (m1), CLI work (m2), in-repo skill addition (m3), the script itself + tests (m4). The substrate diffs in `examples/` and `packages/3-extensions/` should be empty (or limited to the `0-shared` packages we created, which are not under `examples/` or `packages/3-extensions/`). The check should pass vacuously.

### Validation gate (m4)

- `pnpm typecheck` — passes (script may be `.mjs`, tests are `.ts`).
- `pnpm test:packages` (or `pnpm test:scripts` — match existing convention) — passes including the new test file.
- `pnpm check:upgrade-coverage` — passes against the current branch.
- `pnpm lint:deps` — passes.
- Manual: read both workflow YAML diffs; the new step is wired correctly and runs after `pnpm check:publish-deps`.

---

## m5 — Publish-time exact-pin mechanic (FR26)

**Goal.** Migrate every workspace package's `@prisma-next/*` workspace specs to `workspace:<X.Y.Z>` literal-version form, extend `set-version.ts` to rewrite specs in lockstep with the `version` field, extend `check-publish-deps.mjs` to enforce exact pinning of `@prisma-next/*` in the published tarball.

### Tasks

- **m5.1.** Audit every workspace `package.json` for `@prisma-next/*` entries with `workspace:*` (or other workspace-protocol forms). Use `rg '"@prisma-next/[^"]+":\s*"workspace:' --json packages/` to enumerate. Expected scope: every package that depends on internal PN packages (≈ 20+ packages across `packages/3-extensions/`, `packages/2-sql/`, `packages/2-mongo-family/`, `packages/1-framework/`, etc.).
- **m5.2.** For every found entry, rewrite from `"workspace:*"` (or whatever form) to `"workspace:0.7.0"` (the current in-flight minor from root `package.json`). Apply across `dependencies`, `peerDependencies`, `devDependencies`, `optionalDependencies`. Leave non-`@prisma-next/*` workspace specs alone.
- **m5.3.** Run `pnpm install` after the migration. Confirm the lockfile updates without spurious churn — pnpm should still resolve `workspace:0.7.0` to the in-workspace package the same way it resolves `workspace:*`. The lockfile *will* show some changes (the resolved spec appears in the lockfile); these are expected and limited to the spec field.
- **m5.4.** Extend `scripts/set-version.ts` to rewrite `@prisma-next/*` workspace dep specs in addition to the `version` field:
  - For each workspace package, enumerate `dependencies`, `peerDependencies`, `devDependencies`, `optionalDependencies`.
  - For each `@prisma-next/*` entry, if the spec begins with `workspace:`, rewrite to `workspace:<new-version>`.
  - Idempotent: re-running with the same version produces no diff.
- **m5.5.** Add a unit test for `set-version.ts` at `scripts/set-version.test.ts` (matching the precedent of other `scripts/*.test.ts` files):
  - Synthetic workspace fixture in `os.tmpdir()` with three packages: A (no PN deps), B (PN dep at `workspace:*`), C (PN dep at `workspace:0.7.0`).
  - Run `set-version.ts 0.8.0` against the fixture.
  - Assert: A's `version` is `0.8.0` only; B's `version` is `0.8.0` AND its PN dep is `workspace:0.8.0`; C's `version` is `0.8.0` AND its PN dep is `workspace:0.8.0`.
  - Re-run; assert no diff.
  - Covers AC26.
- **m5.6.** Extend `scripts/check-publish-deps.mjs` to add a new check on top of the existing `workspace:` / `catalog:` leak check:
  - For each `@prisma-next/*` entry in `dependencies`, `peerDependencies`, `optionalDependencies`, assert the spec matches `^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$` (no operator, no `workspace:`, no wildcard, no range).
  - The existing leak-check already catches `workspace:` so this is mostly an additional explicit check that catches `^X.Y.Z` and `~X.Y.Z` forms.
  - Update `findLeaks` (or add a parallel `findRangePins`) and surface in the same output shape.
- **m5.7.** Add a unit test at `scripts/check-publish-deps.test.mjs` (matching existing convention if one already exists; otherwise add):
  - Synthetic `package.json` fixture with `dependencies: { "@prisma-next/contract": "^0.7.0" }`. Run check; assert it fails naming the offending entry.
  - Same with `~0.7.0`, `>=0.7.0`, `*`.
  - Synthetic with `"@prisma-next/contract": "0.7.0"` exact passes.
  - Covers AC27.
- **m5.8.** Run `pnpm check:publish-deps` against the workspace's current `pnpm pack` outputs. With the m5.2 migration applied and the `set-version.ts` extension landed, the published artefacts (after the publish-time `workspace:0.7.0 → 0.7.0` rewrite by pnpm publish) should have exact pins. The in-tree `package.json` files have `workspace:0.7.0` which `check-publish-deps` already accepts (workspace specs become exact at publish time).

### Validation gate (m5)

- `pnpm install` — succeeds; lockfile is consistent.
- `pnpm typecheck` — passes.
- `pnpm test:packages` — passes including new tests.
- `pnpm test:scripts` (or whichever script runs the `scripts/*.test.ts` files) — passes.
- `pnpm check:publish-deps` — passes (no leaks, no range pins in `@prisma-next/*` entries).
- `pnpm build` — passes (touches every package's `version`-rewriting touched by m5.2; build must still work).
- `pnpm lint:deps` — passes.

---

## Cross-cutting validation gate (project-wide, before PR-open)

After m5 reaches `SATISFIED`, run a full-workspace sweep before opening the PR:

- `pnpm install`
- `pnpm build`
- `pnpm lint:deps`
- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm check:publish-deps`
- `pnpm check:upgrade-coverage`
- `git status` — clean

If anything regresses, stop, fix, re-run from the top. Do not open the PR with red signals.

## Open items

- **Skill `description` wording.** The exact wording of each `SKILL.md` `description` field — what triggers each skill firing — is content the implementer chooses based on the patterns observed in the reference skills under `projects/prisma-next-agent-skill/references/`. The implementer should re-read at least one reference (e.g. Vercel, TanStack) before authoring.
- **`.agents/skills/` registration.** The repo's existing in-repo skills are at `.claude/skills/`. The new `.agents/skills/record-upgrade-instructions/` is the first inhabitant of the `.agents/skills/` directory. If a workspace-level skills index exists, the new skill is added; if not, no further wiring is needed (the skills mechanism reads `.agents/skills/*/SKILL.md` directly, per the parent project NFR4). If the runtime ergonomics turn out to require a registration step, surface as a finding to the orchestrator.
- **`set-version.ts` invocation context.** The `bump-minor.ts` flow (TML-2518) reads `package.json` *as committed at HEAD*, not as on disk, to make the bump idempotent. The m5 extension must preserve this property: if the `set-version.ts` rewrite reads from disk, it must do so *after* the `version` field has already been rewritten (so subsequent re-reads of disk find the new version). Concretely: the existing `set-version.ts` writes `package.json` with the new `version`, then exits. The m5 extension performs the workspace-spec rewrite as part of the same write — read the file, mutate `version` AND `@prisma-next/*` workspace specs in the same JSON object, write once.
- **Migrating extensions from `dependencies` → `peerDependencies` for `@prisma-next/*`.** Out of scope for this PR (per `Non-goals`). The exact-pin rule applies regardless of which dep field the extension uses today. If a future PR migrates extensions to peer-deps, no change to the m5 mechanic is needed.
- **Placeholder cleanup.** The placeholder `instructions.md` files may be deleted later via a maintainer PR with explicit CI bypass. Not part of this PR's scope.

## Subagent IDs

(Populated by the orchestrator at first delegation per `drive-orchestrate-plan/SKILL.md § Subagent continuity`.)
