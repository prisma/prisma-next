# Journey 02g — Resolve a diamond-convergence conflict

**Skills under test:** `prisma-next-migration-review`, `prisma-next-migrations`.

**Acceptance criterion:** AC5g.

## Setup

Topic branch with a planned migration. Meanwhile, `main` advanced
with a different migration from another developer.

## Prompt

> I rebased my branch onto main and now `migration apply` fails. My migration says it's from hash X but the previous one wrote hash Y.

## Expected agent behavior

The 5-step diamond-convergence procedure:

- [ ] **1.** Rebase the topic branch onto `main` (likely already done).
- [ ] **2.** `rm -rf` the topic branch's locally-planned migration directory.
- [ ] **3.** Run `contract emit` then `migration plan --name <slug>` to re-plan from the post-merge contract head.
- [ ] **4.** Open the old migration from git history; port any custom data-transform logic into the new `migration.ts`.
- [ ] **5.** Self-emit (`node migrations/<dir>/migration.ts`).

## Success criteria

- [ ] New migration chains cleanly from `main`'s head.
- [ ] Custom data transforms (if any) preserved.
- [ ] `migration status` reports a clean chain.
- [ ] Agent did NOT attempt to manually rewrite `migration.json` hashes.
