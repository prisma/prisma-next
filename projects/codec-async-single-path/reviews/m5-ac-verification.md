# M5 AC verification — `codec-async-single-path`

> Implementer-authored verification note for the seven m5 acceptance criteria (AC-SE1..SE4 + AC-DW1..DW3). The reviewer owns final scoreboard updates in `code-review.md`. Two ACs (AC-SE2, AC-SE4) carry **partial-pass** scope notes that the orchestrator may want to surface in the project's close-out summary.

## AC-SE1 — async codec failure → standard envelope; original on `cause`, not `message`

**PASS.** The runtime's encode and decode wrappers preserve the existing envelope shape end-to-end against async codec bodies:

- Encode: `wrapEncodeFailure` at [`packages/2-sql/5-runtime/src/codecs/encoding.ts (L23–L38)`](../../../packages/2-sql/5-runtime/src/codecs/encoding.ts:23-38) emits `RUNTIME.ENCODE_FAILED` with `{ label, codec, paramIndex }` and routes the original error to `cause`. Tests at [`codec-async.test.ts (L143–L207)`](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:143-207) (m2) and the new T5.1 test [`sql-runtime.test.ts (L460–L500)`](../../../packages/2-sql/5-runtime/test/sql-runtime.test.ts:460-500) cover both isolated and runtime-level wrapping.
- Decode: `wrapDecodeFailure` at [`decoding.ts (L98–L118)`](../../../packages/2-sql/5-runtime/src/codecs/decoding.ts:98-118) emits `RUNTIME.DECODE_FAILED` with `{ table, column, codec }` and routes the original error to `cause`. Tests at [`codec-async.test.ts (L406–L477)`](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:406-477) (m2) and the new seeded-secret-codec coverage at [`codec-async.test.ts (L586–L620)`](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:586-620) (m5 T5.5) cover both seeded and authored-async failure paths.

## AC-SE2 — validator-message redaction fires when triggered

**PARTIAL — DEFERRED.** The async-shape side of validator-message redaction is exercised end-to-end (the JSON-Schema validator runs against the **resolved** decoded value of an async codec; see AC-SE4 evidence below). The PR #375 redaction-trigger test for **codec-authored error messages** is translated as `it.skip` at [`json-schema-validation.test.ts (L613–L685)`](../../../packages/2-sql/5-runtime/test/json-schema-validation.test.ts:613-685) because the current `wrapDecodeFailure` embeds `error.message` directly into the envelope `message`. Implementing the redaction-trigger spelling is out of scope for this project per [`spec.md` § Open Items](../spec.md) ("Redaction-trigger spelling — independent of this design; tracked separately"). The test stands ready to flip on once that work lands.

## AC-SE3 — `seeded-secret-codec` exists, exercises async crypto E2E

**PASS.** The fixture is committed at [`packages/2-sql/5-runtime/test/seeded-secret-codec.ts`](../../../packages/2-sql/5-runtime/test/seeded-secret-codec.ts) (commit `52c69e899`, m5 T5.5). It is exercised end-to-end against the runtime by:

- [`codec-async.test.ts (L529–L620)`](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:529-620) — encode encrypts plaintext, decode decrypts ciphertext, no `Promise`-typed cells reach user code, decode failures wrap in `RUNTIME.DECODE_FAILED` with cause.
- [`sql-runtime.test.ts (L413–L500)`](../../../packages/2-sql/5-runtime/test/sql-runtime.test.ts:413-500) — runtime-level `executeAgainstQueryable` awaits async parameter encoding before driver execution, and wraps encoding failures before the driver runs.

## AC-SE4 — JSON-Schema failure shape and include-aggregate test patterns translated and pass

**PARTIAL.** The JSON-Schema-failure piece is covered:

- [`json-schema-validation.test.ts (L570–L600)`](../../../packages/2-sql/5-runtime/test/json-schema-validation.test.ts:570-600) (m5 T5.3) — `runs JSON schema validation against the resolved value of an async decoder` exercises the resolved-value validation path against an async codec; failure shape is `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` with the contract field path.

