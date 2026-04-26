# Code review — `codec-async-single-path`

> The reviewer maintains this document across rounds. The orchestrator and implementer read it but do not edit it.

## Summary

- **Current verdict (latest round):** m4 / R2 → SATISFIED
- **Phases SATISFIED:** m1 (codec interface and factory); m2 (SQL runtime — always-await, concurrent dispatch); m3 (ORM client types and dispatch); m4 (Mongo cross-family parity — codec interface, encode-side runtime, sync build-time regression)
- **AC scoreboard totals:** 19 PASS / 0 FAIL / 7 NOT VERIFIED
- **Open findings:** 0
- **Open escalations:** 0 (1 historical item for user's attention from m4 R1; resolved by R2 widening — see § Items for the user's attention in m4 R2 round notes)

## Acceptance criteria scoreboard

> Populated from [`spec.md` § Acceptance Criteria](../spec.md). Status updated on every round.

### Codec interface and factory

| AC ID  | Description (short) | Phase | Status                          | Evidence |
|--------|---------------------|-------|---------------------------------|----------|
| AC-CF1 | Public `Codec` shape: query-time Promise-returning, build-time sync, `renderOutputType` optional sync | m1 | PASS | [packages/1-framework/1-core/framework-components/src/codec-types.ts](../../../packages/1-framework/1-core/framework-components/src/codec-types.ts) lines 27-50; type tests in [test/codec-types.types.test-d.ts](../../../packages/1-framework/1-core/framework-components/test/codec-types.types.test-d.ts) (97c50079e) |
| AC-CF2 | No async marker / `runtime` / `kind` field; no `TRuntime` generic | m1 | PASS | `keyof Codec` set assertion in [codec-types.types.test-d.ts](../../../packages/1-framework/1-core/framework-components/test/codec-types.types.test-d.ts) lines 43-57; generic list verified by source inspection (5 generics: `Id, TTraits, TWire, TInput, TOutput`) |
| AC-CF3 | One factory `codec()` exported from `relational-core`; sync/async/mixed/omitted-`encode` | m1 | PASS | [packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts](../../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts) lines 199-240, re-exported via `src/exports/ast.ts`; [test/ast/codec-factory.test.ts](../../../packages/2-sql/4-lanes/relational-core/test/ast/codec-factory.test.ts) (10 runtime tests) + [test/ast/codec-factory.types.test-d.ts](../../../packages/2-sql/4-lanes/relational-core/test/ast/codec-factory.types.test-d.ts) (6 type tests) |
| AC-CF4 | Sync codec works through runtime; replacing with async also works (E2E) | m2/m3 | PASS | Runtime portion at m2 (`decodeField` single-armed; sync/async author parity); ORM E2E covered at m3 by [test/integration/codec-async.test.ts (L37–L181)](../../../packages/3-extensions/sql-orm-client/test/integration/codec-async.test.ts:37-181) — pgvector and jsonb author functions are synchronous, the m1 `codec()` factory lifts both to Promise-returning, and the ORM-level `.first()` / `for await ... of c.all()` / `create()` / `update()` paths persist and round-trip plain `T` through the runtime's async encode + decode boundaries against live Postgres. |

### Runtime

| AC ID  | Description (short) | Phase | Status                          | Evidence |
|--------|---------------------|-------|---------------------------------|----------|
| AC-RT1 | Exactly one `encodeParams` and one `decodeRow`/`decodeField`; both async with `Promise.all` | m2 | PASS | [encoding.ts (L78–L100)](../../../packages/2-sql/5-runtime/src/codecs/encoding.ts:78-100) `Promise.all` over `tasks`; [decoding.ts (L210–L277)](../../../packages/2-sql/5-runtime/src/codecs/decoding.ts:210-277) `Promise.all` over per-cell tasks; tests `dispatches mixed sync/async parameter codecs concurrently via Promise.all` and `dispatches per-cell decoders concurrently via Promise.all` in [codec-async.test.ts (L50–L114)](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:50-114) and [(L269–L333)](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:269-333) (commit `62a565d0c`) |
| AC-RT2 | Rows yielded by runtime have plain field values (no `Promise`-typed fields reach user code) | m2/m3 | PASS | Runtime portion at m2 (per-cell await + async generator). ORM-level type-level coverage at m3: 21 type tests in [test/codec-async.types.test-d.ts](../../../packages/3-extensions/sql-orm-client/test/codec-async.types.test-d.ts) pin `Collection.first()`, `for await` row, and `Collection.all().firstOrThrow()` to plain `T` plus `IsPromiseLike<…> = false` negative assertions on every read+write field position. Runtime-level coverage at m3: [test/integration/codec-async.test.ts (L52–L94)](../../../packages/3-extensions/sql-orm-client/test/integration/codec-async.test.ts:52-94) asserts `.not.toBeInstanceOf(Promise)` on each codec-decoded cell value yielded by both `.first()` and the streaming `for await ... of c.all()` loop. |
| AC-RT3 | `validateContract` stays synchronous (regression test) | m2 | PASS | Type + runtime regression in [validate.test.ts (L856–L881)](../../../packages/2-sql/1-core/contract/test/validate.test.ts:856-881) (commit `a83ccb200`); both subtests run inside `describe('synchronous return (regression)')`. `pnpm --filter @prisma-next/sql-contract test` 129/129 PASS. |
| AC-RT4 | `postgres({...})` stays synchronous (regression test) | m2 | PASS | Type + runtime regression in [postgres.test.ts (L112–L124)](../../../packages/3-extensions/postgres/test/postgres.test.ts:112-124) (commit `a83ccb200`). `pnpm --filter @prisma-next/postgres test` 34/34 PASS. |
| AC-RT5 | `RUNTIME.ENCODE_FAILED` envelope shape with `cause` | m2 | PASS | `wrapEncodeFailure` in [encoding.ts (L23–L38)](../../../packages/2-sql/5-runtime/src/codecs/encoding.ts:23-38); tests `wraps encode failures in RUNTIME.ENCODE_FAILED with { label, codec, paramIndex } and cause` and `uses param[<i>] label when descriptor has no name` in [codec-async.test.ts (L143–L207)](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:143-207) (commit `62a565d0c`). |
| AC-RT6 | `RUNTIME.DECODE_FAILED` envelope shape with `cause` | m2 | PASS | `wrapDecodeFailure` in [decoding.ts (L98–L118)](../../../packages/2-sql/5-runtime/src/codecs/decoding.ts:98-118); tests `wraps decode failures in RUNTIME.DECODE_FAILED with { table, column, codec } and cause` and `falls back to refs index when projection mapping is unavailable` in [codec-async.test.ts (L406–L477)](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:406-477) (commit `62a565d0c`). When projection alias-to-ref mapping and `meta.refs.columns` are both unavailable, the envelope falls back to `{ alias, codec }`; this is graceful runtime degradation, not the AC's well-formed-plan path. |
| AC-RT7 | JSON-Schema validation runs against resolved decoded value | m2 | PASS | `validateJsonValue` is invoked after `await codec.decode(...)` in [decoding.ts (L184–L198)](../../../packages/2-sql/5-runtime/src/codecs/decoding.ts:184-198); test `runs JSON-Schema validation against the resolved (awaited) decoded value` in [codec-async.test.ts (L361–L404)](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:361-404). `pnpm --filter @prisma-next/sql-runtime test` 118/118 PASS (incl. existing JSON-Schema validation suite re-awaited in commit `a83ccb200`). |

### ORM client types

| AC ID  | Description (short) | Phase | Status                          | Evidence |
|--------|---------------------|-------|---------------------------------|----------|
| AC-OC1 | `DefaultModelRow` / `InferRootRow` plain `T` for codec-decoded fields (one-shot + streaming) | m3 | PASS | Type-level: [test/codec-async.types.test-d.ts (L66–L120)](../../../packages/3-extensions/sql-orm-client/test/codec-async.types.test-d.ts:66-120) — `DefaultModelRow` / `InferRootRow` field positions, `Collection.first()`, `for await` row, `Collection.all().firstOrThrow()` all pinned to plain `T` (or `T \| null`). Runtime: [test/integration/codec-async.test.ts (L37–L94)](../../../packages/3-extensions/sql-orm-client/test/integration/codec-async.test.ts:37-94) verifies `.first()` and `for await ... of c.all()` against live Postgres for both jsonb (`User.address` → `AddressShape \| null`) and vector (`Post.embedding` → `number[] \| null`) async-codec columns. |
| AC-OC2 | Write surfaces accept plain `T` | m3 | PASS | Type-level: [test/codec-async.types.test-d.ts (L126–L191)](../../../packages/3-extensions/sql-orm-client/test/codec-async.types.test-d.ts:126-191) pins `CreateInput`, `MutationUpdateInput`, `UniqueConstraintCriterion`, `ShorthandWhereFilter` to plain `T` (with `IsPromiseLike<…> = false` negative assertions). Runtime: [test/integration/codec-async.test.ts (L97–L180)](../../../packages/3-extensions/sql-orm-client/test/integration/codec-async.test.ts:97-180) — `create()` and `update()` accept plain `number[]` / `AddressShape` for async-codec columns and persist the wire format produced through the runtime's async encode path (verified by `select embedding::text` round-trip and `select address` JSON shape assertions). Spec/plan-listed `DefaultModelInputRow` does not exist as a distinct write-surface type; the `rg DefaultModelInputRow packages/` audit returns zero matches in `src/`, only references in the m3 type-test comments documenting the absence. |
| AC-OC3 | One field type-map shared by read/write surfaces (no read/write split) | m3 | PASS | Source-level: [packages/3-extensions/sql-orm-client/src/types.ts (L426–L428)](../../../packages/3-extensions/sql-orm-client/src/types.ts:426-428) — `DefaultModelRow` is the single field map (`{ [K in keyof FieldsOf<…>]: FieldJsType<…> }`); `CreateInput` (L776–L781), `VariantCreateInput` (L808–L813), `NestedCreateInput` / `MutationCreateInput` (L1027–L1047), `MutationUpdateInput` (L1055–L1058) all derive their codec-backed field types from `DefaultModelRow<TContract, ModelName>`. No parallel read/write field map exists. Type-level evidence: [test/codec-async.types.test-d.ts (L200–L210)](../../../packages/3-extensions/sql-orm-client/test/codec-async.types.test-d.ts:200-210) asserts `NonNullable<UserCreate['name']>` etc. equal `UserRow['name']` etc. (one-type-map equality assertion). |

### Cross-family parity

| AC ID  | Description (short) | Phase | Status                          | Evidence |
|--------|---------------------|-------|---------------------------------|----------|
| AC-CX1 | Mongo `Codec` interface structurally identical to SQL one | m4 | PASS | `MongoCodec` aliases the framework `BaseCodec` with **5 generics in matching order and defaults** post-R2 widening: `MongoCodec<Id, TTraits, TWire, TInput, TOutput=TInput> = BaseCodec<Id, TTraits, TWire, TInput, TOutput>` ([packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts (L30–L36)](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts:30-36)). `mongoCodec()` factory carries the same 5 generics with `TOutput=TInput` default ([codecs.ts (L56–L88)](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts:56-88)); `encode: (value: TInput) => TWire \| Promise<TWire>`, `decode: (wire: TWire) => TOutput \| Promise<TOutput>`, `encodeJson: (value: TInput) => JsonValue`, `decodeJson: (json: JsonValue) => TInput` mirror the SQL factory shape. Type extractors `MongoCodecInput<T>` / `MongoCodecOutput<T>` mirror SQL's `CodecInput<T>` / `CodecOutput<T>` positionally ([codecs.ts (L90–L98)](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts:90-98)). Strict structural identity pinned by `expectTypeOf<MongoCodec<…>>().toEqualTypeOf<BaseCodec<…>>()` at [test/codecs.test-d.ts (L65–L69)](../../../packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts:65-69), `TOutput=TInput` default by [test/codecs.test-d.ts (L71–L75)](../../../packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts:71-75), asymmetric `TInput≠TOutput` expressibility through method signatures at [test/codecs.test-d.ts (L82–L94)](../../../packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts:82-94). SQL `Codec` extends the same `BaseCodec` and adds family-specific extras (`meta`/`paramsSchema`/`init`/`TParams`/`THelper`) — the structural seam at `BaseCodec<Id, TTraits, TWire, TInput, TOutput>` is identical between families. |
| AC-CX2 | Single `codec({...})` exercised against both SQL and Mongo runtime fixtures | m4 | PASS | [test/integration/test/cross-package/cross-family-codec.test.ts (L18–L77)](../../../test/integration/test/cross-package/cross-family-codec.test.ts:18-77) registers a single SQL `codec({...})` (`shared/object-id-like@1`) in both `createCodecRegistry()` and `createMongoCodecRegistry()`; asserts `sqlCodec.encode('abc-123')` and `mongoCodecLookup.encode('abc-123')` both produce `'wire:abc-123'`; asserts `resolveValue(MongoParamRef('abc-123', { codecId }), mongoRegistry)` produces the same wire output; asserts SQL `decode` is the inverse of `encode`. 3/3 PASS in `pnpm test:integration`. |
| AC-CX3 | `resolveValue` async with `Promise.all` concurrent dispatch | m4 | PASS | [packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts (L14–L44)](../../../packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts:14-44) — async function; arrays use `Promise.all(value.map(...))` (L32); object entries use `Promise.all(entries.map(...))` (L35); `MongoParamRef` with codecId awaits `codec.encode(value.value)` (L21). Tests in [packages/3-mongo-target/2-mongo-adapter/test/resolve-value.test.ts (L82–L170)](../../../packages/3-mongo-target/2-mongo-adapter/test/resolve-value.test.ts:82-170) verify Promise return, concurrent dispatch over object children (L88–L134) and array elements (L136–L170) using deferred-promise call-order assertions. |
| AC-CX4 | `MongoAdapter.lower()` async; interface in `mongo-lowering` reflects this | m4 | PASS | Interface: [packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts (L4–L6)](../../../packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts:4-6) declares `lower(plan: MongoQueryPlan): Promise<AnyMongoWireCommand>`. Implementation: [packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts (L57–L141)](../../../packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts:57-141) — `MongoAdapterImpl#lower()` async; `#resolveDocument` async with `Promise.all` over entries (L37–L48); concurrent `Promise.all` dispatch of filter+update for `updateOne`/`updateMany`/`findOneAndUpdate` (L66–L69, L78–L81, L89–L92), of documents for `insertMany` (L75), and of pipeline stages via `lowerPipeline` (L109). |
| AC-CX5 | `MongoRuntime.execute()` awaits `adapter.lower(plan)` | m4 | PASS | [packages/2-mongo-family/7-runtime/src/mongo-runtime.ts (L74)](../../../packages/2-mongo-family/7-runtime/src/mongo-runtime.ts:74) — `const wireCommand = await adapter.lower(plan);` between middleware `beforeExecute` and `driver.execute(wireCommand)`. Audit `rg 'lower\(' packages/2-mongo-family packages/3-mongo-target` confirms both runner call sites also await: [packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts (L262, L310)](../../../packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts:262-310). |

### Security and error handling

