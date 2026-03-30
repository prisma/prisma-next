---
name: drive-pr-walkthrough
description: Write an intent-first walkthrough (semantic narrative) of a PR/branch or commit range - the overall purpose, the sequence of conceptual steps, the concrete behavior changes, and links to both implementation touchpoints and tests as evidence. Use during branch/PR review when the user asks for a walkthrough, narrative of changes, semantic diff, intent of commits, or “what changed and why” (not a file-by-file diff recap).
---

# Walkthrough

## What this skill produces

A **semantic narrative** of a change set: what the author was trying to achieve, what meaningfully changed in system behavior, and why.

**Default output is written to disk as a Markdown file.** In chat, only print a short pointer to that file.

**Do not paste the full walkthrough into chat unless the user explicitly asks** (e.g. “paste it here”, “inline it”, “show it in the response”).

It must link to:

- **Implementation**: where the behavior changed
- **Tests**: where that behavior is specified/verified (tests are evidence for the same intent, not a separate “thread”)

Avoid:
- File-by-file changelogs
- Process narration (“tests first, then implementation”)
- Treating tests as their own purpose

# Instructions

## Default scope (PR-style)

If the user doesn’t specify scope, treat the walkthrough as **everything in the current branch vs its base**:

- Prefer `origin/main...HEAD`
- Fallback to `main...HEAD`

Also collect the commit list for context:
- `git log --oneline <base>..HEAD`

## Output location (write to disk)

Unless the user specifies an output path, write the walkthrough to a file on disk using these defaults:

- **PR number available (recommended)**: `docs/reviews/pr-<PR_NUMBER>/walkthrough.md`
  - Create the directory if missing.
- **Spec folder provided by user**: `<spec-folder>/walkthrough.md`
- **No spec + no PR number**: `wip/walkthrough.md` (local scratch; never commit)

After writing the file, respond in chat with a short confirmation like:

```
Walkthrough written.

✅ `docs/reviews/pr-157/walkthrough.md`
```

If the user asked for both:
- a file on disk, and
- an inline copy,

then do both (file first), but keep the chat output to the minimum the user asked for.

## Prefer explicit intent sources (when available)

If the walkthrough is for a PR/branch review, prefer **explicit intent** over inference from code:

- **PR title/body** (goal, constraints, non-goals, rollout notes)
- **Linked Linear ticket** (goals/non-goals, acceptance criteria, follow-ups)
- **Merge commit message** (often contains PR number/link or ticket ID)
- **Branch name** (often embeds a ticket ID, e.g. `tml-1837-...` or `ABC-1234-...`)

Use these to fill sections like **Intent**, **Non-goals**, **Compatibility/risk**, and **Follow-ups**. If intent sources aren’t available, keep those sections concise and label them as inferred (or omit them if you can’t support them).

Practical defaults when a PR exists:
- `gh pr view --json title,body,url`
- If the PR body links Linear, use that content as the source of truth for goals/non-goals when present.

If you’re walking through a historical merge commit:
- Look for `Merge pull request #1234` or `(#1234)` in the merge commit message, then:
  - `gh pr view 1234 --json title,body,url`

## Workflow

1. **Acquire context**
   - Read the commit list (`git log --oneline <base>..HEAD`).
   - Read the diff stats (`git diff --stat <base>...HEAD`) to understand breadth.
   - Read the full diff (`git diff <base>...HEAD`) to understand meaning.

2. **Extract intent and threads**
   - Default to **one overarching intent** (common for PRs).
   - If there are multiple independent efforts, split into **2–4 threads** max.
   - Name each thread with a behavior-level label (not “refactor tests”).

3. **Derive behavior changes (semantic units)**
   - Prefer **plain-English additive phrasing** when the change is primarily an addition.
     - Good: “Adds a reusable PSL parser that produces a deterministic AST and structured diagnostics with spans.”
     - Avoid: “no parser → deterministic AST …” (this reads like a state transition and is easy to misinterpret).
   - Use “**Before → After**” when there is a meaningful **behavioral change** to an existing system surface (observable behavior, API, guarantees, error semantics, invariants).
   - Don’t force a “Before” clause when there isn’t a concrete prior behavior to point at; state what was added/introduced instead.
   - Separate **behavior changes** from **refactors**. Refactors can be described as “no behavior change” and still linked.

4. **Map each behavior change to evidence**
   - For every behavior change, gather:
     - 1–5 key **implementation touchpoints**
     - 1+ **tests** that describe/lock the behavior in
   - If tests are missing, explicitly call it out as a gap (or explain why tests are not applicable).

5. **Write the walkthrough using the template below**
   - Prefer short, concrete claims.
   - Mention mechanics only when they help explain the semantics.
   - Write it to the output location above; do not paste the full content into chat unless asked.

## Linking conventions (editor-friendly)

Use **repo-relative markdown links** so they’re clickable from within the workspace.

### Cursor IDE (when detected)

