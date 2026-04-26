# User attention — codec-async-single-path

> Items the orchestrator collected during the autonomous m2 → m5 run that the user should review at the end.
>
> Each item: what happened, what the orchestrator decided, where the evidence lives. Sorted by milestone.

## Pre-run setup

### Skill update applied retroactively to F1

The `drive-orchestrate-plan` skill was updated this session to disallow findings whose recommended action is not addressable in the current implementer round. F1 (m1 R1) recommended action was "address during m4's T4.2 reshape" — that is no longer a legitimate finding under the new rules.

**Decision:** re-record F1 as part of m4's T4.2 in `plan.md` (done) and instruct the next reviewer round to close F1 in `code-review.md` with closure note "re-recorded as m4 plan task per skill update; not actionable in m1." No code change; bookkeeping only.

**Where:** `plan.md` § Milestone 4 → T4.2 (parenthetical added). The m2 R1 reviewer's delegation prompt includes the F1-closure instruction.

### Linear ticket ID — TBD for PR creation

The user's instruction was "the linear ticket's slug is in the branch name." The branch is `feat/codec-async-single-path`, so the slug is `codec-async-single-path`. The ticket **ID** (e.g. `TML-XXXX`) is not in the branch name and there is no Linear MCP available in this environment to look it up.

**Decision:** the create-pr step at the end of the project will leave the Linear closes-link with a `<TBD>` placeholder for the ticket ID and flag it here for the user to fill in. The branch will still be pushed and the PR opened with a complete title and walkthrough body; only the closes-link needs the ID.

## Per-milestone notes

_(populated as the run progresses)_

### m2

**SATISFIED** at HEAD `4d7fc1261` (R1, no R2 needed). 11 PASS / 0 FAIL / 15 NOT VERIFIED on the AC scoreboard.

**Observation surfaced by m2 reviewer (decision deferred):** the m3 plan task list may be over-scoped. `sql-orm-client` typechecks and tests cleanly at m2 because it never calls `codec.encode` / `codec.decode` directly — it consumes results through `sql-runtime`'s now-await-correct async iterator. m3's residual scope therefore likely reduces to:
- T3.1 / T3.2 (ORM-level type tests for `.first()` / `.all()` / `for await` row shape and write surfaces) — still needed to lock the type-level invariant.
- T3.3 (verify no read/write split was introduced) — still needed but likely a no-op verification.
- T3.4 (collection-dispatch await placement) — may be a no-op if dispatch never calls codec methods directly.
- T3.5 / T3.6 (E2E roundtrip with async codec column) — still needed.
- `extension-pgvector` consumer reshape — still needed (still failing typecheck per plan).

**Orchestrator decision:** do not amend m3 plan ahead of time. The plan's T3.3 wording already says `(none should exist on main, but verify against the spec — the constraint is "do not introduce a split")`, so a no-op verification is the documented expected outcome. The m3 implementer's pre-implementation reconnaissance will confirm or refute the observation per task; if any task turns out to be a true no-op, the implementer can document it as such in their report rather than skipping it.

**For user review:** consider whether m3's task list should be tightened in a future similar project (e.g., explicitly mark verification-only tasks). Not urgent.

### m3

**SATISFIED** at HEAD `aa50f7280` after R2. 14 PASS / 0 FAIL / 12 NOT VERIFIED on the AC scoreboard.

- R1 (commits `7505ef158`, `41e01b5f3`): T3.1/T3.2/T3.3 type tests + T3.4 doc + T3.5/T3.6 live-Postgres integration test. R1 confirmed the scope-narrowing observation: T3.3 and T3.4 were verification-only outcomes (no `src/` code changes needed).
- R1 finding F3 (should-fix) — duplicate stacked header doc blocks in `collection-dispatch.ts`, second block referenced a deleted file. R2 fixed in commit `aa50f7280`.
- The implementer found two pre-existing untracked files in `sql-orm-client/test/` on entry (`codec-async.types.test-d.ts` and `codec-async.e2e.test.ts`). Adopted the first as T3.1/T3.2/T3.3 evidence (good content); deleted the second (broken mock) and replaced with a live-Postgres integration test. Likely procedural residue from an earlier session — sensible outcome.
- Reviewer noted a 100ms-timeout flake at `test/authoring/side-by-side-contracts.test.ts:131`. Not introduced by m3; did not reproduce on reviewer-side run; not blocking.

### m4

**R1 → ANOTHER ROUND NEEDED** (F4: one-line README signature drift in `mongo-lowering`).

- Five m4 commits (`236b8e2e0`, `350ac46e3`, `18ddbb92b`, `69e4d527d`, `415d72c1c`) substantively complete the Mongo encode-side runtime reshape, cross-family integration test, F1 cleanup (the `as unknown as TTraits` double-cast was eliminated by reshaping the empty-traits default through `ifDefined`), and sync-construction regression tests.
- AC scoreboard: AC-CX1..CX5 promoted to PASS. Totals at R1: 19 PASS / 0 FAIL / 7 NOT VERIFIED (m5 only).
- Workspace-wide gates green: `pnpm typecheck`, `pnpm test:packages` (111/111), `pnpm test:integration` (104 files / 521 tests), `pnpm lint:deps`. Cross-package `\.lower\(` and `resolveValue\(` audits clean (only the F4 README narrative is stale).

