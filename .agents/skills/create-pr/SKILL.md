---
name: create-pr
description: Creates a GitHub PR with a Linear-ticket-prefixed title and a decision-led, narrative description for prisma-next. Use when the user wants to create a pull request, open a PR, or submit changes for review.
---

# Create PR Skill

## Instructions

### Step 1: Gather Context

1. Run `git log main..HEAD --oneline` to see all commits on the current branch (fallback: `git log origin/main..HEAD --oneline`).
2. Run `git diff main...HEAD --stat` to see which files changed (fallback: `git diff origin/main...HEAD --stat`).
3. Run `git diff main...HEAD` to read the full diff (fallback: `git diff origin/main...HEAD`).
4. Check for local-only changes that won't be in the PR unless committed:
   - `git status -sb`
   - If there are uncommitted changes, explicitly call out that `gh pr create` can proceed but those changes will not be in the PR.

### Step 2: Ask for Linear Ticket

Ask the user for the Linear ticket URL (e.g., `https://linear.app/prisma-company/issue/TML-1859/pn-add-more-parameterized-types`).

Extract from the URL:
- `$TICKET_ID` — the ticket identifier (e.g., `TML-1859`)
- `$SLUG` — the trailing slug (e.g., `pn-add-more-parameterized-types`)

### Step 3: Compose the PR Title

Format:

```
$TICKET_ID: <concise title in sentence case>
```

Rules:
- Always start with the Linear ticket ID followed by `: ` (colon + space).
- Sentence case after the colon (capital first letter; rest lowercase except proper nouns, package names, types, etc.).
- No period at the end.
- Aim for under 70 characters total. Optimise for **information density**, not raw character count — a slightly longer title that names the concrete deliverable is better than a short abstract one.
- The title must convey **what concrete thing changed**, not just an abstract scope. A teammate scanning a list of PR titles should be able to tell what this PR delivers without opening it.
  - Bad: `TML-2375: expand encrypted type and operator surface` (abstract)
  - Good: `TML-2375: 5 new cipherstash codecs + EQL operator surface` (concrete)
- If the change spans multiple packages or layers, name the headline package or capability, not all of them. Secondary scopes belong in the body.

Examples:
- `TML-1859: add text codec support to sql-runtime`
- `TML-2104: handle null in jsonb columns (postgres adapter)`
- `TML-2375: 5 new cipherstash codecs + EQL operator surface`
- `TML-2456: split contract emission into two phases`

### Step 4: Compose the PR Description

The PR description must follow a **decision-led, narrative** structure. A teammate without prior context on the work should be able to read it top-to-bottom and understand what we decided, why, and how it fits together — without being overwhelmed by file lists or alternatives we ultimately rejected.

#### Required structure (in this order)

1. **Linear close line** (one line, very top):

   ```md
   closes [$TICKET_ID](https://linear.app/prisma-company/issue/$TICKET_ID/$SLUG)
   ```

2. **`## At a glance`** — a copy-pasteable code sample from real code in the branch (not invented, not pseudocode) that demonstrates the change in user-observable terms. Below the code, one short sentence that grounds the "before" state if relevant.

   - The snippet must be small enough to absorb in 10 seconds but rich enough to convey what's new. Prefer a real call-site, contract emission, query, or output shape.
   - If the change is genuinely impossible to demonstrate in code (rare — even a refactor usually changes a signature), substitute a minimal representative diff or output sample. Do **not** open with abstract prose.

3. **`## Decision`** — lead with what we decided. State the deliverable in one paragraph or a short numbered list. If the PR carries more than one substantive piece (e.g. a feature + an enabling framework change), enumerate them so the reader can't miss any. Link to ADRs inline at the points they matter.

4. **`## How it fits together`** — the narrative, built bit by bit. 3–6 numbered steps that walk the reader from substrate to delivery. Each step should have a clear job (e.g. "lift the substrate", "add the codecs", "widen the operator surface", "prove against live infra"). Inline ADR links where relevant.