**Cursor** does not resolve `path:line` / `path:start-end` in markdown link targets to a useful location (links are effectively broken for navigation). When **any** of `CURSOR_AGENT`, `CURSOR_TRACE_ID`, or `CURSOR_CLI` is set in the environment—or when the user says the output is for Cursor—use **path-only** links:

- Link: `[path/to/file.ts](path/to/file.ts)` (no `:line` suffix on the target).
- When readers need a line hint, put it **outside** the link as plain text, e.g. ` — lines 12–34` or on the next line: `Lines 12–34.`

Do **not** put `(L12–L34)` in the link text when using path-only targets (it implies a jump that will not work).

### Other environments (not Cursor)

When Cursor is **not** detected and the artifact is not Cursor-only:

- Preferred format (encodes a range): `[path/to/file.ts (L12–L34)](path/to/file.ts:12-34)`
- Fallback: start line only `[...](path/to/file.ts:12)` or path only `[...](path/to/file.ts)`

Notes:

- **GitHub** blob pages support `#L12-L34` anchors, e.g. `[file.ts (L12–L34)](https://github.com/ORG/REPO/blob/SHA/file.ts#L12-L34)`.
- Avoid `vscode://file/...` (not portable).

### Snippets

For the most important 1–3 snippets total, include a small fenced excerpt when it clarifies the change; line numbers in **snippet** fences remain fine. Prefer path-only file links in the narrative when running under Cursor as above.

## Output template (use this structure)

````markdown
## Key snippet(s) (optional)
Use snippets only when they materially clarify the change.

- If the change is a **modification**, use **Before / After** and keep both snippets small.
- If the change is an **addition**, prefer a single **New** snippet (omit “Before” entirely).

### Before / After (when modifying existing behavior)
```ts
// BEFORE — smallest snippet that captures the old shape
```

```ts
// AFTER — smallest snippet that captures the new shape
```

### New (when adding a new capability)
```ts
// NEW — smallest snippet that captures the new capability
```

## Sources (optional but recommended when available)
- PR: <link or `#1234`>
- Linear: <ticket link or ticket id>
- Commit range: `<base>...HEAD` (or explicit commit list)

## Intent
<1–3 sentences: what we’re trying to make true, and why it matters>

## Change map
- **Implementation**:
  - [path/to/primary-file.ts](path/to/primary-file.ts) — lines 12–34
  - ...
- **Tests (evidence)**:
  - [path/to/test-file.test.ts](path/to/test-file.test.ts) — lines 12–34
  - ...

(In Cursor, keep links path-only and put ranges after the link as above. Outside Cursor, you may use `[file (L12–L34)](file:12-34)` instead.)

## The story
1. <Step 1: conceptual move; name the new guarantee/behavior>
2. <Step 2: follow-on change; why it was necessary>
3. ...

## Behavior changes & evidence
- **Behavior change A**: <Additive statement (“Adds X that …”) OR Before → After statement>
  - **Why**: <rationale / constraint / trade-off>
  - **Implementation**:
    - [path/to/file.ts](path/to/file.ts) — lines 12–34
  - **Tests**:
    - [path/to/test.test.ts](path/to/test.test.ts) — lines 12–34

- **Behavior change B**: ...

## Compatibility / migration / risk
- <breaking changes, rollout notes, backfills, toggles, perf implications, etc. If none, say “None noted.”>

## Follow-ups / open questions
- <anything intentionally deferred, cleanup left behind, or questions for reviewers. If none, omit.>

## Non-goals / intentionally out of scope
- <1–3 bullets, if applicable>
````

## Quality checklist (self-review before sending)

- [ ] The walkthrough reads like **intent and behavior**, not a file list.
- [ ] Additive changes are phrased as “Adds/Introduces …” (avoid “no X → …” shorthand).
- [ ] Each behavior change has **tests linked** (or an explicit “no tests” rationale).
- [ ] Tests are presented as **evidence for behavior**, not as a separate storyline.
- [ ] The narrative has a small number of semantic steps (not commit-by-commit retelling).
- [ ] Refactors are explicitly labeled as “no behavior change” where appropriate.
- [ ] Any compatibility/migration risk is called out (or explicitly noted as absent).
- [ ] Follow-ups / open questions are captured when they meaningfully affect review or rollout.
- [ ] The walkthrough is **written to disk**, and chat output is only a pointer (unless the user asked to inline it).
- [ ] **Cursor**: file links are path-only with line ranges in plain text after the link (see Linking conventions). **Else**: line-range links are acceptable when they resolve for the reader.

## Examples

Mini-example (shape only):

````markdown
## Before / After (intention in code)
```ts
// BEFORE
```

```ts
// AFTER
```

## Intent
Tighten driver initialization so runtime instantiation is explicit and testable.

## Behavior changes & evidence
- **Driver construction is deferred until runtime creation**: eager side effects → explicit instantiation
  - **Implementation**:
    - [packages/foo/src/runtime.ts](packages/foo/src/runtime.ts) — lines 10–42
  - **Tests**:
    - [packages/foo/test/runtime.test.ts](packages/foo/test/runtime.test.ts) — lines 15–60
````
