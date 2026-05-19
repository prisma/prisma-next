# drive/pr — project-context for PR-body and walkthrough authoring

Loaded by `drive-pr-description` and `drive-pr-walkthrough`. Holds prisma-next's PR conventions, scope-statement patterns, commit-style rules.

> **Trial period in effect (ends 2026-06-02).** When any drive-* skill in this category produces a finding, record it in [`findings.md`](./findings.md). Quality bar, tags, and format live in [`docs/drive/trial.md`](../../docs/drive/trial.md).

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

_(Living; add conventions as they emerge.)_
