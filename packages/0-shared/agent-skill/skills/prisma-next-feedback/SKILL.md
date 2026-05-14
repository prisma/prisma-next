---
name: prisma-next-feedback
description: File a bug report or feature request against Prisma Next at github.com/prisma/prisma-next/issues. Use for bug, bug report, file an issue, report a bug, feature request, missing feature, this should be a feature, file this, this is a bug, this is broken, surprising behaviour, this doesn't work, file feedback, send feedback, capability gap, file via prisma-next-feedback.
---

# Prisma Next — Feedback (Bug Reports + Feature Requests)

> **Edit your data contract. Prisma handles the rest.**

This skill is the *terminal* of the capability-gap routing pattern.
Every other Prisma Next skill's *What Prisma Next doesn't do yet*
entries route here when the user wants the gap closed; the skill
also fires directly on prompts like *"this is a bug"*, *"file an
issue"*, *"feature request"*.

The skill walks the agent through producing a **structured,
public-safe** issue body (no secrets, no proprietary schema) the
framework team can act on, then helps the user submit it — never
auto-submitting without explicit user confirmation.

Canonical submission surface:
<https://github.com/prisma/prisma-next/issues/new/choose>.

## When to Use

- A capability-gap entry from another `prisma-next-*` skill fired and
  the user said *"yes, file the feature request"*.
- User says *"this is a bug"*, *"file this"*, *"report this"*, *"file
  an issue against PN"*, *"send feedback"*, *"this should be a
  feature"*.
- User describes an unexpected behaviour — wrong exit code, error
  message that didn't match what happened, type signature that
  doesn't match runtime behaviour, planner refused a migration that
  looked safe — and wants it on the framework team's radar.

## When Not to Use

- User wants to fix the bug themselves in the user's own code. The
  fix lives in another skill (debug / contract / migrations /
  queries / runtime / build). Chain to the right skill first; only
  file feedback if the user explicitly wants the framework to do
  something differently.
- User wants to upgrade Prisma Next (the bug may already be fixed)
  → the `prisma-next-upgrade` skill (separately installed); this
  skill mentions it as a pre-flight check.
- User wants community help / "is this how Prisma Next does X?" →
  the matching `prisma-next-*` skill answers the question; don't
  route them to file an issue for a documentation question.

## Key Concepts

- **Public artefact.** GitHub issues are world-readable and
  archived. The body must not contain `DATABASE_URL` strings,
  internal company schema fragments, customer data in sample rows,
  or any other content the user wouldn't share publicly. The agent
  redacts before submission.
- **Bug vs feature.** A *bug* is "documented surface behaved
  unexpectedly." A *feature request* is "I want a capability that
  doesn't exist." Many capability-gap routes are feature requests.
