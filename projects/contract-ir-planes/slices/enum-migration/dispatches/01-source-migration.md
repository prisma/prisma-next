# D1 — Source migration: enum slot hard-cut + TML-2658 fold

> **Brief format & scope discipline.** Hard-cut migration of Postgres enum from the framework-shared namespace `types` slot to the pack-contributed `enum` slot. Stay strictly inside the file surfaces enumerated below; expand only if the grep pre-flight (step 1) surfaces hits in those packages that aren't listed here — and if so, halt and report before editing the surprise files. **Do not** run `pnpm fixtures:emit` in this dispatch — fixture work is D2. **Do not** touch document-scoped `storage.types` (codec triples / aliases) — it stays untouched. **Do not** introduce any read-fallback or dual-write from `types` → `enum` (A6 confirmed; spec edge #1).
>
> **Slice spec:** [`projects/contract-ir-planes/slices/enum-migration/spec.md`](../spec.md). **Slice plan:** [`projects/contract-ir-planes/slices/enum-migration/plan.md`](../plan.md) § Dispatch 1. **Folded cleanup:** [TML-2658](https://linear.app/prisma-company/issue/TML-2658). **Linear:** [TML-2623](https://linear.app/prisma-company/issue/TML-2623).

## Why this dispatch exists

S1.A landed the descriptor mechanism (`AuthoringContributions.entityTypes`, family-base hydration registry keyed on `discriminator`, validator-fragment composition surface). The Postgres pack already registers `'postgres-enum'` via that descriptor. But enum entries still write to the legacy framework-shared `storage.namespaces.<ns>.types` slot for backward fixture stability during substrate landing.

D1 completes the move in source: every read/write path that today reaches namespace `types` for enums reaches namespace `enum` instead; the framework-shared namespace `types` slot is deleted from IR types and the validator schema; the family-base error path stops naming Postgres specially. PDoD3's grep gate becomes satisfiable.

`pnpm fixtures:check` will fail after D1 commits — that is **expected**, not a defect. D2 regenerates the fixtures. Don't rework D1 on a fixtures:check failure.

## Settled decisions (don't re-question)

The slice spec's Per-dispatch DoR overlay table ([`spec.md` § Per-dispatch DoR overlay](../spec.md#per-dispatch-dor-overlay)) settled the six surfaces this dispatch touches. The orchestrator's pre-flight Risk #5 (a)+(b) walk confirmed the surface delta is subtractive across all eight read/write surfaces (one slot rename + one schema directive fold; no new fields, no new framework-layer identity-encoding structures). The walk is recorded for audit at the orchestrator's dispatch turn.

1. **Slot key.** Namespace-scoped enums land on `enum` (essence + singular). Settled in S1.A ADR Decision 5. Do not revisit; do not propose `enums`, `postgresEnums`, or any variant.
2. **Hard-cut.** No read-fallback from `types` → `enum`. No dual-write. No `types ?? enum` coalescing on namespace envelopes. No deprecation shim. A6 confirmed by operator 2026-05-22.
3. **`types` slot on namespace scope: delete entirely** (not `Record<string, never>` stub). Working position per spec open question #3 — verify nothing semantically requires the key to exist empty; if a consumer does, that's a discovery worth flagging.
4. **Document-scoped `storage.types` (codec triples / codec aliases) is untouched.** The emitter / validator / serializer paths that handle document-scoped `storage.types` stay. Accidental deletion of `createSqlStorageSchema`'s document-scoped `types` slot is a refusal trigger.
5. **TML-2658 folds here.** `NamespaceRawSchema` in `packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts` gains explicit `'+': 'ignore'` + a one-line rationale comment matching the wording in the TML-2658 ticket body. Same commit as the slot-rename touches, not a separate commit.
6. **Descriptor surface unchanged.** No new field on `AuthoringEntityTypeDescriptor`. No new `FamilyDescriptor` field. No parallel slot registry. The existing `postgresAuthoringEntityTypes.enum` descriptor + `validatorSchema: PostgresEnumTypeSchema` continue to drive hydration and validation; D1 just changes which slot key those reach.
7. **Generic error replaces hardcoded Postgres name.** The family-base error message *"postgres-enum requires PostgresContractSerializer"* becomes a generic descriptor-driven message (e.g. *"entry kind '<kind>' has no registered hydration factory"* — exact wording is implementer discretion as long as the discriminator is interpolated and the framework no longer names Postgres specially).

## Files in play

Grep pre-flight (step 1 of execution) bounds the inventory; the table below is the working position grounded on the spec's source-surfaces table + project-plan estimate (~15–22 implementation files across 4 packages). If `git diff --stat` shows > 25 files under `packages/` or the typecheck cascade pulls in > 30 files, **halt and split** into D1a (contract IR + family) + D1b (authoring + postgres target) before continuing.

### Step 1 (pre-flight): grep inventory

```bash
rg -l 'postgres-enum|PostgresEnum' packages/2-sql/ packages/3-targets/3-targets/postgres/ \
   --glob '!**/test/fixtures/**' --glob '!**/*.json'
```

Record the file list in the dispatch commit body or PR description appendix. Edits stay within this list; surprises halt the dispatch.

### Step 2 (edits): surfaces grouped by package

| Surface | Paths | Change |
|---|---|---|
| **IR typing** | [`packages/2-sql/1-core/contract/src/ir/sql-storage.ts`](../../../../../packages/2-sql/1-core/contract/src/ir/sql-storage.ts), [`postgres-enum-storage-entry.ts`](../../../../../packages/2-sql/1-core/contract/src/ir/postgres-enum-storage-entry.ts), [`sql-node.ts`](../../../../../packages/2-sql/1-core/contract/src/ir/sql-node.ts), [`storage-type-instance.ts`](../../../../../packages/2-sql/1-core/contract/src/ir/storage-type-instance.ts), [`types.ts`](../../../../../packages/2-sql/1-core/contract/src/types.ts) | Drop `PostgresEnumStorageEntry` from `SqlNamespacePayload` / `SqlNamespaceTablesInput`'s namespace `types` slot; add `enum?: Record<string, PostgresEnumStorageEntry>` on the namespace shape (singular). Delete the namespace-level `types?` field entirely. `PostgresEnumStorageEntry` itself stays as a type (still referenced by Postgres target + adapter); only its **slot position** moves. |
| **Validator** | [`packages/2-sql/1-core/contract/src/validators.ts`](../../../../../packages/2-sql/1-core/contract/src/validators.ts), [`test/sql-storage.test.ts`](../../../../../packages/2-sql/1-core/contract/test/sql-storage.test.ts) | Remove hardcoded `PostgresEnumTypeSchema` from `createNamespaceEntrySchema`'s `'types?'` slot; the descriptor's existing `validatorSchema` fragment composes on `'enum?'` instead. Adjust unit tests that pin the schema's `'types?'` slot to pin `'enum?'`. Do not delete the document-scoped `storage.types` validator entry in `createSqlStorageSchema`. |
| **Serializer + TML-2658** | [`packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts`](../../../../../packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts) | Slot loop reads/writes `enum` instead of `types` for pack-contributed entries (the structural walk landed in S1.A D3 doesn't need slot-name awareness; the change is in the namespace IR class output, not the loop). Replace the *"postgres-enum requires PostgresContractSerializer"* hardcoded special-case message with a generic descriptor-driven message. **Add `'+': 'ignore'` to `NamespaceRawSchema`** with the one-line rationale comment (TML-2658). |
| **Verifier** | [`packages/2-sql/9-family/src/core/schema-verify/verify-sql-schema.ts`](../../../../../packages/2-sql/9-family/src/core/schema-verify/verify-sql-schema.ts) | `verifyEnumType` walks the namespace `enum` slot. Logic unchanged; property name change only. |
| **Emitter codegen** | [`packages/2-sql/3-tooling/emitter/src/index.ts`](../../../../../packages/2-sql/3-tooling/emitter/src/index.ts) | Replace the hardcoded path that emits `namespace.types.<name>: { kind: 'postgres-enum'; … }` with descriptor-driven emission under `namespace.enum.<name>`. The document-scoped `storage.types` codegen path stays. |
| **Authoring (TS DSL)** | [`packages/2-sql/2-authoring/contract-ts/src/contract-builder.ts`](../../../../../packages/2-sql/2-authoring/contract-ts/src/contract-builder.ts) + sibling files (`contract-lowering.ts`, `contract-definition.ts`, `build-contract.ts`, `contract-types.ts`, `contract-dsl.ts`, `contract-warnings.ts` — enumerate via grep) | Where enum entries are attached under `namespace.types`, attach under `namespace.enum` instead. Authoring still dispatches through `postgresAuthoringEntityTypes.enum`; only the storage envelope slot key changes. |
| **Authoring (PSL)** | [`packages/2-sql/2-authoring/contract-psl/src/interpreter.ts`](../../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts) + any PSL tests that pin the slot key | Same — enum interpretation writes to `namespace.enum`. |
| **Postgres target** | [`packages/3-targets/3-targets/postgres/src/core/postgres-contract-serializer.ts`](../../../../../packages/3-targets/3-targets/postgres/src/core/postgres-contract-serializer.ts), [`postgres-schema.ts`](../../../../../packages/3-targets/3-targets/postgres/src/core/postgres-schema.ts), [`postgres-enum-type.ts`](../../../../../packages/3-targets/3-targets/postgres/src/core/postgres-enum-type.ts), migration planner modules under [`migrations/`](../../../../../packages/3-targets/3-targets/postgres/src/core/migrations/) (`enum-planning.ts`, `planner-strategies.ts`, `issue-planner.ts`, `planner.ts` — grep-driven) | Read paths that today access `namespace.types[enumName]` for enum entries access `namespace.enum[enumName]` instead. Postgres serializer's hydration override (where it still has one) becomes descriptor-driven via the S1.A registry. |
| **Descriptor anchor (read-only)** | [`packages/3-targets/3-targets/postgres/src/core/authoring.ts`](../../../../../packages/3-targets/3-targets/postgres/src/core/authoring.ts) | Confirm `postgresAuthoringEntityTypes.enum` descriptor is registered with `discriminator: 'postgres-enum'` + `validatorSchema: PostgresEnumTypeSchema`. Adjust **only** if slot-key wiring still references legacy `types`; expect no edit needed (S1.A landed this). |

### Files explicitly NOT in play

- [`packages/2-sql/1-core/contract/src/ir/sql-storage.ts`](../../../../../packages/2-sql/1-core/contract/src/ir/sql-storage.ts) — `createSqlStorageSchema`'s **document-scoped** `storage.types` slot (codec triples). Do not delete; do not narrow.
- [`packages/3-targets/6-adapters/sqlite/`](../../../../../packages/3-targets/6-adapters/sqlite/) — SQLite adapter's `PostgresEnumStorageEntry` import sites stay (project non-goal per spec § Out of scope).
- [`packages/2-mongo-family/`](../../../../../packages/2-mongo-family/) — Mongo has no enum slot; no edits expected.
- [`examples/`](../../../../../examples/), `test/fixtures/`, any `contract.json` / `contract.d.ts` — fixture regen is D2's job.
- Any framework-layer slot registry, `storageSlotKey` field, or `reservedStorageSlotKeys` array — all retired in S1.A D3; adding any back is a refusal trigger.

## Done when

- [ ] Pre-flight grep inventory recorded in commit body or PR appendix; edits stayed within that list.
- [ ] Build cascade clean in order: `pnpm --filter @prisma-next/sql-contract build` → `@prisma-next/family-sql build` → `@prisma-next/sql-emitter build` → `@prisma-next/target-postgres build`.
- [ ] `pnpm typecheck` clean.
- [ ] `pnpm test:packages` green (includes `sql-storage.test.ts`, serializer / verifier tests, authoring tests, postgres target tests covering enum hydration / planning).
- [ ] `pnpm test:integration` green (Postgres enum is the load-bearing exemplar).
- [ ] `pnpm lint:deps` clean — no new framework→target layering violations; no read-fallback shim importing across layers.
- [ ] **Intent-validation grep #1:** `rg "PostgresEnumStorageEntry|'postgres-enum'" packages/1-framework/ packages/2-sql/9-family/` → **zero matches** (PDoD3 pre-gate).
- [ ] **Intent-validation grep #2:** `rg '\.types\.' packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts packages/2-sql/3-tooling/emitter/src/index.ts packages/2-sql/1-core/contract/src/validators.ts` — no namespace-enum reads/writes under `.types.` (document-scoped `storage.types` matches in the emitter document path may remain — those aren't namespace-scoped).
- [ ] **Intent-validation grep #3:** `rg "'\\+': 'ignore'" packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts` shows the directive on `NamespaceRawSchema` with the rationale comment present (TML-2658 / SDoD7).
- [ ] **Document-scoped guard:** `createSqlStorageSchema` in [`packages/2-sql/1-core/contract/src/validators.ts`](../../../../../packages/2-sql/1-core/contract/src/validators.ts) still has its document-scoped `types?` slot definition unchanged.
- [ ] **Edge cases covered in this dispatch:** spec edges #1 (enum-under-old-slot rejected at validator), #2 (document-scoped enum rejected), #3 (empty `enum` map omitted), #5 (discriminator vs slot key distinct), #18 (enum/table name collision via distinct slots), A6 hard-cut (no read-fallback).
- [ ] **Explicit non-gate:** `pnpm fixtures:check` is **expected to fail** after D1 commits — do **not** treat fixture drift as D1 rework; proceed to D2.

## Brief overlay (drive-build-workflow execution discipline)

The brief author **must** carry these forward into the implementer's first message:

- **F5 forbidden:** No destructive git operations (no `git reset --hard`, no force-push, no `rm -rf .git`, no `git checkout --` on un-staged work). Implementer commits incrementally and pushes at the end of the dispatch.
- **F3 required:** Run the grep pre-flight (step 1) and commit the file list to the dispatch commit body **before** any source edits.
- **F1 forbidden patterns:** No `normalize*Enum*`, `readFallback`, `legacyTypesSlot`, `types ?? enum` namespace-envelope coalescing, no "temporary" dual-slot read. The slot move is one-way and atomic in the source diff.
- **F6 forbidden:** No new field on `AuthoringEntityTypeDescriptor`, `FamilyDescriptor`, or any framework-layer registry / lookup table. The spec-level Risk #5 answer table is the source of truth ([`spec.md` § Per-dispatch DoR overlay](../spec.md#per-dispatch-dor-overlay)); do not lift its rows into a "do not relitigate" block in any later step.
- **Build cascade order required:** `sql-contract` → `family-sql` → `sql-emitter` → `target-postgres`. Skipping the cascade leaves stale `dist/*.d.mts` and produces false typecheck signals.
- **fixtures:check is a non-gate for D1.** Do not run `pnpm fixtures:emit`. Do not edit any `.json` / `.d.ts` files under `examples/`, `test/fixtures/`, `packages/**/test/fixtures/`.

## Refusal triggers (halt — do not work around)

- **A6 falsified mid-flight:** any signal (operator message, test failure, downstream surfacing) that an external consumer relies on the old `namespace.types` enum shape. Halt and route to discussion-mode for shim re-introduction (project plan Risk #2).
- **New framework-encoded identity surface proposed:** implementer wants to add `storageSlotKey`, `reservedStorageSlotKeys`, `namespaceSlotHydrationRegistry`, or any parallel slot lookup. Risk #5 (b) refusal; halt and surface the proposal.
- **Document-scoped `storage.types` accidentally removed or narrowed.** Halt and revert.
- **Typecheck / fixture cascade exceeds threshold:** `git diff --stat` shows > 25 package files OR typecheck pulls in > 30 files. Halt and re-decompose into D1a (contract IR + family) + D1b (authoring + postgres target).
- **`pnpm test:integration` fails on Postgres enum and the fix requires emit-pipeline / `deserializeContract` changes:** that's TML-2654 territory. Halt; do not expand D1's scope.
- **TML-2654-style emit blocker surfaces** (plain-literal namespace missing `kind`, etc.). Halt; defer the ticket.
- **F7 — implementer hits an unbriefed structural blocker** (Turbo cycle, lint:deps refusal, hidden circular import) **and considers a workaround that crosses a layering boundary.** Halt and report; do not alias / dependsOn / re-export to bypass.

## Model tier

**Composer-2.5 (`composer-2.5-fast`).** Per [`drive/calibration/model-tier.md`](../../../../../drive/calibration/model-tier.md): scope-bounded mechanical migration with a fully-settled brief, enumerated file list, and pre-walked design. The slot rename has no design-judgment surface; descriptor-mechanism design is pinned in spec § Approach + ADR Decision 5.

**Escalate to Opus 4.7 (`claude-opus-4-7-thinking-high`)** if one of these surfaces:

- Descriptor-driven emitter change requires inventing a new public field on `AuthoringEntityTypeDescriptor` or `FamilyDescriptor` (F6 / Risk #5 (a)).
- Migration planner paths need a shape change beyond slot-key substitution.
- Risk #5 (a)+(b) cannot be answered without new registry / lookup infrastructure (revert to discussion mode; do not ship redundant surface).

## Dispatch hygiene

- One or two commits is fine; both ending in a clean working tree. The TML-2658 `'+': 'ignore'` directive may live in the same commit as the serializer slot loop change (same file).
- Commit messages reference TML-2623 in the trailer or body so GitHub auto-links.
- DCO: every commit signed (`git commit -s`).
- Push at end of dispatch; do not push partial state intra-dispatch.

## Report back

Implementer's wrap-up message must contain:

1. **Final HEAD SHA + push confirmation.**
2. **Pre-flight grep inventory** (the file list captured at step 1).
3. **Done-when gate results** — every checkbox above marked PASS / FAIL / N/A with one-line evidence (command output digest, grep hit count, test runner summary).
4. **Cascade size** (file count from `git diff --stat`; typecheck-cascade file count if it spiked).
5. **Edge cases handled** — for each one in the Done-when list, one-line confirmation of how D1's diff handles it.
6. **Any refusal-trigger fires** — if zero, say so explicitly; if any fired, what was the trigger and what the implementer reported instead of working around.

## References

- Slice spec: [`../spec.md`](../spec.md) (Per-dispatch DoR overlay answer table; Edge cases)
- Slice plan: [`../plan.md`](../plan.md) § Dispatch 1
- Parent project plan: [`../../../plan.md`](../../../plan.md) § S1.B (Risk #5 mitigation context)
- ADR: [`../../../adrs/0001-contract-planes.md`](../../../adrs/0001-contract-planes.md) Decision 5 (slot-key essence + singular)
- Calibration: [`drive/calibration/failure-modes.md`](../../../../../drive/calibration/failure-modes.md) (F1 / F3 / F5 / F6 / F7), [`grep-library.md`](../../../../../drive/calibration/grep-library.md)
- Retro: [`drive/retro/findings.md`](../../../../../drive/retro/findings.md) (2026-05-21 — Risk #5 root cause)
- TML-2658 ticket body for the `'+': 'ignore'` rationale comment wording
- S1.A landings consumed: descriptor registry (`postgresAuthoringEntityTypes.enum`), structural slot loop in `sql-contract-serializer-base.ts`
