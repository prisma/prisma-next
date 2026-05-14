# Journey 06 — Feedback skill: bug report

**Skill under test:** `prisma-next-feedback`.

**Acceptance criterion:** AC8c (bug report path) from
`specs/usage-skill.spec.md`.

## Setup

A `prisma-next init`-scaffolded project (any target).

## Prompt

> I want to report that `prisma-next migration plan` exits 0 even when
> the planner found no diff — that's surprising

## Expected agent behaviour

- [ ] Skill matcher fires on `prisma-next-feedback`.
- [ ] Agent classifies as a **bug report** (the CLI exit code is
      arguably wrong vs. documented behaviour). Not a feature request.
- [ ] Agent produces a minimal reproduction:
  - A small `schema.psl` excerpt (renamed to neutral domain names
    like `User`, `Post`).
  - The exact command (`prisma-next migration plan --name no-op`)
    and its full output.
  - Steps to reproduce as a numbered list.
- [ ] Agent collects the environment block:
  - Prisma Next version (from
    `pnpm ls @prisma-next/postgres` or similar).
  - Node version (`node -v`).
  - Package manager + version.
  - OS.
- [ ] Agent renders the issue body in the structured shape from
      FR19b: *Summary / Environment / Steps to reproduce / Expected /
      Actual / Workaround*.
- [ ] Agent renders a conventional-commit title:
      `bug(cli): migration plan exits 0 when there is no diff`.
- [ ] Agent surfaces the rendered title + body to the user for
      confirmation **before** submitting.
- [ ] On user confirmation, agent submits via `gh issue create`
      (preferred) or opens the prefilled new-issue URL in the browser.
- [ ] Agent records the issue URL in the user's project notes.

## Success criteria

- [ ] No `DATABASE_URL` strings or secrets in the body.
- [ ] No customer-domain model names in the body.
- [ ] Body contains all required fields (Summary, Environment,
      Reproduction, Expected, Actual, Workaround).
- [ ] Title is in conventional-commit form.
- [ ] User was prompted for confirmation before submission.
- [ ] Issue submitted to `prisma/prisma-next` (verified by URL in
      the agent's response).
