---
name: drive-pr-description
description: >
  Generates PR descriptions by analyzing git diffs between the current branch and the
  default branch. Two modes — full mode (slice PRs: overview / changes / why / explicit
  scope statement) and direct-change mode (~30-second-verifiable diffs: intent / Linear
  link / scope statement / verification note). Use when the user requests a PR
  description, pull request summary, or commit message for a squash merge. Direct-change
  mode fires automatically when drive-start-workflow routes to "direct change."
metadata:
  author: Tyler Benfield
  version: "2026.5.18"
---

> **Execution mode: orchestrator-direct.** This atomic skill is invoked by the Orchestrator directly. Running it does NOT change the Orchestrator's role — the file-path boundary, stop-and-delegate triggers, and escape-hatch criterion from the active workflow skill remain in force. Outputs land in `projects/<current-project>/` (spec / plan / design notes), in Linear (via MCP), or in the conversation surface (verdicts, briefs, summaries).
>
> If the skill's body asks for work that requires reading source code, running builds/tests, or writing files outside `projects/<current-project>/` — **STOP. Dispatch.** See [`drive/roles/README.md`](../../drive/roles/README.md) for the canonical Orchestrator role definition.

# PR Description Generator

Analyzes the git diff between the current branch and the default branch to generate a concise, informative PR description suitable for code review and commit history.

## Modes

This skill has **two modes**:

- **Full mode** (default) — for slice-sized PRs. The full overview / changes / why structure below.
- **Direct-change mode** — for direct-change PRs (~30-second-verifiable diffs routed by `drive-start-workflow`). Different structure: intent statement, Linear ticket link, scope statement, brief verification note. See § Direct-change mode below.

Pick the mode that matches the PR's shape. Direct-change mode is the smaller surface; if you're unsure, use full mode (slice PRs are the more common case).

## Core Principles

- **Concise for quick reading**: Facilitate rapid comprehension by a human reviewer
- **Context, not repetition**: Provide context to aid review, not a verbatim list of what changed
- **Big picture focus**: Explain why and how things changed, not every individual change
- **Title separate from body**: Title can be provided separately; don't duplicate it in the body

## Workflow

1. **Identify the remote and default branch**: don't assume the remote is `origin` — resolve the remote-tracking HEAD dynamically, e.g.:
   - Pick a remote (typically the only one returned by `git remote`; otherwise prefer the upstream of the current branch via `git rev-parse --abbrev-ref --symbolic-full-name @{u}` and take its remote prefix).
   - Resolve the default branch from that remote's HEAD: `git symbolic-ref --short refs/remotes/<remote>/HEAD` (or `git rev-parse --abbrev-ref <remote>/HEAD`), which yields `<remote>/<default-branch>`.
   - Fallback when no remote-tracking HEAD is configured: run `git remote set-head <remote> --auto` (or ask the user) and retry; if that still fails, fall back to `<remote>/main` (or `<remote>/master`) only after confirming the branch exists with `git rev-parse --verify <remote>/<branch>`.
   - Use the resolved `<remote>` and `<default-branch>` consistently in the commands below.
2. **Refresh and get the diff**: fetch the resolved default branch from the remote so the diff base is current, then diff against the remote-tracking ref:
   - `git fetch --prune <remote> <default-branch>`
   - `git diff <remote>/<default-branch>...HEAD`

   Always diff against `<remote>/<default-branch>` (not the local `<default-branch>`) so a stale local copy can't yield a misleading PR description.
3. **Analyze changes** to understand intent, scope, and technical decisions
4. **Generate description** following the structure below

## Structure

```markdown
[Overview paragraph]

## Changes

- **Component/Area**: Big-picture change with why/how context
- **Component/Area**: Big-picture change with why/how context

## Why

[Explanation of key technical decisions and reasoning]
```

### Title (Optional)

- Provide separately if requested
- One-line summary of what was added/changed/fixed (the "what", not the "why")
- Omit branch name (redundant)
- Examples: "Add pgBackRest S3 credential rotation", "Implement storage guard write restrictions"

### Overview

- 1-2 sentences explaining purpose and motivation
- Provide context for why this change exists
- Set the stage for understanding the changes

### Changes

- **Focus on big picture**, not exhaustive enumeration
- Explain **why and how** things changed, providing context for code review
- Organize by component/service/area for multi-component changes
- Cite key files, functions, or modules when it aids understanding (use repo-relative paths only)
- Include concrete technical details when they matter: timeouts, limits, formats, protocols
- **Omit** tangential changes (import organization, minor refactors) unless they're the focus
- **Skip** "improved observability" unless it's the PR's primary purpose

### Why

