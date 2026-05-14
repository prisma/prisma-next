# Journey 04 — Aggregate-contract monorepo

**Skills under test:** `prisma-next-contract`, `prisma-next-runtime`.

**Example app:** `examples/multi-extension-monorepo/` (or any aggregate-contract project).

**Acceptance criterion:** AC9 from `specs/usage-skill.spec.md`.

## Prompt

> Add a `Post` model to the blog package.

## Expected agent behavior

- [ ] Locates the blog package within the monorepo.
- [ ] Reads the blog package's own `prisma-next.config.ts` (not the root one).
- [ ] Edits the blog package's contract source (its `schema.psl` or `contract.ts`).
- [ ] Runs `pnpm prisma-next contract emit` from the blog package directory.
- [ ] Does NOT touch any other package's contract.

## Success criteria

- [ ] Only the blog package's contract source changed.
- [ ] Only the blog package's `contract.json` / `contract.d.ts` updated.
- [ ] The aggregate root's contract is unchanged (or refreshed only after a deliberate aggregate emit).
- [ ] Agent did NOT edit the wrong package's schema.