5. **`## Behavior changes & evidence`** — one bullet per observable change. Each bullet:
   - Leads with the change in plain, user-observable language.
   - Anchors to **1–3 implementation files** (not all of them) using GitHub-friendly relative links.
   - Cites **1–2 evidence files** (tests / fixtures / e2e).
   - Avoid dumping every file in the package. The change map should be distributed across these bullets, not pasted as a separate section.

6. **`## Compatibility / migration / risk`** — SPI / API / behavioral compatibility notes; pre-existing flake disclosures; any expectation updates that landed alongside the change.

7. **`## Follow-ups`** — Linear tickets or doc notes for deferred work.

8. **`## Alternatives considered`** — final section. Each bullet names an alternative we genuinely weighed and why we didn't take it. Pull alternatives forward from any ADRs or design discussions so the reader doesn't have to click through. Frame as alternatives (decisions we made), not as "non-goals" (scope statements).

#### Forbidden / discouraged patterns

- **Don't open with abstract prose.** No "Intent" paragraph at the very top. The reader should hit a concrete code sample first.
- **Don't paste a "Change map" section near the top** that lists every file. File links belong distributed across the narrative steps and behavior bullets where they have context.
- **Don't dump file paths in behavior bullets.** Each bullet gets at most ~3 implementation anchors and ~2 evidence anchors. If a section needs more, it's two changes — split the bullet.
- **Don't bury major decisions inside other sections.** If the PR carries a substantive framework change alongside a feature, the framework change must be enumerated in `## Decision` so a reader can't skim past it.
- **Don't conflate "non-goals" with "alternatives considered".** Non-goals are scope statements ("we didn't ship X"); alternatives are decisions ("we considered X and chose Y because Z"). The PR ends with the latter.
- **Don't include reviewer-coaching phrases** ("anchor", "read this first", "tl;dr"). Write like a normal narrative.
- **Don't paste auto-generated review-tool comments** in the body you author. They're appended automatically by bots after creation.

#### Drafting workflow

1. Run the `.agents/skills/drive-pr-walkthrough/SKILL.md` workflow for the current branch vs base (default: `origin/main...HEAD`) and write `walkthrough.md` to disk. The walkthrough provides raw material — narrative steps, behavior changes, evidence links — but its default section order is **not** the PR shape. You will restructure it.
2. Write the PR body to disk as a working file (e.g. `wip/pr-<num>-body.md`) following the **Required structure** above. Reuse the walkthrough's narrative, behavior bullets, and evidence links where they fit; restructure to lead with the code sample and the decision, and to end with alternatives.
3. **Adjust links for GitHub**:
   - Keep helpful link text (file paths, optionally line ranges).
   - Use GitHub-friendly relative paths (e.g. `path/to/file.ts`); strip local-editor suffixes like `:12-34`.
4. Apply the **forbidden / discouraged patterns** check to the draft before showing it to the user.

### Step 5: Confirm and Create

1. Present the full title and description to the user for review.
2. After approval, ensure the branch is pushed to remote (`git push -u origin HEAD` if needed).
3. Create the PR using the body file:

```bash
gh pr create --title "$TICKET_ID: <title>" --body-file wip/pr-<num>-body.md
```

(Use `--body-file` rather than a heredoc to avoid quoting/escaping pitfalls with backticks and code samples.)

4. Return the PR URL.

## Don't Do

1. Don't paste diff stats or long file lists — focus on intention and semantics.
2. Don't write reviewer-coaching phrases ("anchor", "read this first", etc.). Prefer a normal narrative.
3. Don't open the description with prose — it must open with a real code sample under `## At a glance`.
4. Don't bury substantive secondary changes (e.g. framework reorders alongside a feature) — enumerate them in `## Decision`.
5. Don't end the description with "non-goals" — end with `## Alternatives considered`, framed as decisions you weighed.
6. Don't create the PR without showing the user the title and description first.
7. Don't guess the Linear ticket number — always ask.
8. Don't use the conventional-commit `type(scope):` title format — that's the old format. The current format is `$TICKET_ID: <title>`.
