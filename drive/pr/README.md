# drive/pr — project-context for PR-body and walkthrough authoring

Loaded by `drive-pr-description` and `drive-pr-walkthrough`. Holds prisma-next's PR conventions, scope-statement patterns, commit-style rules.

> **Trial period in effect (ends 2026-06-02).** When any drive-* skill in this category produces a finding, record it in [`findings.md`](./findings.md). Quality bar, tags, and format live in [`drive/trial.md`](../trial.md).

## PR title convention

- Conventional-commit prefix: `feat:` / `fix:` / `chore:` / `docs:` / `refactor:` / `test:` / `build:` / `ci:`.
- Linear ticket identifier included as `(TML-NNNN)` suffix OR in the description as `Refs: TML-NNNN` — GitHub integration auto-transitions Linear on merge if either is present.
- One-line summary, present tense, imperative mood.

Examples:
- `feat(sql): add returning() to insert operations (TML-2549)`
- `fix(emitter): handle null defaults in column codecs (TML-2487)`

## PR body conventions (full mode)

The canonical `drive-pr-description` structure applies. Additional repo conventions:

- **Reference linked Linear ticket** explicitly in the overview paragraph when the ticket carries context the PR description doesn't repeat.
- **Call out package-layer changes** in `## Changes`: which packages, which layer (Core / Authoring / Tooling / Lane / Runtime / Adapters per `architecture.config.json`).
- **Note fixture regen** if the PR includes regenerated fixtures (so the reviewer knows the diff sprawl is from regen, not code change).
- **No reference to transient project artefacts** in the PR body — per `.cursor/rules/doc-maintenance.mdc`, ADR numbers + Linear tickets are durable references; `projects/<x>/...` paths are not.

## Direct-change mode conventions (per slice 9 augmentation)

For PRs routed as **direct change** by `drive-start-workflow`:

- Title: conventional-commit prefix; ≤ 60 chars; Linear ticket in title.
- Body: 4-line structure (intent / Linear / scope / verification) per `drive-pr-description` § Direct-change mode.
- No `## Changes` section needed (the diff is the change).
- No `## Why` section needed (the intent paragraph carries why).

## Commit-style rules

- Per `.agents/skills/commit-as-you-go/SKILL.md` (canonical): small logical commits; intent-focused messages; no WIP / temp messages.
- This repo's preference: commits within a PR can stay separate (no squash) when each commit is a coherent step. Maintainers may squash on merge based on the PR's shape.

## Walkthrough conventions

`drive-pr-walkthrough` generates walkthroughs at PR-open time. Repo-specific overlays:

- Walkthrough goes under `## Walkthrough` heading in the PR body for slice PRs.
- For project-spanning PRs (close-out PRs that migrate `projects/<project>/` to `docs/`), the walkthrough is in `projects/<project>/walkthroughs/` and referenced from the PR body.
- Link to specific test files as evidence; per the `walkthrough.mdc` user rule, prefer repo-relative links (`path/to/file.ts (L12-L34)`) that editors can open.

## Linear-issue conventions

- Each slice maps to a Linear Issue.
- Issue description links back to `projects/<project>/slices/<slice>/` (in-project) or to the orphan-slice PR description path (orphan).
- PR title prefix: `<tml-id>:` (Linear ticket). Example: `tml-2549: drive-domain-model consolidation`.
- PR description references the Linear issue (`Refs: TML-XXXX` line OR included in the title — either is enough for auto-close).

## Linear state conventions

- The team's terminal-before-merge state is **`Ready to be merged`** (not `Done`). The GitHub integration auto-transitions to the team's completed state on merge.
- Do not manually transition issues to a completed state; the integration handles it.
- Manual transitions before merge are fine (e.g. moving to `In review` when the PR opens).

## Slice-DoD overlay (PR-side items)

In addition to the canonical slice DoD:

- [ ] Linear issue moved to `Ready to be merged` (the team's terminal-before-merge state).
- [ ] PR title carries Linear ticket prefix (e.g. `tml-XXXX:`).
- [ ] PR description follows `drive-pr-description` shape (decision-led, narrative).
- [ ] PR linked to its Linear issue via GitHub integration (auto-close on merge works).
- [ ] No `projects/` references in long-lived files added by the slice (per the doc-maintenance rule; grep gate lives in `drive/plan/README.md`).

(Manual-QA slice-DoD items live in `drive/qa/README.md`. Plan-side gates / failure-mode references live in `drive/plan/README.md`.)

_(Living; add conventions as they emerge.)_
