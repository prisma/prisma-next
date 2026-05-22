# D2 — Fixture regeneration + A4 replay probe + JSDoc fold-ins

> **Brief format & scope discipline.** Pure regen + verification dispatch. Stay within the fixture inventory + the two JSDoc lines + the one test-revert listed below. **Do not** touch any other implementation file. **Do not** rerun the slot rename — that landed in D1 (`0339f348e`). **Do not** edit any new file under `packages/2-sql/**/src/`, `packages/1-framework/**/src/` (other than the two JSDoc lines), or `packages/3-targets/3-targets/postgres/src/` — if the regen surfaces an emit defect needing a source fix, halt and report (F7).
>
> **Slice spec:** [`projects/contract-ir-planes/slices/enum-migration/spec.md`](../spec.md). **Slice plan:** [`projects/contract-ir-planes/slices/enum-migration/plan.md`](../plan.md) § Dispatch 2. **Linear:** [TML-2623](https://linear.app/prisma-company/issue/TML-2623).

## Why this dispatch exists

D1 (commit `0339f348e`) hard-cut the namespace enum slot from `types` to `enum` in source. It left every on-disk `contract.json` / `contract.d.ts` carrying namespace-scoped enums stale, and `pnpm fixtures:check` is expected to fail until D2 regenerates them. D1 also introduced a temporary test-side workaround in `snapshot-read-shapes.test.ts` (three skip-paths + inline JSON construction) so D1 could land green without touching fixture data — D2 reverts that workaround once the underlying fixtures regen.

Two pre-existing JSDoc references in framework `.ts` source name `'postgres-enum'` as the example discriminator. They predate the slice (confirmed: identical hits on `origin/main`) and are stylistic leakage rather than load-bearing references. The slice plan folds the 2-line generalization into D2.

A4 replay probe: pre-#534 migration bookends carry **document-scoped** `storage.types` enums (the legacy shape, which is unrelated to D1's namespace-scoped change). Migration-replay should still pass against these bookends because D1 didn't touch document-scoped paths — A4 is a falsification probe to confirm that assumption.

## Settled decisions (don't re-question)

The slice spec's Per-dispatch DoR overlay table already settled D2's surfaces. The orchestrator's pre-flight Risk #5 (a)+(b) walk confirmed D2 is data-only + JSDoc-only + test-revert: no new framework-layer field, no new registry, no new identity-encoding structure. Walk recorded for audit at the orchestrator's dispatch turn.

1. **Fixture regen flow.** `pnpm fixtures:emit` from the repo root (or per-package emit per each package's README) is the authoritative regen path. Do not hand-edit JSON.
2. **A4 outcome documentation.** Whether replay passes or bookends regenerate, document the outcome inline in the dispatch commit body and in the PR description appendix.
3. **JSDoc generalization wording.** Replace `'postgres-enum'` example occurrences with a target-agnostic placeholder (e.g. `'my-pack-entry'`, `'<kind>'`, or `'pack-contributed-kind'`). Implementer's discretion as long as the replacement reads as substrate documentation, not Postgres-specific.
4. **Test-revert mechanism.** `snapshot-read-shapes.test.ts` currently constructs inline JSON for the stale `postgres-enum.json` fixture path and skips three checked-in contracts in its broader scan. After fixture regen, revert both: load from the regenerated on-disk fixture and remove the three skip-paths.
5. **No source edits beyond the two JSDoc lines.** If fixture regen surfaces an emit-pipeline defect (e.g. missing `kind` on plain-literal namespaces, à la TML-2654), halt and report. Do not patch source.

## Files in play

### Step 1 (pre-flight): grep inventory

```bash
rg -l '"kind": "postgres-enum"' examples/ test/ packages/ --glob 'contract.json' --glob '*.json'
```

Record the file list in the dispatch commit body. Any surprises beyond the working-position table below — halt and surface before regen.

### Step 2: fixture regen (data files only)

Working-position inventory (confirm at execution per Step 1):

- `examples/prisma-next-demo/src/prisma/contract.json` + paired `contract.d.ts`
- `examples/prisma-next-cloudflare-worker/src/prisma/contract.json` + paired `contract.d.ts`
- `packages/3-targets/3-targets/postgres/test/fixtures/snapshot-read-shapes/postgres-enum.json`
- `test/integration/test/authoring/parity/core-surface/expected.contract.json` (only if still enum-bearing — confirm via grep)
- Conditional: pre-#534 migration bookends under `examples/prisma-next-demo/migrations/app/*/` (regen **only** if A4 replay falsifies; document rationale)

### Step 3: JSDoc fold-ins (2 lines)

- `packages/1-framework/1-core/framework-components/src/ir/ir-node.ts` line ~20 — JSDoc example using `'postgres-enum'` → target-agnostic placeholder
- `packages/1-framework/1-core/framework-components/src/ir/storage-type.ts` line ~9 — JSDoc example using `'postgres-enum'` → target-agnostic placeholder

### Step 4: test workaround revert

- `packages/3-targets/3-targets/postgres/test/snapshot-read-shapes.test.ts` — remove the three skip-paths (`examples/prisma-next-demo/src/prisma/contract.json`, `examples/prisma-next-cloudflare-worker/src/prisma/contract.json`, `postgres-enum.json`) and revert the inline-JSON construction so the test loads the regenerated on-disk fixture. Match the pattern that existed on `origin/main` (`git show origin/main:packages/3-targets/3-targets/postgres/test/snapshot-read-shapes.test.ts` shows the pre-D1 shape).

### Files explicitly NOT in play

- Any other source file under `packages/**/src/` — D2 does not edit source beyond Step 3's two JSDoc lines.
- Any new test file. Existing tests adjust only via the revert in Step 4.
- Mongo contracts / fixtures — no enum slot on Mongo; no edits expected.
- Bookends in Step 2's conditional list — touched only if A4 replay falsifies.

## Done when

- [ ] **Step 1 pre-flight inventory** recorded in commit body; no surprise hits.
- [ ] **Step 2 regen** complete; all inventory `contract.json` + paired `contract.d.ts` carry namespace-scoped enums under `storage.namespaces.<ns>.enum.<name>`; `storageHash` / `profileHash` shifts accepted (spec edge #9).
- [ ] **Step 3 JSDoc fold-ins** landed; `rg "'postgres-enum'" packages/1-framework/ -t ts` returns hits only in test fixtures (`control-stack.test.ts` — explicitly allowed by PDoD3 carve-out).
- [ ] **Step 4 test revert** landed; `snapshot-read-shapes.test.ts` loads from the regenerated on-disk `postgres-enum.json`; the three skip-paths and the inline-JSON construction are gone.
- [ ] `pnpm fixtures:check` clean — **byte-stability gate for the slice**.
- [ ] `pnpm typecheck` clean (emitted `.d.ts` literals satisfy `Contract<SqlStorage>` with D1's narrowed types).
- [ ] `pnpm test:packages` green (post-regen, includes `snapshot-read-shapes.test.ts` after revert).
- [ ] `pnpm test:integration` green (post-regen).
- [ ] `pnpm lint:deps` clean.
- [ ] **A4 / SDoD8:** migration-replay tests pass against the document-scoped enum bookends OR (if falsified) bookends regenerated with rationale documented inline. Outcome explicit in commit body + PR appendix.
- [ ] **Edge cases:** #4 (orthogonal document-scoped + namespace-scoped enums exercised in demo contract), #6 (`elementCoordinates(storage)` yields `(plane: 'storage', ns, entityKind: 'enum', name)` — confirm via existing walk test or one targeted assertion), #7 (fixture regen ordering: D1 source on branch before regen), #9 (hash shifts accepted), #12 (replay falsification handling).
- [ ] **Intent-validation grep:** `rg '"kind": "postgres-enum"' -A5 -B5 examples/ packages/ test/ | rg 'types'` returns zero namespace-enum contexts (refine pattern if needed — the intent is "no regenerated contract.json carries enum under the deleted `.types.` slot").

## Brief overlay (drive-build-workflow execution discipline)

- **F3 required:** Step 1 grep inventory committed to the dispatch commit body before any regen.
- **F5 forbidden:** no destructive git operations.
- **F7 forbidden:** if `pnpm fixtures:emit` fails due to an emit-pipeline defect (missing `kind` on plain-literal namespace, TML-2654-style), **halt and report**. Do not patch source. Do not work around with hand-edited JSON.
- **Ordering:** D1 (`0339f348e`) must be on the branch before Step 2 regen runs. Verify with `git log --oneline origin/main..HEAD | grep 0339f348e`.
- **Risk #5 stance:** subtractive throughout. No new descriptor field, no new framework-layer registry, no new identity-encoding structure. If the implementer reaches for one, halt and surface.

## Refusal triggers (halt — do not work around)

- **Emit pipeline blocker** — `pnpm fixtures:emit` fails with errors requiring source changes (e.g. TML-2654 plain-literal namespace fixes). Halt; do not expand D2; ticket the defect separately.
- **A4 replay failure needs >3 implementation files** — halt; promote per spec edge #12 (defer to a separate slice).
- **Implementer regens fixtures before D1 source is on branch** — halt (ordering violation; breaks reviewability).
- **Source change crept in beyond the two JSDoc lines** — halt and revert; that's a D1 or follow-up territory, not D2.
- **A4 falsification cascades** — if replay needs planner/serializer changes beyond bookend regen, halt and re-decompose.

## Model tier

**Composer-2.5 (`composer-2.5-fast`).** Per [`drive/calibration/model-tier.md`](../../../../drive/calibration/model-tier.md): test-literal / fixture regen row. Mechanical, well-scoped, no design judgment. **Escalate to Opus 4.7 (`claude-opus-4-7-thinking-high`)** only if A4 replay falsification implicates non-mechanical planner semantics that need cross-file design.

## Dispatch hygiene

- One or two commits is fine: (a) regen + JSDoc + test revert, (b) optional separate commit for bookend regen if A4 falsified. Both ending in clean working tree.
- Commit messages reference TML-2623 in trailer or body.
- DCO: every commit signed (`git commit -s`).
- Push at end of dispatch; not intra-dispatch.

## Report back

Implementer's wrap-up message must contain:

1. **Final HEAD SHA + push confirmation.**
2. **Pre-flight grep inventory** (Step 1 file list).
3. **A4 outcome:** PASS (replay green against doc-scoped bookends) or REGEN (bookends regenerated; rationale).
4. **Done-when gate results** — every checkbox PASS / FAIL / N/A with one-line evidence.
5. **Cascade size** (file count from `git diff --stat origin/main..HEAD`; should be ≪ D1's 24 — most diff weight is JSON / `.d.ts` data, not packages source).
6. **Any refusal triggers fired** — if zero, say so explicitly.
7. **JSDoc generalization wording** chosen (one line each for the two files).
8. **`snapshot-read-shapes.test.ts` revert confirmation** — diff should show the three skip-paths gone and the inline-JSON construction replaced by an on-disk fixture load.

## References

- Slice spec: [`../spec.md`](../spec.md) (corrected SDoD6, edge cases #4 / #6 / #7 / #9 / #12, A4)
- Slice plan: [`../plan.md`](../plan.md) § Dispatch 2
- D1 brief (context): [`./01-source-migration.md`](./01-source-migration.md)
- D1 reviewer ACCEPT verdict (carries the snapshot-read-shapes.test.ts callout): conversation transcript (not committed; reviewer brief at `../reviews/D1-reviewer-brief.md`, gitignored)
- D1 implementation HEAD: `0339f348e`
- Calibration: [`drive/calibration/failure-modes.md`](../../../../drive/calibration/failure-modes.md) (F3 / F5 / F7), [`grep-library.md`](../../../../drive/calibration/grep-library.md)
- Retro: [`drive/retro/findings.md`](../../../../drive/retro/findings.md) (2026-05-22 entry — gate-translation discipline)
