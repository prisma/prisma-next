---
name: drive-pr-description
description: Generates PR descriptions by analyzing git diffs between the current branch and the default branch. Use when the user requests a PR description, pull request summary, or commit message for a squash merge.
metadata:
  author: Tyler Benfield
  version: "2026.2.3"
---

# PR Description Generator

Analyzes the git diff between the current branch and the default branch to generate a concise, informative PR description suitable for code review and commit history.

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
