# Project learnings — sqlite-mongo-transactions

Working ledger of patterns surfaced during this run. Reviewed at close-out; cross-cutting lessons migrate to durable docs, project-local ones drop with the folder.

## D1 (sqlite facade transaction)

- **Stale-workspace false alarm after branch rebase.** Cutting a branch from a newer `origin/main` without re-running `pnpm install` + `pnpm build` produced 5 test failures + typecheck errors in `@prisma-next/sqlite` that looked like a red main (blamed on TML-2837). A rebuild made all gates green. Candidate durable home: a line in the worktree/branching docs or `drive/calibration/failure-modes.md` ("verify-stale-build before believing a pre-existing-red claim — run install+build first").
- **"Mirror the precedent" briefs can authorize rule violations.** The D1 brief authorized mirroring the Postgres facade's bare `as TransactionContext` cast; the reviewer caught that the `lint:casts` ratchet counts per-PR increases, so the mirrored cast would fail CI even though the precedent file carries it in the baseline. Brief-authoring lesson: precedent-transplant briefs must say "mirror the pattern, but apply current repo rules where the precedent predates them."
- **Pre-existing cleanup candidate (out of slice scope):** two old bare casts at `packages/3-extensions/sqlite/src/runtime/sqlite.ts:99-100` (plus 3 aliased-import false positives from the biome plugin). Possible tiny follow-up ticket; not a finding.

## D2 (e2e proof)

- **Postgres-only validation masked a guard gap in shared runtime code.** `withTransaction`'s escaped-result invalidation guard was only ever exercised against drivers that keep the connection alive after commit (Postgres/PGlite); SQLite's connection-closing driver bypassed it entirely. Lesson for the Mongo slices: behavioral invariants claimed by shared runtime helpers need per-driver e2e proof, not inherited trust — exactly what this slice's D2 was for, and it caught one. Candidate durable home: `drive/calibration/failure-modes.md` (variant of F13).
