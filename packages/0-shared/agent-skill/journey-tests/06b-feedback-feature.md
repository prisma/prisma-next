# Journey 06b — Feedback skill: feature request via capability-gap route

**Skills under test:** `prisma-next-contract`, `prisma-next-feedback`.

**Acceptance criterion:** AC8c (feature request path) from `specs/usage-skill.spec.md`.

## Setup

A `prisma-next init`-scaffolded project.

## Prompt sequence

First prompt (originates the route):

> add a validation: email must contain '@'

Expected: `prisma-next-contract` fires, names the validations capability gap, names the arktype / zod workaround, and routes the user to `prisma-next-feedback` for the feature request.

Second prompt (after the user says yes to the route):

> yes, file the feature request

## Expected agent behaviour

- [ ] On the first prompt, `prisma-next-contract` activates and does not confabulate a `@validates` PSL attribute.
- [ ] On the routing offer, the agent surfaces the *What PN doesn't do yet* entry plus the offer to file via `prisma-next-feedback`.
- [ ] On the second prompt, `prisma-next-feedback` fires.
- [ ] Agent classifies as **feature request** (not a bug).
- [ ] Agent produces the body in the feature-request shape: *Desired behaviour* / *Where the gap surfaces* / *Workaround today*.
- [ ] *Where the gap surfaces* references back to `prisma-next-contract`'s *What PN doesn't do yet* entry on validations.
- [ ] Title in `feat(area): summary` form, e.g. `feat(contract): first-class field-level validations in PSL`.
- [ ] User is prompted for confirmation before submission.
- [ ] On user confirmation, submitted via `gh issue create` or via the prefilled new-issue URL.

## Success criteria

- [ ] No fabricated `@validates` API in any prose or code the agent produces.
- [ ] Body's *Workaround today* references arktype / zod (matching the source skill's gap entry).
- [ ] Body's *Where the gap surfaces* references the source skill (`prisma-next-contract`).
- [ ] User confirmation step happened before submission.