- **The framework team needs to reproduce.** A bug report without a
  reproduction is much harder to act on. Where possible, the agent
  produces a minimal repro the team can re-run locally — ideally a
  small change against
  [`examples/prisma-next-demo`](https://github.com/prisma/prisma-next/tree/main/examples/prisma-next-demo),
  which the team already has checked out.

## Workflow

### 1. Classify

```text
the user is reporting something. is it a bug or a feature request?

bug if:
  - a documented CLI command exited with the wrong code
  - the `fix` field of an error envelope was misleading or wrong
  - a published TypeScript signature doesn't match runtime behaviour
  - the planner refused a migration that should have been valid (or
    accepted one that shouldn't have been)
  - the contract emit produced an artefact that doesn't load at
    runtime
  - any other "the documented surface did the wrong thing"

feature request if:
  - the user wants a capability that doesn't exist yet (most of the
    "what PN doesn't do yet" entries land here)
  - the user wants a better error message, an additional CLI flag,
    a new middleware, an additional bundler plugin, etc.
```

If both — a bug *and* the user wants a related feature — file two
separate issues. Mixing them makes the framework team's triage
harder.

### 2. Collect the minimum body

For **either** kind:

- **Prisma Next version**: `pnpm ls @prisma-next/postgres` (or
  `@prisma-next/mongo`). If the project uses a target package, that
  version is canonical.
- **Node version**: `node -v`.
- **Package manager**: `pnpm` / `npm` / `yarn` / `bun` / `deno`.
- **OS**: `darwin` / `linux` / `win32` and the version string is
  enough.

For **bug reports**, additionally:

- **The exact command** that misbehaved (e.g.
  `prisma-next migration plan --name add-email`).
- **The full output**, with `-v` if a structured error envelope is
  involved. Redact `DATABASE_URL` and any other secrets.
- **A minimal `schema.psl` / `prisma/contract.ts` excerpt** that
  reproduces the issue. Strip unrelated models. Rename customer
  domain concepts to neutral names (`User`, `Post`, `Tag`) before
  pasting.
- **Steps to reproduce**, as a numbered list.
- **Expected behaviour** — one sentence.
- **Actual behaviour** — one sentence plus the relevant output line.
- **Workaround**, if any — one sentence.

For **feature requests**, additionally:

- **Desired API or behaviour** — one paragraph. Concrete shape (CLI
  flag, config field, middleware export, plugin API) where possible.
- **Where the gap surfaces today** — which skill's *What PN doesn't
  do yet* entry triggered the request, or the workflow the user was
  trying to complete.
- **Current workaround**, if any — one sentence (and the skill body
  the user is following may already say this).

### 3. Render the body

The repository may or may not yet have GitHub Issue Forms
(`.github/ISSUE_TEMPLATE/*.yml`). The skill produces the body in the
following structured shape regardless — when the forms exist, the
fields map onto them cleanly; when they don't, the structured shape
gives the framework team a parseable artefact.

```markdown
## Summary

<one-sentence summary>

## Environment

- Prisma Next: <version>
- Node: <version>
- Package manager: <pnpm/npm/yarn/bun/deno> <version>
- OS: <darwin/linux/win32> <version>

## Steps to reproduce

1. <step one>
2. <step two>
3. <step three>

## Expected behaviour

<one sentence>

## Actual behaviour

<one sentence + relevant output line>

## Workaround

<one sentence, or "none">

## Notes

<optional — link to source skill's capability-gap entry, related
issue number, partner extension involved>
```

For **feature requests**, replace *Steps to reproduce / Expected /
Actual* with:

```markdown
## Desired behaviour

<paragraph — the API shape you'd want>

## Where the gap surfaces

<which skill / workflow brought you here>

## Workaround today

<sentence — the existing workaround from the capability-gap entry>
```

### 4. Title

- **Bug**: `bug(<area>): <one-line summary>` — e.g.
  `bug(cli): migration plan exits 0 when there is no diff`.
- **Feature request**: `feat(<area>): <one-line summary>` — e.g.
  `feat(build): first-party Next.js plugin for contract emit`.

Areas mirror the cluster of skills: `cli`, `contract`, `migration`,
`query`, `runtime`, `build`, `error`, `docs`.

### 5. Surface for confirmation

**Never auto-submit.** The agent shows the rendered title and body
to the user and asks: *"This looks good to file. Shall I submit it
to GitHub?"*. Submission only happens after explicit user approval.

### 6. Submit

Preferred:

```bash
gh issue create \
  --repo prisma/prisma-next \
  --title "<title>" \
  --body-file <(cat <<'EOF'
<the rendered body>
EOF
)
```

If `gh` is not installed: open the prefilled new-issue URL in the
browser:

```text
https://github.com/prisma/prisma-next/issues/new/choose
```

…and instruct the user to paste the rendered body. The agent can
copy the body to the clipboard via `pbcopy` (macOS), `xclip`
(Linux), or by simply printing it in the chat for the user to
copy.

### 7. Follow up

Record the issue URL in the user's project notes (or in the
project's `wip/` if there is one) so a later upgrade or related
work can reference it. If the bug is the symptom of an old version
of Prisma Next, suggest the user run `prisma-next-upgrade` (the
separately-installed upgrade skill) — many bugs are fixed in
newer releases.

## Common Pitfalls

1. **Auto-submitting without confirmation.** Always show the body
   first. The user owns the public-facing artefact, not the agent.
2. **Pasting `DATABASE_URL` or other secrets into the body.**
   `redact` aggressively. Replace with `postgresql://USER:PASS@HOST/DB`
   placeholders.
3. **Pasting a customer's domain schema.** Rename models and
   fields to neutral names before the body goes into a public
   issue.
4. **Filing a documentation question as a bug.** Documentation
   questions belong in another skill or in a GitHub Discussion (if
   the repo enables them). Bugs are about the surface misbehaving.
5. **Conflating bug + feature in one issue.** File two. Mixed
   issues are hard to triage and hard to close.
6. **Filing without a version.** "I'm using Prisma Next, it's
   broken" without the version makes triage hopeless. The version
   is the cheapest piece of context to capture; always include it.

## What Prisma Next doesn't do yet

- **First-class GitHub Issue Forms**
  (`.github/ISSUE_TEMPLATE/*.yml`). The repository may not yet
  expose them. Until it does, the skill produces the structured
  body inline. If you want first-class issue forms in the
  repository, file a feature request — via this skill, of course.
- **In-product feedback channel.** No `prisma-next feedback` CLI
  command. The GitHub Issues page is the canonical surface. If
  you want a CLI-side feedback command, file a feature request via
  this skill.
- **Anonymous / telemetry-driven bug capture.** Prisma Next does
  not phone home and does not collect crash reports. The user
  controls every report. If you want to enable opt-in telemetry,
  file a feature request via this skill.

## Reference Files

- <https://github.com/prisma/prisma-next/issues/new/choose> — the
  canonical submission surface.
- <https://cli.github.com/manual/gh_issue_create> — the `gh`
  command reference.

## Checklist

- [ ] Classified as bug or feature request (not both in one issue).
- [ ] Environment block present: PN version, Node, package
      manager, OS.
- [ ] Reproduction is minimal, public-safe, secret-free.
- [ ] Schema fragments renamed to neutral domain names.
- [ ] Title in conventional-commit form (`bug(area): …` /
      `feat(area): …`).
- [ ] Body shown to the user for confirmation before submission.
- [ ] Submitted via `gh issue create` (preferred) or via the
      prefilled new-issue URL.
- [ ] Issue URL captured for future reference.
- [ ] Suggested `prisma-next-upgrade` if the bug may already be
      fixed in a newer release.
