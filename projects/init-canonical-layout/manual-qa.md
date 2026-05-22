# Manual QA — init-canonical-layout

Slice DoD SDoD4. Operator: orchestrator (claude-opus-4.7).
Run date: 2026-05-22.
CLI build under test: `packages/1-framework/3-tooling/cli/dist/cli.mjs` at HEAD `6d0b8ed18`.

## Scenario 1 — fresh init scaffolds canonical `src/prisma/`

**Command** (scratch dir):

```bash
node .../cli/dist/cli.mjs init --yes --target postgres --authoring psl --no-install
```

**Result.** `ok: true`. `filesWritten` lists `src/prisma/contract.prisma` and `src/prisma/db.ts` (alongside `prisma-next.config.ts`, `prisma-next.md`, `.env.example`, `tsconfig.json`, `.gitignore`, `.gitattributes`, `package.json`). `schemaPath` reported as `src/prisma/contract.prisma`. `warnings` empty.

**Comparison vs `examples/prisma-next-demo/src/prisma/`.** Shape matches: both hold `contract.prisma` + `db.ts` at the canonical root. The demo also has `contract.json` + `contract.d.ts` — these are emit artefacts (the init output explicitly defers them to step 2 of `nextSteps`: "Emit the contract: `npx prisma-next contract emit`"), not init artefacts. Init's responsibility ends at scaffold; emit shape is out of scope for this slice.

**Verdict.** PDoD6 / SDoD4 satisfied for the fresh path. The default flip to `src/prisma/` works end-to-end.

## Scenario 2 — `--force` re-init surfaces the legacy-`prisma/` warning

**Setup.** From the same scratch dir, planted three legacy files alongside the now-canonical layout:

```
prisma/contract.prisma
prisma/contract.json
prisma/db.ts
```

**Command.**

```bash
node .../cli/dist/cli.mjs init --yes --force --target postgres --authoring psl --no-install
```

(`--force` is the user-facing flag; the internal `inputs.reinit` is set whenever `--force` runs against an existing `prisma-next.config.ts`.)

**Result.** `ok: true`. `warnings` contains a single structured entry naming every present legacy file by path with a manual-cleanup hint:

```
Legacy files from the previous default layout are still present in prisma/:
  prisma/contract.prisma
  prisma/contract.json
  prisma/db.ts
These are no longer the default location (src/prisma/ is now canonical). Remove them manually once migrated.
```

`filesDeleted` lists only the stale-skill cleanup (`.agents/skills/prisma-next/SKILL.md`) — no legacy `prisma/` entry. `ls prisma/` post-run confirms the legacy directory is byte-for-byte intact.

**Verdict.** FR4 detect-and-warn behaves as specified: detection fires only under `--force`, the warning names each present file, and zero deletion side-effects occur.

## Notes / follow-ups

- The user-visible flag is `--force`; the internal symbol is `inputs.reinit`. The slice spec, dispatch brief, and test names all use "reinit" terminology, which is consistent with the implementation but worth keeping in mind when describing the behaviour to downstream users (PR description should use `--force`, not `--reinit`).
- No regressions surfaced during either run. The `nextSteps` list reads cleanly with the new canonical path baked in.