- Explain reasoning behind key technical decisions
- Address "why this approach over alternatives"
- Highlight security, performance, or reliability implications when relevant
- Connect decisions to constraints or requirements

## Guidelines

**Do:**

- Keep it concise for quick reading by reviewers
- Provide context to facilitate code review, not verbatim change lists
- Focus on big-picture why/how, not exhaustive what
- Use repo-relative paths only (e.g., `src/lib.rs`, never `/home/user/project/src/lib.rs`)
- Cite key files/functions/modules when it aids understanding
- Explain technical decisions with concrete reasoning
- Organize multi-service changes by component

**Don't:**

- List every change (focus on the bigger picture)
- Repeat what's visible in the code review itself
- Include branch name in description (redundant)
- Duplicate title in the body (title can be provided separately)
- Mention tangential changes like "organized imports" or "added logging" unless focal
- Use vague statements like "removed unused code" without specifics
- Treat observability as a feature (it's table stakes)
- Use absolute filesystem paths

## Output Format

Provide two separate outputs:

1. The title as plain text (not in a markdown block)
2. The PR description body in a single Markdown code block

**Format:**

[One-line summary]

```markdown
[PR description body without title - no nested blocks]
```

**Critical:** Do NOT nest markdown blocks. Do NOT put the title inside the same markdown block as the body. Provide them as two distinct outputs.

## Example

For a change adding S3 credential rotation:

Add pgBackRest S3 credential rotation worker

```markdown
Implements automatic rotation of S3 credentials for pgBackRest backups to comply with 90-day credential expiration policy.

## Changes

- **Credential management**: New background worker (`src/pgbackrest_credentials_worker.rs`) fetches fresh S3 credentials from the platform API every 24 hours and updates pgBackRest configuration. Added `prisma_postgres.s3_credentials_url` GUC setting for the API endpoint.

## Why

S3 credentials expire after 90 days. Rather than manual rotation or backup failures, the worker proactively refreshes credentials well before expiration. The 24-hour interval provides a safety margin while avoiding unnecessary API calls.
```

## Direct-change mode

For PRs routed by `drive-start-workflow` as **direct change** (~30-second-verifiable diff; no spec; no plan; no dispatch ceremony — see `drive/triage/README.md` for team sizing anchors).

### Direct-change structure

```markdown
[One-paragraph intent statement: what changes; why; what stays the same.]

**Linear:** <issue link>

**Scope:** _<one-line scope statement; named files / behaviours that change; out-of-scope explicitly named if there's any ambiguity>_

**Verification:** _<one-sentence verification note — what the reviewer should look for in the diff; how the reviewer can verify correctness in ~30 sec by reading the diff>_
```

### Direct-change workflow

1. Read the diff (per § Workflow step 1-2 — resolve remote + diff base; refresh; diff).
2. **Sanity-check the verdict.** Direct change is a scope claim; the diff is the test. If the diff is more than 1-3 files OR > ~50 LoC OR not obvious-from-reading, the verdict was wrong — escalate back to `drive-triage-work` for re-routing as orphan slice or in-project slice. The direct-change PR description shouldn't be assembled over a diff that isn't direct-change-shaped.
3. Assemble the four-line PR body per the template above.
4. Title: a single-line summary, conventional commit style if the team uses one (`fix: ...`, `chore: ...`).

### Direct-change rules

- **Always link Linear.** Direct changes still need observability; the Linear link is the trail.
- **Scope statement is non-optional.** Without it, the PR's blast radius is unbounded for the reviewer. Even a one-line scope sentence is enough.
- **Verification note is what makes the PR direct-change-shaped.** The reviewer should be able to verify correctness in ~30 sec; the verification note tells them how. If you can't write a credible verification note, the PR isn't direct-change.

### Direct-change anti-patterns

- **Direct-change PR with a multi-paragraph "Why" section.** If the change needs that much explanation, it's not direct-change. Re-route as orphan slice.
- **Direct-change PR that adds tests.** Tests are fine; if the test logic needs explaining, the change isn't 30-second-verifiable. Re-route.
- **Direct-change PR that touches > 3 files.** Almost certainly mis-routed. Verify against triage.
- **Direct-change PR with feature flags.** Feature flags imply rollout sequencing, which implies a slice (or project). Re-route.

### Example direct-change PR

`fix(docs): typo in install guide`

```markdown
Fixes a typo in the install guide that misnamed the env var (`DATBASE_URL` → `DATABASE_URL`).

**Linear:** TML-1234

**Scope:** Only `docs/getting-started/install.md`. No code, no tests, no other docs.

**Verification:** Diff shows a single character change in one prose paragraph; no other lines touched.
```
