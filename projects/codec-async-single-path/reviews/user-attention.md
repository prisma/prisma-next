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

**SATISFIED** at HEAD `7b466364b` after R3. Final scoreboard: 26 PASS / 0 FAIL / 0 NOT VERIFIED (3 PASS-with-scope-note on AC-SE2, AC-SE4, AC-DW3 — all spec-legitimate or orchestrator-deferred).

**R1 (commits `52c69e899` → `5ac4a3de6`, 8 commits):** PR #375 security tests translated (T5.1/T5.3 verbatim, T5.5 seeded-secret-codec fixture); ADR 204 — *Single-Path Async Codec Runtime* born in canonical location (T5.6); ADR 030 partial-supersession pointer (T5.7); 5 affected READMEs refreshed (T5.8); AC verification artifact (T5.9). Two `it.skip` deferrals: T5.2 codec-message redaction (out-of-scope per spec § Non-goals — redaction-trigger spelling tracked separately) with verbatim assertion preserved for future activation; T5.4 include-aggregate child-row codec decoding (3 tests + 1 dropped) — orthogonal ORM feature outside async-shape scope. Full M5 gate set ran green: `pnpm typecheck`, `pnpm test:packages` (with 4 documented `it.skip`), `pnpm test:integration` (521/521), `pnpm test:all`, `pnpm lint:deps`, `pnpm build`.

**R1 review (commit `b5dc7b919`) → ANOTHER ROUND NEEDED.** Three doc-quality findings against canonical artifacts:
- F5 (should-fix): ADR 204 declared a fictional `Codec` interface signature (`<TInput, TWire, TJson, TJsonInput, TOutput>` with `TypeNode`, `decodeJson(json: TJsonInput): TOutput`). None of those types exist; the source-of-truth is `framework-components/src/codec-types.ts:27-50`.
- F6 (should-fix): Six factory examples used `id:` config key (ADR 204 lines 82, 92; relational-core README lines 103, 113; mongo-codec README lines 17, 27). The actual factory config field is `typeId`.
- F7 (low/process): ADR 030 supersession pointer over-claimed by listing build-time `encodeJson`/`decodeJson` as superseded. ADR 204 explicitly keeps build-time methods sync.

**Procedural anomaly — F8 filed by the user (commit `e33635ec1`).** Between m5 R1 review and m5 R2 implementation, the user themselves committed `e33635ec1` filing a new finding F8 in the SDR + walkthrough (the `code-review.md` had already recorded it as filed). F8: T5.4 deferred-test header comment in `collection-dispatch.test.ts` lines 403–406 claimed "The assertions themselves are preserved verbatim against the single-path contract" but the three `it.skip` bodies contain only `expect(true).toBe(true)` placeholders. Substance of F8 is sound; the deferral itself remains spec-legitimate (no AC change), only the artifact's documentation was inconsistent. Indicates the user briefly came back to perform a second-pass review before going unavailable again.

**R2 (commit `a4aeba917`, single doc-only commit):** F5/F6/F7 all closed by replacing ADR 204's interface block with the source-of-truth from `framework-components/src/codec-types.ts:27-50`, renaming six `id:` → `typeId:` sites, and trimming ADR 030's supersession pointer parenthetical to query-time methods only. Bonus: `decodeJson(json): TOutput` → `decodeJson(json): TInput` (peripheral fictional-types fix). Implementer raised one minor pushback: the orchestrator's prompt-snippet conflated SQL-extension members (`meta?`/`paramsSchema?`/`init?`) with the framework-components base; the implementer correctly used the base file as source-of-truth (per the orchestrator's primary directive). **For your awareness:** future delegation prompts that touch interface-vs-extension surfaces should explicitly cite the file path of the source-of-truth slice rather than paraphrase the interface.

**R2 review (commit `d57a2a655`) → ANOTHER ROUND NEEDED** — F5/F6/F7 closed; F8 (filed by you between rounds) remained outside the orchestrator's R2 prompt and was still open. Reviewer offered two paths: re-delegate F8 to R3 (Option B — single-comment edit) or visibly override. Orchestrator chose Path A / Option B per the reviewer's preference.

