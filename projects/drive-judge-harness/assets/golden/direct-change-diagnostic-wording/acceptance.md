# Acceptance set — direct-change-diagnostic-wording

## Expected triage verdict

`direct-change`. The change is one diagnostic string + its test; it is verifiable in roughly 30 seconds of reading the diff. A correct run does **not** stand up a project, write a slice spec, or open a multi-dispatch plan for this.

## Expected outcome / requirements

A correct run must:

- **AC-1** — Locate the existing unrecognized-namespace diagnostic and change only its message text (and any snapshot/assertion pinning that text).
- **AC-2** — The new message names the specific namespace the user referenced.
- **AC-3** — The new message instructs the user to add the extension pack to `extensionPacks` in `prisma-next.config.ts`.
- **AC-4** — The phrase "namespace not composed" no longer appears in the user-facing message.
- **AC-5** — No behaviour change beyond the message text; the diagnostic still fires under the same condition.

## Correctness oracle

- **Mechanical:** `pnpm typecheck` + the touched package's tests pass; the diagnostic's test asserts the new wording.
- **Requirements:** AC-1…AC-5 above, checked against the diff.
- **Intent:** the message reads as actionable guidance to a user who hit it — it names the namespace and the exact config key to edit. The repo's `namespace-diagnostic-wording` rule is the wording oracle.

## Failure modes a correct run avoids

- Over-engineering: introducing a new diagnostic code, a config flag, or a project workspace for a one-string change (scope inflation).
- Changing the firing condition or downgrading the diagnostic to a warning.
- Leaving "namespace not composed" in place anywhere user-facing.
