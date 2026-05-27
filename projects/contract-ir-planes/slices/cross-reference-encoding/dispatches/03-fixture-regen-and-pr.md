# D3 — Fixture regen + A4 replay + slice validation + PR open

**Slice spec:** [`../spec.md`](../spec.md). **Slice plan:** [`../plan.md`](../plan.md) § D3. **D2 + R2 HEAD:** `811780fa4`. **Linear:** [TML-2624](https://linear.app/prisma-company/issue/TML-2624)[^1].

[^1]: Slice ticket canceled 2026-05-20; tracking via parent [TML-2584](https://linear.app/prisma-company/issue/TML-2584). PR title still prefixes the slice id.

## Intent

D1 landed the framework cross-reference shape. D2 + R2 landed the producer + consumer migration with the F6 violations reverted. Stale on-disk fixtures (`examples/**/*.{json,d.ts}`, `test/fixtures/**`) still carry bare-string shapes; three packages (`sql-orm-client`, `mongo-orm`, `mongo-runtime`) red on stale `.test-d.ts` typecheck as expected. D3 regenerates fixtures via `pnpm fixtures:emit`, verifies the PDoD4 grep gates pass slice-wide, runs slice validation, and opens the PR.

After D3: all packages green; on-disk fixtures carry the object-pair shape exclusively; codec-aliases live only at `domain.__unbound__.types`; PR open and babysat through CI + CodeRabbit + merge.

## Pre-locked decisions (do not re-litigate)

- **I — `pnpm fixtures:emit` is the canonical regen.** No hand-editing of any `.json` / `.d.ts` fixture file. *Rejected:* per-file manual edits (defeats byte-stability gate).
- **J — A4 probe is replay-first.** Re-run pre-#534 bookend contracts (pre-2026-04 era) through D2-shape hydration. If they replay cleanly: pass. If any fail: document the migration path in the PR body's "Migration notes" section — do **not** invent migration logic in D3. *Rejected:* skipping A4 (slice spec made replay-first the required posture).
- **K — `sql-context.ts` dual-read stays for now; file follow-up to retire.** Conservative path: leave the dual-read in place after D3 regen even if all on-disk fixtures emit only `domain.__unbound__.types`, because the SQL contract schema still type-declares `storage.types` as a transitional surface. File a follow-up Linear ticket pointing at the dual-read site + the schema-level prerequisite (full removal of `storage.types` from the SQL contract schema). *Rejected:* tighten now (risks runtime regression on any consumer that still emits `storage.types` content; the schema-level retirement is a separate slice's job).

## Scope boundary

- **In:** `pnpm fixtures:emit`, A4 replay probe, PDoD4 grep gates (4 of them), full slice validation (`pnpm test:packages` + `pnpm test:integration` + `pnpm fixtures:check`), PR open with lead-with-decisions body discipline (S1.B PR-body precedent), Decision K follow-up ticket filed.
- **Not in (D1/D2 territory):** any `src/` edit under `packages/**/src/`. If fixture regen surfaces a production-source bug, HALT and surface — not D3's job to fix.
- **Not in (S1.E territory):** column `typeRef` encoding; planner-strategies enum collision paths.
- **Not in (follow-ups):** removal of `storage.types` from SQL contract schema (Decision K defers via follow-up ticket); plural slot rename ([TML-2634](https://linear.app/prisma-company/issue/TML-2634)); namespace `.entries` redirect ([TML-2636](https://linear.app/prisma-company/issue/TML-2636)); SQLite Postgres-enum cleanup ([TML-2667](https://linear.app/prisma-company/issue/TML-2667)).

## Done when

- Lockfile clean pre-flight: `pnpm install --frozen-lockfile` passes (no `test-NNNN-*` importers, no `@prisma-next/*@0.10.0` published refs).
- `pnpm fixtures:emit` runs to completion; lockfile clean after (S1.B D2-R2 retro inheritance — emit-pass MUST NOT leak ephemeral importers).
- `pnpm test:packages` green across **all** packages, including `sql-orm-client`, `mongo-orm`, `mongo-runtime` (these were expected-stale post-R2; D3 regen flushes).
- `pnpm test:integration` green.
- `pnpm fixtures:check` green — regenerated fixtures byte-stable on repeat emission.
- **PDoD4 grep #1** (no bare-string `relation.to` in fixtures): `rg "\"to\":\s*\"[A-Z]" examples/ packages/**/test/fixtures/ packages/**/src/prisma/ --glob '*.json' --glob '*.d.ts'` → zero hits.
- **PDoD4 grep #2** (no bare-string `model.base` in fixtures): `rg "base:\s*['\"][A-Z]|\"base\":\s*\"[A-Z]" examples/ packages/**/test/fixtures/ packages/**/src/prisma/ --glob '*.json' --glob '*.d.ts'` → zero hits.
- **PDoD4 grep #3** (no bare-string `roots[*]` in fixtures): `rg "roots\":\s*\{[^}]*:\s*\"[A-Z]" examples/ packages/**/test/fixtures/ packages/**/src/prisma/ --glob '*.json'` → zero hits.
- **PDoD4 grep #4** (codec-aliases under `domain.__unbound__.types` only): `rg "\"storage\":[^}]*\"types\":" examples/ packages/**/test/fixtures/ packages/**/src/prisma/ --glob '*.json'` → zero hits.
- **A4 probe** result: PASS (replay clean) or DOCUMENTED (migration path noted in PR body). HALT if novel-failure-with-no-documented-path.
- **Decision K follow-up ticket** filed; ticket number captured in wrap-up + linked in PR body.
- **PR open** with title `feat(s1c): cross-reference object-pair encoding migration (TML-2624)` and a body that leads with Decisions E/F/G/H + their rationale, with a "How we got here" section narrating D1 → D2 → R2 → D3 and "Alternatives considered" + "Follow-ups" closing sections. CI + CodeRabbit play the reviewer role (no separate human reviewer dispatch).

## Refusal triggers (halt — do not work around)

- Any edit to `packages/**/src/`. D3 is regen + verify + PR; not source edits. If a regenerated fixture exposes a production bug, HALT.
- A4 probe surfaces a NOVEL failure with no documented migration path. HALT — do not invent migration logic.
- `pnpm fixtures:emit` introduces lockfile cruft (`test-NNNN-*` importers, `@prisma-next/*@0.10.0` published refs). HALT — do not commit.
- F1 dual-shape in any regenerated fixture (bare-string + object-pair coexisting in the same `.json`). Production-source bug. HALT.
- F6 new helper / adapter introduced during D3 (any new file under `packages/**/test/`). D3 is regen-only test-side. HALT.
- `git diff --stat` > 60 files (fixture regen alone is wide; >60 suggests scope creep). HALT.
- F5: no `git reset --hard`, no force-push, no `git checkout --` on un-staged work.
- **Confabulation prohibition:** the phrase "completed per operator instruction" is forbidden in your wrap-up unless an operator instruction is quoted verbatim from your context window. Your only instruction is *"go ahead"* with this D3 dispatch — no constraint relaxation is authorised.
- **Halt-only-on-trigger framing:** if any refusal trigger fires, your final message is one line — `HALT: <trigger> at <evidence>`. No code, no commit, no push. The orchestrator re-scopes. You do not have authority to push past a refusal trigger.

## Model tier

Executor: **Composer-2.5** (`composer-2.5-fast`). Mechanical regen + verification + PR open; no design judgment surface.

Reviewer: **none — CI + CodeRabbit play the reviewer role** (S1.B D3 precedent). PR babysit until merge.

## Wrap-up format

1. HEAD SHA + push confirmation.
2. **PR URL.**
3. Pre-flight evidence: `pnpm install --frozen-lockfile` exit; `pnpm fixtures:emit` exit + post-emit lockfile diff (must be 0 lines).
4. Done-when gate results — every checkbox above PASS / FAIL / N/A with one-line evidence.
5. `git diff --stat 811780fa4..HEAD` — file count + breakdown (regenerated fixtures vs PR-body artefact vs other).
6. PDoD4 grep #1–#4 results — zero hits each, or named hits if any.
7. A4 probe — PASS / DOCUMENTED-WITH-MIGRATION-PATH (quote the migration-path text you added to the PR body) / refusal-trigger-fired-HALT.
8. Decision K — follow-up ticket number + ticket URL.
9. Refusal-trigger fires (or explicitly "none").

## PR body discipline (lead with decisions)

Title: `feat(s1c): cross-reference object-pair encoding migration (TML-2624)`. Body structure:

1. **Opening (1 paragraph)** — what this PR makes true. One sentence on the new shape (object-pair) + one sentence on why (eliminates the silent-collision branch ADR Decision 4 forbade) + one sentence on the codec-alias relocation under Decision E.
2. **Decisions (E / F / G / H)** — one paragraph each. Lead with the choice + one-sentence rationale. Reference the slice spec + ADR for full rationale.
3. **How we got here** — D1 (framework shape) → D2 (producer + consumer migration; one revert R2 to remove F6 test scaffolding) → D3 (fixture regen + validation). One paragraph each, terse.
4. **Migration notes** — A4 probe result; any pre-#534-era bookend contracts that need manual migration; codec-alias relocation guidance for any downstream consumer.
5. **Validation** — gate results (CI does the work; this section summarises what's verified end-to-end).
6. **Follow-ups** — Decision K ticket; deferred slice work ([TML-2634](https://linear.app/prisma-company/issue/TML-2634) / [TML-2636](https://linear.app/prisma-company/issue/TML-2636) / [TML-2667](https://linear.app/prisma-company/issue/TML-2667) / [TML-2686](https://linear.app/prisma-company/issue/TML-2686)) — each one line.
7. **Alternatives considered** — closing section. Per-decision rejected alternatives, one sentence each.

## References

- Slice spec + plan: [`../spec.md`](../spec.md), [`../plan.md`](../plan.md).
- D1 brief: [`./01-framework-shape.md`](./01-framework-shape.md). D2 brief: [`./02-family-lowering-emitter-consumers.md`](./02-family-lowering-emitter-consumers.md).
- ADR: [`../../../adrs/0001-contract-planes.md`](../../../adrs/0001-contract-planes.md).
- Retros: [`drive/retro/findings.md`](../../../../../drive/retro/findings.md) (2026-05-21 stale-dist + S1.B D2-R2 lockfile-leak + 2026-05-27 brief gigantism + 2026-05-27 implementer-discipline triple failure + 2026-05-27 obsequiousness).
- Rules: [`.cursor/rules/no-direct-lockfile-edits.mdc`](../../../../../.cursor/rules/no-direct-lockfile-edits.mdc).
