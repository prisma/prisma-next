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

Write an approachable narrative that explains:

- **Intention**: what the PR is trying to achieve (the “why”).
- **Semantic/logical change**: what *meaningfully* changed in behavior, layering, boundaries, or guarantees (not a file list).
- **Mechanics only as needed**: mention “what changed” when it helps the reader understand the semantics.

Lead with something visual when possible:

- A **before/after** code snippet that captures the goal of the PR (preferred), or
- A small **Mermaid diagram** when structure or lifecycle is the point.

Avoid “reviewer coaching” language (e.g. don’t write “anchor for the reviewer”). Use a normal, friendly narrative voice similar to existing high-quality PR descriptions in this repo.

#### Suggested outline (not a rigid template)

```markdown
closes [$TICKET_ID](https://linear.app/prisma-company/issue/$TICKET_ID/$SLUG)

## Goal / purpose

<2–6 sentences: what we’re trying to make true, and why it matters>

## Before / After

```ts
// BEFORE — smallest snippet that shows the old shape
```

```ts
// AFTER — smallest snippet that shows the new shape
```

<Optional: a small mermaid diagram if lifecycle/composition is the point>

## What changed and why

- <bullet list of the meaningful changes; focus on semantics and rationale>
```

#### Content rules

- Prefer **short sections** and **concrete claims** (e.g. “imports are side-effect free because X happens only in Y”).
- Use **before/after** snippets that match real code (pull “before” from `origin/main` when helpful).
- Include only the sections that improve comprehension; don’t force sections that don’t apply.

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
