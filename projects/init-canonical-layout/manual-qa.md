# Manual QA — init-canonical-layout

Slice DoD SDoD4. Operator: implementer (review-r2 rework).
Run date: 2026-05-22.
CLI build under test: `packages/1-framework/3-tooling/cli/dist/cli.mjs` at HEAD post-rework (D2 reverted, F01–F03 landed).

## Scenario 1 — fresh init scaffolds canonical `src/prisma/`

**Command** (scratch dir):

```bash
node .../cli/dist/cli.mjs init --yes --target postgres --authoring psl --no-install --json
```

**Result.** `ok: true`. `filesWritten` lists `src/prisma/contract.prisma` and `src/prisma/db.ts` (alongside `prisma-next.config.ts`, `prisma-next.md`, `.env.example`, `tsconfig.json`, `.gitignore`, `.gitattributes`, `package.json`). `schemaPath` reported as `src/prisma/contract.prisma`. `warnings` empty.

**On-disk verification.** `ls src/prisma/` shows `contract.prisma` + `db.ts` only (no legacy `prisma/` directory created).

**Comparison vs `examples/prisma-next-demo/src/prisma/`.** Shape matches: both hold `contract.prisma` + `db.ts` at the canonical root. The demo also has `contract.json` + `contract.d.ts` — these are emit artefacts (the init output explicitly defers them to step 2 of `nextSteps`: "Emit the contract: `npx prisma-next contract emit`"), not init artefacts. Init's responsibility ends at scaffold; emit shape is out of scope for this slice.

**Verdict.** PDoD6 / SDoD4 satisfied for the fresh path. The default flip to `src/prisma/` works end-to-end after review-r2 rework.

## Scenario 2 removed

Scenario 2 removed: D2 detect-and-warn descoped post-review (see `design-decisions.md` § D5).

## Notes / follow-ups

- The user-visible flag is `--force`; the internal symbol is `inputs.reinit`. F07 tracks renaming `inputs.reinit` → `inputs.force` as a follow-up ticket (out of scope for this PR).
- No regressions surfaced during the fresh-init run. The `nextSteps` list reads cleanly with the canonical path baked in.
