# Journey 02b — Rename a column with `@hint`

**Skills under test:** `prisma-next-contract`, `prisma-next-migrations`.

**Acceptance criterion:** AC5b.

## Prompt

> Rename the `email` column on User to `emailAddress`.

## Expected agent behavior

- [ ] Edits the contract to rename the field AND adds `@hint(was: "email")`.
- [ ] Runs `contract emit`.
- [ ] Runs `migration plan --name rename-user-email`.
- [ ] Runs `migration show <slug>` and confirms the plan uses `ALTER TABLE ... RENAME COLUMN`, not `DROP` + `ADD`.
- [ ] Applies.

## Success criteria

- [ ] Migration uses RENAME, not DROP+ADD.
- [ ] No data lost.
- [ ] Agent did NOT skip the `@hint` step.
