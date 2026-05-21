# Design decisions log

> Numbered, chronological log of design decisions for this project. Each entry names the trigger (operator question / falsified assumption / obstacle), the decision reached, and the affected artefacts. Discussion personas and synthesis from `drive-discussion` land here.

## D0 — Scaffolding

**Trigger:** Project creation. Operator asked for design discussion before implementation.

**Decision:** Single-slice project under `projects/init-canonical-layout/` rooted on Linear TML-2532. Discussion personas: `architect` + `principal-engineer` (lenses chosen for the layout-convention question and blast-radius across tests + adjacent agent-skill cluster).

**Affected:** `projects/init-canonical-layout/` scaffolded.

## D1 — Single source of truth for the canonical scaffold root

**Trigger:** Architect pass — the bug exists because three call sites independently declare the same fact (`src/prisma/...`); patching the immediate symptom would leave the structural cause intact.

**Decision:** Introduce `DEFAULT_PRISMA_DIR = 'src/prisma'` in `packages/1-framework/1-core/config/src/config-types.ts`. Re-express `DEFAULT_CONTRACT_OUTPUT` as `${DEFAULT_PRISMA_DIR}/contract.json`. Update `defaultSchemaPath()` (init templates) and the runtime fallback in `command-helpers.ts:102` to derive from `DEFAULT_PRISMA_DIR` rather than hardcode the path. Names the *directory convention* (not "the path to contract.json with dirname() applied"), so each consumer reaches for the concept it actually cares about.

**Affected:**
- `packages/1-framework/1-core/config/src/config-types.ts`
- `packages/1-framework/1-core/config/src/exports/config-types.ts` (export the new constant)
- `packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates.ts` (`defaultSchemaPath`)
- `packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts:102` (runtime fallback)
- Init test surface (~6 files) and `command-helpers.test.ts`.

## D2 — Re-init detect-and-warn for legacy `prisma/` layout

**Trigger:** PE pass — users who hit the bug will run `init --reinit` to pick up the fix and end up with both layouts side-by-side with no signal the legacy one is dead.

**Decision:** On `init --reinit`, detect co-located legacy `prisma/contract.{prisma,ts,json,d.ts}` or `prisma/db.ts` files alongside the now-default `src/prisma/...` scaffold; emit a structured warning naming the orphaned files and how to clean up manually. **Do not delete** (legacy `prisma/` may contain user-added content; deletion is unsafe). The literal `'prisma'` lives inline in the new branch with a one-line comment; not promoted to a named constant.

**Affected:**
- `packages/1-framework/3-tooling/cli/src/commands/init/init.ts` (precondition phase: new warning branch).
- New test asserting the detect-and-warn path under `--reinit`.

## D3 — Slice scope: this PR ships D1 + D2 + the touchpoint sweep

**Trigger:** PE pass surfaced three stale references (`index.ts:75` flag help, `contract-infer.ts:107` example, `hygiene-gitattributes.ts` comments) not covered by the constant introduction; question whether they ship as one slice or split.

**Decision:** One slice, one PR — ships the constant introduction, the detect-and-warn, the touchpoint sweep, and the test surface updates together. Splitting any of these creates intermediate states where the project tells inconsistent stories about the default layout. The detect-and-warn is meaningful only against the new default and cannot be tested independently.

**Affected:** Slice scope as enumerated in `plan.md`.

## D4 — `@prisma-next/agent-skill` cluster coordination is moot

**Trigger:** PE pass surfaced cluster-coordination concern (originally listed in ticket); operator noted cluster was deleted.

**Decision:** No coordination needed. Verified via `ls packages/3-extensions/agent-skill` (no such directory) and Grep for residual references in init.

**Affected:** None.