**R3 (commit `a8ea4dbd1`, single doc-only commit):** F8 closed via Option B — rewrote `collection-dispatch.test.ts` lines 395–426 header comment to honestly describe the three `it.skip` blocks as placeholders (titles only, no verbatim PR #375 assertions) while reinforcing the structural deferral evidence. No test bodies changed. Tests pass at 463/3, lint:deps clean.

**R3 review (commit `7b466364b`) → SATISFIED.** All findings closed (F1, F2, F3, F4, F5, F6, F7, F8); pre-PR readiness check confirmed.

**Items for your review (m5 phase):**

1. **Future-project pointers identified during m5 — three orthogonal follow-up projects worth tracking in Linear:**
   - **`orm-include-aggregate-codec-dispatch`** — closes the include-aggregate redaction-correctness hole at the ORM layer. The current `dispatchCollectionRows` single-query include path JSON-parses payload and applies field-name mapping but does NOT invoke codec query-time methods on `jsonb_agg` child cells. Three `it.skip` placeholders at `packages/3-extensions/sql-orm-client/test/collection-dispatch.test.ts:427-440` are positioned for activation when this project lands and assertions are re-derived from PR #375 § collection-dispatch.test.ts (tests 5–7).
   - **Mongo row decoding** — next-family extension; should mirror SQL's `decodeRow`/`decodeField` pattern per ADR 204 § Cross-family scope notes. Out of scope for codec-async-single-path because Mongo doesn't currently decode rows; adding it is a separate piece of work (projection-aware document walker, async dispatch, result-shape decisions).
   - **Redaction-trigger spelling** — orthogonal redaction-policy work; spec § Non-goals item. T5.2's `it.skip` test in `json-schema-validation.test.ts:613-685` is positioned for activation when the redaction policy work lands.

2. **Inline-comment consistency follow-up (one-line edit, optional close-out task).** The first `it.skip` block at `collection-dispatch.test.ts` lines 428–430 carries an inline comment "Translated from PR #375. …" which is technically inconsistent with the rewritten header at L395–L426 (header says bodies are stubs). The reviewer accepted as honestly-resolved within R3 scope (governed by the rewritten header). **Recommend folding into the close-out PR as a one-line edit** — drop the "Translated from PR #375. " prefix or replace with "Placeholder body. ". Not blocking; surfaced for awareness.

3. **Close-out PR (T5.11 / T5.12) is queued behind your review of this file.** Per the orchestrator's M5 R1 mandate, close-out work (strip repo-wide references to `projects/codec-async-single-path/**` and delete the project directory) is sequenced after you review `user-attention.md`. The close-out PR can fold in item 2 above.

## Final summary

**Project: codec-async-single-path. Status: implementation complete; pre-PR readiness confirmed at HEAD `7b466364b`. PR opening is the next step.**

### What landed

A complete single-path async codec runtime across SQL and Mongo families:

- **Public `Codec` interface** (5 generics: `<Id, TTraits, TWire, TInput, TOutput=TInput>`) with Promise-returning query-time methods (`encode`, `decode`) and synchronous build-time methods (`encodeJson`, `decodeJson`, optional `renderOutputType`). No async marker, no `TRuntime` generic, no per-codec discriminator.
- **Single `codec()` / `mongoCodec()` factory** transparently lifting sync author functions to Promise-shaped methods. Authors write whichever shape is natural per method without annotations.
- **Always-await runtime path** with concurrent `Promise.all` dispatch in `encodeParams` and `decodeRow` (SQL) plus `resolveValue` and `MongoAdapter.lower()` (Mongo encode side). Standard error envelopes (`RUNTIME.ENCODE_FAILED` / `RUNTIME.DECODE_FAILED`) with `cause` chaining preserved end-to-end.
- **Single field type-map shared by ORM read and write surfaces** (no read/write split). Rows yield plain `T`; writes accept plain `T`. Build-time paths (`validateContract`, `postgres({...})`, `createMongoAdapter()`) remain synchronous, regression-locked.
- **Strict cross-family parity:** `MongoCodec` is structurally identical to `BaseCodec`; a single `codec({...})` value is exercised against both runtimes (verified by integration test `cross-family-codec.test.ts`).
- **ADR 204 — Single-Path Async Codec Runtime** captures the design (single-path query-time, build-time-vs-query-time seam, cross-family portability, walk-back framing for the future additive sync fast-path). ADR 030 carries a partial-supersession pointer for the runtime-shape parts.
- **PR #375's security tests translated** to the new design (envelope wrapping, JSON-Schema validation against resolved values, seeded-secret-codec async crypto fixture).

### Validation

Workspace-wide green at HEAD `7b466364b`: `pnpm typecheck` (120/120 tasks), `pnpm test:packages` (111/111 turbo tasks; 4 documented `it.skip` for spec-legitimate deferrals), `pnpm test:integration` (104 files / 521 tests), `pnpm test:all` (full suite), `pnpm lint:deps` (606 modules / 1198 deps; 0 violations), `pnpm build` (61/61 tasks). The deferred-test discipline is now consistent project-wide: T5.2 preserves verbatim assertions; T5.4 honestly describes its bodies as stubs.

### Findings closed

F1, F2, F3, F4, F5, F6, F7, F8 — all closed across m1..m5. Findings log has zero open items. AC scoreboard: 26 PASS / 0 FAIL / 0 NOT VERIFIED.

### Procedural anomalies (audit trail)

Three rounds (m1 R2, m4 R1, m5 between R1/R2) saw work appear in git history before the orchestrator's delegation prompt — variously authored by the user themselves or by an earlier reviewer subagent. Substance was correct in every case; the orchestrator reconciled by independently re-verifying rather than re-doing committed work. F8 filing in particular was authored by the user (Will Madden, `madden@prisma.io`) at commit `e33635ec1`, indicating you briefly returned for a second-pass review before going unavailable again.

### What's queued behind your review

- **Close-out PR (T5.11 + T5.12).** Strip repo-wide references to `projects/codec-async-single-path/**` (replace with canonical `docs/` links or remove); delete `projects/codec-async-single-path/`. Optional: fold in the inline-comment consistency follow-up at `collection-dispatch.test.ts:428-430`.
- **Three follow-up projects to track in Linear** (per § m5 item 1 above): include-aggregate child-codec dispatch; Mongo row decoding; redaction-trigger spelling.
- **Pre-existing flake follow-ups** (per § m4 above): `MongoMigrationRunner` CAS robustness; CLI Postgres-timing flake.
- **Linear ticket ID for the closes-link in the PR body** — ticket slug is `codec-async-single-path` (from the branch name), but the ID (e.g., `TML-XXXX`) needs to be filled in by you. The PR body uses a `<TBD>` placeholder.

### Recommended order

1. Review this `user-attention.md` file end-to-end.
2. Fill in the Linear ticket ID in the PR body (search for `<TBD>`).
3. Approve / merge the codec-async-single-path PR.
4. Open the close-out PR (T5.11 + T5.12, optionally folding in the inline-comment fix).
5. Open Linear tickets for the three follow-up projects + the two pre-existing flakes.