**Procedural anomaly (audit trail):** The m4 implementer reported that 4 of the 5 commits were already in place when their session started — they only authored `415d72c1c` themselves. The same pattern occurred during m1 R2 (the user accepted at that time, citing that re-doing identical work would waste cycles). Substance of all 5 commits matches the m4 plan tasks. Treating identically: accept and proceed.

**Orchestrator design decision absorbed into m4 R2 (your review needed):** The m4 reviewer flagged a 4-vs-5 generic asymmetry between `MongoCodec` (4 generics: `<Id, TTraits, TWire, TJs>`) and `BaseCodec` (5 generics: `<Id, TTraits, TWire, TInput, TOutput=TInput>`). `MongoCodec` collapses `TInput=TOutput=TJs`. AC-CX1 says "Mongo `Codec` interface structurally identical to SQL one." The reviewer's permissive read PASSes via the cross-family integration test (which uses the default case where TInput=TOutput). A strict reading would require `MongoCodec` to widen to 5 generics matching `BaseCodec`.

**Decision:** widen `MongoCodec` to 5 generics in m4 R2, alongside the F4 README fix. Rationale: (a) project intent is strict cross-family parity; (b) the m1 implementer applied the `TInput`/`TOutput` split to `BaseCodec` per the spec's Open Items decision; (c) widening is mechanical (type alias + factory signature + one type extractor), no behavioral impact, no consumer breakage; (d) avoids needing an ADR caveat documenting a deliberate asymmetry. If you disagree, the alternative path is to roll the widening back and have the m5 ADR record the deliberate collapse.

**Pre-existing flake follow-up (out of scope):** `MongoMigrationRunner > returns MARKER_CAS_FAILURE when concurrent marker change causes CAS miss` in `mongo-runner.test.ts:330`. Not introduced by m4 (test file byte-identical between m3 and m4 HEADs; runner-src diff only the two T4.8 `await adapter.lower(...)` lines, in unrelated DDL paths). Concrete fix exists (`await onOperationComplete` callback at `mongo-runner.ts:174`) but is unrelated to async codecs. **For your action:** consider opening a separate Linear issue for migration-runner CAS robustness; do not absorb into m5.

**Pre-existing CLI flake (out of scope):** 4 tests around span emission and progress callbacks in `cli/test/control-api/client.test.ts:525,1191`. Not Mongo-related, not introduced by m4. Postgres-integration timing dependent. No action recommended; flag for awareness only.

**R2 → SATISFIED** at HEAD `a720b9056` (review-artifact concordance commit on top of `47ce86a6f` impl HEAD; prior reviewer-artifact commit `0d7bd780b` was already on disk).

- Two impl commits (`6f567afa3`, `47ce86a6f`): F4 README fix + `MongoCodec` widened to 5 generics (`<Id, TTraits, TWire, TInput, TOutput = TInput>`) matching `BaseCodec` exactly. New extractors `MongoCodecInput<T>` / `MongoCodecOutput<T>` replace `MongoCodecJsType<T>` (no backcompat alias per AGENTS.md).
- AC-CX1 promoted from permissively-PASS → **strictly PASS** (pinned by `toEqualTypeOf<BaseCodec<…>>()` in `mongo-codec/test/codecs.test-d.ts:65-69`).
- All 14 R2 validation gates green; full integration suite 521/521 PASS; CAS flake did not reproduce.

**Latent extractor union behavior on asymmetric codecs (Mongo + SQL) — for your awareness:** TypeScript collapses the `infer` slot with the defaulted `TOutput = TInput` slot, so both `MongoCodecInput<T>` and SQL's `CodecInput<T>` return `TInput | TOutput` (the union) for asymmetric codecs. This is **pre-existing in SQL** and required to mirror in Mongo per the strict-parity mandate. Implementer documented this inline and tested asymmetric expressibility through method signatures (`Parameters<encode>[0]`, `ReturnType<decode>`) rather than the extractors — correct disposition, since those are the load-bearing demonstration that `TInput ≠ TOutput` is structurally expressible. **Recommendation:** leave as-is unless/until an asymmetric codec lands in production; at that point the natural fix is to switch both SQL and Mongo extractors from positional `infer` to function-shape `infer` (`T extends { encode(value: infer In): unknown } ? In : never`), in a single small atomic PR. Not blocking; flagged for future consideration.

**Procedural anomaly (audit trail):** The m4 R2 reviewer subagent entered with HEAD `0d7bd780b` rather than the expected `47ce86a6f` — a prior reviewer subagent had already committed the m4 R2 review artifacts (verdict, AC-CX1 promotion, gates) before the orchestrator's second-pass delegation. This is the same shape of "work appears already done" pattern observed in m1 R2 and m4 R1. Reviewer reconciled by independently re-verifying all 14 gates rather than re-doing committed work. **For your action:** consider whether the orchestrator should snapshot HEAD immediately before delegating reviewer subagents (and re-anchor the prompt) rather than relying on the implementer's reported HEAD.

**`projects/**/reviews/` is gitignored.** Both `0d7bd780b` and `a720b9056` were committed with `git add -f`. The reviewer flagged this as an orchestrator decision: either intentional (workflow tolerates `-f`) or `.gitignore` should be updated to allow the canonical review-artifact filenames. **For your action:** consider whether to whitelist `projects/*/reviews/{code-review,system-design-review,walkthrough,user-attention}.md` in `.gitignore` so future projects don't need `git add -f`.

### m5

_(pending)_

## Final summary

_(populated at end of run)_
