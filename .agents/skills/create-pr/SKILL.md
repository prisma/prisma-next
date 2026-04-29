---
name: create-pr
description: Creates a GitHub PR with a conventional-commit title and a narrative description for prisma-next. Use when the user wants to create a pull request, open a PR, or submit changes for review.
---

# Create PR Skill

## Instructions

### Step 1: Gather Context

1. Run `git log main..HEAD --oneline` to see all commits on the current branch (fallback: `git log origin/main..HEAD --oneline`).
2. Run `git diff main...HEAD --stat` to see which files changed (fallback: `git diff origin/main...HEAD --stat`).
3. Run `git diff main...HEAD` to read the full diff (fallback: `git diff origin/main...HEAD`).
4. Identify the **conventional commit type** from the changes:
   - `feat` — new feature or capability
   - `fix` — bug fix
   - `refactor` — restructuring without behavior change
   - `chore` — tooling, deps, config
   - `docs` — documentation only
   - `test` — test additions or changes
5. Identify the **scope** — the primary architectural layer or package affected (e.g., `sql-runtime`, `postgres-adapter`, `contract`, `framework`, `cli`, `sql-lane`).
6. Check for local-only changes that won’t be in the PR unless committed:
   - `git status -sb`
   - If there are uncommitted changes, explicitly call out that `gh pr create` can proceed but those changes will not be in the PR.

### Step 2: Ask for Linear Ticket

Ask the user for the Linear ticket URL (e.g., `https://linear.app/prisma-company/issue/TML-1859/pn-add-more-parameterized-types`).

Extract from the URL:
- `$TICKET_ID` — the ticket identifier (e.g., `TML-1859`)
- `$SLUG` — the trailing slug (e.g., `pn-add-more-parameterized-types`)

### Step 3: Compose the PR Title

Use conventional commits format:

```
type(scope): concise lowercase description
```

Rules:
- Keep under 60 characters total.
- Lowercase after the colon.
- No period at the end.
- Must clearly convey what changed.

Examples:
- `feat(sql-runtime): add text codec support`
- `fix(postgres-adapter): handle null in jsonb columns`
- `refactor(contract): split emission into two phases`

### Step 4: Compose the PR Description

Use the walkthrough output as the PR description.

1. Run the `.agents/skills/drive-pr-walkthrough/SKILL.md` workflow for the current branch vs base (default: `origin/main...HEAD`) and write `walkthrough.md` to disk.
2. Apply adjustments directly to that same `walkthrough.md` file on disk, then use the adjusted file contents as the PR description in Step 5:
   - **Omit** the entire `## Sources` section (it’s great for local review, but it’s noise in a GitHub PR body).
   - **Prepend** the Linear close line at the very top:

     ```md
     closes [$TICKET_ID](https://linear.app/prisma-company/issue/$TICKET_ID/$SLUG)
     ```

   - **Adjust links for GitHub**:
     - Keep the link text including the line ranges (e.g. `file.ts (L12–L34)`).
     - But change the link target to a GitHub-friendly relative path (e.g. `(path/to/file.ts)`), **removing** any local-editor suffixes like `:12-34`.

   - Do **not** create a second adjusted file unless the user explicitly asks for one.
   - In Step 5, the heredoc body should come from this adjusted `walkthrough.md` content.

3. Keep the rest of the walkthrough structure as-is (it’s the intended narrative PR shape), with one exception:
   - `## Before / After (intention in code)` is **optional**.
   - Only include it when you can show a *real, minimal* “before” vs “after” snippet taken from actual code in `origin/<base>` and `HEAD` (e.g. a function signature, a call-site, or a plan shape), not comment-only placeholders.
   - If you can’t produce a meaningful snippet, **omit the section entirely** and begin at `## Intent`.

   Recommended section order (when “Before / After” is omitted):
   - `## Intent`
   - `## Change map`
   - `## The story`
   - `## Behavior changes & evidence`
   - `## Compatibility / migration / risk`
   - `## Follow-ups / open questions`
   - `## Non-goals / intentionally out of scope`

Notes:
- The walkthrough must stay **intent/behavior-first**, not a file list.
- Avoid “reviewer coaching” phrases; write like a normal narrative.

### Step 5: Confirm and Create

1. Present the full title and description to the user for review.
2. After approval, ensure the branch is pushed to remote (`git push -u origin HEAD` if needed).
3. Create the PR:

```bash
gh pr create --title "the title" --body "$(cat <<'EOF'
the body
EOF
)"
```

4. Return the PR URL.

## Don't Do

1. Don't paste diff stats or long file lists — focus on intention and semantics.
2. Don't write “reviewer coaching” phrases (“anchor”, “read this first”, etc.). Prefer a normal narrative.
3. Don't use uppercase after the colon in the title.
4. Don't create the PR without showing the user the title and description first.
5. Don't guess the Linear ticket number — always ask.