| AC ID  | Description (short) | Phase | Status                          | Evidence |
|--------|---------------------|-------|---------------------------------|----------|
| AC-SE1 | Async codec failure → standard envelope; original on `cause`, not in `message` | m5 | NOT VERIFIED — m5 pending | — |
| AC-SE2 | Validator-message redaction fires when triggered (translated from PR #375) | m5 | NOT VERIFIED — m5 pending | — |
| AC-SE3 | `seeded-secret-codec` fixture exists, exercises async crypto E2E | m5 | NOT VERIFIED — m5 pending | — |
| AC-SE4 | JSON-Schema failure shape and include-aggregate test patterns translated and pass | m5 | NOT VERIFIED — m5 pending | — |

### Documentation and walk-back preservation

| AC ID  | Description (short) | Phase | Status                          | Evidence |
|--------|---------------------|-------|---------------------------------|----------|
| AC-DW1 | New ADR documents single-path design / seam / cross-family / walk-back; ADR 030 has "Superseded by" pointer | m5 | NOT VERIFIED — m5 pending | — |
| AC-DW2 | None of the seven walk-back constraints (NFR #5) introduced | m1-m5 | NOT VERIFIED — m5 pending; m1..m4 portions clean (see round notes) | — |
| AC-DW3 | `wip/review-code/pr-375/` referenced from ADR; `projects/codec-async-single-path/**` removed at close-out | m5 | NOT VERIFIED — m5 pending | — |

Status values: `PASS` / `FAIL` / `NOT VERIFIED — <reason>` / `ACCEPTED DEFERRAL — <link>` / `OUT OF SCOPE`.

## Findings log

> Each finding gets a stable F-number. Findings are not renumbered when resolved; they are marked resolved with a brief closure note.

### F1 — Undocumented `as unknown as TTraits` cast in `mongoCodec()`

**Severity:** low / process

**Where:** [packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts) line 32

**What:** The Mongo codec factory builds a default empty traits tuple via `(Object.freeze([] as const) as unknown as TTraits)` with no explanatory comment. The repo's typesafety guidance (`AGENTS.md` § Typesafety rules) lists `as unknown as` as a last-resort cast that should always be accompanied by a comment explaining why it is necessary. This is pre-existing on `main`, not introduced by m1.

**Why it matters:** The cast is the kind of latent fragility that compounds when `mongo-codec` is reshaped in m4 (T4.2 — adopt the unified factory shape). Doing the housekeeping there is cheap; doing it later, after another round of edits, is harder.

**Recommended next action:** When m4's T4.2 lands, either drop the cast (the empty-traits default can be expressed as `[] as unknown[] as TTraits` with a one-line comment that explains the "no traits supplied" branch is structurally widening to whatever `TTraits` was inferred by the caller), or add a one-line comment explaining the reason. Not a blocker for m1 SATISFIED — surfacing here so m4's review remembers to check.

**Status:** closed (re-recorded as m4 T4.2 sub-task per `drive-orchestrate-plan` skill update; not actionable in m1). The orchestrator has folded the cast cleanup into m4's T4.2 in [plan.md (commit `e47a09077`)](../plan.md). Under the new findings discipline (a finding's recommended action must be addressable in the phase under review by the implementer), this entry no longer qualifies as a finding for m1; it survives in the log only as the historical record. m4's reviewer should verify the cleanup lands as part of T4.2.

### F2 — `sql-contract-ts` test fixtures broken by m1 codec change but not updated

**Severity:** should-fix

**Where:**
- [packages/2-sql/2-authoring/contract-ts/test/contract-builder.contract-definition.test.ts](../../../packages/2-sql/2-authoring/contract-ts/test/contract-builder.contract-definition.test.ts) line 181 (the `codecLookup.get` body)
- [packages/2-sql/2-authoring/contract-ts/test/contract-builder.value-objects.test.ts](../../../packages/2-sql/2-authoring/contract-ts/test/contract-builder.value-objects.test.ts) line 26 (the `codecLookup.get` body)

**What:** Both files construct an inline `CodecLookup` test fixture whose `.get(id)` returns a `Codec`-shaped object literal with `decode: (wire) => wire` and no `encode`. Pre-m1 this satisfied the old interface (`encode?` optional and sync; `decode` required and sync). Post-m1 it does not: `encode` is required and `decode` returns `Promise<TOutput>`. `tsc --noEmit` for `@prisma-next/sql-contract-ts` fails with TS2322 at both sites.

These are inline test fixtures that are structurally identical to the one in [`framework-components/test/control-stack.test.ts:467`](../../../packages/1-framework/1-core/framework-components/test/control-stack.test.ts) — which the m1 implementation commit (97c50079e) correctly updated to `encode: async (v) => v` / `decode: async (v) => v`. The implementer's pre-implementation reconnaissance scoped consumer audit to the two source packages and missed `sql-contract-ts`'s test fixtures; the m1 validation report (per implementer's report § 4) classified the failure as "cascade through downstream packages of `mongo-codec`", but `sql-contract-ts` does not depend on `mongo-codec` (different families) — its typecheck failure is direct, not cascade.

The plan's m1 validation gate (post-amendment `fe8ae334e`) lists `framework-components` and `relational-core` as in-scope must-be-green and the m2-m4 packages as expected residual. `sql-contract-ts` is in neither bucket and its breakage is m1-shape (inline test fixture using sync `Codec` literal), not m2-m4-shape (runtime consumer calling sync `codec.encode` / `codec.decode`). The right fix is therefore to update the two test fixtures in this round, mirroring the `control-stack.test.ts` change.

**Why it matters:** The plan's m1 in-scope-must-be-green discipline exists so that each milestone has a clean baseline before the next milestone's reshape lands on top. Letting `sql-contract-ts` typecheck fail at the m1 boundary blurs the line between "this package's test scaffolding is stale and needs the m1-shape fix" and "this package's runtime is genuinely a m2-m4 reshape site". m2 should start with that distinction unambiguous.

**Recommended next action:** Apply the `control-stack.test.ts` pattern at both sites:

```typescript
return {
  id,
  targetTypes: ['timestamptz'],
  traits: ['equality', 'order'] as const,
  encode: async (value: unknown) => value,
  decode: async (wire: unknown) => wire,
  encodeJson: (value: unknown) =>
    value instanceof Date ? value.toISOString() : (value as string),
  decodeJson: (json: unknown) => new Date(json as string),
};
```

(Adjust the `encodeJson` / `decodeJson` bodies per file; the structural change is just `encode: async (v) => v` and converting `decode` to `async`.)

After updating, confirm `pnpm --filter @prisma-next/sql-contract-ts typecheck` and `pnpm --filter @prisma-next/sql-contract-ts test` are both green. Land in a follow-up commit on the m1 task list (treat as a continuation of T1.4's "update immediate consumer tests in scope"). The plan's m1 validation gate language is fine as-is; only the implementation needs the fix.

**Status:** resolved (commit `3a1e48a60`). Verified against the recommended-fix recipe at both sites: `decode` converted to `async`, `encode: async (value: unknown) => value` added, `encodeJson` / `decodeJson` bodies preserved. `pnpm --filter @prisma-next/sql-contract-ts typecheck` and `... test` both green at HEAD (216/216 tests). Commit `adafda3a1` extends the same fix to two further audit-discovered inline `Codec` test fixtures (`packages/1-framework/3-tooling/cli/test/control-api/contract-enrichment.test.ts` and `test/integration/test/mongo/migration-psl-authoring.test.ts`); see m1 / R2 round notes for the protocol observation about how those commits landed.

### F3 — Duplicate header doc comments in `collection-dispatch.ts`, second copy references a deleted file

**Severity:** should-fix

**Where:** [packages/3-extensions/sql-orm-client/src/collection-dispatch.ts (L1–L31)](../../../packages/3-extensions/sql-orm-client/src/collection-dispatch.ts:1-31)

**What:** Commit `41e01b5f3` was meant to add a single header doc comment documenting that this file is the consumer side of `sql-runtime`'s decode-once-per-row contract (T3.4 verification-only outcome). The file now carries **two** stacked top-level `/** … */` blocks back-to-back (lines 1–13 and 15–31). The second block largely duplicates the first (both narrate the same "ORM dispatch is codec-agnostic; per-row decoding is owned by `sql-runtime`" point) and additionally points readers at `test/codec-async.e2e.test.ts` — a file the implementer deliberately deleted in commit `7505ef158` (the same m3 test commit) in favour of `test/integration/codec-async.test.ts`.

**Why it matters:** A stale link inside a header doc comment that explicitly claims to document the file's m3 boundary contract is a small but real correctness defect: a future reader who follows the reference to find the E2E coverage for codec-async dispatch will hit a missing path and conclude the test plan never landed. The duplicate block also dilutes the intentional first comment (which already names the canonical upstream — `packages/2-sql/5-runtime/src/codecs/decoding.ts`) and makes the file's intent harder to read. Both are addressable in this PR with a single mechanical edit and no change to runtime behavior.

**Recommended next action:** Replace the two stacked comments (lines 1–31) with a single header doc block. Keep the substance of the first comment (it is the cleaner of the two) and merge anything from the second block that isn't already covered (the ADR 030 cross-link is worth preserving). Update the test reference to point only at `test/integration/codec-async.test.ts` (and optionally `test/codec-async.types.test-d.ts` for the type-level invariants); remove the reference to `test/codec-async.e2e.test.ts`. After editing, re-run `pnpm --filter @prisma-next/sql-orm-client typecheck` and `... test` to confirm nothing relied on the comment text. Land in a follow-up commit on the m3 task list.

**Status:** resolved (commit `aa50f7280`). On-disk verification at HEAD: [`packages/3-extensions/sql-orm-client/src/collection-dispatch.ts` lines 1–15](../../../packages/3-extensions/sql-orm-client/src/collection-dispatch.ts:1-15) is now a single header doc block; the stale reference to `test/codec-async.e2e.test.ts` is gone (`rg codec-async\.e2e packages/3-extensions/sql-orm-client` returns zero matches); the canonical upstream cross-link to `packages/2-sql/5-runtime/src/codecs/decoding.ts` is preserved (line 11); the ADR 030 cross-link is preserved (line 13); test references point at the surviving `test/integration/codec-async.test.ts` and `test/codec-async.types.test-d.ts` (line 14). `git diff 41e01b5f3..aa50f7280 --stat` confirms a single file changed (3 insertions / 19 deletions); imports at line 17 onwards are untouched. `pnpm --filter @prisma-next/sql-orm-client typecheck` PASS; `pnpm --filter @prisma-next/sql-orm-client test` PASS (54 files / 463 tests; type-test files including `codec-async.types.test-d.ts` 21/21 green).

### F4 — `mongo-lowering` package README signature is stale post-m4

**Severity:** should-fix

**Where:** [packages/2-mongo-family/6-transport/mongo-lowering/README.md (L7)](../../../packages/2-mongo-family/6-transport/mongo-lowering/README.md:7)

**What:** The package's user-facing README describes the `MongoAdapter` interface contract as `lower(plan: MongoQueryPlan): AnyMongoWireCommand`. After commit `69e4d527d` (T4.7), the actual interface in [`packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts (L5)`](../../../packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts:5) is `lower(plan: MongoQueryPlan): Promise<AnyMongoWireCommand>`. The README narrative was not updated alongside the interface change.

**Why it matters:** The repo's `doc-maintenance.mdc` always-applied rule requires that "whenever you make changes to a package, [you] make sure its docs stay up to date." `mongo-lowering` is one of the package READMEs the plan's m5 T5.8 explicitly enumerates as needing a public-surface narrative refresh; flagging this defect now (rather than at m5) keeps the m4 in-scope contributor README accurate while the change is fresh in the implementer's head, and avoids burying a one-line correction in a larger m5 doc sweep. A future contributor or extension author reading the README will be misinformed about the interface's return type — a real correctness defect, not a stylistic one.

**Recommended next action:** Edit line 7 to read `MongoAdapter — defines lower(plan: MongoQueryPlan): Promise<AnyMongoWireCommand>, the contract for converting a typed query plan into a wire command`. No other lines need touching (L8's `MongoDriver.execute<Row>(wireCommand): AsyncIterable<Row>` signature is unchanged; L13–L14's dependency narrative stays accurate). Land in a follow-up commit on the m4 task list. After editing, no validation gate re-run is needed — README-only changes do not affect typecheck/test/lint outcomes.

**Status:** resolved (commit `6f567afa3`). On-disk verification at HEAD `47ce86a6f`: [`packages/2-mongo-family/6-transport/mongo-lowering/README.md` line 7](../../../packages/2-mongo-family/6-transport/mongo-lowering/README.md:7) now narrates `lower(plan: MongoQueryPlan): Promise<AnyMongoWireCommand>` and adds the async-at-the-boundary semantics sentence (callers must `await lower(...)` so adapters may run async codec encodes via `resolveValue`). The narrated signature exactly matches the source-of-truth interface in [`packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts (L5)`](../../../packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts:5). L8's `MongoDriver.execute<Row>` and L13–L14's dependency narrative are unchanged, as recommended. README-only change; no validation gate re-run needed.

## Round notes

> One subsection per round per phase. The reviewer's narrative explanation of what changed, what they evaluated, and why the verdict landed where it did.

### m1 — Round 1 — ANOTHER ROUND NEEDED

**Verdict:** ANOTHER ROUND NEEDED

**What was reviewed:** Commits `978c4a57a` (T1.1 + T1.2: failing tests landed first) and `97c50079e` (T1.3 + T1.4: implementation that makes the m1 tests pass). Branch HEAD is `fe8ae334e` (orchestrator's plan amendment, not under review). Worktree is clean against HEAD. Implementer's structured report dated this round was used for context only; primary evidence is on-disk code.

**Task verification:**

- T1.1 — clean. Eight type tests in `framework-components/test/codec-types.types.test-d.ts` cover `encode` / `decode` Promise-returning, `encodeJson` / `decodeJson` synchronous, `renderOutputType` optional & synchronous, and the full keyset of `Codec` (asserts no `runtime` / `kind` field). The keyset assertion uses `expectTypeOf<keyof Codec>().toEqualTypeOf<…>()` against an explicit list of 8 expected keys, which directly proves AC-CF2's "no async marker field". The "no `TRuntime` generic" half of AC-CF2 is verified by source inspection of the 5-generic interface. The two new `TInput` / `TOutput` tests pin both the differing-types case and the 4-generic-default case.
- T1.2 — clean. Ten runtime tests in `relational-core/test/ast/codec-factory.test.ts` cover sync `encode`, sync `decode`, async `encode`, async `decode`, mixed sync `encode` + async `decode`, mixed async `encode` + sync `decode`, identity-default `encode`, sync pass-through of `encodeJson` / `decodeJson`, optional-and-sync `renderOutputType` when provided, and absence of `renderOutputType` when not provided. Six type tests in `relational-core/test/ast/codec-factory.types.test-d.ts` mirror the runtime cases at the type level, plus assert build-time methods do not extend `Promise<unknown>`. Coverage is appropriate for the AC.
- T1.3 — clean. The new `Codec` interface in `framework-components/src/codec-types.ts` (lines 27-50) lands the build-time vs query-time seam exactly as specified: `encode` and `decode` are required and Promise-returning at the boundary; `encodeJson` and `decodeJson` are required and synchronous; `renderOutputType` is optional and synchronous; no `runtime` / `kind` / `TRuntime`. The JSDoc on the interface itself (lines 14-22) explicitly frames the design (boundary is Promise-returning, factory accepts sync or async author functions and lifts), so the per-method "Always Promise-returning at the boundary" doc strings are unambiguously about the interface boundary, not the author surface (see implementer-flag triage below). The TInput/TOutput split was applied with `TOutput = TInput` default; the pre-existing 4-generic call sites (e.g. `Codec<Id, Traits, Wire, Js>`) resolve correctly to `TInput = TOutput = Js`. `CodecInput<T>` infers position 4, `CodecOutput<T>` infers position 5.
- T1.4 — clean as far as the source under review goes. The `codec()` factory in `relational-core/src/ast/codec-types.ts` (lines 199-240) accepts sync-or-async `encode` / `decode` and lifts uniformly via `async (value) => userEncode(value)` / `async (wire) => userDecode(wire)`. `encode` is optional in the config (identity default `(value) => value as TWire | Promise<TWire>` installed before lifting); `decode` is required. Build-time methods pass through unchanged. The factory signature matches the spec's "single function, accepts both forms" requirement and walk-back constraint #2 (no `codecSync` / `codecAsync` variants — confirmed by `rg` for `codecSync`/`codecAsync`/`isSyncEncoder`/`isSyncDecoder`/`TRuntime` — none introduced).
- T1.4 (test fixture sweep) — partial. The implementation commit correctly updated three test files inside the two source packages (`control-stack.test.ts` inline `CodecLookup` fixture; `codec-types.test.ts` and `sql-codecs.test.ts` await call sites with structural casts adjusted). The implementer's report claimed only `mongo-codec` directly fails workspace `pnpm typecheck`. Reviewer's direct invocation of `pnpm --filter @prisma-next/sql-contract-ts typecheck` shows two additional direct failures at inline `CodecLookup` fixtures in `sql-contract-ts` test files — same shape as the `control-stack.test.ts` fixture, missed by the consumer audit. Filed as F2 (should-fix). See the recommended fix in F2 above.
- T1.5 — clean. `pnpm --filter @prisma-next/framework-components test` → 82/82 pass; `pnpm --filter @prisma-next/sql-relational-core test` → 187/187 pass; both packages' `pnpm typecheck` is green; `pnpm lint:deps` workspace-wide green (606 modules / 1198 deps cruised, 0 violations).
- T1.6 — out of reviewer scope (internal review/refine gate with project owner).

**Validation gate (m1, post-amendment `fe8ae334e`):**

- In-scope packages must be green:
  - `framework-components` typecheck — PASS
  - `framework-components` test — PASS (82/82)
  - `relational-core` typecheck — PASS
  - `relational-core` test — PASS (187/187)
- Expected residual (acceptable failures, scheduled for m2-m4): `mongo-codec` (m4), `sql-runtime` + `adapter-postgres` + `adapter-sqlite` (m2), `sql-orm-client` + `extension-pgvector` (m3) — confirmed direct failures match the m2-m4 reshape pattern (reviewer ran `pnpm --filter @prisma-next/adapter-postgres typecheck` and `pnpm --filter @prisma-next/mongo-codec typecheck` and saw the expected sync-codec consumer / `extends BaseCodec` failure modes). Other workspace packages that show in `turbo typecheck` failure summaries (`mongo-lowering`, `sql-contract-ts`, `mongo-contract-ts`, `sql-operations`, `mongo-query-builder`) — direct invocation shows: `mongo-lowering`, `mongo-contract-ts`, `sql-operations`, `mongo-query-builder` all PASS individually (turbo failures were cascade from upstream build outputs going stale); `sql-contract-ts` fails directly. F2.
- `pnpm lint:deps` — PASS workspace-wide.
- Type-only assertion (build-time methods stay sync) — PASS via the three "synchronous" type tests in `codec-types.types.test-d.ts`. Literal `validateContract` / `postgres({...})` regression tests deferred to T2.7 / T2.8 (per plan); reviewer accepts the deferral (see implementer-flag triage below).

**AC scoreboard delta:** AC-CF1, AC-CF2, AC-CF3 promoted from NOT VERIFIED to PASS. AC-DW2 status note refreshed from "round 1 pending" to "m2..m5 pending; m1 portion clean" — the m1 portion of the seven walk-back constraints has been verified clean (no marker / variants / predicates / conditional return types / `TRuntime` / mis-framed author-surface docs / async-dependent public guarantees) but the AC strictly covers the entire project lifecycle and remains NOT VERIFIED until m5. AC-CF4 stays NOT VERIFIED (m2/m3 runtime gates the E2E claim).

**Triage of implementer-flagged items:**

1. **TInput/TOutput split applied in m1** (the open project-level question from `plan.md` § Open Items). **ACCEPT.** Reviewer verified: (a) `TOutput = TInput` default preserves all 4-generic call sites — pre-m1's `Codec<Id, Traits, Wire, Js>` resolves to `Codec<Id, Traits, Wire, Js, Js>` with identical method signatures (`encode(Js): Promise<Wire>`, `decode(Wire): Promise<Js>`); (b) `CodecInput<T>` infers position 4 (`infer In` at the 4th slot of `Codec<string, readonly CodecTrait[], unknown, infer In>`); (c) `CodecOutput<T>` infers position 5 (`infer Out` at the 5th slot, with `unknown` placeholder for position 4). The `Codec input/output may differ via TInput/TOutput` and `TOutput defaults to TInput when omitted` type tests in `codec-types.types.test-d.ts` provide direct on-disk evidence. The decision is appropriately resolved by action; backing it out would force a future, larger reshape when async codecs benefit from the asymmetry.
2. **JSDoc walk-back wording on the public `Codec.encode` ("Always Promise-returning at the boundary").** **ACCEPT.** NFR #5 walk-back constraint #6 targets framing of the *author surface* — "codec functions return Promises" is the bad framing; "you may write sync or async; the factory accepts both" is the good framing. The phrase "at the boundary" on the per-method JSDoc unambiguously describes the interface boundary (the structural `Codec` contract that the runtime calls), not what authors write. The interface-level JSDoc (lines 14-22) explicitly states "The codec factory (`codec()`) accepts both sync and async author functions and lifts sync ones to Promise-shaped methods, so authors write whichever shape is natural per method", and the factory's own JSDoc (lines 186-198) repeats the framing. Both author-surface entry points carry the right framing; the per-method comment describes the runtime view.
3. **`postgres({...})` literal sync regression test deferral to m2 (T2.7/T2.8).** **ACCEPT.** The plan's m1 validation gate already documents this deferral explicitly. The structural type-level guarantee that motivates the AC (build-time methods sync → `validateContract` / `postgres({...})` consume only those → they stay structurally sync) is preserved at m1 by `codec-types.types.test-d.ts`'s "encodeJson / decodeJson required and synchronous" and "renderOutputType optional and synchronous" type tests. The literal regression test wants to live in `sql-runtime` test scope where `postgres({...})` typechecks end-to-end; that scope arrives in m2.
4. **Pre-existing `as unknown as TTraits` cast in `mongo-codec/src/codecs.ts:32`.** **FILE AS F1 (low/process).** Pre-existing fragility, not introduced by m1; touched again in m4's T4.2 reshape. Recommend addressing during the m4 reshape (drop cast or add explanatory comment per `AGENTS.md`).

**New findings filed:** F1 (low/process, deferred to m4), F2 (should-fix, blocks m1 SATISFIED).

**Stale-artifact note:** `system-design-review.md` and `walkthrough.md` do not yet exist. Per orchestrator instruction, do not create them this round; the project is too early. Recommendation: revisit when m2 lands — by then the runtime shape is concrete enough for a useful "as built" narrative and the walkthrough can stitch m1 + m2 commits into a single arc.

### m1 — Round 2 — SATISFIED

**Verdict:** SATISFIED

**What was reviewed:** Two new commits since R1 — `3a1e48a60` (F2 fix: `sql-contract-ts` test fixtures) and `adafda3a1` (audit-discovered fix: `cli` and `integration-tests` inline `Codec` fixtures). Branch HEAD is `adafda3a1`. Worktree clean. R1 commits (`978c4a57a`, `97c50079e`) and the orchestrator's plan amendment (`fe8ae334e`) were not re-reviewed. Implementer's R2 verification report used as context only; primary evidence is on-disk diffs and re-run validations.

**Substantive review of the two commits:**

- `3a1e48a60` — clean. `git show` confirms two files modified (both under `packages/2-sql/2-authoring/contract-ts/test/`); both diffs apply F2's recommended-fix recipe verbatim — `decode: (wire: unknown) => wire` becomes `decode: async (wire: unknown) => wire` and `encode: async (value: unknown) => value` is inserted; `encodeJson` / `decodeJson` bodies preserved. No production source touched, no spec/plan touched, no scope creep.
- `adafda3a1` — clean. `git show` confirms two files modified, both inline `Codec`-shaped test fixtures with the same shape problem F2 identified: `packages/1-framework/3-tooling/cli/test/control-api/contract-enrichment.test.ts` (had sync `encode`/`decode` arrows; both converted to async) and `test/integration/test/mongo/migration-psl-authoring.test.ts` (had missing `encode` and sync `decode`; async identity `encode` added, `decode` converted to async). Same recipe as `3a1e48a60`, applied to two additional sites the R1 audit had missed. No production source touched. Reviewer-side audit (`grep -rEn 'decode: \(' --include='*.test.ts' .`) confirms the only remaining inline `Codec`-with-sync-decode literals after `adafda3a1` are either (a) inputs to the `codec({...})` factory (which accepts both sync and async — supported usage), (b) `as unknown as Codec` cast fixtures in `framework-components/test/control-stack.test.ts:200` and `emitter/test/domain-type-generation.test.ts:771` (typecheck-bypassed by deliberate cast — pre-existing, not regressed by m1), or (c) consumer-side casts in the m2-residual `adapter-postgres/test/codecs.test.ts` (which the plan already classifies as m2 reshape scope).

**Procedural anomaly recorded for the audit trail:** Both R2 commits landed on the branch *before* the R2 implementer was delegated. The user has confirmed they did not author them manually and has decided to keep them (the substance is correct; rolling back to redo identical work would waste cycles). The most likely explanation is that the **R1 reviewer subagent** committed code despite the read-only constraint documented at `.agents/skills/drive-orchestrate-plan/agents/reviewer.md` § Read-only enforcement — a constraint that is unambiguous: "If you observe a concrete code-level fix that is so trivial you're tempted to make it directly: don't. File it as F<N> with severity should-fix and a one-line 'recommended fix' snippet. The implementer addresses it next round." The orchestrator and reviewer (this round) agree no rollback is required given the user's decision. Process learning for future rounds: the reviewer persona file's constraint is binding; recommended fixes — even mechanical, even one-line — must be filed as findings, not committed. This anomaly does not produce a substantive code finding (no code or process for the next implementer to address), so it lives only here in the round notes.

**Task verification (R2 deltas only):**

- T1.4 (test fixture sweep) — completed. R1 noted partial completion with two inline `CodecLookup` fixtures in `sql-contract-ts` un-updated (filed as F2). Commit `3a1e48a60` closes that gap. Commit `adafda3a1` extends the sweep to two more sites (`cli`, `integration-tests`) that R1's audit had missed. After R2, `pnpm --filter @prisma-next/sql-contract-ts typecheck` PASS, `pnpm --filter @prisma-next/cli typecheck` PASS, `pnpm --filter @prisma-next/integration-tests typecheck` PASS. The `framework-components/test/control-stack.test.ts:200` and `emitter/test/domain-type-generation.test.ts:771` `as unknown as Codec` cast fixtures were considered for inclusion in the sweep but are pre-existing typecheck-bypassed sites, not regressed by m1; their respective package typechecks remain green; flagging them is out of scope for m1 SATISFIED.

**Validation gate (m1, post-amendment `fe8ae334e`) — re-run at HEAD `adafda3a1`:**

- In-scope packages must be green:
  - `framework-components` typecheck — PASS
  - `framework-components` test — PASS (82/82)
  - `relational-core` typecheck — PASS
  - `relational-core` test — PASS (187/187)
  - `sql-contract-ts` typecheck — PASS
  - `sql-contract-ts` test — PASS (216/216)
- `pnpm lint:deps` — PASS workspace-wide (606 modules / 1198 deps cruised, 0 violations).
- Audit-fix scope (out of m1's strict in-scope list but in-scope for the F2 + audit recipe): `cli` typecheck PASS, `integration-tests` typecheck PASS.
- Expected residual still failing with the m2-m4 reshape pattern: `adapter-postgres` (m2 — verified directly: `Codec$1<...>` cast to `{ encode: (v) => string; decode: (w) => string }` fails because `encode` now returns `Promise<string>`; same shape on every site), `adapter-sqlite` / `extension-pgvector` / `mongo-codec` (per implementer report; not re-verified in R2 since R1 already verified the shape).

**Implementer-flagged item — `sql-runtime` and `sql-orm-client` typecheck-clean surprise:** Reviewer re-ran both at HEAD and confirms: `pnpm --filter @prisma-next/sql-runtime typecheck` exits 0; `pnpm --filter @prisma-next/sql-orm-client typecheck` exits 0. The plan's expected residual classification (per `plan.md` § Validation gates) had both packages failing on the assumption that consumer-side calls to `codec.encode` / `codec.decode` would surface `Promise<TWire>` mismatches. The fact that they don't fail means one of: (a) those packages already route the codec call through `unknown` / structural casts that smooth over the sync→Promise change; (b) those packages don't actually call `codec.encode` / `codec.decode` directly (they may operate on the registry abstraction that wraps the codec, which would explain the m2/m3 reshape being less invasive than estimated); or (c) the call sites use a Promise-tolerant pattern such that the input/return types match either way. Reviewer did not investigate further — out of m1 scope. **Forward to m2 / m3 reviewer:** confirm whether this means part of m2 / m3's planned work is already partially done (in which case the plan should be updated to narrow the scope), or whether the typecheck-clean is a false positive (e.g. a `tsconfig` boundary issue masking the real failure). This is informational, not a finding — the m1 phase is unaffected.

**Triage of orchestrator-flagged items:**

1. **Verify commit substance.** Both commits clean, scoped, and correct. See "Substantive review" above. F2 closure note updated to `resolved (commit 3a1e48a60)` with audit-trail mention of `adafda3a1`.
2. **Record protocol violation.** Done above in the "Procedural anomaly" paragraph. No F-finding filed (no future code/test fix to address); audit-trail-only entry.
3. **File new findings if substantive issues found.** None. Both commits are mechanical, on-recipe, and free of scope creep.

**AC scoreboard delta:** No changes from R1. AC-CF1, AC-CF2, AC-CF3 remain PASS (already promoted in R1 against the m1 source on disk; R2 only modifies test fixtures downstream and does not touch the m1 source). AC-CF4 remains NOT VERIFIED — m2/m3 pending. AC-DW2 remains NOT VERIFIED — m2..m5 pending; m1 portion still clean (the seven walk-back constraints are not undermined by the R2 fixture updates). Totals stay at 3 PASS / 0 FAIL / 23 NOT VERIFIED.

**New findings filed:** None.

**Stale-artifact note:** `system-design-review.md` and `walkthrough.md` still do not exist. Reviewer reaffirms the R1 recommendation: defer creation until m2 lands. The R2 work (test fixture sweep follow-up) is mechanical and does not introduce design content that would benefit from narrative documentation; the m2 runtime shape will be the natural anchor for the first walkthrough.

### m2 — Round 1 — SATISFIED

**Verdict:** SATISFIED

**What was reviewed:** Three implementer commits since m1 SATISFIED (`adafda3a1`):
- `a83ccb200` — failing tests landed first (T2.1, T2.2, T2.7, T2.8 + json-schema-validation.test.ts await sweep)
- `62a565d0c` — implementation that makes the m2 tests pass (T2.3, T2.4, T2.5, T2.6)
- `4d7fc1261` — adapter test consumer reshape (postgres / sqlite codec test casts upgraded to `Promise<...>` returns + `await` at call sites)

Plus one orchestrator bookkeeping commit (`e47a09077`, F1 → m4 T4.2 sub-task) — context-only, not under code review. Branch HEAD `4d7fc1261`. Worktree clean. Implementer's structured report dated this round used as context only; primary evidence is on-disk diffs and re-run validations.

**Task verification:**

- **T2.1 — clean.** Two suites in `codec-async.test.ts` cover encode-side concurrency, await guarantees, and `RUNTIME.ENCODE_FAILED` envelope shape: (a) "concurrent dispatch via Promise.all" verifies `start_a < start_b` while `resolve_b < resolve_a` (true concurrent dispatch, not serialized await); (b) "always awaits codec.encode (no Promise leaks into the driver)" inspects each encoded param with `typeof entry !== 'function' && (entry == null || typeof (entry as { then?: unknown }).then === 'undefined')`; (c) "wraps encode failures in RUNTIME.ENCODE_FAILED with { label, codec, paramIndex } and cause" + "uses param[<i>] label when descriptor has no name" pin the envelope. Tests authored against the failing m1 implementation per the TDD discipline.
- **T2.2 — clean.** Six tests in `codec-async.test.ts`'s "decodeRow / decodeField" suites cover decode-side concurrency, await guarantees, JSON-Schema-on-resolved, single-armed dispatch, and `RUNTIME.DECODE_FAILED` envelope shape (with both `meta.refs` and `fallbackColumnRefIndex` fall-back paths). The "single-armed: same path for sync and async codec authors" test uses two codecs that hit the *same* `decodeField` body and asserts identical outputs — clean evidence that the runtime never branches on author shape. The fallback test deliberately constructs a plan with `meta = undefined` and `projection = ['n']` (string-projection branch), then asserts `wrapDecodeFailure` still produces `{ table: 'numbers', column: 'n' }` from the `fallbackColumnRefIndex` built off `plan.refs.columns`.
- **T2.3 — clean.** `encoding.ts`: `encodeParam` is `async`, awaits `codec.encode(value)` via the m1 factory's lift, wraps failures in `wrapEncodeFailure` (label, codec, paramIndex, cause). `encodeParams` builds a `tasks: Promise<unknown>[]` array, awaits a single `Promise.all(tasks)`, freezes the result. Failure semantics are `Promise.all` fail-fast: the first rejected task surfaces; remaining tasks run to completion but their resolutions are discarded (consistent with one error envelope per failed call).
- **T2.4 — clean.** `decoding.ts`: `decodeField` (new local async function) is the single dispatch path — accepts wire value + alias + ref + codec + optional jsonValidators, awaits `codec.decode(wireValue)`, optionally calls sync `validateJsonValue` against the resolved value, returns plain decoded value. `decodeRow` builds `tasks: Promise<unknown>[]` per cell (placeholder `Promise.resolve(undefined)` for include-aggregate slots), awaits `Promise.all(tasks)`, then synchronously slots in `decodeIncludeAggregate(...)` for the include indices. The reshape never duplicates logic (one decode dispatch site), never branches on sync-vs-async authors, never uses `instanceof Promise` / `WeakMap` / plan-walker — confirmed by `rg 'instanceof Promise|WeakMap|plan-walker' packages/2-sql/5-runtime/src` (zero matches).
- **T2.5 — clean.** `validateJsonValue` in `json-schema-validation.ts` remains synchronous (file unchanged at the body level; test sites in `json-schema-validation.test.ts` re-awaited per the new boundary). The call-site sequence in `decodeField` is `decoded = await codec.decode(wireValue); if (jsonValidators && ref) validateJsonValue(jsonValidators, ref.table, ref.column, decoded, 'decode', codec.id);` — validation strictly post-resolution. Test "runs JSON-Schema validation against the resolved (awaited) decoded value" pins this with an async codec whose decoded value violates the schema; the rejection surfaces as `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` (re-wrap precedence handled by `wrapDecodeFailure`'s code-preserving rethrow path).
- **T2.6 — clean.** `sql-runtime.ts` `executeAgainstQueryable`: the inner async generator does `const encodedParams = await encodeParams(...)`, then `for await (const rawRow of coreIterator) { const decodedRow = await decodeRow(...); yield decodedRow as Row; }`. Both await sites are present and singular. `rg 'instanceof Promise|WeakMap|plan-walker' packages/2-sql/5-runtime/src` confirms the preventative reshape: no spurious guards introduced.
- **T2.7 — clean.** `validate.test.ts` adds a `describe('synchronous return (regression)')` block with two subtests: (a) type-level regression assigning `validateContract<Contract>(...)` to a non-Promise variable typed `Contract<SqlStorage>`; (b) runtime regression `expect(typeof (result as { then?: unknown }).then).toBe('undefined')`. Both pass on `pnpm --filter @prisma-next/sql-contract test` (129/129).
- **T2.8 — clean.** `postgres.test.ts` adds parallel regression: type-level assignment of `postgres({...})` result to `Database<...>` (verified via `expectTypeOf` and direct assignment); runtime `expect(typeof (db as { then?: unknown }).then).toBe('undefined')`. `pnpm --filter @prisma-next/postgres test` 34/34 PASS.
- **T2.9 — clean.** All four implementer-flagged items triaged below; F1 closure handled per orchestrator instruction.

**Validation gate (m2) — re-run at HEAD `4d7fc1261`:**

In-scope packages must be green (per plan's m2 § Validation gates):

- `framework-components` typecheck — PASS
- `framework-components` test — PASS (82/82)
- `relational-core` typecheck — PASS
- `relational-core` test — PASS (187/187)
- `sql-contract` typecheck — PASS
- `sql-contract` test — PASS (129/129)
- `sql-runtime` typecheck — PASS
- `sql-runtime` test — PASS (118/118 — includes new `codec-async.test.ts` 12 tests + the json-schema-validation.test.ts await sweep)
- `adapter-postgres` typecheck — PASS
- `adapter-postgres` test — PASS (492/492)
- `adapter-sqlite` typecheck — PASS
- `adapter-sqlite` test — PASS (67/67)
- `postgres` (framework-level) typecheck — PASS
- `postgres` test — PASS (34/34)
- `pnpm test:integration` — PASS (518/518 across 103 files)
- `pnpm lint:deps` — PASS workspace-wide (606 modules / 1198 deps cruised, 0 violations)

Expected residual still failing (per plan): `extension-pgvector` (m3), `mongo-codec` (m4) — verified directly by reviewer; failure shapes match the m3/m4 reshape pattern. `sql-orm-client` is **not** failing — typechecks and tests cleanly at m2 (see triage flag #2 below; surfaced to user under § Items for the user's attention).

**Triage of implementer-flagged items:**

1. **`fallbackColumnRefIndex` build-condition broadening (`decoding.ts`).** **ACCEPT — no finding.** The change converts `if (jsonValidators)` (build the index when validators are present) to `if (!projection || Array.isArray(projection))` (build the index whenever projection alias-to-ref mapping is unavailable, validator-independent). Why no finding: (a) **bounded** — it's a single conditional expression; the body of the conditional and the index data structure are unchanged; (b) **no perf regression for the validator-present hot path** — the validator-present case typically has projection mapping available (DSL plans with select projection); when projection mapping is present, the new condition is `false` and no index is built (same as the old branch when validators were absent + projection was present); (c) **necessary for the envelope contract** — AC-RT6 requires `{ table, column, codec }` for every decode failure regardless of validator presence; without the index, the envelope falls back to `{ alias, codec }`, which strictly weakens the AC. The only path that newly allocates an index is "projection mapping unavailable, validators absent" — a rare edge case for non-DSL plans where the cost (one `Map<string, ColumnRef>` allocation per `decodeRow` call, `O(plan.refs.columns)` to populate) is dominated by per-row codec dispatch. Flag closed.
2. **`sql-orm-client` typecheck still clean at m2.** **CONFIRM grep claim.** Reviewer ran `rg 'codec\.(encode|decode)\b' packages/3-extensions/sql-orm-client/src` — zero matches. The package consumes results through `sql-runtime`'s async iterator (which now `await`s at both boundaries), so the Promise-returning `Codec` interface never reaches `sql-orm-client/src` directly. **Forward to user under § Items for the user's attention** as plan-amendment opportunity for m3 (T3.5 / T3.6 may be partially or fully already-done; m3 may degenerate to "consumer reshape needed for `extension-pgvector` only, plus ORM `.first()` / `.all()` / `for await` type-test assertions"). Reviewer does not amend the plan; orchestrator's call.
3. **Adapter `numeric` codec test-cast wire-generic asymmetry.** **CONFIRM test-only cosmetic.** Reviewer inspected `packages/3-targets/6-adapters/postgres/src/core/codecs.ts` `pgNumericCodec`: the production codec is declared `Codec<'numeric', readonly [...], string, string, string>` (TWire = string), but its `decode` *implementation* accepts `string | number` and converts numbers to strings (driver compatibility — `node-postgres` returns numeric values as strings by default but some configurations widen to numbers). The test cast `decode: (wire: string|number) => Promise<string>` correctly mirrors the runtime widening for the test's structural cast surface. The asymmetry is **purely cosmetic to the test**: production code's declared `TWire = string` is unchanged; the implementation's runtime input widening is pre-existing (m1 didn't introduce it). No finding.
4. **Include-aggregate slotting via `Promise.resolve(undefined)` placeholder.** **ACCEPT — functionally equivalent.** Reviewer traced the `decodeRow` flow: (a) the placeholder `Promise.resolve(undefined)` reserves the alias's slot in the `tasks` array at index `i`, preserving array indexing for the post-await result builder; (b) `Promise.all` resolves all per-cell decode promises, with placeholder slots resolving immediately (synchronously fulfilled at construction time); (c) the post-`Promise.all` loop walks `includeIndices` and synchronously calls `decodeIncludeAggregate(alias, wire)` for each, overwriting the `undefined` slot with the real aggregate. **Order-equivalence:** the prior sync branch decoded each cell in source order via a single `for` loop; the new branch dispatches non-include cells concurrently and slots include-aggregates after the gather. Since include-aggregate decoding is pure (no side effects, no observable interleaving with codec dispatch), and since the result builder iterates `aliases[i]` deterministically after both phases complete, the observable output for a given row is identical. **Failure semantics:** `Promise.all` rejects on the first failed codec dispatch; include-aggregate decoding never runs in that case (the post-await loop is unreached). This is *strictly* the prior behavior — include-aggregates never "see" partial codec failures, which matches the prior single-loop semantics where a thrown decode would short-circuit before any later cell ran. No finding.

**F1 closure confirmation:** F1's status updated to `closed (re-recorded as m4 T4.2 sub-task per drive-orchestrate-plan skill update; not actionable in m1)`. Summary block's "Open findings" count reduced from 1 → 0. F2 closure (resolved at m1 R2 by commit `3a1e48a60`) preserved as historical record.

**AC scoreboard delta:**

- AC-RT1 (was NOT VERIFIED) → **PASS**.
- AC-RT2 (was NOT VERIFIED) → **PASS** for the runtime portion (m2-owned); the ORM-level `.first()` / `.all()` / `for await` type-test assertions remain NOT VERIFIED until m3 T3.1.
- AC-RT3 (was NOT VERIFIED) → **PASS**.
- AC-RT4 (was NOT VERIFIED) → **PASS**.
- AC-RT5 (was NOT VERIFIED) → **PASS**.
- AC-RT6 (was NOT VERIFIED) → **PASS**.
- AC-RT7 (was NOT VERIFIED) → **PASS**.
- AC-CF4 (was NOT VERIFIED) → **PASS** for the m2 runtime portion (sync codec author → runtime → plain decoded value, single-armed). The full ORM E2E swap (sync codec replaced with async codec at the ORM call site, type tests for `.first()` / `.all()` / `for await`) remains NOT VERIFIED until m3 T3.5 / T3.6.

Totals: **11 PASS / 0 FAIL / 15 NOT VERIFIED** (delta: +8 PASS — including AC-CF4's runtime portion — vs m1 R2's 3 / 0 / 23).

**New findings filed:** None. All four flagged items triaged without filing under the new findings discipline (each candidate either failed the "addressable in this PR by the implementer" bar or did not represent a defect: flag #1 is a justified architectural extension, #2 is informational and goes to the user as plan amendment, #3 is a pre-existing cosmetic property of the test, #4 is a verified equivalent rewrite).

**Items for the user's attention (escalations):**

1. **m3 scope-narrowing observation.** `sql-orm-client` typechecks and tests cleanly at m2 (verified via grep + `pnpm --filter @prisma-next/sql-orm-client typecheck` exits 0; the package never calls `codec.encode` / `codec.decode` directly — it consumes results through `sql-runtime`'s now-await-correct async iterator). The plan currently allocates m3's scope to "ORM client and extension consumer reshape for the async codec surface." A meaningful portion of T3.5 / T3.6 may already be implicitly satisfied by m2's await-at-the-boundary work; m3's residual scope likely reduces to (a) `extension-pgvector` consumer reshape (still failing typecheck per plan) and (b) m3-T3.1's ORM-level type-test assertions (`.first()` / `.all()` / `for await` row shape — these don't depend on consumer reshape but do verify the AC-RT2 "no Promise leaks into user code" guarantee end-to-end through the ORM lane). Recommend the orchestrator review m3's task list against this finding before delegating m3 to the implementer; some tasks may be re-scoped or removed.

**Mandatory artifact refresh:** Both `system-design-review.md` and `walkthrough.md` exist on disk at the start of m2 R1 (created post-m1 R2; the SDR's header reads "m1 snapshot" and reflects HEAD `adafda3a1`). Per orchestrator instruction this round, both must be appended with M2 R1 sections; touched in this round (see § Files modified below).

**Stale-artifact note:** Round-end state: SDR appended with "M2 R1 — runtime async path" section; walkthrough appended with "M2 R1 delta" section. Both reflect HEAD `4d7fc1261`.

### m3 — Round 1 — ANOTHER ROUND NEEDED

**Verdict:** ANOTHER ROUND NEEDED

**What was reviewed:** Two implementer commits since m2 SATISFIED (`4d7fc1261`):

- `7505ef158` — `test(sql-orm-client, pgvector): m3 ORM read/write surfaces present plain T (T3.1–T3.6)` (adds [`test/codec-async.types.test-d.ts`](../../../packages/3-extensions/sql-orm-client/test/codec-async.types.test-d.ts), adds [`test/integration/codec-async.test.ts`](../../../packages/3-extensions/sql-orm-client/test/integration/codec-async.test.ts), updates [`packages/3-extensions/pgvector/test/codecs.test.ts`](../../../packages/3-extensions/pgvector/test/codecs.test.ts) to align with the m1 codec interface, and deletes a broken untracked `test/codec-async.e2e.test.ts` mock-driver attempt).
- `41e01b5f3` — `docs(sql-orm-client): document codec-async decode linkage in collection-dispatch (T3.4)` (intended to add a single header doc block to [`collection-dispatch.ts`](../../../packages/3-extensions/sql-orm-client/src/collection-dispatch.ts); see F3 for the duplicate-block defect).

Branch HEAD `41e01b5f3`. Worktree clean against HEAD. Implementer's structured report dated this round used as context only; primary evidence is on-disk diffs and re-run validations.

**Task verification:**

- **T3.1 — clean.** [`test/codec-async.types.test-d.ts`](../../../packages/3-extensions/sql-orm-client/test/codec-async.types.test-d.ts) lines 66–120 carry `expectTypeOf` assertions pinning `DefaultModelRow`, `InferRootRow`, `Collection.first()`'s awaited row, the `Collection.all()` async iterator's iterated row, and `Collection.all().firstOrThrow()`'s awaited row to plain `T` for both jsonb-backed value-object columns (`User.address` → `AddressShape | null`) and primitive columns (`User.name` → `string`, `User.id` → `number`, `User.invitedById` → `number | null`). The negative `IsPromiseLike<…> = false` assertion is replicated at every read-position to catch any future regression.
- **T3.2 — clean.** Same file lines 126–191 cover write surfaces: `CreateInput`, `MutationUpdateInput`, `UniqueConstraintCriterion`, and `ShorthandWhereFilter` all pinned to plain `T` (with `null | undefined` where appropriate). Negative-form `IsPromiseLike<…> = false` assertions on every write-position.
- **T3.3 — verification-only outcome, accepted.** Source-level check: `rg 'DefaultModelInputRow' packages/` returns zero matches in `src/`; `DefaultModelRow` is the single field type-map, and `CreateInput` (`types.ts` L776–L781), `VariantCreateInput` (L808–L813), `NestedCreateInput`/`MutationCreateInput` (L1027–L1047), and `MutationUpdateInput` (L1055–L1058) all derive from `DefaultModelRow<TContract, ModelName>`. Type-level evidence pins this directly: `test/codec-async.types.test-d.ts` lines 200–210 assert `NonNullable<UserCreate['name']>` equals `UserRow['name']` and `NonNullable<UserUpdate['name']>` equals `UserRow['name']`. The absence of a parallel `DefaultModelInputRow` type *is* the verification of AC-OC3.
- **T3.4 — verification-only outcome, accepted with finding.** The functional claim — `collection-dispatch.ts` does not call `codec.encode` or `codec.decode` directly — is verified: `rg 'codec\.(encode|decode)\b' packages/3-extensions/sql-orm-client/src` returns zero matches, and the dispatch path traces from `Collection.all()` → `dispatchCollectionRows` → `executeQueryPlan` → `runtime.execute` → `sql-runtime`'s async generator (which `await`s `decodeRow` once per yielded row). The integration test's `for await ... of posts.orderBy(...).all()` loop ([`test/integration/codec-async.test.ts` L81–L84](../../../packages/3-extensions/sql-orm-client/test/integration/codec-async.test.ts:81-84)) exercises this exact path and asserts `expect(row.embedding).not.toBeInstanceOf(Promise)` per yielded row — that is the live evidence that ORM dispatch produces plain rows. **However**, the documentation artifact intended to record this invariant has a defect: the file now carries two stacked header doc blocks, the second of which references a deleted test file. Filed as F3 (should-fix). The functional T3.4 outcome is correct; only the doc artifact requires a touch-up.
- **T3.5 — clean.** [`test/integration/codec-async.test.ts`](../../../packages/3-extensions/sql-orm-client/test/integration/codec-async.test.ts) lines 38–94 cover both query roundtrip flavours against live Postgres: `posts.first({ id: 1 })` yields a `Post` whose `embedding` (handled by the synchronous-author `pg/vector@1` codec, lifted to async by the m1 factory) round-trips through the runtime decode boundary as plain `number[]`, and the parallel `for await ... of posts.orderBy(p => p.id.asc()).all()` loop yields rows whose `embedding` cells are likewise plain (with `expect(row.embedding).not.toBeInstanceOf(Promise)` asserted per yielded row). The `User.address` jsonb codec adds the second-codec read coverage in the same `.first()` test (lines 58–62).
- **T3.6 — clean.** Lines 97–180 of the same file: `posts.create({ embedding: [0.1, 0.2, 0.3] })` accepts plain `number[]`, runs through the m2 `await encodeParams` boundary, and persists `'[0.1,0.2,0.3]'` (verified by `select embedding::text` round-trip at lines 114–119); `users.create({ address: { … } })` accepts plain `AddressShape` and persists JSON (verified at lines 144–152); `posts.where({ id: 1 }).update({ embedding: [0.4, 0.5, 0.6] })` re-encodes through the same async path (verified at lines 167–176). All three sites match the AC-OC2 promise: write surface accepts plain `T`, encode runs through the runtime's async path.
- **T3.7 — clean.** Implementer's report § 4 plus reviewer-side validation (re-run below) confirm `framework-components`, `sql-relational-core`, `sql-runtime`, `adapter-postgres`, `adapter-sqlite`, `sql-orm-client`, and `extension-pgvector` all typecheck and test green. `pnpm lint:deps` PASS workspace-wide. `pnpm test:integration` PASS (518/518 tests, 51.46s on the reviewer-side run; the 100ms-timeout flake the implementer surfaced did not reproduce).
- **T3.8 — out of reviewer scope** (internal review/refine gate with project owner).

**Validation gate (m3) — re-run at HEAD `41e01b5f3`:**

- In-scope packages must be green:
  - `framework-components` typecheck — PASS
  - `framework-components` test — PASS (82/82)
  - `sql-relational-core` typecheck — PASS
  - `sql-relational-core` test — PASS (187/187)
  - `sql-runtime` typecheck — PASS
  - `sql-runtime` test — PASS (118/118)
  - `adapter-postgres` typecheck — PASS
  - `adapter-postgres` test — PASS (492/492)
  - `adapter-sqlite` typecheck — PASS
  - `adapter-sqlite` test — PASS (67/67)
  - `sql-orm-client` typecheck — PASS
  - `sql-orm-client` test — PASS (463 runtime + 21 type tests)
  - `extension-pgvector` typecheck — PASS
  - `extension-pgvector` test — PASS (31/31)
- `pnpm lint:deps` — PASS workspace-wide.
- `pnpm test:integration` — PASS (518/518). The 100ms `testTimeout` flake at `test/authoring/side-by-side-contracts.test.ts:131` the implementer surfaced did not reproduce on the reviewer-side run.

**Triage of implementer-flagged items:**

1. **Worktree-not-clean-on-entry: adopted `codec-async.types.test-d.ts`, deleted `codec-async.e2e.test.ts`.** **ACCEPT — no finding.** Verified the adopted file's contents on disk: 21 type tests pinning the m3 read+write invariants for both `User` (jsonb-backed value-object column) and primitive columns, with explicit `IsPromiseLike<…> = false` negative assertions across every read+write field position. The file is the right shape for T3.1–T3.3 evidence. The deletion of `codec-async.e2e.test.ts` did not lose substantive coverage: the ACs T3.5/T3.6 require *behavioural* roundtrip evidence (plain `T` reads, plain `T` writes, real codec lift exercised end-to-end), and the new live-Postgres `test/integration/codec-async.test.ts` provides that more rigorously than a hand-rolled mock SqlDriver could (the mock would not have exercised the real wire encoding `'[0.1,0.2,0.3]'` round-trip nor the real jsonb persistence path). Substituting integration coverage for a broken mock E2E is a quality-positive trade.
2. **T3.3 verification-only outcome.** **ACCEPT — no finding.** Reviewer-side `rg 'DefaultModelInputRow' packages/` returns zero matches in `src/`. `DefaultModelRow` is structurally the single field type-map for `User` (verified by source inspection of `types.ts` L426–L428 and the four downstream derivations in L776–L1058). `expectTypeOf<NonNullable<UserCreate['name']>>().toEqualTypeOf<UserRow['name']>()` and the matching `UserUpdate` assertion at lines 200–210 of the type-test file pin the invariant — any future drift introducing a parallel `DefaultModelInputRow` with `Promise<T>` field positions would break these assertions.
3. **T3.4 verification-only outcome — `collection-dispatch.ts` does not call codec methods directly.** **ACCEPT, with F3 filed.** The functional claim is correct (zero `codec.(encode|decode)` matches in `src/`; the integration test's `for await` loop produces plain rows by exercising the dispatch path through the runtime's async iterator). The doc artifact intended to record the invariant has a defect (duplicate header blocks; second block references a deleted test file). Filed as F3 — see the finding for the recommended fix.
4. **Integration test substituted for E2E mock test (T3.5 / T3.6).** **ACCEPT — no finding.** The live-Postgres integration test exercises the AC behind T3.5 (`.first()` and `for await` streaming both yield plain values for vector and jsonb async-codec columns; verified by `expect(post?.embedding).not.toBeInstanceOf(Promise)` at line 56, by `expect(user?.address).not.toBeInstanceOf(Promise)` at line 62, and by the `expect(row.embedding).not.toBeInstanceOf(Promise)` assertion inside the `for await` loop at line 83) and the AC behind T3.6 (`create()` and `update()` accept plain `T` for async-codec columns; verified by the wire-format `select embedding::text` round-trips at lines 114–119 and 172–176, plus the jsonb shape round-trip at lines 144–152). The substitution is quality-positive: it exercises the real codec lift, real wire format, and real driver behaviour.
5. **`extension-pgvector` unit-test fixup folded into m3.** **ACCEPT — no finding.** Diff inspection confirms the changes are mechanical: the `pgVectorCodec` definition is widened to `Codec<…, Promise<string>, Promise<number[]>>` via a structural cast (`AsyncVectorCodec`); test functions are made `async`; `encode()` / `decode()` calls are awaited; `expect(...).toThrow(...)` becomes `await expect(...).rejects.toThrow(...)`. No behavioural change to the codec, no change to its `decode`/`encode` bodies, no scope creep. The fixup is cleanly bundled with the m3 test commit because the cause (m1 codec-interface bump) is the same as the m1 R2 expected residual.
6. **Integration test flake at `side-by-side-contracts.test.ts:131`.** **NEITHER FINDING NOR ESCALATION.** The reviewer-side `pnpm test:integration` ran 518/518 tests in 51.46s with no flake reproduction. The implementer's report classified the flake as pre-existing, not introduced by m3, and the reviewer-side run did not produce evidence to the contrary. The flake fails the findings discipline bar (no concrete actionable in-PR fix is available — the test passed cleanly when re-run, which means the implementer has nothing to do here in this PR). The candidate also fails the escalation bar (there is no decision the user needs to make right now; if the flake recurs across PRs in future runs, that is the right time to re-investigate). Recording it here in the round notes is the appropriate disposition; revisit if it reproduces.

**AC scoreboard delta:**

- AC-OC1 (was NOT VERIFIED) → **PASS**.
- AC-OC2 (was NOT VERIFIED) → **PASS**.
- AC-OC3 (was NOT VERIFIED) → **PASS**.
- AC-CF4 (was PASS for m2 runtime portion only; ORM E2E unverified) → **PASS** (full AC). The ORM E2E swap (sync codec author replaced with async codec author, ORM call sites round-trip plain `T`) is now covered by the live-Postgres integration test; both pgvector (`pg/vector@1`) and jsonb (`pg/jsonb@1`) author functions are synchronous, the m1 `codec()` factory lifts both to Promise-returning, and the `.first()` / `for await` / `create()` / `update()` paths all persist and round-trip plain `T` against live Postgres.
- AC-RT2 (was PASS for runtime portion only; ORM-level streaming unverified) → **PASS** (full AC). ORM-level type-level coverage is provided by the 21 type tests pinning every read+write field position to plain `T` with explicit `IsPromiseLike<…> = false` negative assertions; runtime-level coverage is provided by the integration test's per-row `expect(row.embedding).not.toBeInstanceOf(Promise)` assertions.

Totals: **14 PASS / 0 FAIL / 12 NOT VERIFIED** (delta: +3 PASS vs m2 R1's 11 / 0 / 15 — AC-OC1, AC-OC2, AC-OC3 promoted; AC-CF4 and AC-RT2 evidence strengthened to "full AC" without changing the PASS count).

**New findings filed:** F3 (should-fix) — duplicate header doc comments in `collection-dispatch.ts`; second comment references a deleted file.

**Items for the user's attention:** None.

**Mandatory artifact refresh:** Both `system-design-review.md` and `walkthrough.md` exist on disk at the start of m3 R1. Per orchestrator instruction, both have been appended with M3 R1 sections; touched in this round (see § Files modified below).

**Stale-artifact note:** Round-end state: SDR appended with "M3 R1 — ORM client surface verification" section; walkthrough appended with "M3 R1 delta" section. Both reflect HEAD `41e01b5f3`. F3 is open and blocks m3 SATISFIED — another round needed.

### m3 — Round 2 — SATISFIED

**Verdict:** SATISFIED

**What was reviewed:** One implementer commit since m3 R1 (`41e01b5f3`):

- `aa50f7280` — `docs(sql-orm-client): collapse stacked headers in collection-dispatch` — F3 fix.

Branch HEAD `aa50f7280`. Worktree clean against HEAD. Implementer's structured report dated this round used as context only; primary evidence is on-disk diff and re-run validations.

**Substantive review of the commit:**

- `aa50f7280` — clean. `git diff 41e01b5f3..aa50f7280 --stat` confirms a single file changed (`packages/3-extensions/sql-orm-client/src/collection-dispatch.ts`, 3 insertions / 19 deletions). The diff replaces the two stacked top-level `/** … */` blocks (former lines 1–31) with a single header block (lines 1–15) that (a) preserves block 1's substance verbatim — including the canonical cross-link to [`packages/2-sql/5-runtime/src/codecs/decoding.ts`](../../../packages/2-sql/5-runtime/src/codecs/decoding.ts); (b) folds in the ADR 030 cross-link uniquely contributed by block 2; (c) re-points test references at the surviving files (`test/integration/codec-async.test.ts` and `test/codec-async.types.test-d.ts`); (d) drops the dangling reference to the deleted `test/codec-async.e2e.test.ts`. Imports at line 17 onwards are unchanged. No runtime code, function bodies, types, or exports touched — strictly doc-comment cleanup. The fix matches F3's recommended next action verbatim.

**Task verification (R2 deltas only):**

- T3.4 (doc artifact for codec-async decode linkage) — completed. R1 noted T3.4's functional outcome (the file does not call codec methods directly) was correct, but the doc artifact had a defect (duplicate header blocks; second block referenced a deleted test file). Commit `aa50f7280` closes that gap with a one-edit, on-recipe fix.

**Validation gate (m3) — re-run at HEAD `aa50f7280`:**

- `sql-orm-client` typecheck — PASS.
- `sql-orm-client` test — PASS (54 files / 463 tests, including `codec-async.test.ts` 5/5 and `codec-async.types.test-d.ts` 21/21).
- Other in-scope packages from m3 R1 (`framework-components`, `sql-relational-core`, `sql-runtime`, `adapter-postgres`, `adapter-sqlite`, `extension-pgvector`) not re-run this round — the R2 commit is doc-comment-only on a single file, with no transitive surface that could affect them.
- `pnpm lint:deps` not re-run — same justification.

**On-disk verification points for F3 closure:**

- Only `packages/3-extensions/sql-orm-client/src/collection-dispatch.ts` was modified (`git diff 41e01b5f3..aa50f7280 --stat`).
- The header is a single `/** … */` block at lines 1–15 (read directly).
- No reference to `test/codec-async.e2e.test.ts` remains anywhere in `packages/3-extensions/sql-orm-client` (`rg codec-async\.e2e packages/3-extensions/sql-orm-client` returns zero matches).
- The ADR 030 cross-link is preserved (line 13).
- The reference to `packages/2-sql/5-runtime/src/codecs/decoding.ts` is preserved (line 11).
- The references to surviving test files (`test/integration/codec-async.test.ts` and `test/codec-async.types.test-d.ts`) are present (line 14).
- No runtime / imports / function changes — strictly doc-comment cleanup (diff: header doc block only, lines 12–32 of the prior file replaced by lines 12–14 of the new one).
- `pnpm --filter @prisma-next/sql-orm-client typecheck` and `... test` both green at HEAD `aa50f7280`.

**Triage of orchestrator-flagged item:**

1. **F3 fix verification.** All seven verification points pass. Closure note added to F3: `resolved (commit aa50f7280)`. Summary block updated: open findings 1 → 0; current verdict m3 R1 → m3 R2 SATISFIED; phases SATISFIED list extended to include m3.

**AC scoreboard delta:** None. The m3-owned ACs (AC-OC1, AC-OC2, AC-OC3) and the m3 portions of AC-CF4 / AC-RT2 were already PASS at m3 R1 against the m3 source on disk (the type tests, integration tests, and the functional codec-agnostic-dispatch invariant of `collection-dispatch.ts`). R2 was a doc-comment cleanup; no AC scoreboard movement is expected or observed. Totals stay at **14 PASS / 0 FAIL / 12 NOT VERIFIED**.

**New findings filed:** None.

**Items for the user's attention:** None. Stale-status note from the prompt context (the embedded git-status snapshot was stale relative to the actual clean worktree) is informational; no action needed.

**Implementer's report observation — stale embedded git-status snapshot.** The implementer surfaced that the prompt's embedded git-status snapshot was stale relative to the actual clean worktree (only the touched file showed in live `git status`). Reviewer-side `git status` at the start of the round confirmed the worktree was clean against HEAD `aa50f7280`. This is informational and does not produce a finding — both the implementer and reviewer rely on live `git status` rather than the prompt's snapshot, so no rule violation occurred and no future-implementer action is required.

**Mandatory artifact refresh:** Both `system-design-review.md` and `walkthrough.md` exist on disk. Per the skill, an "M3 R2 — F3 closure" delta is appended to the SDR and an "M3 R2 delta" section is appended to the walkthrough. Both reflect HEAD `aa50f7280`.

**Stale-artifact note:** Round-end state: SDR appended with "M3 R2 — F3 closure" delta; walkthrough appended with "M3 R2 delta" section. Both reflect HEAD `aa50f7280`. F3 closed. m3 SATISFIED.

### m4 — Round 1 — ANOTHER ROUND NEEDED

**Verdict:** ANOTHER ROUND NEEDED

**What was reviewed:** Five implementer commits since m3 R2 SATISFIED (`aa50f7280`):

- `236b8e2e0` — `test(m4): land failing tests for cross-family codec parity, async resolveValue, and Mongo client sync regression` (T4.1, T4.4, T4.10)
- `350ac46e3` — `feat(mongo-codec): reshape factory to unified Codec interface (m4 T4.2/T4.3)` (T4.2 incl. F1 cleanup; T4.3 — built-in Mongo codecs migrate to the unified factory)
- `18ddbb92b` — `feat(mongo-adapter): async resolveValue + lower() with concurrent dispatch (m4 T4.5/T4.6/T4.9)` (T4.5, T4.6, partial T4.9)
- `69e4d527d` — `feat(mongo): MongoAdapter.lower returns Promise; runtime + runner await it (m4 T4.7/T4.8)` (T4.7, T4.8)
- `415d72c1c` — `test(target-mongo): align stub adapter with async lower() interface (m4 T4.9)` (T4.9 completion)

Branch HEAD `415d72c1c`. Worktree clean against HEAD. Implementer's structured report dated this round used as context only; primary evidence is on-disk diffs and re-run validations. Per the orchestrator's procedural note, the audit-trail anomaly that 4/5 commits were already in place when the implementer entered is bookkeeping (recorded in `user-attention.md` by the orchestrator); this review evaluates the substance of all five commits as the m4 R1 work product without distinguishing authorship.

**Task verification:**

- **T4.1 — clean.** [test/integration/test/cross-package/cross-family-codec.test.ts](../../../test/integration/test/cross-package/cross-family-codec.test.ts) defines a single SQL `codec({...})` value (`shared/object-id-like@1`) and registers it in both a SQL `CodecRegistry` (`createCodecRegistry()`) and a Mongo `MongoCodecRegistry` (`createMongoCodecRegistry()`). Three tests assert: (a) `sqlCodec.encode('abc-123')` and `mongoCodecLookup.encode('abc-123')` both return `'wire:abc-123'` and are equal (L25–L43); (b) the Mongo path through `resolveValue` against a `MongoParamRef('abc-123', { codecId: 'shared/object-id-like@1' })` produces the same wire output as the SQL `encode` (L45–L62); (c) SQL `decode` round-trips (L64–L76). The "single codec module" pattern is satisfied by the SQL `codec()` factory's output structurally fitting both registries — not by re-instantiating the codec twice. 3/3 PASS in `pnpm test:integration`.
- **T4.2 — clean (F1 verified closed; see § F1 cleanup verification below).** [packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts) reshapes `MongoCodec` to alias `BaseCodec` from `framework-components` (L21–L26), and `mongoCodec()` now lifts sync author functions to Promise-returning methods via `async (value) => userEncode(value)` / `async (wire) => userDecode(wire)` (L65–L66). Build-time methods (`encodeJson`, `decodeJson`, `renderOutputType`) stay synchronous (L67–L68); identity defaults installed when omitted (`config.encodeJson ?? identity`). The `as unknown as TTraits` double-cast is gone (replaced by `ifDefined('traits', config.traits ? Object.freeze([...config.traits]) as TTraits : undefined)` at L60–L63 — the empty-traits default is structurally absent rather than expressed as a cast). Generic-arity asymmetry vs SQL noted: `MongoCodec` declares 4 generics (`<Id, TTraits, TWire, TJs>`) which collapses `TInput=TOutput=TJs`, while `BaseCodec` has 5 generics (`<Id, TTraits, TWire, TInput, TOutput=TInput>`); see § Items for the user's attention #1 below — does not break the AC-CX1 test or cross-family registration but does narrow the Mongo factory's expressiveness vs the SQL factory.
- **T4.3 — clean.** All built-in Mongo codecs now use the unified `mongoCodec()` factory with synchronous author functions — verified at [packages/3-mongo-target/2-mongo-adapter/src/core/codecs.ts](../../../packages/3-mongo-target/2-mongo-adapter/src/core/codecs.ts) (`mongoObjectIdCodec`, `mongoStringCodec`, `mongoDoubleCodec`, `mongoInt32Codec`, `mongoBooleanCodec`, `mongoDateCodec`, `mongoVectorCodec`). The `defaultCodecRegistry()` helper in [`mongo-adapter.ts (L154–L168)`](../../../packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts:154-168) registers all seven. Adapter-side codec tests in [packages/3-mongo-target/2-mongo-adapter/test/codecs.test.ts](../../../packages/3-mongo-target/2-mongo-adapter/test/codecs.test.ts) `await` `encode`/`decode` calls per the Promise-returning boundary.
- **T4.4 — clean.** [packages/3-mongo-target/2-mongo-adapter/test/resolve-value.test.ts (L82–L170)](../../../packages/3-mongo-target/2-mongo-adapter/test/resolve-value.test.ts:82-170) covers: (a) `resolveValue(MongoParamRef('x'))` returns a Promise (`typeof (result as { then?: unknown }).then === 'function'`); (b) concurrent dispatch over object children verified by deferred-promise call-order assertions (`encode-a-start` and `encode-b-start` recorded before either resolves; setImmediate gate); (c) concurrent dispatch over array elements verified by the same pattern; (d) identity passthrough for non-`MongoParamRef` values. Tests use the async-codec author form to exercise the lift-via-factory path.
- **T4.5 — clean.** [packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts (L14–L44)](../../../packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts:14-44) is `async`; for arrays, `Promise.all(value.map((v) => resolveValue(v, codecs)))` (L32) dispatches all child resolutions concurrently; for objects, `Promise.all(entries.map(([, val]) => resolveValue(val, codecs)))` (L35) does the same; `MongoParamRef` with `codecId` awaits `codec.encode(value.value)` (L21). Identity passthrough for `null`/primitives/`Date` (L25–L30); `MongoParamRef` without `codecId` returns `value.value` directly (L23). The "function-typed" Postgres-style sentinel handling is not relevant to Mongo — no equivalent leak surface.
- **T4.6 — clean.** [packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts (L30–L142)](../../../packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts:30-142): `MongoAdapterImpl#lower()` is `async` (L57), `#resolveDocument` is `async` and uses `Promise.all` over object entries (L37–L48), `#lowerUpdate` uses `Promise.all` over update-pipeline stages (L52). The `lower()` switch has eight non-raw command kinds; each one that performs encode-side reshape uses concurrent `Promise.all` for independent sub-tasks: `updateOne`/`updateMany`/`findOneAndUpdate` dispatch `lowerFilter(command.filter)` and `this.#lowerUpdate(command.update)` concurrently (L66–L69, L78–L81, L89–L92); `insertMany` dispatches per-document resolution concurrently via `Promise.all(command.documents.map((doc) => this.#resolveDocument(doc)))` (L75); `aggregate` lowers the pipeline via `lowerPipeline(command.pipeline)` (L109; pipeline-stage lowering uses `Promise.all` internally per [packages/3-mongo-target/2-mongo-adapter/src/lowering.ts](../../../packages/3-mongo-target/2-mongo-adapter/src/lowering.ts)). Raw command variants (`rawAggregate`/`rawInsertOne`/etc.) bypass codec lowering entirely (L110–L134), preserving the spec's "raw escape hatch" semantics. Default exhaustiveness check at L137. `createMongoAdapter()` itself (L170–L172) stays synchronous — the constructor builds the `MongoAdapterImpl` directly, no Promise return.
- **T4.7 — clean.** [packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts (L4–L6)](../../../packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts:4-6) declares `lower(plan: MongoQueryPlan): Promise<AnyMongoWireCommand>`. The interface is the contract shared between `mongo-adapter` (implementation) and `mongo-runtime` (consumer), and across the lowering boundary. **Note:** the package README at the same path (`README.md` line 7) still narrates the pre-m4 sync signature; filed as F4.
- **T4.8 — clean.** Three call sites verified awaiting the now-async `adapter.lower(...)`:
  - [packages/2-mongo-family/7-runtime/src/mongo-runtime.ts (L74)](../../../packages/2-mongo-family/7-runtime/src/mongo-runtime.ts:74) — `const wireCommand = await adapter.lower(plan);` between middleware `beforeExecute` (L68–L72) and `driver.execute(wireCommand)` (L76).
  - [packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts (L262)](../../../packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts:262) — `const wireCommand = await adapter.lower(plan);` inside `executeDataTransform`'s op-run loop (DML data-transform plans).
  - [packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts (L310)](../../../packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts:310) — `const wireCommand = await adapter.lower(check.source);` inside `evaluateDataTransformChecks` (read-only check commands routed through aggregate).
  - Audit `rg 'lower\(' packages/2-mongo-family/ packages/3-mongo-target/` returns the three runtime/runner call sites above plus 35 test call sites in [`mongo-adapter.test.ts`](../../../packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts) (all already `await adapter.lower(...)`); zero unawaited matches in production or test code. The single non-code occurrence is the stale README narrative at `mongo-lowering/README.md:7` (F4).
- **T4.9 — clean.** Two adapter-side test files verified with `await` expectations:
  - [packages/3-mongo-target/2-mongo-adapter/test/resolve-value.test.ts](../../../packages/3-mongo-target/2-mongo-adapter/test/resolve-value.test.ts) — all `resolveValue(...)` call sites either `await` the result (assertion sites) or capture the unresolved Promise to verify concurrent-dispatch ordering (3 deliberate non-await sites in the T4.4 concurrency tests).
  - [packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts](../../../packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts) — 35 `await adapter.lower(...)` sites; the m4 plan's enumerated T4.9 fixtures are aligned. Plus a third site outside the plan's T4.9 enumeration: `packages/3-mongo-target/1-mongo-target/test/mongo-runner.test.ts` updates `StubMongoAdapter.lower` to be `async` and the `WireCommand` type alias to use `Awaited<ReturnType<MongoAdapter['lower']>>` (commit `415d72c1c`); this is structurally required by T4.7's interface change and is correctly bundled under the T4.9 commit message tag. The implementer's procedural note about plan.md naming `resolve-value.test.ts` and `mongo-adapter.test.ts` as the T4.9 sites is accepted — the runner test was an additional, structurally necessary fixup site.
- **T4.10 — clean.** Two regression suites verified:
  - `validateMongoContract` sync regression at [packages/2-mongo-family/1-foundation/mongo-contract/test/validate.test.ts (L662–L681)](../../../packages/2-mongo-family/1-foundation/mongo-contract/test/validate.test.ts:662-681) — `describe('synchronous return (regression)')` with two subtests: (a) runtime check `expect(typeof thenable.then).toBe('undefined')` (L671) on the result of `validateMongoContract(makeValidContractJson())`; (b) type-level binding regression — the test compiles only if `validateMongoContract(...)` returns a non-Promise type (the `result` variable is bound and `result.contract` is accessed without `await`). 49/49 PASS in `pnpm --filter @prisma-next/mongo-contract test`.
  - `createMongoAdapter()` sync construction regression at [packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts (L435–L453)](../../../packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts:435-453) — `describe('createMongoAdapter (sync construction regression)')` with two subtests: (a) runtime check `expect(typeof thenable.then).toBe('undefined')` (L444); (b) type-level binding — adapter is bound directly without `await` and `adapter.lower` accessed as a function. 215/215 PASS in `pnpm --filter @prisma-next/adapter-mongo test`. The plan's "client construction" wording is interpreted as the Mongo adapter construction path (the closest equivalent to SQL's `postgres({...})` regression test at the m2 boundary); there is no monolithic Mongo `mongo({...})` client entry point on `feat/codec-async-single-path` analogous to `postgres({...})`, and the plan does not enumerate one. The two regression sites (validateMongoContract; createMongoAdapter) cover the build-time-stays-sync invariant that the AC requires.
- **T4.11 — green.** All m4 validation gates re-run at HEAD `415d72c1c` (see § Validation gate below).
- **T4.12 — out of reviewer scope** (internal review/refine gate with project owner).

**Validation gate (m4) — re-run at HEAD `415d72c1c`:**

- **Workspace-wide green required:**
  - `pnpm typecheck` workspace-wide (per the plan's m4 § Validation gates; "M4 closes out the consumer reshape; no codec-shape breakage should remain") — implementer report claims 120/120 PASS via `pnpm turbo run typecheck --force`; reviewer-side `pnpm test:packages` succeeds at 111/111 tasks (each task includes its own typecheck via `tsdown` build), corroborating the workspace-wide claim.
  - `pnpm test:packages` — PASS (111/111 tasks).
- `pnpm test:integration` — PASS (104 files / 521 tests, 51.47s) — includes `test/cross-package/cross-family-codec.test.ts` 3 tests confirming AC-CX2 end-to-end.
- `pnpm lint:deps` — PASS workspace-wide (606 modules / 1198 dependencies cruised; 0 violations).
- Mongo-family targeted re-runs:
  - `pnpm --filter @prisma-next/mongo-codec test` — PASS (14/14).
  - `pnpm --filter @prisma-next/mongo-contract test` — PASS (76/76, includes 3 test files: `validate-storage.test.ts`, `validate-domain.test.ts`, `validate.test.ts`).
  - `pnpm --filter @prisma-next/mongo-runtime test` — PASS (51/51 — covered by parallel run earlier in this round; also re-validated via test:packages).
  - `pnpm --filter @prisma-next/adapter-mongo test` — PASS (215/215).
  - `pnpm --filter @prisma-next/target-mongo test` — PASS (366/366 across 16 test files).
- Cross-package consumer audit (per plan's m4 § Validation gates): `rg 'lower\('` across `packages/2-mongo-family/` and `packages/3-mongo-target/` returns 38 code matches plus 1 README narrative match. Code: production `MongoAdapter.lower(...)` and test stub `lower(...)` definitions; runtime/runner `await adapter.lower(...)` call sites; 35 awaited test invocations. README narrative match is the F4 stale signature line.
- `rg 'resolveValue\('` audit: all production call sites await; the three deliberate non-await test sites in `resolve-value.test.ts` capture the Promise to verify concurrent dispatch ordering, which is the test design point.

**F1 cleanup verification:** verified closed on disk.

- The `as unknown as TTraits` double-cast is gone from [packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts (L57–L69)](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts:57-69). The empty-traits default is now structurally absent: `ifDefined('traits', config.traits ? (Object.freeze([...config.traits]) as TTraits) : undefined)` at L60–L63 either spreads the key with the user's traits (single `as TTraits` cast on the frozen array — narrowest possible scope) or omits the key entirely when `config.traits` is undefined. The single surviving `as TTraits` cast at L62 is for narrowing `Object.freeze([...config.traits])` (which produces `readonly MongoCodecTrait[]` after spread + freeze) back to the const-typed `TTraits` tuple supplied by the caller; `ReadonlyArray<T>.freeze` widens the const inference, and the spread reconstitutes a fresh array, so the cast is the standard pattern for preserving a `const TTraits extends readonly [...]` parameter through a frozen-array shape. No `// why` comment is required given the cast is `as TTraits` (not `as unknown as TTraits`) and the surrounding factory shape makes the intent self-evident; this is consistent with the implementer's reading.
- F1's status remains `closed (re-recorded as m4 T4.2 sub-task per drive-orchestrate-plan skill update; not actionable in m1)` from m2 R1 — m4's R1 review verifies the code-level cleanup landed as expected, per F1's own closure note ("m4's reviewer should verify the cleanup lands as part of T4.2"). No status change needed.

**Triage of orchestrator-flagged items:**

1. **F1 closure verification.** **VERIFIED CLOSED.** See § F1 cleanup verification above. No new finding filed; cleanup landed as expected.
2. **T4.1 — cross-family test.** **VERIFIED CLEAN.** See T4.1 task verification above. The test imports a single `codec({...})` value from `@prisma-next/sql-relational-core/ast` and registers it in both registries; encoding is identical; SQL `decode` round-trips. The "single codec module" pattern in the spec is satisfied by structural reusability rather than physical module re-import.
3. **T4.5 / T4.6 — `resolveValue` and `MongoAdapter.lower()` async + concurrent dispatch.** **VERIFIED CLEAN.** See T4.5/T4.6 task verifications above. `Promise.all` propagation is exhaustive (resolve-value over arrays + objects; mongo-adapter over filter+update for updates; over documents for insertMany; over pipeline stages for aggregate). The `Promise.all` semantics align with m2's `encodeParams`/`decodeRow` pattern: fail-fast on rejection, concurrent dispatch on success.
4. **T4.7 / T4.8 — interface and runtime.** **VERIFIED CLEAN.** Interface declares `Promise<AnyMongoWireCommand>` return; both runtime and runner call sites await. README narrative is stale (F4) — but the code-level interface and call-site contract are correct.
5. **T4.10 — sync regression for Mongo `validateContract` + client construction.** **VERIFIED CLEAN.** Two regression suites (validateMongoContract; createMongoAdapter) cover the build-time-stays-sync invariant. `validateMongoContract` 49/49 PASS in `mongo-contract`; `createMongoAdapter` regression 215/215 PASS in `adapter-mongo`. Type-level regression triggered if either becomes Promise-returning.
6. **Pre-existing MongoMigrationRunner CAS flake.** **NEITHER FINDING NOR ESCALATION; reviewer-side reproduction did not occur.** Reviewer-side `pnpm --filter @prisma-next/target-mongo test` ran 366/366 PASS in 14.46s; `mongo-runner.test.ts` (16 tests for `MongoMigrationRunner`) all green. The flake the implementer surfaced did not reproduce. Diff inspection confirms the implementer's pre-existing characterization: `git diff aa50f7280..415d72c1c -- packages/3-mongo-target/1-mongo-target/test/mongo-runner.test.ts` shows the only change is a stub-adapter `async lower()` signature update (T4.9 follow-on); `git diff aa50f7280..415d72c1c -- packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts` shows the only changes are the two `await adapter.lower(...)` lines at L262 and L310 (DDL operations like the `MARKER_CAS_FAILURE` test's `createIndex` do not route through `lower()`, per the runner's DDL-vs-DML branching). Under the new findings discipline: a concrete in-PR fix likely exists ("await the `onOperationComplete` callback at line 174 of `mongo-runner.ts`") but the fix is **out of m4 scope** — the codec-async-single-path project is structurally about codec runtime async, not migration-runner CAS semantics. Surfaced under § Items for the user's attention #2 as a follow-up issue candidate; reviewer does not file a finding because the implementer has nothing to do here in this PR.
7. **CLI test flake (control-api/client.test.ts:525,1191).** **NOT A REGRESSION; no action needed.** Reviewer-side `pnpm test:packages` ran 111/111 PASS without reproducing the flake. The implementer's diagnosis (Postgres-integration timing dependent; not Mongo-related, not introduced by m4) matches the reviewer's read of the failing test paths (control-api span emission and progress callbacks — orthogonal to the codec runtime path). Recording it here is the appropriate disposition; revisit only if it reproduces across PRs.

**New findings filed:** F4 (should-fix) — `mongo-lowering` package README signature is stale; line 7 narrates `lower(): AnyMongoWireCommand` but the post-m4 interface is `lower(): Promise<AnyMongoWireCommand>`. Concrete in-PR fix: one-line README edit. See F4 in § Findings log for full recommended-fix recipe. Blocks m4 SATISFIED.

**Items for the user's attention (escalations):**

1. **`MongoCodec` collapses `TInput=TOutput`; SQL `Codec` does not.** AC-CX1 (NFR #6 in [spec.md](../spec.md)) says "the Mongo `Codec` interface is structurally identical to the SQL `Codec` interface (same generic parameters …)". On disk, `MongoCodec<Id, TTraits, TWire, TJs>` (4 generics) is `BaseCodec<Id, TTraits, TWire, TJs, TJs>` (`TInput=TOutput=TJs`); SQL `Codec<Id, TTraits, TWire, TInput, TOutput, TParams, THelper>` (7 generics) extends `BaseCodec<Id, TTraits, TWire, TInput, TOutput>` (5 generics) and adds SQL-specific extras `TParams`/`THelper`. The base-shape parity (Promise-returning query-time methods; sync build-time methods; same factory-lift mechanic via `async (x) => fn(x)`) is fully satisfied; the cross-family test (AC-CX2) demonstrates the substance — a SQL `codec({...})` with `TInput=TOutput` works identically in both registries. **Two interpretations are possible:**
   - **Permissive (PASS):** "structurally identical" means the shape contract — query-time async/build-time sync/factory-lift — is the same; SQL adds family-specific extras (just as Mongo could later add Mongo-specific extras), and the cross-family test confirms `codec({...})` values work in both registries. AC-CX1 PASS.
   - **Strict (FAIL on the precise wording):** `MongoCodec` should declare 5 generics (`<Id, TTraits, TWire, TInput, TOutput=TInput>`) to mirror `BaseCodec` exactly, so a SQL codec with `TInput≠TOutput` (e.g. `Codec<…, Date, Date | string, Date>` for a flexible date input) can be registered in a Mongo registry without `TOutput` collapsing. The factory `mongoCodec()` would also expand to 5 generics with corresponding `encode`/`decode` signatures.
   - The reviewer chose the permissive interpretation (PASS) for the AC scoreboard given (a) the concrete cross-family test passes, (b) no observed user surface fails, (c) the JSDoc on `MongoCodec` explicitly defers Mongo-specific extensions ("Mongo-specific extensions are not currently needed; this alias keeps the Mongo surface in lockstep with the framework base. Any divergence should be added here"), and (d) the spec's § Open Items records the `TInput`/`TOutput` split as a "project-level decision" that was deliberated at m1 and resolved by adding the split to `BaseCodec`. **Decision needed from the user/orchestrator:** is the strict interpretation preferred (Mongo expands to 5 generics; spec wording is taken literally), or is the permissive interpretation acceptable (the substance — structural fit + cross-family round-trip — satisfies the AC; spec wording is read as "structural shape parity")? If strict, the m5 implementer should expand `MongoCodec` and `mongoCodec()` to 5 generics; if permissive, no action needed. Reviewer recommends permissive — the design intent (Mongo can add what it needs later) is correctly captured by the JSDoc, and the cross-family test substantively demonstrates parity.
2. **Pre-existing `MongoMigrationRunner` CAS flake follow-up.** Filed by the implementer as pre-existing fragility in [`packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts (L174)`](../../../packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts:174) — `onOperationComplete` callback is invoked without `await`, so the CAS read in `mongo-runner.test.ts:330` (`returns MARKER_CAS_FAILURE when concurrent marker change causes CAS miss`) races against tampered marker writes intermittently. Diff verification confirms pre-existing (test file byte-identical between m3 and m4 HEAD; runner-src diff is solely the two T4.8 `await adapter.lower(...)` lines, which apply only to DML data-transform plans, not the failing test's DDL `createIndex` path). The fix is concrete (await the callback) but **out of m4 scope** — it concerns migration-runner CAS semantics, not codec-async runtime. Reviewer recommends the orchestrator log a follow-up issue for migration-runner robustness; the codec-async-single-path project should not absorb this unrelated fix. Reviewer-side run did not reproduce the flake (366/366 PASS); the issue is intermittent enough that one or two retries clear it.

**AC scoreboard delta:**

- AC-CX1 (was NOT VERIFIED) → **PASS**.
- AC-CX2 (was NOT VERIFIED) → **PASS**.
- AC-CX3 (was NOT VERIFIED) → **PASS**.
- AC-CX4 (was NOT VERIFIED) → **PASS**.
- AC-CX5 (was NOT VERIFIED) → **PASS**.
- AC-DW2 status note refreshed from "m2..m5 pending; m1 portion clean" to "m5 pending; m1..m4 portions clean" — m4 portion of the seven walk-back constraints (per NFR #5 / [spec.md](../spec.md)) verified clean: no per-codec async marker introduced (`mongoCodec()` lifts uniformly; no `runtime`/`kind` field on `MongoCodec`); no `codecSync()`/`codecAsync()` variants; no `isSyncEncoder`/`isSyncDecoder` predicates (`rg` returns zero matches); no conditional return types on Promise-returning methods; no `TRuntime` generic on `MongoCodec`; no mis-framed author-surface docs (Mongo factory JSDoc explicitly says "authors may write `encode` / `decode` as sync or async; the factory lifts uniformly"); no async-dependent public guarantees added that bind `validateMongoContract` or `createMongoAdapter` to Promise returns (T4.10 regressions enforce sync at type + runtime).

Totals: **19 PASS / 0 FAIL / 7 NOT VERIFIED** (delta: +5 PASS vs m3 R2's 14 / 0 / 12 — AC-CX1, AC-CX2, AC-CX3, AC-CX4, AC-CX5 all promoted).

**Mandatory artifact refresh:** Both `system-design-review.md` and `walkthrough.md` exist on disk at the start of m4 R1. Per orchestrator instruction, both have been appended with M4 R1 sections; touched in this round (see § Files modified below).

**Stale-artifact note:** Round-end state: SDR appended with "M4 R1 — Mongo cross-family parity" section; walkthrough appended with "M4 R1 delta" section. Both reflect HEAD `415d72c1c`. F4 is open and blocks m4 SATISFIED — another round needed.

**Files modified (m4 R1):** `code-review.md`, `system-design-review.md`, `walkthrough.md`.

### m4 — Round 2 — SATISFIED

**Verdict:** SATISFIED

**What was reviewed:** Two implementer commits since m4 R1 (HEAD `415d72c1c`):

- `6f567afa3` — `docs(mongo-lowering): narrate Promise<AnyMongoWireCommand> + async-at-the-boundary semantics (m4 R2 F4 fix)`
- `47ce86a6f` — `feat(mongo-codec): widen MongoCodec to 5 generics for strict cross-family parity with BaseCodec (m4 R2)`

Branch HEAD on entry `47ce86a6f`. Worktree clean against HEAD. Implementer's structured report dated this round used as context only; primary evidence is on-disk diffs, file inspections at HEAD, and re-run validations.

**Task verification:**

- **F4 fix — clean.** [`packages/2-mongo-family/6-transport/mongo-lowering/README.md` line 7](../../../packages/2-mongo-family/6-transport/mongo-lowering/README.md:7) now narrates `lower(plan: MongoQueryPlan): Promise<AnyMongoWireCommand>`, with a new sentence on async-at-the-boundary semantics (`callers must await lower(...) so adapters may run async codec encodes (e.g. resolveValue) before producing the wire shape`). The narrated signature exactly matches the source-of-truth interface in [`packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts (L5)`](../../../packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts:5). L8 (`MongoDriver.execute<Row>(wireCommand): AsyncIterable<Row>`) and L13–L14 (dependency narrative) untouched, as recommended in F4's recipe. The added async-semantics sentence is a value-add over the minimum recommended fix and is consistent with the implementer's mandate. F4 closed.
- **MongoCodec widening — clean.** [packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts (L30–L36)](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts:30-36): `MongoCodec` now declares 5 generics in matching order with the `BaseCodec` defaults: `<Id extends string = string, TTraits extends readonly MongoCodecTrait[] = readonly MongoCodecTrait[], TWire = unknown, TInput = unknown, TOutput = TInput>` and aliases directly to `BaseCodec<Id, TTraits, TWire, TInput, TOutput>`. The `mongoCodec()` factory (L56–L88) carries the same 5 generics with `TOutput = TInput` default; `encode: (value: TInput) => TWire | Promise<TWire>` (L66), `decode: (wire: TWire) => TOutput | Promise<TOutput>` (L67), `encodeJson: (value: TInput) => JsonValue` (L68), `decodeJson: (json: JsonValue) => TInput` (L69) — the `TInput`/`TOutput` split is threaded explicitly through every method position that needs it. `MongoCodecJsType<T>` was replaced (no backcompat alias, per the implementer's mandate) by `MongoCodecInput<T>` (L91–L92) and `MongoCodecOutput<T>` (L95–L98), mirroring SQL's `CodecInput<T>` / `CodecOutput<T>` positionally. Exports updated in [`packages/2-mongo-family/1-foundation/mongo-codec/src/exports/index.ts`](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/exports/index.ts). The package README narrates the new helpers ([packages/2-mongo-family/1-foundation/mongo-codec/README.md](../../../packages/2-mongo-family/1-foundation/mongo-codec/README.md)).
- **Type-level structural identity — pinned.** New tests in [packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts (L65–L112)](../../../packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts:65-112) cover four invariants:
  - **Strict structural identity** (L65–L69): `expectTypeOf<MongoCodec<'id/x@1', readonly ['equality'], number, string, Date>>().toEqualTypeOf<BaseCodec<'id/x@1', readonly ['equality'], number, string, Date>>()` — the `toEqualTypeOf` assertion against `BaseCodec` directly proves identity at the 5-generic positional level (not just functional equivalence).
  - **`TOutput = TInput` default** (L71–L75): `expectTypeOf<MongoCodec<'id/y@1', readonly CodecTrait[], number, string>>().toEqualTypeOf<MongoCodec<'id/y@1', readonly CodecTrait[], number, string, string>>()`.
  - **Asymmetric `TInput ≠ TOutput` expressibility** (L82–L94): asserts `Parameters<typeof asymmetric.encode>[0]` is `string`, `ReturnType<typeof asymmetric.encode>` extends `Promise<number>`, `Parameters<typeof asymmetric.decode>[0]` is `number`, `ReturnType<typeof asymmetric.decode>` extends `Promise<Date>`. Pinning at the method-signature level (rather than via the extractors) is correct — it isolates the structural-identity invariant from the latent extractor behavior the implementer flagged for the orchestrator.
  - **Extractor symmetric round-trip** (L102–L112): `MongoCodecInput<typeof symmetric>` and `MongoCodecOutput<typeof symmetric>` both equal `string` for the canonical `TInput=TOutput=string` case used everywhere in the cross-family parity fixtures and built-in codec set.
- **No consumer breakage.** The widening is structural: `BaseCodec` already had 5 generics and the SQL family already used the same shape. Built-in Mongo codecs in [packages/3-mongo-target/2-mongo-adapter/src/core/codecs.ts](../../../packages/3-mongo-target/2-mongo-adapter/src/core/codecs.ts) and the `defaultCodecRegistry()` helper still construct via `mongoCodec({ typeId, targetTypes, traits, encode, decode })` with the symmetric `TInput=TOutput=TJs` form — `mongoCodec()`'s `TOutput = TInput` default makes every existing call site backward-compatible without any source change. All targeted-package tests, workspace-wide typecheck, package and integration tests, and `lint:deps` ran green at HEAD `47ce86a6f` (see § Validation gate (m4 R2) below).

**Validation gate (m4 R2) — re-run at HEAD `47ce86a6f`:**

- `pnpm --filter @prisma-next/mongo-codec typecheck` — PASS.
- `pnpm --filter @prisma-next/mongo-codec test` — PASS (18/18 tests; +4 new type-test assertions vs R1's 14).
- `pnpm --filter @prisma-next/adapter-mongo typecheck` — PASS.
- `pnpm --filter @prisma-next/adapter-mongo test` — PASS (215/215).
- `pnpm --filter @prisma-next/target-mongo typecheck` — PASS.
- `pnpm --filter @prisma-next/target-mongo test` — PASS (366/366).
- `pnpm --filter @prisma-next/mongo-contract typecheck` — PASS.
- `pnpm --filter @prisma-next/mongo-contract test` — PASS (76/76).
- `pnpm --filter @prisma-next/mongo-lowering typecheck` — PASS.
- `pnpm --filter @prisma-next/mongo-lowering test` — PASS (0 tests; package has no test files at this milestone, as expected — types-only at this layer).
- `pnpm --filter @prisma-next/integration-tests exec vitest run --passWithNoTests cross-family-codec` — PASS (3/3 tests; AC-CX2 cross-family parity demonstration unchanged from R1).
- `pnpm typecheck` (workspace-wide) — PASS (120/120 tasks).
- `pnpm test:packages` (workspace-wide) — PASS (111/111 tasks).
- `pnpm test:integration` (full suite) — PASS (104 files / 521 tests).
- `pnpm lint:deps` — PASS (no violations across 606 modules / 1198 deps).

**Triage of orchestrator-flagged items and implementer flags:**

1. **F4 closure verification.** **VERIFIED CLOSED** (commit `6f567afa3`). README signature now matches the interface; async-at-the-boundary semantics narrated.
2. **MongoCodec widening structural-identity verification.** **VERIFIED.** Strict structural identity is pinned by `toEqualTypeOf<BaseCodec<…>>()` at L65–L69, not just functional equivalence. The 5-generic shape, `TOutput=TInput` default, and asymmetric expressibility are all individually pinned.
3. **Implementer flag — `MongoCodecInput<T>` / `MongoCodecOutput<T>` extractor latent behavior on asymmetric codecs.** **NOT A FINDING (per orchestrator's explicit mandate).** The implementer noted that both extractors return `TInput | TOutput` (the union) for asymmetric codecs because TypeScript collapses the `infer` slot with the defaulted `TOutput = TInput` slot — pre-existing behavior in SQL's `CodecInput<T>` / `CodecOutput<T>` that the Mongo extractor is required to mirror per the "structurally identical" mandate. The implementer documented this inline and tested asymmetric expressibility through the method signatures rather than the extractors (correct disposition). Surfaced under § Items for the user's attention #1 (refresh) for the orchestrator to capture as a separate user-attention item if desired; not filed as a finding here.

**New findings filed:** None. F4 closed in this round; no new findings.

**AC scoreboard delta:**

- AC-CX1 (was permissively PASS at R1) → **strictly PASS at R2**. The widening achieves strict cross-family parity at the `BaseCodec` seam: `MongoCodec<Id, TTraits, TWire, TInput, TOutput=TInput> = BaseCodec<Id, TTraits, TWire, TInput, TOutput>` is structurally identical to the SQL `Codec`'s base (SQL's `Codec` extends the same `BaseCodec` and adds family-specific extras `meta`/`paramsSchema`/`init`/`TParams`/`THelper`; the structural seam at `BaseCodec` is identical). The R1 escalation about generic-arity asymmetry is fully resolved.
- All other ACs unchanged. Totals remain **19 PASS / 0 FAIL / 7 NOT VERIFIED** (the same totals as R1 — R2 strengthens AC-CX1's evidence rather than promoting a new AC).

**Items for the user's attention (escalations):**

1. **Latent extractor union behavior on asymmetric codecs (Mongo + SQL).** Per the orchestrator's explicit mandate not to file this as a finding, the implementer flagged that `MongoCodecInput<T>` / `MongoCodecOutput<T>` mirror SQL's `CodecInput<T>` / `CodecOutput<T>` exactly, including a shared latent behavior: both pairs of extractors return `TInput | TOutput` (the union) for asymmetric codecs because TypeScript collapses the `infer` slot with the defaulted `TOutput = TInput` slot. The implementer tested asymmetric expressibility through method signatures (`Parameters<typeof asymmetric.encode>[0]` etc.) rather than through the extractors, which is the correct disposition and matches SQL's existing test pattern. The cross-family parity AC is satisfied because (a) the `BaseCodec` seam is structurally identical, (b) the canonical `TInput=TOutput` case used by every built-in codec works identically, and (c) the asymmetric case is expressible at the factory and method-signature level (just not as cleanly destructurable via `MongoCodecInput`/`MongoCodecOutput`). Whether to enhance both families' extractors to return precisely `TInput`/`TOutput` for asymmetric codecs (e.g. via a discriminated tagged form) is a follow-up consideration that the orchestrator may choose to record in `user-attention.md` or escalate to a separate ticket.
2. **Pre-existing `MongoMigrationRunner` CAS flake follow-up** (carried over from m4 R1). Reviewer-side did not reproduce in either R1 or R2 (target-mongo 366/366 PASS in R2 too); recommend the orchestrator log a follow-up issue for migration-runner robustness, not absorb into this PR.

**Mandatory artifact refresh:** All three review artifacts (`code-review.md`, `system-design-review.md`, `walkthrough.md`) refreshed in this round to reflect post-R2 state and the strict AC-CX1 promotion. See § Files modified below.

**Stale-artifact note:** Round-end state: SDR appended with "M4 R2 — strict cross-family parity (MongoCodec widening) + F4 closure" section; walkthrough appended with "M4 R2 delta" section. Both reflect HEAD `47ce86a6f`. No open findings; m4 SATISFIED.

**Files modified (m4 R2):** `code-review.md`, `system-design-review.md`, `walkthrough.md`.

#### m4 R2 — independent re-verification (post-artifact-commit)

A fresh reviewer pass was performed against the on-disk state at HEAD `0d7bd780b` (the artifact-commit that landed the m4 R2 review narratives above). Branch `feat/codec-async-single-path`. Worktree clean. The orchestrator's delegation prompt for this pass cited HEAD `47ce86a6f` (the implementation HEAD), one commit prior to the artifact-commit; the second-pass reviewer reconciled the snapshot drift by independently re-verifying both the source state at `47ce86a6f` and the artifact narratives at `0d7bd780b`, rather than re-doing already-committed review work.

- **Source-of-truth re-inspection — clean.** [`packages/2-mongo-family/6-transport/mongo-lowering/README.md` line 7](../../../packages/2-mongo-family/6-transport/mongo-lowering/README.md:7) narrates `Promise<AnyMongoWireCommand>` and the async-at-the-boundary sentence, matching [`packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts (L5)`](../../../packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts:5) exactly. [`packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts (L30–L36)`](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts:30-36) declares 5 generics aliasing `BaseCodec`; factory (L56–L88) threads `TInput`/`TOutput` through `encode`/`decode`/`encodeJson`/`decodeJson`; extractors (L90–L98) are `MongoCodecInput`/`MongoCodecOutput`. [`packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts (L65–L112)`](../../../packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts:65-112) pins strict `toEqualTypeOf<BaseCodec<…>>()` identity, `TOutput=TInput` default, asymmetric expressibility through method signatures, and extractor symmetric round-trip. Cross-family seam in [`packages/1-framework/1-core/framework-components/src/codec-types.ts`](../../../packages/1-framework/1-core/framework-components/src/codec-types.ts) and SQL `Codec` extends-`BaseCodec` declaration in [`packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts`](../../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts) confirm the 5-generic positional alignment.

- **Validation gates — re-run, fully green.** All gates re-executed locally in this second pass (subject to a Node.js version warning that did not block any task — `engines.node: >=24` wanted, `v22.22.0` present):

  - `pnpm --filter @prisma-next/mongo-codec typecheck` — PASS.
  - `pnpm --filter @prisma-next/mongo-codec test` — PASS (18/18; 10 runtime + 8 type tests).
  - `pnpm --filter @prisma-next/adapter-mongo typecheck` — PASS.
  - `pnpm --filter @prisma-next/adapter-mongo test` — PASS (215/215 across 7 files).
  - `pnpm --filter @prisma-next/target-mongo typecheck` — PASS.
  - `pnpm --filter @prisma-next/target-mongo test` — PASS (366/366 across 16 files; CAS flake did not reproduce).
  - `pnpm --filter @prisma-next/mongo-contract typecheck` — PASS.
  - `pnpm --filter @prisma-next/mongo-contract test` — PASS (76/76 across 3 files).
  - `pnpm --filter @prisma-next/mongo-lowering typecheck` — PASS.
  - `pnpm --filter @prisma-next/mongo-lowering test` — PASS (no test files; types-only at this layer, as expected).
  - `pnpm --filter @prisma-next/integration-tests exec vitest run --passWithNoTests cross-family-codec` — PASS (3/3).
  - `pnpm typecheck` (workspace-wide) — PASS (120/120 tasks).
  - `pnpm test:packages` (workspace-wide) — PASS (111/111 tasks; full Turbo cache hit).
  - `pnpm test:integration` (full suite) — PASS (104 files / 521 tests).
  - `pnpm lint:deps` — PASS (606 modules / 1198 deps; no violations).

- **Concordance.** Every counts-and-shapes claim in the m4 R2 round notes above (test counts, file paths, generic positions, extractor names, README signature, JSDoc-level documentation) re-verified bit-for-bit against on-disk state. AC-CX1 strictly PASS confirmed. F4 closure confirmed. No drift. No new findings filed by the second-pass reviewer.

- **Stale-snapshot note for orchestrator.** The orchestrator's delegation cited HEAD `47ce86a6f`, but on entry HEAD was `0d7bd780b` (the artifact-commit by an earlier reviewer subagent). The second-pass reviewer treated this as a snapshot-drift situation rather than a re-do trigger — surfacing the situation here for the orchestrator's audit trail.

**Verdict carry-forward:** m4 R2 → **SATISFIED** (unchanged; reaffirmed by independent re-verification).

---

## Finding template

When filing a new finding, copy this block under § Findings log:

```markdown
### F<N> — <short title>

**Severity:** must-fix | should-fix | low / process / informational

**Where:** <file>:<line> or commit SHA + brief description

**What:** One-paragraph problem statement.

**Why it matters:** Impact analysis. Why this is worth surfacing rather than ignoring.

**Recommended next action:** Concrete, addressable next step.

**Status:** open | resolved (commit SHA) | accepted-deferral (link)
```

## Round-notes template

```markdown
### <Phase ID> — Round <N> — <verdict-summary>

**Verdict:** SATISFIED | ANOTHER ROUND NEEDED | ESCALATING TO USER

**What was reviewed:** Commits <SHA>..<SHA>; <implementer report timestamp>.

**Task verification:**

- T<X.Y>: clean / partial / regressed — <one-line>
- T<X.Z>: ...

**AC scoreboard delta:** <what got promoted/demoted>.

**Triage of implementer flags:** <one-line per flag>.

**New findings filed:** F<N>, F<N+1>, ...

**Stale-artifact note:** <whether system-design-review.md / walkthrough.md need refresh>.
```