The include-aggregate piece is **deferred**: PR #375's tests at `packages/3-extensions/sql-orm-client/test/collection-dispatch.test.ts` assert that the single-query include path applies codec decoding to **child-row cells** within `jsonb_agg`-aggregated payloads. Inspecting the current dispatcher (see source comment at [`collection-dispatch.test.ts (L396–L420)`](../../../packages/3-extensions/sql-orm-client/test/collection-dispatch.test.ts:396-420)) shows it JSON-parses the payload and applies field-name mapping but does **not** invoke codec query-time methods on child cells — child-row codec decoding in the single-query include path does not exist yet, and adding it is orthogonal ORM work outside this project's async-shape scope. Three `it.skip` placeholders at [`collection-dispatch.test.ts (L422–L436)`](../../../packages/3-extensions/sql-orm-client/test/collection-dispatch.test.ts:422-436) preserve the assertions for activation when that work lands. PR #375's promise-valued-child-cell test is intentionally dropped (single-path always-await contract reverses it).

## AC-DW1 — new ADR documents single-path; ADR 030 has Superseded-by pointer

**PASS.** [`docs/architecture docs/adrs/ADR 204 - Single-Path Async Codec Runtime.md`](../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) is born in its canonical location with sections for Context (rejected per-codec marker), Decision (single-path always-await), Architecture (interface shape, factory lift, runtime always-await + `Promise.all`, cross-family parity), Walk-back framing (future additive `codecSync()` opt-in plus the seven NFR #5 constraints verbatim), Trade-offs, Cross-family scope notes, and References. ADR 030 carries a partial-supersession pointer at [`ADR 030 - Result decoding & codecs registry.md (L3)`](../../../docs/architecture%20docs/adrs/ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md:3) naming the specific superseded sections and preserving the registry-model parts unchanged.

## AC-DW2 — none of the seven walk-back constraints introduced

**PASS.** Each NFR #5 constraint verifiable from source:

1. No `runtime` / `kind` / equivalent field on `Codec` — see [`packages/1-framework/1-core/framework-components/src/codec-types.ts (L27–L50)`](../../../packages/1-framework/1-core/framework-components/src/codec-types.ts:27-50) and the `keyof Codec` set assertion in `framework-components/test/codec-types.types.test-d.ts`.
2. No `codecSync` / `codecAsync` factory variants — `rg 'export.*codecSync|export.*codecAsync' packages/` returns zero matches; only `codec()` and `mongoCodec()` are exported.
3. No exported sync-vs-async predicates — `rg 'isSyncEncoder|isSyncDecoder' packages/` returns zero matches.
4. No conditional return types tied to async-ness — `encode` / `decode` are typed as `Promise<...>` unconditionally on both `Codec` and `MongoCodec`.
5. No `TRuntime` generic on `Codec` — both interfaces have exactly five generics.
6. Documentation framing remains "you may write sync or async; the factory accepts both" (see updated READMEs in m5 T5.8 and ADR 204 Context/Decision).
7. No public guarantees that depend on async-ness — error envelope shape is the same regardless of authoring style (see AC-SE1 evidence).

## AC-DW3 — PR #375 review artifacts referenced from ADR; close-out cleanup pending

**PARTIAL.** The ADR migrates the relevant PR #375 review content into its Context section (the rejected per-codec marker, the four cost-in-the-wrong-place / no-walk-back / wrong-seam / cross-family critiques), satisfying the "or migrated content where relevant" branch of the AC. The wip-folder review artifacts are intentionally not linked from canonical ADR text per the doc-maintenance rule that "Docs must not link to transient project artifacts". The remaining piece — removing `projects/codec-async-single-path/**` and stripping repo-wide references — is intentionally out of scope this round (T5.11 / T5.12) and is the orchestrator's close-out work.

---

**Scoreboard delta (m5 R1, implementer view):** AC-SE1 → PASS; AC-SE3 → PASS; AC-DW1 → PASS; AC-DW2 → PASS. AC-SE2 → PARTIAL (deferred for redaction-trigger work). AC-SE4 → PARTIAL (JSON-Schema piece PASS; include-aggregate piece deferred). AC-DW3 → PARTIAL (ADR migration content satisfied; cleanup pending close-out PR).
