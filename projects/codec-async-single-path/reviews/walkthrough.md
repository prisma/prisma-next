# Walkthrough — `codec-async-single-path` (m1 + m2 + m3 + m4 delta)

> **Scope.** m1 + m2 + m3 + m4 (R1 + R2). m1 lands the public codec interface and the `codec()` factory; m2 reshapes the SQL runtime to single-path encode + decode with `Promise.all` concurrent dispatch; m3 verifies the ORM lane carries the runtime's plain-`T` semantics through unchanged; m4 propagates the same single-path async-codec design across the Mongo family's encode-side runtime (decode is intentionally out of scope; Mongo doesn't decode rows today) — m4 R1 lands the encode-side runtime and codec factory shape; m4 R2 closes F4 (README signature alignment) and widens `MongoCodec` to **5 generics matching `BaseCodec` exactly**, achieving strict cross-family parity at the `BaseCodec` seam. Subsequent milestones (security/ADR in m5) are not yet on disk; this walkthrough will be refreshed as later milestones land. Current HEAD: `47ce86a6f`.

## Sources

- PR: not opened yet (PR opening is deferred per [spec.md § Open Questions](../spec.md))
- Ticket: not mirrored
- Commit range (m1 lifecycle on branch): `984feb70d..adafda3a1`
- m1 source-touching commits (the surface this walkthrough covers):
  - `978c4a57a` — failing tests landed first (`T1.1` + `T1.2`)
  - `97c50079e` — implementation that makes the m1 tests pass (`T1.3` + `T1.4`)
  - `3a1e48a60` — F2 fix: `sql-contract-ts` test fixtures
  - `adafda3a1` — audit-discovered consumer fixture fixes (`cli`, `integration-tests`)
- m1 boundary commits (orchestrator-only, not narrated below): `eacb39942` (spec/plan scaffold), `84f538b6e` (task IDs + initial validation gates), `fe8ae334e` (validation-gate refinement)
- Upstream design conversation: [wip/review-code/pr-375/code-review-response.md](../../../wip/review-code/pr-375/code-review-response.md), [wip/review-code/pr-375/alternative-design.md](../../../wip/review-code/pr-375/alternative-design.md)
- Project artifacts: [spec.md](../spec.md), [plan.md](../plan.md), [code-review.md](code-review.md)

## Intent

Make the public `Codec` interface uniformly Promise-returning at the query-time boundary so the future SQL runtime can always-await, regardless of whether a given codec was authored sync or async. Land this without putting any sync/async discriminator on the public surface — no `runtime` flag, no `TRuntime` generic, no conditional return types — so the door to a synchronous fast path stays open as a non-breaking, additive future opt-in. m1 stops at the interface and factory; m2 reshapes the runtime that consumes them.

## Narrative (semantic steps)

1. **Pin the new shape with failing tests first** (commit `978c4a57a`). Type-level assertions for the `Codec` interface (`encode` / `decode` Promise-returning, `encodeJson` / `decodeJson` synchronous, `renderOutputType` optional and synchronous, full keyset asserted) and runtime + type-level assertions for the `codec()` factory (sync, async, mixed, identity-default-encode, sync pass-through of build-time methods) land before any source change. Per `AGENTS.md` § Golden Rules, tests come first; this also makes the rest of the m1 work small follow-on edits.

2. **Reshape the public `Codec` interface and the `codec()` factory** (commit `97c50079e`). Two source files change:
   - `framework-components/src/codec-types.ts` — the framework-agnostic `Codec` becomes 5-generic (`Id, TTraits, TWire, TInput, TOutput = TInput`); `encode` and `decode` become required and Promise-returning; `encodeJson` and `decodeJson` stay required and synchronous; `renderOutputType` stays optional and synchronous.
   - `relational-core/src/ast/codec-types.ts` — the local SQL `Codec` extends the framework base with the same 5-generic head plus SQL-specific fields; the `codec()` factory accepts sync, async, or mixed `encode` / `decode` author functions and lifts them via `async (x) => fn(x)`. `encode` is optional in the spec (identity default installed before lifting); `decode` is required.
   The same commit also updates the immediate consumer tests inside the two source packages (`control-stack.test.ts` inline `CodecLookup` fixture; `codec-types.test.ts` and `sql-codecs.test.ts` await call sites).

3. **Sweep workspace test fixtures whose object literals depended on the pre-m1 sync shape** (commits `3a1e48a60` and `adafda3a1`). Inline `Codec`-shaped object literals in `sql-contract-ts` test files (filed as F2 in [code-review.md](code-review.md)) were updated to match the new interface; an audit-discovered second wave (`cli` and `integration-tests`) followed the same recipe. These are mechanical fixes — `decode: (wire) => wire` becomes `decode: async (wire) => wire`, `encode: async (value) => value` is added when missing — and are confined to test files (no production source touched, no spec/plan touched, no scope creep). The audit result confirms remaining sync-shaped `Codec` literals in the workspace are either factory inputs (which the factory accepts), `as unknown as Codec` cast fixtures (typecheck-bypassed), or m2-residual consumer-side casts in `adapter-postgres/test/codecs.test.ts` (planned reshape).

## Key snippets

### Public `Codec` interface — Before / After

Before (pre-m1, on `main`, 4 generics, sync everything except optional `encode`):

```ts
export interface Codec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TJs = unknown,
> {
  readonly id: Id;
  readonly targetTypes: readonly string[];
  readonly traits?: TTraits;
  encode?(value: TJs): TWire;
  decode(wire: TWire): TJs;
  encodeJson(value: TJs): JsonValue;
  decodeJson(json: JsonValue): TJs;
  renderOutputType?(typeParams: Record<string, unknown>): string | undefined;
}
```

After (m1, on `feat/codec-async-single-path`, 5 generics with `TOutput = TInput` default; query-time methods Promise-returning at the boundary; build-time methods stay sync):

```ts
export interface Codec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TInput = unknown,
  TOutput = TInput,
> {
  readonly id: Id;
  readonly targetTypes: readonly string[];
  readonly traits?: TTraits;
  encode(value: TInput): Promise<TWire>;
  decode(wire: TWire): Promise<TOutput>;
  encodeJson(value: TInput): JsonValue;
  decodeJson(json: JsonValue): TInput;
  renderOutputType?(typeParams: Record<string, unknown>): string | undefined;
}
```

### `codec()` factory — sync-or-async author functions, uniform Promise-returning lift

```ts
export function codec<…>(config: {
  typeId: Id;
  targetTypes: readonly string[];
  encode?: (value: TInput) => TWire | Promise<TWire>;
  decode: (wire: TWire) => TOutput | Promise<TOutput>;
  encodeJson?: (value: TInput) => JsonValue;
  decodeJson?: (json: JsonValue) => TInput;
  …
}): Codec<…> {
  const userEncode =
    config.encode ?? ((value: TInput) => value as unknown as TWire | Promise<TWire>);
  const userDecode = config.decode;
  return {
    id: config.typeId,
    targetTypes: config.targetTypes,
    …
    encode: async (value) => userEncode(value),
    decode: async (wire) => userDecode(wire),
    encodeJson: (config.encodeJson ?? identity) as (value: TInput) => JsonValue,
    decodeJson: (config.decodeJson ?? identity) as (json: JsonValue) => TInput,
  };
}
```

## Behavior changes & evidence

### A. `Codec.encode` / `Codec.decode` query-time methods are Promise-returning at the boundary

**Before → After:** `encode` was optional and sync (`encode?(value: TJs): TWire`); `decode` was required and sync (`decode(wire: TWire): TJs`). After m1, both are required and Promise-returning at the public boundary (`encode(value: TInput): Promise<TWire>`, `decode(wire: TWire): Promise<TOutput>`).

**Why:** Lets the future SQL runtime (m2) always-await a single uniform shape. Avoids putting a `runtime: 'sync' | 'async'` discriminator on the public interface, which would thread through every codec call site and the ORM client's type maps (the rejected PR #375 direction). Cost is bounded: one Promise allocation per cell, microtask resumption batched per row via `Promise.all` (m2 work).

**Implementation:**

- [packages/1-framework/1-core/framework-components/src/codec-types.ts (L27–L50)](../../../packages/1-framework/1-core/framework-components/src/codec-types.ts:27-50)
- [packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts (L57–L69)](../../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts:57-69) — local SQL `Codec` extending the framework base with SQL-specific fields, same generic head

**Tests (evidence):**

- [packages/1-framework/1-core/framework-components/test/codec-types.types.test-d.ts (L5–L17)](../../../packages/1-framework/1-core/framework-components/test/codec-types.types.test-d.ts:5-17) — `encode` / `decode` Promise-returning
- [packages/1-framework/1-core/framework-components/test/codec-types.types.test-d.ts (L43–L57)](../../../packages/1-framework/1-core/framework-components/test/codec-types.types.test-d.ts:43-57) — full keyset assertion proves no `runtime` / `kind` discriminator field

### B. The `codec()` factory accepts sync-or-async author functions and lifts uniformly

**Adds:** A single factory entry that normalizes any combination of sync and async `encode` / `decode` to Promise-shaped methods on the constructed codec. Authors don't annotate; the factory wraps user functions in `async (x) => fn(x)` regardless of whether the user function returns `T` or `Promise<T>`. When `encode` is omitted, an identity passthrough is installed before lifting (so the constructed codec always has an `encode` method even though the spec made it optional for ergonomics).

**Why:** Walk-back constraint — only one factory function (`codec()`); no `codecSync()` / `codecAsync()` variants today. The `codecSync()` opt-in arrives later as a non-breaking additive optimization for cell-count-dominant codecs ([alternative-design.md § Why we trust this design](../../../wip/review-code/pr-375/alternative-design.md#why-we-trust-this-design)).

**Implementation:**

- [packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts (L199–L240)](../../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts:199-240)

**Tests (evidence):**

- [packages/2-sql/4-lanes/relational-core/test/ast/codec-factory.test.ts (L4–L141)](../../../packages/2-sql/4-lanes/relational-core/test/ast/codec-factory.test.ts:4-141) — sync, async, mixed sync+async, mixed async+sync, identity default, sync pass-through of build-time methods, optional `renderOutputType`
- [packages/2-sql/4-lanes/relational-core/test/ast/codec-factory.types.test-d.ts (L4–L77)](../../../packages/2-sql/4-lanes/relational-core/test/ast/codec-factory.types.test-d.ts:4-77) — type-level mirrors of the above; build-time return types do not extend `Promise<unknown>`

### C. `Codec.encodeJson` / `Codec.decodeJson` / `Codec.renderOutputType` remain synchronous (deliberate non-change)

**Adds:** A *guarantee* — not a change to existing behavior, but newly load-bearing because m1 makes the query-time methods async. Build-time methods stay synchronous so `validateContract` (which walks the contract artifact via `decodeJson`) and `postgres({...})` (which calls `validateContract` during construction) stay structurally synchronous regardless of how many codecs in the registry use async query-time methods.

**Why:** Preserves the "build-time vs. query-time seam" the design depends on. Pulling async into build-time methods would force `validateContract` to become async, with downstream ripples through every client constructor — much wider blast radius than this project carries.

**Implementation:**

- [packages/1-framework/1-core/framework-components/src/codec-types.ts (L44–L49)](../../../packages/1-framework/1-core/framework-components/src/codec-types.ts:44-49)

**Tests (evidence):**

- [packages/1-framework/1-core/framework-components/test/codec-types.types.test-d.ts (L19–L41)](../../../packages/1-framework/1-core/framework-components/test/codec-types.types.test-d.ts:19-41) — `encodeJson` / `decodeJson` synchronous, `renderOutputType` optional and synchronous
- [packages/2-sql/4-lanes/relational-core/test/ast/codec-factory.types.test-d.ts (L65–L77)](../../../packages/2-sql/4-lanes/relational-core/test/ast/codec-factory.types.test-d.ts:65-77) — factory pass-through of `encodeJson` / `decodeJson` is non-Promise-returning

> **Literal regression test deferral.** [spec.md § Acceptance Criteria § Runtime AC-RT3 / AC-RT4](../spec.md) requires runtime tests that `validateContract` / `postgres({...})` stay synchronous. These deferred to m2 (T2.7 / T2.8), where the SQL runtime typechecks end-to-end. m1 covers the structural type-level guarantee that motivates the requirement.

### D. `Codec` gains a `TInput` / `TOutput` generic split with `TOutput = TInput` default

**Before → After:** Pre-m1 `Codec<Id, TTraits, TWire, TJs>` (4 generics) becomes `Codec<Id, TTraits, TWire, TInput, TOutput = TInput>` (5 generics with default). Existing 4-generic call sites continue to work via the default — `Codec<Id, Traits, Wire, Js>` resolves to `Codec<Id, Traits, Wire, Js, Js>` with identical method signatures. Explicit 5-generic call sites can express the asymmetric case (input type ≠ output type), which m4 codecs benefit from.

**Why:** Was an open question in [plan.md § Open Items](../plan.md) ("split now vs. defer"). Splitting at m1 avoids forcing a larger reshape later when m4 cross-family codecs need the asymmetry. Backwards-compatible by default.

**Implementation:**

- [packages/1-framework/1-core/framework-components/src/codec-types.ts (L27–L33)](../../../packages/1-framework/1-core/framework-components/src/codec-types.ts:27-33)
- [packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts (L245–L252)](../../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts:245-252) — `CodecInput<T>` / `CodecOutput<T>` helpers (position 4 / position 5 inference)

**Tests (evidence):**

- [packages/1-framework/1-core/framework-components/test/codec-types.types.test-d.ts (L59–L73)](../../../packages/1-framework/1-core/framework-components/test/codec-types.types.test-d.ts:59-73) — pins both the asymmetric case and the 4-generic-default case

## Compatibility / migration / risk

- **Existing 4-generic `Codec<Id, Traits, Wire, Js>` call sites continue to work** via the `TOutput = TInput` default. No mechanical migration required for those sites.
- **Inline `Codec`-shaped test fixtures required mechanical updates** — `decode: (wire) => wire` → `decode: async (wire) => wire`; `encode: async (value) => value` added when missing. Five test files were updated across the m1 sweep:
  - [packages/1-framework/1-core/framework-components/test/control-stack.test.ts](../../../packages/1-framework/1-core/framework-components/test/control-stack.test.ts) (in `97c50079e`)
  - [packages/2-sql/2-authoring/contract-ts/test/contract-builder.contract-definition.test.ts](../../../packages/2-sql/2-authoring/contract-ts/test/contract-builder.contract-definition.test.ts) (in `3a1e48a60` — F2 fix)
  - [packages/2-sql/2-authoring/contract-ts/test/contract-builder.value-objects.test.ts](../../../packages/2-sql/2-authoring/contract-ts/test/contract-builder.value-objects.test.ts) (in `3a1e48a60` — F2 fix)
  - [packages/1-framework/3-tooling/cli/test/control-api/contract-enrichment.test.ts](../../../packages/1-framework/3-tooling/cli/test/control-api/contract-enrichment.test.ts) (in `adafda3a1` — audit-discovered)
  - [test/integration/test/mongo/migration-psl-authoring.test.ts](../../../test/integration/test/mongo/migration-psl-authoring.test.ts) (in `adafda3a1` — audit-discovered)
- **Runtime consumers in m2-m4 packages still typecheck-fail at HEAD as expected residual.** [plan.md § Validation gate convention](../plan.md) defines progressive-green: each milestone's gate names in-scope packages that must be green and expected residual packages whose breakage is acceptable until their reshape lands. At HEAD `adafda3a1`:
  - In-scope green: `framework-components`, `relational-core`, `sql-contract-ts`, `cli`, `integration-tests`.
  - Expected residual still failing: `adapter-postgres` / `adapter-sqlite` (m2), `extension-pgvector` (m3), `mongo-codec` (m4). These fail with the uniform "consumer calls sync `codec.encode` / `codec.decode`" pattern; they reshape on schedule.
  - Surprise (informational, not a finding): `sql-runtime` and `sql-orm-client` typecheck-clean at m1 — see [code-review.md § m1 — Round 2 — Implementer-flagged item](code-review.md). m2 / m3 reviewer should confirm whether the planned reshape scope is partially implicit or whether typecheck-clean masks a real failure.
- **No public re-exports / shims for backwards compatibility.** Per `AGENTS.md` § Golden Rules.
- **No security or migration concerns at m1.** Error-redaction policy translates from PR #375 at m5; the fixtures and assertions are independent of the m1 interface change.

## Follow-ups / open questions

- **Internal review/refine gate (T1.6).** Confirm the M1 interface + factory shape with the project owner before starting M2 (per [plan.md § Milestone 1](../plan.md)).
- **m2 / m3 reshape scope re-estimation.** The `sql-runtime` / `sql-orm-client` typecheck-clean at HEAD suggests the planned m2 / m3 reshape may be partially implicit. m2 reviewer to confirm.
- **Identity-default `encode` cast** ([packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts (L221–L222)](../../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts:221-222)) — `as unknown as TWire | Promise<TWire>` lacks an inline `// why` comment per `AGENTS.md` § Typesafety rules. Worth a "should-fix" on a future factory-touch round (m4 cross-family alignment is a natural moment); not flagged at m1 because semantics match the design doc and the cast follows the documented pattern in [alternative-design.md § The factory](../../../wip/review-code/pr-375/alternative-design.md#the-factory).
- **F1** (open finding from [code-review.md](code-review.md)) — undocumented `as unknown as TTraits` cast in `mongoCodec()`; pre-existing on `main`, deferred to m4 housekeeping.

---

## M2 R1 delta

> **Scope.** m2 only — the SQL runtime's reshape onto the always-await, single-armed, concurrent-dispatch path. `feat/codec-async-single-path` advanced from `adafda3a1` (m1 SATISFIED) to `4d7fc1261` (m2 SATISFIED). The original m1 sections above are preserved verbatim; m2 deltas are appended here.

### Sources (m2)

- Commit range (m2 lifecycle on branch): `adafda3a1..4d7fc1261`
- m2 source-touching commits (the surface this delta covers):
  - `a83ccb200` — failing tests landed first (`T2.1`, `T2.2`, `T2.7`, `T2.8` + `json-schema-validation.test.ts` await sweep)
  - `62a565d0c` — implementation that makes the m2 tests pass (`T2.3`, `T2.4`, `T2.5`, `T2.6`)
  - `4d7fc1261` — adapter test consumer reshape (`adapter-postgres`, `adapter-sqlite` codec test casts upgraded to `Promise<...>` returns + `await` at call sites)
- m2 boundary commits (orchestrator-only, not narrated below): `e47a09077` (F1 → m4 T4.2 sub-task per `drive-orchestrate-plan` skill update)
- Project artifacts (refreshed for m2): [code-review.md § m2 — Round 1](code-review.md), [system-design-review.md § M2 R1](system-design-review.md)

### Intent (m2)

The runtime adopts the async path that m1 prepared the type system for: every codec dispatch on the per-row hot paths now goes through a single `await` per cell, dispatched concurrently via `Promise.all` — once for params before driver dispatch, once per row for cell decoding. The m1 walk-back constraints (no marker, no `TRuntime`, no predicates, no plan-walker, no `instanceof Promise` guards) are honored in the runtime literally: no sync-vs-async branching anywhere, no `WeakMap` cache, no per-codec dispatch tables. Errors surface through the standard runtime envelopes (`RUNTIME.ENCODE_FAILED`, `RUNTIME.DECODE_FAILED`) with `cause` chaining and structured details. The build-time / query-time seam is preserved at the literal regression level (`validateContract` and `postgres({...})` tested for runtime synchrony).

### Narrative (semantic steps)

1. **Pin the runtime contract with failing tests first** (commit `a83ccb200`). Twelve concurrent-dispatch + envelope-shape + single-armed + JSON-Schema-on-resolved tests land in a new `codec-async.test.ts` file in `sql-runtime`; two synchronous-return regression suites land in `sql-contract`'s `validate.test.ts` and `extensions/postgres`'s `postgres.test.ts`; the existing `json-schema-validation.test.ts` is re-awaited at call sites to compose with the new async boundary. All twelve `codec-async.test.ts` tests fail against the m1 baseline (the runtime does not yet dispatch concurrently, does not yet await codec methods, does not yet wrap envelopes); the two regression suites pass against m1 (structural sync was already preserved at the type level). The TDD discipline produces a clear failing surface to drive against.

2. **Reshape the runtime onto the async path** (commit `62a565d0c`). Three runtime files change in a coherent move:
   - `encoding.ts` — `encodeParam` becomes `async` and awaits `codec.encode(value)`; failures wrap in `wrapEncodeFailure` with `{ label, codec, paramIndex, cause }`. `encodeParams` builds a `tasks: Promise<unknown>[]` array, awaits a single `Promise.all(tasks)`, freezes the result.
   - `decoding.ts` — a new local `async function decodeField` becomes the single-armed per-cell dispatch path: one `await codec.decode(wireValue)`, optional sync `validateJsonValue` against the resolved value, return plain decoded value. `decodeRow` builds `tasks: Promise<unknown>[]` per cell with `Promise.resolve(undefined)` placeholders for include-aggregate slots; awaits `Promise.all(tasks)`; synchronously slots include-aggregates into the `undefined` positions; assembles the row in alias order. `wrapDecodeFailure` produces `{ table, column, codec, cause }` from projection alias-to-ref mapping (fast path) or `fallbackColumnRefIndex` (rebuilt from `plan.refs.columns` when projection mapping is unavailable, validator-independent).
   - `sql-runtime.ts` — the inner async generator's encode site becomes `const encodedParams = await encodeParams(...)`; the per-row decode site becomes `const decodedRow = await decodeRow(...)` inside `for await (const rawRow of coreIterator) { ...; yield decodedRow as Row; }`. No plan-walker, no `WeakMap`, no `instanceof Promise` guards (verified by `rg` in [code-review.md § m2 — Round 1 — Task verification](code-review.md)).

3. **Reshape adapter consumer test casts** (commit `4d7fc1261`). Inline `Codec`-shaped structural casts in `adapter-postgres/test/codecs.test.ts` and `adapter-sqlite/test/codecs.test.ts` are narrowed from `{ encode: (v) => string }` to `{ encode: (v) => Promise<string> }`; call sites prefixed with `await`. No production code changes. The `numeric` codec's `decode: (wire: string|number) => Promise<string>` cast preserves the pre-existing runtime widening (the production `pgNumericCodec`'s `decode` implementation accepts `string | number` even though its declared `TWire` is `string`); see [code-review.md § m2 — Round 1 — Triage of implementer-flagged items](code-review.md) item #3.

### Key snippets

#### `encodeParams` — concurrent dispatch via `Promise.all`

Before (m1, sync `for` loop, `unknown`-typed cells hiding Promise leaks):

```ts
export function encodeParams(
  plan: ExecutionPlan<unknown>,
  registry: CodecRegistry,
): readonly unknown[] {
  const params = new Array<unknown>(plan.params.length);
  for (let i = 0; i < plan.params.length; i++) {
    const paramDescriptor = plan.paramDescriptors[i];
    const codec = resolveCodec(paramDescriptor, registry);
    params[i] = encodeParam(plan.params[i], paramDescriptor, i, registry);
  }
  return Object.freeze(params);
}
```

After (m2, async + `Promise.all`):

```ts
export async function encodeParams(
  plan: ExecutionPlan<unknown>,
  registry: CodecRegistry,
): Promise<readonly unknown[]> {
  const tasks: Promise<unknown>[] = new Array(plan.params.length);
  for (let i = 0; i < plan.params.length; i++) {
    const paramValue = plan.params[i];
    const paramDescriptor = plan.paramDescriptors[i];
    tasks[i] = encodeParam(paramValue, paramDescriptor, i, registry);
  }
  const encoded = await Promise.all(tasks);
  return Object.freeze(encoded);
}
```

#### `decodeField` — single-armed per-cell dispatch

```ts
async function decodeField(
  wireValue: unknown,
  alias: string,
  ref: ColumnRef | undefined,
  codec: Codec,
  jsonValidators: JsonValidators | undefined,
): Promise<unknown> {
  let decoded: unknown;
  try {
    decoded = await codec.decode(wireValue);
  } catch (error) {
    wrapDecodeFailure(error, alias, ref, codec, wireValue);
  }
  if (jsonValidators && ref) {
    try {
      validateJsonValue(jsonValidators, ref.table, ref.column, decoded, 'decode', codec.id);
    } catch (error) {
      throw error;
    }
  }
  return decoded;
}
```

The same body runs for sync-authored and async-authored codecs — m1's factory always lifts to `Promise<TOutput>`, so the runtime sees one shape. Pinned by [codec-async.test.ts (L479–L523)](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:479-523).

#### `decodeRow` — concurrent dispatch with include-aggregate slotting

```ts
const fallbackColumnRefIndex =
  !projection || Array.isArray(projection) ? buildColumnRefIndex(plan) : null;
const tasks: Promise<unknown>[] = new Array(aliases.length);
const includeIndices: Array<{ index: number; alias: string; value: unknown }> = [];

for (let i = 0; i < aliases.length; i++) {
  const alias = aliases[i];
  const wireValue = rawRow[alias];
  const projectionValue = /* ... resolves alias → 'include:<key>' or codec id */;
  if (typeof projectionValue === 'string' && projectionValue.startsWith('include:')) {
    includeIndices.push({ index: i, alias, value: wireValue });
    tasks[i] = Promise.resolve(undefined);
    continue;
  }
  const ref = /* projection mapping or fallbackColumnRefIndex.get(alias) */;
  tasks[i] = decodeField(wireValue, alias, ref, codec, jsonValidators);
}

const settled = await Promise.all(tasks);
for (const entry of includeIndices) {
  settled[entry.index] = decodeIncludeAggregate(entry.alias, entry.value);
}
// build decoded row from settled[i] in alias order
```

Order-equivalent to the prior sync `for` loop (deterministic post-gather slot assignment); failure-equivalent (include-aggregates never see partial codec failures because `Promise.all` short-circuits before the post-gather slot-assignment loop runs). Pinned by [codec-async.test.ts (L269–L477)](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:269-477).

#### Runtime async generator — await at both boundaries

```ts
const iterator = async function* (self: SqlRuntime) {
  const encodedParams = await encodeParams(executablePlan, self.codecRegistry);
  const planWithEncodedParams: ExecutionPlan<Row> = {
    ...executablePlan,
    params: encodedParams,
  };
  const coreIterator = queryable.execute(planWithEncodedParams);
  for await (const rawRow of coreIterator) {
    const decodedRow = await decodeRow(/* ... */);
    yield decodedRow as Row;
  }
};
```

Two await sites (encode-once, decode-per-row), zero defensive guards, zero plan-walker. Pinned by [codec-async.test.ts (L116–L141, L335–L359)](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:116-141).

### Behavior changes & evidence

#### A. SQL runtime always-awaits codec methods (encoding + decoding)

**Before → After:** Pre-m2 the runtime called `codec.encode(value)` and `codec.decode(wire)` synchronously; if a codec returned a `Promise`, the runtime treated it as the cell value (a Promise leak — the `unknown` cell typing hid this from the type system, surfacing only as runtime data corruption). m2 awaits both methods at the boundary; cell values yielded to the consumer are always plain (no `Promise`-typed fields reach user code).

**Why:** Closes the soundness gap explained in m1 R2's typecheck-clean surprise (`encodeParam` / `decodeRow` returned `unknown`, so `Promise<TWire>` / `Promise<TJs>` silently widened). The runtime now sees one shape: Promise-returning codec methods, single-armed dispatch, plain values out.

**Implementation:**

- [packages/2-sql/5-runtime/src/codecs/encoding.ts (L78–L100)](../../../packages/2-sql/5-runtime/src/codecs/encoding.ts:78-100) — `encodeParams` async + `Promise.all`
- [packages/2-sql/5-runtime/src/codecs/decoding.ts (L164–L277)](../../../packages/2-sql/5-runtime/src/codecs/decoding.ts:164-277) — `decodeField` async, `decodeRow` async + `Promise.all`
- [packages/2-sql/5-runtime/src/sql-runtime.ts (L201–L209)](../../../packages/2-sql/5-runtime/src/sql-runtime.ts:201-209) — async iterator awaits at both sites

**Tests (evidence):**

- [packages/2-sql/5-runtime/test/codec-async.test.ts (L116–L141)](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:116-141) — `always awaits codec.encode (no Promise leaks into the driver)`
- [packages/2-sql/5-runtime/test/codec-async.test.ts (L335–L359)](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:335-359) — `always awaits codec.decode and yields plain values (no Promise leaks)`

#### B. Concurrent dispatch via `Promise.all` at exactly two sites

**Before → After:** Pre-m2 the runtime dispatched codec methods serially (sequential `for` loop). m2 dispatches them concurrently within a row (decode) or within a parameter set (encode) via a single `Promise.all` per site. Latency for N cells of body work becomes `max(body_i)` instead of `sum(body_i)` plus one microtask per resumption.

**Why:** The single-path design's value proposition is that latency-dominant async codecs (KMS round-trips, externally-resolved secrets) do not serialize per cell. Sustained-throughput workloads pay the allocation cost in exchange (one Promise per cell), with the documented walk-back path (`codecSync()` + predicates) reserved as a future additive opt-in.

**Implementation:** Same pointers as Behavior A.

**Tests (evidence):**

- [packages/2-sql/5-runtime/test/codec-async.test.ts (L50–L114)](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:50-114) — `dispatches mixed sync/async parameter codecs concurrently via Promise.all` (start/resolve ordering pinned: `start_a < start_b` while `resolve_b < resolve_a`)
- [packages/2-sql/5-runtime/test/codec-async.test.ts (L269–L333)](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:269-333) — `dispatches per-cell decoders concurrently via Promise.all`

#### C. Standard runtime error envelopes: `RUNTIME.ENCODE_FAILED` and `RUNTIME.DECODE_FAILED`

**Before → After:** Pre-m2 codec failures surfaced as raw thrown errors from inside `for` loops. m2 wraps codec failures in standard envelopes with `cause` chaining and structured details (`{ label, codec, paramIndex }` for encode; `{ table, column, codec }` or `{ alias, codec }` fallback for decode). The pre-existing `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` envelope from `validateJsonValue` is preserved verbatim — `wrapDecodeFailure` checks the thrown error's code and re-raises the original envelope when it matches a known JSON-Schema validation code.

**Why:** AC-RT5 / AC-RT6 require `cause` chaining and structured details so application-level callers can correlate codec failures back to the parameter or column that triggered them. The fallback `{ alias, codec }` shape on the decode side is graceful runtime degradation for non-DSL plans where projection mapping is unavailable; it preserves the codec id (the most diagnostic field) and the alias (for caller correlation).

**Implementation:**

- [packages/2-sql/5-runtime/src/codecs/encoding.ts (L23–L38)](../../../packages/2-sql/5-runtime/src/codecs/encoding.ts:23-38) — `wrapEncodeFailure`
- [packages/2-sql/5-runtime/src/codecs/decoding.ts (L98–L118)](../../../packages/2-sql/5-runtime/src/codecs/decoding.ts:98-118) — `wrapDecodeFailure` (with code-preserving rethrow for JSON-Schema validation)

**Tests (evidence):**

- [packages/2-sql/5-runtime/test/codec-async.test.ts (L143–L207)](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:143-207) — `wraps encode failures in RUNTIME.ENCODE_FAILED with { label, codec, paramIndex } and cause` + `uses param[<i>] label when descriptor has no name`
- [packages/2-sql/5-runtime/test/codec-async.test.ts (L406–L477)](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:406-477) — `wraps decode failures in RUNTIME.DECODE_FAILED with { table, column, codec } and cause` + `falls back to refs index when projection mapping is unavailable`

#### D. JSON-Schema validation runs against the resolved (awaited) decoded value

**Before → After:** The pre-m2 `decodeRow` called `validateJsonValue(...)` on the cell value directly after the sync `decode(...)` call; m2's `decodeField` calls `await codec.decode(wireValue)` *first*, then conditionally calls the still-synchronous `validateJsonValue(...)` against the resolved decoded value. Since `validateJsonValue` itself is unchanged, the only delta is the call-site sequencing — but it is load-bearing: validating against the unresolved Promise would always succeed with garbage detail or fail with a type mismatch on the schema's `type: 'string' | 'number' | ...` keyword, whereas validating against the resolved value enforces the schema as specified.

**Why:** AC-RT7 explicitly requires "JSON-Schema validation runs against the resolved decoded value, not the Promise."

**Implementation:**

- [packages/2-sql/5-runtime/src/codecs/decoding.ts (L184–L198)](../../../packages/2-sql/5-runtime/src/codecs/decoding.ts:184-198) — sequencing inside `decodeField`

**Tests (evidence):**

- [packages/2-sql/5-runtime/test/codec-async.test.ts (L361–L404)](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:361-404) — `runs JSON-Schema validation against the resolved (awaited) decoded value`

#### E. `validateContract` and `postgres({...})` literal synchronous-return regression

**Before → After:** m1 proved structural sync at the type level via `codec-types.types.test-d.ts`. m2 closes the loop at the literal regression level: both `validateContract` and `postgres({...})` are tested with one type-level subtest (assignment to a non-Promise-typed variable) and one runtime subtest (`expect(typeof (result as { then?: unknown }).then).toBe('undefined')`).

**Why:** AC-RT3 / AC-RT4 require runtime regression tests; m1 deferred them to m2 where the SQL runtime typechecks end-to-end. The contract pipeline's structural synchrony is now defended at the call-site level.

**Implementation:** None — these are tests of existing behavior that must not regress.

**Tests (evidence):**

- [packages/2-sql/1-core/contract/test/validate.test.ts (L856–L881)](../../../packages/2-sql/1-core/contract/test/validate.test.ts:856-881) — `synchronous return (regression)` describe block
- [packages/3-extensions/postgres/test/postgres.test.ts (L112–L124)](../../../packages/3-extensions/postgres/test/postgres.test.ts:112-124) — `synchronous return (regression)` describe block

#### F. Adapter consumer test casts narrowed to Promise-returning shape

**Before → After:** Inline `Codec`-shaped structural casts in `adapter-postgres/test/codecs.test.ts` and `adapter-sqlite/test/codecs.test.ts` were narrowed from `{ encode: (v) => string }` to `{ encode: (v) => Promise<string> }`; call sites prefixed with `await`. No production code changed.

**Why:** Required to make `adapter-postgres` and `adapter-sqlite` typecheck-clean at m2's gate (these were "expected residual" packages at m1 with consumer-side casts that assumed sync codec methods). The reshape is mechanical; the production codecs themselves were already Promise-returning at the boundary by virtue of the m1 factory's lift.

**Implementation:** None — test-only changes.

**Tests (evidence):** The reshape itself is the change; verified by `pnpm --filter @prisma-next/adapter-postgres test` (492/492) and `pnpm --filter @prisma-next/adapter-sqlite test` (67/67).

### Compatibility / migration / risk (m2)

- **Public API surface unchanged.** The `Codec` interface declared in `framework-components` is the m1 shape (Promise-returning at the boundary; sync at the build-time methods). m2 only changes how the SQL runtime *consumes* it. The m1 walk-back constraints (no marker / no `TRuntime` / no predicates / no plan-walker / no `instanceof Promise`) hold at m2: reviewer ran `rg 'instanceof Promise|WeakMap|plan-walker' packages/2-sql/5-runtime/src` and got zero matches; per-codec dispatch tables are absent.
- **Promise.all failure semantics are partial fail-fast.** First rejected codec dispatch surfaces as the error envelope; remaining dispatched bodies still run to completion (cannot be cancelled in standard `Promise.all`) but their outputs are discarded. This matches the prior synchronous loop's "throw on first failure" semantics from the user's point of view. Documented in [system-design-review.md § M2.3](system-design-review.md) so the m5 ADR can be explicit about it.
- **Allocation pressure now realized.** Every codec dispatch allocates one Promise per cell. For a query returning N rows × M cells, that's N × M Promise allocations; the walk-back path (`codecSync()` + predicates as a future additive opt-in) is preserved.
- **`fallbackColumnRefIndex` build-condition broadening — bounded.** The condition was widened from "build when validators are present" to "build when projection alias-to-ref mapping is unavailable, validator-independent." Required for AC-RT6's `{ table, column }` envelope detail regardless of validator presence; validator-present hot path (DSL plans with projection) is unchanged. See [code-review.md § m2 — Round 1 — Triage of implementer-flagged items](code-review.md) item #1.
- **`adapter-postgres` `numeric` codec test cast preserved as-is.** The `decode: (wire: string|number) => Promise<string>` cast mirrors the production `pgNumericCodec`'s `decode` implementation, which accepts `string | number` even though its declared `TWire` is `string` (driver compatibility — `node-postgres` returns numerics as strings by default but some configurations widen). Pre-existing runtime widening, not introduced by m2.
- **`sql-orm-client` typechecks and tests cleanly at m2.** The package consumes results through `sql-runtime`'s now-await-correct async iterator, never calls codec methods directly (verified by `rg 'codec\.(encode|decode)\b' packages/3-extensions/sql-orm-client/src` — zero matches). m3's planned reshape may be lighter than originally estimated; surfaced as a plan-amendment opportunity to the orchestrator.
- **Expected residual at m2:** `extension-pgvector` (m3), `mongo-codec` (m4) — both still failing typecheck per plan; verified directly by reviewer.
- **No security or migration concerns at m2.** Error-redaction policy translates from PR #375 at m5; m2 only introduces structured detail in envelopes (`label`, `codec`, `paramIndex`, `table`, `column`), all of which are already plan-derived (no user data).

### Follow-ups / open questions (m2)

- **m3 scope re-estimation.** Confirm with the orchestrator and m3 implementer whether `sql-orm-client` typecheck-clean at m2 means part of T3.5 / T3.6 is implicitly satisfied. m3's residual scope likely reduces to (a) `extension-pgvector` consumer reshape, (b) m3-T3.1's ORM-level `.first()` / `.all()` / `for await` type-test assertions, and (c) any consumer code in the ORM lane that *constructs* codec literals.
- **ORM-level row-shape assertions (T3.1).** Verify AC-RT2's "no Promise leaks into user code" guarantee end-to-end through the ORM lane.
- **Identity-default `encode` cast** (carried forward from m1) — `as unknown as TWire | Promise<TWire>` lacks an inline `// why` comment per `AGENTS.md` § Typesafety rules. Continues to be a candidate for "should-fix" review when m4's T4.2 reshape touches the factory.
- **F1 closure** — closed as bookkeeping under the new findings discipline (`drive-orchestrate-plan` skill update). The cast cleanup is now folded into m4's T4.2 sub-task in [plan.md (commit `e47a09077`)](../plan.md). No code change at m2.

## M3 R1 delta

### Sources (m3)

- Commit range (m3 lifecycle on branch): `4d7fc1261..41e01b5f3`
- m3 source-touching commits (the surface this delta covers):
  - `7505ef158` — `test(sql-orm-client, pgvector): m3 ORM read/write surfaces present plain T (T3.1–T3.6)` (adds [`test/codec-async.types.test-d.ts`](../../../packages/3-extensions/sql-orm-client/test/codec-async.types.test-d.ts), adds [`test/integration/codec-async.test.ts`](../../../packages/3-extensions/sql-orm-client/test/integration/codec-async.test.ts), aligns [`packages/3-extensions/pgvector/test/codecs.test.ts`](../../../packages/3-extensions/pgvector/test/codecs.test.ts) with the m1 codec interface, deletes a broken untracked `test/codec-async.e2e.test.ts` mock-driver attempt)
  - `41e01b5f3` — `docs(sql-orm-client): document codec-async decode linkage in collection-dispatch (T3.4)` (adds a header doc block to [`collection-dispatch.ts`](../../../packages/3-extensions/sql-orm-client/src/collection-dispatch.ts))

### Intent (m3)

m2 made the SQL runtime always-await codec encode and decode, and m1 made the `codec()` factory accept both sync and async author functions and lift them uniformly. Together those two milestones already make the *runtime layer* return plain `T` to whatever consumes its async iterator. m3's intent is to **verify that the ORM lane carries the async-codec semantics through unchanged** — both at the type-system level (read and write surfaces expose plain `T`, never `Promise<T>` or `T | Promise<T>`) and at the runtime level (a real query roundtrip with a real codec lift produces plain values on disk, not stringified Promises). The milestone is verification-only by design: no production code in `sql-orm-client/src/` changes (apart from a documentation comment), because the m1 + m2 design already positioned the ORM client correctly. The work that lands at m3 is type-level evidence (`expectTypeOf` assertions), runtime-level evidence (live-Postgres integration test against `pg/vector@1` and `pg/jsonb@1`), and one doc comment that records the file-level invariant.

### Narrative (semantic steps, m3)

1. **Pin ORM read + write surfaces to plain `T` at the type level** (commit `7505ef158`, `test/codec-async.types.test-d.ts`). 21 type tests across three sections: read surfaces (`DefaultModelRow`, `InferRootRow`, `Collection.first()`'s awaited row, the `Collection.all()` async iterator's iterated row, `Collection.all().firstOrThrow()`'s awaited row); write surfaces (`CreateInput`, `MutationUpdateInput`, `UniqueConstraintCriterion`, `ShorthandWhereFilter`); negative tests (`IsPromiseLike<…> = false` on every read+write field position, plus equality assertions pinning `CreateInput`/`MutationUpdateInput` field types to `DefaultModelRow` field types — the "one type-map" invariant). These tests fail compile if any future drift introduces `Promise<T>` into a consumer-facing field position or splits the field type-map for codec output types.
2. **Prove the ORM roundtrip with live Postgres + a real codec lift** (commit `7505ef158`, `test/integration/codec-async.test.ts`). 5 integration tests against the live-Postgres harness, exercising both `pg/vector@1` (synchronous `encode`/`decode` author functions, lifted to async by the m1 factory) and `pg/jsonb@1` (synchronous `encode`/`decode`, also lifted) on the same models. Read paths verify `.first()` and `for await ... of c.all()` yield rows whose codec-decoded fields are plain (with explicit `expect(value).not.toBeInstanceOf(Promise)` per cell). Write paths verify `create()` and `update()` accept plain `T` and persist the codec's wire format on disk (`select embedding::text` returns `'[0.1,0.2,0.3]'`, `select address` returns the codec's JSON shape) — the strongest possible evidence that the m1 + m2 + m3 composition produces correct round-trips end-to-end.
3. **Record the codec-agnostic-dispatch invariant in `collection-dispatch.ts`** (commit `41e01b5f3`). Add a header doc block stating that per-row decoding is owned upstream in `sql-runtime`'s row-yielding async generator, that this file never calls codec query-time methods directly, and that consumers therefore see plain `T` cell values. Cross-link `packages/2-sql/5-runtime/src/codecs/decoding.ts` as the canonical upstream. **Defect:** the commit landed *two* stacked header doc blocks back-to-back where one was intended (the second references the deleted `test/codec-async.e2e.test.ts`); see F3 in [code-review.md](code-review.md) for the recommended one-edit fix.
4. **Align `extension-pgvector` unit tests with the m1 codec interface** (commit `7505ef158`). Mechanical fixup: cast the codec definition through an `AsyncVectorCodec` shape so its `encode`/`decode` are typed as Promise-returning; convert test functions to `async`; `await` every `encode`/`decode` call site; convert sync `expect(...).toThrow(...)` rejection assertions to `await expect(...).rejects.toThrow(...)`. No behavioural change to the codec body, no scope creep. The fixup was bundled into the m3 test commit because the cause (m1 codec-interface bump) is shared with the m1 R2 expected residual.

### Behavior changes & evidence (m3)

#### A. ORM read surfaces expose plain `T` for codec-decoded fields

**Before → After:** Pre-m3, the ORM lane was *structurally* correct (because `sql-runtime`'s async generator awaits `decodeRow` before yielding rows; M2.1.2 in [system-design-review.md](system-design-review.md)) but the invariant was not pinned at the type-system level. Post-m3, every read-position on `DefaultModelRow`, `InferRootRow`, `Collection.first()`, the `Collection.all()` async iterator, and `Collection.all().firstOrThrow()` is asserted to be plain `T` (or `T | null`) at compile time, with `IsPromiseLike<…> = false` negative assertions as a regression guard. Any future change that surfaces `Promise<T>` into a row-shape field position will break the type tests at compile time.

**Why:** AC-OC1 ("`DefaultModelRow` / `InferRootRow` plain `T` for codec-decoded fields, one-shot + streaming"), and AC-RT2 ("rows yielded by runtime have plain field values") at the ORM-lane level.

**Implementation:** None — verification only. The structural guarantee is m2's `sql-runtime` async generator (which awaits `decodeRow` before yielding) plus m1's `codec()` factory (which lifts sync `decode` to Promise-returning so the runtime can uniformly await). m3 does not change either.

**Tests (evidence):**

- [test/codec-async.types.test-d.ts (L66–L120)](../../../packages/3-extensions/sql-orm-client/test/codec-async.types.test-d.ts:66-120) — `DefaultModelRow exposes plain string for pg/text@1 columns`, `DefaultModelRow exposes plain T | null for nullable pg/int4@1 columns`, `DefaultModelRow exposes plain object value (no Promise) for jsonb-backed value object`, `Collection.first() resolves to a plain row | null (no Promise<T> on row fields)`, `Collection async iteration yields a plain row (no Promise<T> on row fields)`, `Collection.all().firstOrThrow() resolves to a plain row (no Promise<T> on row fields)`
- [test/integration/codec-async.test.ts (L37–L94)](../../../packages/3-extensions/sql-orm-client/test/integration/codec-async.test.ts:37-94) — `first() resolves a row with plain values for vector and jsonb async-codec columns`, `for-await streaming yields rows with plain values for the vector async-codec column`

#### B. ORM write surfaces accept plain `T` for codec-backed fields

**Before → After:** Pre-m3, write surfaces (`CreateInput`, `MutationUpdateInput`, `UniqueConstraintCriterion`, `ShorthandWhereFilter`) were *structurally* derived from the same field type-map as read surfaces (no read/write split has ever existed in `sql-orm-client`), but the invariant was not pinned at the type-system level. Post-m3, every write-position is asserted to be plain `T` (with `null | undefined` where the field is nullable / optional) at compile time. Live-Postgres integration tests confirm that `create()` and `update()` with plain `T` write surfaces produce correctly-encoded wire values on disk via the m2 runtime's `await encodeParams` boundary.

**Why:** AC-OC2 ("write surfaces accept plain `T`") and AC-CF4 ORM portion ("sync codec works through runtime; replacing with async also works (E2E)") — the integration tests use synchronous-author codecs (`pg/vector@1`, `pg/jsonb@1`) lifted to Promise-returning by the m1 factory, exercising the full sync→async-runtime composition end-to-end.

**Implementation:** None — verification only. The structural guarantee is `sql-orm-client/src/types.ts`'s derivation of `CreateInput` / `MutationUpdateInput` from `DefaultModelRow`, plus m2's `await encodeParams` boundary. m3 does not change either.

**Tests (evidence):**

- [test/codec-async.types.test-d.ts (L126–L191)](../../../packages/3-extensions/sql-orm-client/test/codec-async.types.test-d.ts:126-191) — `CreateInput accepts plain string for pg/text@1 fields`, `CreateInput accepts plain object for jsonb-backed value-object field`, `MutationUpdateInput accepts plain T for jsonb-backed value-object field`, `UniqueConstraintCriterion variants carry plain T for unique columns`, `ShorthandWhereFilter accepts plain T (or null/undefined) for filterable fields`, plus 5 negative `IsPromiseLike<…> = false` assertions on the same fields
- [test/integration/codec-async.test.ts (L97–L180)](../../../packages/3-extensions/sql-orm-client/test/integration/codec-async.test.ts:97-180) — `create() accepts plain number[] for embedding and persists via the runtime async encode path`, `create() accepts plain object for jsonb-backed value-object field and persists JSON`, `update() accepts plain number[] for embedding and re-encodes via the runtime async path`. The first and third tests verify the literal wire format via `select embedding::text` returning `'[0.1,0.2,0.3]'` / `'[0.4,0.5,0.6]'`; the second verifies the `address` JSON shape via `select address`.

#### C. One field type-map shared by read and write surfaces (no read/write split)

**Before → After:** Pre-m3, `DefaultModelRow` was already the single field type-map for `User` (and every other model), and `CreateInput` / `MutationUpdateInput` were already derived from it via `Pick` / `Partial`. m3 confirms this on disk, asserts it at the type-system level, and documents the absence of a parallel `DefaultModelInputRow` (the spec's "no read/write split" wording can be read as forbidding such a parallel type — the absence is the verification).

**Why:** AC-OC3 ("one field type-map shared by read/write surfaces"). PR #375's rejected design had introduced a read/write split for codec output types (read returns `Promise<T>`, write accepts `T`); the single-path design rejects that split entirely.

**Implementation:** None — verification only. `DefaultModelRow` at [packages/3-extensions/sql-orm-client/src/types.ts (L426–L428)](../../../packages/3-extensions/sql-orm-client/src/types.ts:426-428) is the single source of truth; `CreateInput` (L776–L781), `VariantCreateInput` (L808–L813), `NestedCreateInput`/`MutationCreateInput` (L1027–L1047), `MutationUpdateInput` (L1055–L1058) all derive from it.

**Tests (evidence):**

- [test/codec-async.types.test-d.ts (L200–L210)](../../../packages/3-extensions/sql-orm-client/test/codec-async.types.test-d.ts:200-210) — `CreateInput field types match DefaultModelRow field types (one type-map)`, `MutationUpdateInput field types match DefaultModelRow field types (one type-map)` — both assert `expectTypeOf<NonNullable<UserCreate['name']>>().toEqualTypeOf<UserRow['name']>()` and similar for `email` / `address`. Any future divergence (e.g. introducing a `DefaultModelInputRow` with `Promise<T>` field positions) would fail these assertions at compile time.
- Source audit: `rg DefaultModelInputRow packages/` returns zero matches in `src/` and only references in the m3 type-test comments documenting the absence.

#### D. ORM dispatch layer is codec-agnostic (documented in the file)

**Before → After:** Pre-m3, `dispatchCollectionRows` already did not call `codec.encode` or `codec.decode` — the runtime layer (`sql-runtime`) owns codec dispatch, and the ORM lane only consumes the runtime's async iterator. m3 records this invariant in a header doc block on `collection-dispatch.ts` so that future readers can verify the file's role at a glance. The integration test's `for await ... of posts.orderBy(p => p.id.asc()).all()` loop with per-row `expect(row.embedding).not.toBeInstanceOf(Promise)` exercises the dispatch path under live Postgres, providing runtime evidence that the documented invariant holds.

**Why:** AC-RT2's ORM portion ("no Promise leaks into user code") relies on the ORM lane not interposing its own dispatch logic. T3.4 in the plan was a verification task; the doc comment is the on-disk record.

**Implementation:**

- [packages/3-extensions/sql-orm-client/src/collection-dispatch.ts (L1–L13)](../../../packages/3-extensions/sql-orm-client/src/collection-dispatch.ts:1-13) — header doc block documenting the codec-agnostic invariant (commit `41e01b5f3`)
- *Defect (F3):* the commit also accidentally introduced a *second* header doc block at [L15–L31](../../../packages/3-extensions/sql-orm-client/src/collection-dispatch.ts:15-31) that duplicates the substance of the first and additionally references the deleted `test/codec-async.e2e.test.ts`. The fix is to merge the two blocks into one and drop the stale reference. Filed as F3 (should-fix); see [code-review.md § F3](code-review.md) for the recommended next action.

**Tests (evidence):**

- Source audit: `rg 'codec\.(encode|decode)\b' packages/3-extensions/sql-orm-client/src` returns zero matches.
- [test/integration/codec-async.test.ts (L78–L91)](../../../packages/3-extensions/sql-orm-client/test/integration/codec-async.test.ts:78-91) — the `for await` loop yields plain rows on each iteration; `expect(row.embedding).not.toBeInstanceOf(Promise)` fires per yielded row.

#### E. `extension-pgvector` unit tests aligned with the m1 codec interface

**Before → After:** Pre-m3, `pgvector/test/codecs.test.ts` was structurally regressed against the m1 codec-interface bump (codec methods were called synchronously without `await`; rejection paths used sync `toThrow` instead of `rejects.toThrow`). This was the m1 R2 expected residual for `extension-pgvector`. Post-m3, the tests are mechanically updated: the codec definition is widened to `AsyncVectorCodec` (a structural cast through `Promise<…>`), test bodies are `async`, every `encode`/`decode` call is `await`ed, and rejection assertions use `await expect(...).rejects.toThrow(...)`.

**Why:** Required to make `extension-pgvector` typecheck-clean at m3's gate. Folded into the m3 test commit because the cause (m1 codec-interface bump) is shared with the m3 test work; the codec body itself is unchanged, no scope creep into pgvector behaviour.

**Implementation:** None — test-only changes.

**Tests (evidence):** The reshape itself is the change; verified by `pnpm --filter @prisma-next/extension-pgvector test` (31/31).

### Compatibility / migration / risk (m3)

- **Public API surface unchanged.** The `Codec` interface, the `codec()` factory, and the SQL runtime's two-place `Promise.all` dispatch architecture are all the m1 + m2 shape. m3 only adds tests, an integration test, and a doc comment.
- **No new walk-back constraints introduced.** Re-checked the seven-item walk-back inventory at m3 (per NFR #5 / AC-DW2): no marker / no variants / no predicates / no conditional return types / no `TRuntime` / no mis-framed author-surface docs / no async-dependent public guarantees. The m3 type tests *enforce* the no-Promise-leak invariant on the ORM lane, which strengthens the walk-back posture rather than weakening it.
- **Live-Postgres integration test adds runtime cost to `pnpm test:integration`.** 5 new integration tests run against the live-Postgres harness; reviewer-side `pnpm test:integration` ran 518/518 in 51.46s with no flake reproduction. The pre-existing 100ms-timeout flake at `test/authoring/side-by-side-contracts.test.ts:131` the implementer surfaced did not reproduce; it is not classified as introduced by m3.
- **One open should-fix finding.** F3 — duplicate header doc comments in `collection-dispatch.ts`, second comment references a deleted test file. One-edit fix; blocks m3 SATISFIED under the new findings discipline.

### Follow-ups / open questions (m3)

- **F3 — duplicate header doc comments in `collection-dispatch.ts`.** Merge the two stacked doc blocks into one and remove the reference to the deleted `test/codec-async.e2e.test.ts`. See [code-review.md § F3](code-review.md) for the recommended fix.
- **m4 Mongo runtime parity.** m2 established the SQL runtime's `await encodeParams` boundary and the two `Promise.all` dispatch sites; m4 should produce a Mongo-side equivalent (`MongoAdapter.lower()` async, `MongoRuntime.execute()` awaits `adapter.lower(plan)`, `resolveValue` async with `Promise.all` concurrent dispatch). The same architectural points should hold: one factory used by both families, no SQL-specific assumptions leaking into Mongo runtime.
- **m4 T4.2 — `mongo-codec` factory shape adoption + F1 cast cleanup.** F1 was re-recorded as an m4 T4.2 sub-task at m1 R2 (closed as bookkeeping). The m4 reviewer should verify the cast is dropped or accompanied by an explanatory comment per `AGENTS.md` § Typesafety rules.
- **Polymorphic `InferRootRow` + async codec.** m3's verification was scoped to SQL contracts. m4's plan should ensure the polymorphic `InferRootRow` invariant holds for Mongo's discriminator/variant model shape if the surface is reached by an async codec column.
- **Identity-default `encode` cast in the factory** (carried forward from m1, m2) — `as unknown as TWire | Promise<TWire>` lacks an inline `// why` comment per `AGENTS.md` § Typesafety rules. Continues to be a candidate for "should-fix" review when m4's T4.2 reshape touches the factory.

## M3 R2 delta — F3 fix lands

### Sources (m3 R2)

- Commit range (m3 R2): `41e01b5f3..aa50f7280`
- m3 R2 source-touching commits:
  - `aa50f7280` — `docs(sql-orm-client): collapse stacked headers in collection-dispatch` (collapses two stacked top-level doc blocks at the head of [`collection-dispatch.ts`](../../../packages/3-extensions/sql-orm-client/src/collection-dispatch.ts) into a single header; drops the dangling reference to the deleted `test/codec-async.e2e.test.ts`; preserves the ADR 030 cross-link and the canonical reference to `packages/2-sql/5-runtime/src/codecs/decoding.ts`)

### Intent (m3 R2)

m3 R1 closed every m3-owned AC against the m3 source on disk but left one open should-fix finding (F3 in [code-review.md](code-review.md)): the T3.4 doc-comment commit (`41e01b5f3`) had landed *two* stacked top-level `/** … */` blocks at the head of `collection-dispatch.ts` where one was intended, and the second block referenced a test file (`test/codec-async.e2e.test.ts`) that the m3 test commit (`7505ef158`) had deleted in favour of the live-Postgres `test/integration/codec-async.test.ts`. m3 R2's intent is to land that one-edit fix and close the round.

### Behavior changes & evidence (m3 R2)

#### A. Header doc comment in `collection-dispatch.ts` is a single block; no dangling test reference (F3 closure)

**Before → After:** Pre-R2, the file's head carried two stacked `/** … */` blocks back-to-back (former lines 1–13 and 15–31). The first block was the cleaner narrative (codec-agnostic dispatch; cross-link to `sql-runtime`'s `decodeRow`); the second block largely duplicated the first, additionally cross-linked ADR 030, and pointed readers at `test/codec-async.e2e.test.ts` — a path that did not exist on disk. Post-R2, the head carries a single header block at lines 1–15: it preserves the first block's substance verbatim, folds in the ADR 030 cross-link from the second block, and points the test reference at the surviving files (`test/integration/codec-async.test.ts` and `test/codec-async.types.test-d.ts`).

**Why:** F3 (should-fix) — a stale link inside a header doc comment that explicitly claims to document the file's m3 boundary contract is a small but real correctness defect; future readers following the reference would hit a missing path and conclude the test plan never landed. The duplicate block also diluted the intentional first comment.

**Implementation:**

- [packages/3-extensions/sql-orm-client/src/collection-dispatch.ts (L1–L15)](../../../packages/3-extensions/sql-orm-client/src/collection-dispatch.ts:1-15) — the single header doc block now reads: "Collection row dispatch. Per-row decoding is performed upstream in `sql-runtime`'s row-yielding async generator (it `await`s `decodeRow` once per row before yielding). This file never calls codec query-time methods directly; it consumes plain decoded cells through `executeQueryPlan` → `scope.execute(plan)` → `AsyncIterableResult<Row>`. Every `for await` / `.toArray()` consumer below therefore sees plain `T` values, not `Promise<T>`. See `packages/2-sql/5-runtime/src/codecs/decoding.ts` for the decode-once-per-row contract; this file is the consumer side of that contract. See also ADR 030 (codecs registry & decode boundary) and the m3 coverage in `test/integration/codec-async.test.ts` and `test/codec-async.types.test-d.ts`."
- Diff scope: `git diff 41e01b5f3..aa50f7280 --stat` reports a single file changed, 3 insertions / 19 deletions. Imports at line 17 onwards untouched.

**Tests (evidence):**

- `pnpm --filter @prisma-next/sql-orm-client typecheck` — PASS at HEAD `aa50f7280`.
- `pnpm --filter @prisma-next/sql-orm-client test` — PASS (54 files / 463 tests, including `codec-async.test.ts` 5/5 and `codec-async.types.test-d.ts` 21/21).
- Source audit: `rg codec-async\.e2e packages/3-extensions/sql-orm-client` returns zero matches at HEAD.

### Compatibility / migration / risk (m3 R2)

- **No production code, types, imports, or exports touched.** Strictly doc-comment cleanup on a single file.
- **No AC scoreboard movement.** All m3-owned ACs (AC-OC1, AC-OC2, AC-OC3, plus the m3 portions of AC-CF4 and AC-RT2) were already PASS at m3 R1.
- **No new walk-back constraints introduced.** The seven-item walk-back inventory at m3 (per NFR #5 / AC-DW2) is unchanged: no marker / no variants / no predicates / no conditional return types / no `TRuntime` / no mis-framed author-surface docs / no async-dependent public guarantees.
- **F3 closed.** No open findings remain at m3 phase close. m3 SATISFIED.

### Follow-ups / open questions (m3 R2)

- No new follow-ups. The m3 R1 follow-up list (m4 Mongo runtime parity; m4 T4.2 + F1 cast cleanup; polymorphic `InferRootRow` + async codec; identity-default `encode` cast in the factory) carries forward unchanged into m4.

## M4 R1 delta — Mongo cross-family parity

> **Scope.** m4 R1. Verdict: **ANOTHER ROUND NEEDED** ([code-review.md § m4 — Round 1](code-review.md)) on the strength of one open should-fix finding (F4 — `mongo-lowering` package README signature stale). The substantive m4 work — Mongo encode-side runtime parity with SQL — is **complete on disk**; F4 is documentation hygiene, not architectural. Current HEAD: `415d72c1c`.

### Sources (m4)

- Commit range (m4 lifecycle on branch): `aa50f7280..415d72c1c`
- m4 source-touching commits (the surface this delta covers):
  - `236b8e2e0` — `test(m4): land failing tests for cross-family codec parity, async resolveValue, and Mongo client sync regression` (T4.1, T4.4, T4.10)
  - `350ac46e3` — `feat(mongo-codec): reshape factory to unified Codec interface (m4 T4.2/T4.3)` (T4.2 incl. F1 cleanup, T4.3)
  - `18ddbb92b` — `feat(mongo-adapter): async resolveValue + lower() with concurrent dispatch (m4 T4.5/T4.6/T4.9)` (T4.5, T4.6, partial T4.9)
  - `69e4d527d` — `feat(mongo): MongoAdapter.lower returns Promise; runtime + runner await it (m4 T4.7/T4.8)` (T4.7, T4.8)
  - `415d72c1c` — `test(target-mongo): align stub adapter with async lower() interface (m4 T4.9)` (T4.9 completion)
- Project artifacts: [spec.md](../spec.md), [plan.md](../plan.md), [code-review.md](code-review.md)

### Intent (m4)

Propagate the m1 + m2 + m3 single-path async-codec design across the Mongo family's encode-side runtime so that a single `codec({...})` value works in both SQL and Mongo registries with identical semantics, and the Mongo runtime stack always-awaits codec dispatch through `resolveValue` → `MongoAdapter.lower()` → `MongoRuntime.execute()`. Keep `validateMongoContract` and `createMongoAdapter()` synchronous so contract validation and client construction stay sync at the build-time boundary. Land the F1 cleanup (the `as unknown as TTraits` double-cast at the empty-traits site in `mongo-codec`) as part of T4.2's factory reshape. Decode-side parity is intentionally out of scope: Mongo does not decode rows today, and adding one would invent a new subsystem orthogonal to async codecs.

### Narrative (semantic steps, m4)

1. **Pin the new Mongo-family shape with failing tests first** (commit `236b8e2e0`). Three test families land before any source change: (a) the cross-family integration test ([`test/integration/test/cross-package/cross-family-codec.test.ts`](../../../test/integration/test/cross-package/cross-family-codec.test.ts)) registers a single SQL `codec({...})` value in both SQL and Mongo registries and asserts wire-output equality across the two encode paths; (b) the Mongo-adapter async-`resolveValue` tests ([`packages/3-mongo-target/2-mongo-adapter/test/resolve-value.test.ts`](../../../packages/3-mongo-target/2-mongo-adapter/test/resolve-value.test.ts)) verify Promise-returning behavior, identity passthrough for non-`MongoParamRef` values, and concurrent dispatch over array elements + object children via deferred-promise call-order assertions; (c) the sync-regression suites for `validateMongoContract` ([`packages/2-mongo-family/1-foundation/mongo-contract/test/validate.test.ts`](../../../packages/2-mongo-family/1-foundation/mongo-contract/test/validate.test.ts) `synchronous return (regression)` block) and `createMongoAdapter()` ([`packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts`](../../../packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts) `createMongoAdapter (sync construction regression)` block) pin both build-time methods to sync return at runtime + type level. Per `AGENTS.md` § Golden Rules, tests come first.

2. **Reshape `mongoCodec()` to a unified factory + close F1** (commit `350ac46e3`). Two parallel source changes land in [`packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts`](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts):
   - The `MongoCodec<Id, TTraits, TWire, TJs>` type alias is reshaped to `BaseCodec<Id, TTraits, TWire, TJs>` (4 generics; the `BaseCodec` 5th generic `TOutput` collapses to `TInput=TJs`); query-time methods are Promise-returning at the boundary, build-time methods are synchronous. JSDoc on the alias explicitly defers Mongo-specific extras ("Any divergence should be added here").
   - The `mongoCodec()` factory accepts sync or async author functions and uniformly lifts them via `async (value) => userEncode(value)` / `async (wire) => userDecode(wire)` (L65–L66) — exactly the SQL `codec()` factory's lift mechanic from m1.
   - F1 closure: the previous `as unknown as TTraits` double-cast at the empty-traits site is eliminated by reshaping the empty-traits default through `ifDefined`. The new shape is `...ifDefined('traits', config.traits ? Object.freeze([...config.traits]) as TTraits : undefined)` (L60–L63). The remaining single `as TTraits` cast (only when `traits` is provided) is frozen-array narrowing — narrowest possible scope, no `// why` comment needed.
   - Built-in Mongo codecs ([`packages/3-mongo-target/2-mongo-adapter/src/core/codecs.ts`](../../../packages/3-mongo-target/2-mongo-adapter/src/core/codecs.ts)) all migrate to the unified `mongoCodec()` factory with sync author functions throughout (T4.3).

3. **Async `resolveValue` + `MongoAdapter#lower()` with `Promise.all` concurrent dispatch** (commit `18ddbb92b`). Two related source changes propagate the m2 SQL pattern across the Mongo encode side:
   - [`packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts`](../../../packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts) becomes `async`. For `MongoParamRef` leaves with a registered `codecId`, the function awaits `codec.encode(value.value)` (L21). For arrays, children dispatch concurrently via `Promise.all(value.map((v) => resolveValue(v, codecs)))` (L32). For object children, entries dispatch concurrently via `Promise.all(entries.map(([, val]) => resolveValue(val, codecs)))` (L35). Identity passthrough preserved for non-`MongoParamRef` values.
   - [`packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts`](../../../packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts) `MongoAdapterImpl#lower()` becomes `async`; `#resolveDocument` becomes `async` and dispatches object entries concurrently via `Promise.all(entries.map(...))` (L37–L48). `lower()` itself dispatches multi-task lowering concurrently: `updateOne`/`updateMany`/`findOneAndUpdate` await `[lowerFilter(filter), this.#lowerUpdate(update)]` together (L66–L69, L78–L81, L89–L92); `insertMany` awaits `Promise.all(documents.map((doc) => this.#resolveDocument(doc)))` (L75); aggregate pipelines lower stages via `lowerPipeline` (uses `Promise.all` internally). Raw command variants bypass codec lowering entirely (L110–L134) — the spec's "raw escape hatch" semantics are preserved.
   - [`packages/3-mongo-target/2-mongo-adapter/src/lowering.ts`](../../../packages/3-mongo-target/2-mongo-adapter/src/lowering.ts) `lowerFilter`, `lowerStage`, `lowerPipeline` are async with internal `Promise.all` for concurrent traversal of compound filters and pipeline stages.
   - The fixture-side stub adapter `target-mongo/test/...` is partially updated in this commit (T4.9 partial); the stragglers land in `415d72c1c`.

4. **Lift the `MongoAdapter` interface contract to `Promise<AnyMongoWireCommand>` + propagate `await` through the runtime + runner** (commit `69e4d527d`). [`packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts` (L4–L6)](../../../packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts:4-6) declares `lower(plan: MongoQueryPlan): Promise<AnyMongoWireCommand>`. [`packages/2-mongo-family/7-runtime/src/mongo-runtime.ts` (L74)](../../../packages/2-mongo-family/7-runtime/src/mongo-runtime.ts:74) inserts `const wireCommand = await adapter.lower(plan);` between middleware `beforeExecute` invocations (L68–L72) and `driver.execute(wireCommand)` (L76). Two consumer call sites in [`packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts`](../../../packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts) — `executeDataTransform` (L262) and `evaluateDataTransformChecks` (L310) — now `await adapter.lower(...)`.

5. **Align the `target-mongo` stub adapter with the async `lower()` interface** (commit `415d72c1c`). The fixture-side stub adapter in `target-mongo/test` carries a sync `lower(plan): AnyMongoWireCommand` from before the interface change; this commit updates it to `Promise<AnyMongoWireCommand>` so the stub conforms to the new contract. Strictly test-fixture surface; no runtime behavior change.

### Behavior changes & evidence (m4)

- **Behavior change: A single `codec({...})` value works in both SQL and Mongo registries with identical encode wire output.**
  - **Before**: SQL `codec({...})` had Promise-returning `encode`/`decode` (m1); Mongo had its own `mongoCodec({...})` factory with a divergent shape that prevented direct cross-family use.
  - **After**: A SQL `codec({...})` value is structurally a `BaseCodec`, and the Mongo registry accepts `BaseCodec` shape. Encode wire output is byte-equal across both registries. Decode is intentionally only validated on the SQL side (Mongo decode is out of scope; Mongo doesn't decode rows today).
  - **Why**: Cross-family codec parity is a shape contract at `BaseCodec`, not a syntactic alias of the SQL `Codec`. The architectural seam is the value-conversion contract; downstream wire formats stay family-specific.
  - **Implementation**:
    - [packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts (L21–L26)](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts:21-26) — `MongoCodec` aliases `BaseCodec`.
    - [packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts (L39–L70)](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts:39-70) — factory lifts sync author functions to Promise-returning.
  - **Tests (evidence)**:
    - [test/integration/test/cross-package/cross-family-codec.test.ts (L18–L77)](../../../test/integration/test/cross-package/cross-family-codec.test.ts:18-77) — single `codec({...})` registered in both registries; encode wire-output equality + SQL decode roundtrip.

- **Behavior change: `resolveValue` is async and dispatches array elements + object children concurrently via `Promise.all`.**
  - **Before**: Mongo did not have a single-path codec dispatch concentration on the encode side; codec calls happened ad-hoc through synchronous `MongoAdapter.lower()`.
  - **After**: `resolveValue` is the single-armed encode-side codec dispatch site; awaits each `MongoParamRef` leaf's `codec.encode(...)`; concurrent dispatch over siblings via `Promise.all`. Mirrors the m2 SQL `encodeParams` + `decodeRow` two-place concentration.
  - **Why**: Codec-dispatch concentration is the design point: codec call discipline lives in **one** place per family per direction. Concurrent dispatch via `Promise.all` minimizes serialization on independent leaves.
  - **Implementation**:
    - [packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts (L14–L44)](../../../packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts:14-44) — async signature; `Promise.all` over arrays (L32) + objects (L35); identity passthrough for non-`MongoParamRef`.
  - **Tests (evidence)**:
    - [packages/3-mongo-target/2-mongo-adapter/test/resolve-value.test.ts (L82–L170)](../../../packages/3-mongo-target/2-mongo-adapter/test/resolve-value.test.ts:82-170) — deferred-promise call-order assertions verify concurrent dispatch over object children + array elements.

- **Behavior change: `MongoAdapter.lower()` is async at the interface level and dispatches multi-task lowering concurrently.**
  - **Before**: `MongoAdapter.lower(plan: MongoQueryPlan): AnyMongoWireCommand` (sync return).
  - **After**: `MongoAdapter.lower(plan: MongoQueryPlan): Promise<AnyMongoWireCommand>`. Inside, multi-task lowering (filter + update for the four update-family ops; multiple documents for `insertMany`; pipeline stages for `aggregate`) dispatches concurrently via `Promise.all`. Raw command variants bypass codec lowering entirely (raw escape-hatch semantics preserved).
  - **Why**: Mirrors the SQL runtime pattern at M2.1.2 (`await encodeParams` → core-iterator → `await decodeRow`): codec dispatch is the only async work; everything else (wire-command construction, plan selection, raw passthrough) stays synchronous within the async function body. The interface lift to `Promise<...>` makes the contract explicit at the boundary so consumers cannot forget to `await`.
  - **Implementation**:
    - [packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts (L4–L6)](../../../packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts:4-6) — interface declares `Promise<AnyMongoWireCommand>` return type.
    - [packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts (L57–L142)](../../../packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts:57-142) — `async lower(...)`; `Promise.all` for filter+update tuples (L66–L69, L78–L81, L89–L92), `insertMany` documents (L75), and `#resolveDocument` object entries (L37–L48).
    - [packages/3-mongo-target/2-mongo-adapter/src/lowering.ts](../../../packages/3-mongo-target/2-mongo-adapter/src/lowering.ts) — `lowerFilter`, `lowerStage`, `lowerPipeline` async with internal `Promise.all`.
  - **Tests (evidence)**:
    - [packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts](../../../packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts) — all eight non-raw command kinds with `await adapter.lower(plan)` assertions; codec-encoded `MongoParamRef` round-trips through the lowering chain (e.g. `uppercase` codec encoding `'alice'` → `'ALICE'` in `insertMany`, `updateOne`, etc.); raw command pass-through tests.
    - [packages/3-mongo-target/2-mongo-adapter/test/lowering.test.ts](../../../packages/3-mongo-target/2-mongo-adapter/test/lowering.test.ts) — `lowerFilter`/`lowerStage`/`lowerPipeline` async behavior + `Promise.all` concurrency.

- **Behavior change: `MongoRuntime.execute()` and consumer call sites await `adapter.lower(plan)`.**
  - **Before**: `MongoRuntime.execute()` and `mongo-runner` data-transform paths called `adapter.lower(plan)` synchronously; type-level coupling to a sync return type.
  - **After**: `MongoRuntime.execute()` awaits the lowering between middleware `beforeExecute` and `driver.execute`. Consumer call sites in `mongo-runner` (`executeDataTransform`, `evaluateDataTransformChecks`) also await. Workspace-wide audit confirms zero unawaited code-level call sites.
  - **Why**: Lowering must produce a fully-resolved wire command before the driver consumes it. The await sits at the natural boundary between plan-level concerns (middleware) and wire-level concerns (driver).
  - **Implementation**:
    - [packages/2-mongo-family/7-runtime/src/mongo-runtime.ts (L74)](../../../packages/2-mongo-family/7-runtime/src/mongo-runtime.ts:74) — `const wireCommand = await adapter.lower(plan);` between `beforeExecute` (L68–L72) and `driver.execute(wireCommand)` (L76).
    - [packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts (L262, L310)](../../../packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts:262-310) — `await adapter.lower(...)` at both data-transform call sites.
  - **Tests (evidence)**:
    - [packages/2-mongo-family/7-runtime/test/...](../../../packages/2-mongo-family/7-runtime) — `MongoRuntime.execute()` test fixtures use `await runtime.execute(plan)` and assert wire commands reach the driver fully resolved.
    - [packages/3-mongo-target/1-mongo-target/test/mongo-runner.test.ts](../../../packages/3-mongo-target/1-mongo-target/test/mongo-runner.test.ts) — runner-level tests exercise both call sites.

- **Behavior change: `validateMongoContract` and `createMongoAdapter()` remain synchronous.**
  - **Before**: Both were synchronous in m3 and earlier.
  - **After**: Both stay synchronous; runtime + type-level regression assertions pin them. If either ever drifts to Promise-returning, both type tests and runtime `expect(typeof thenable.then).toBe('undefined')` checks fail loudly.
  - **Why**: Build-time methods stay synchronous so contract loading and adapter instantiation don't need `await`. Mirrors the m1/m2 invariant for `validateContract` (SQL) and `postgres({...})` (AC-RT3, AC-RT4).
  - **Tests (evidence)**:
    - [packages/2-mongo-family/1-foundation/mongo-contract/test/validate.test.ts (L662–L681)](../../../packages/2-mongo-family/1-foundation/mongo-contract/test/validate.test.ts:662-681) — `synchronous return (regression)` describe block.
    - [packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts (L435–L453)](../../../packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts:435-453) — `createMongoAdapter (sync construction regression)` describe block.

- **Behavior change: F1 closure — `as unknown as TTraits` double-cast eliminated.**
  - **Before**: `mongoCodec()` factory had an `as unknown as TTraits` double-cast at the empty-traits default site.
  - **After**: The empty-traits default flows through `ifDefined('traits', config.traits ? Object.freeze([...config.traits]) as TTraits : undefined)`. Only one narrow `as TTraits` cast remains (frozen-array narrowing when `traits` is provided) — narrowest possible scope, no documentation comment needed.
  - **Why**: Casts should be as narrow as possible (`AGENTS.md` § Typesafety rules). The original `as unknown as TTraits` was a too-broad escape hatch; the `ifDefined` reshape lets the type system carry the empty-traits case correctly.
  - **Implementation**:
    - [packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts (L60–L63)](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts:60-63) — `ifDefined` flow at the traits site.
  - **Tests (evidence)**: existing `mongo-codec` test suite continues to pass (215/215 in `pnpm --filter @prisma-next/adapter-mongo test` and the `mongo-codec` filter); no test change required since the cast was a type-only edge.

### Validation gates (m4)

- `pnpm lint:deps` — PASS (605 modules / 1196 deps; 0 violations).
- `pnpm typecheck` — PASS (workspace-wide).
- `pnpm test:packages` — PASS (111/111 tasks).
- `pnpm test:integration` — PASS (104 files / 521 tests / 51.47s; includes `cross-family-codec.test.ts` 3/3).
- `pnpm --filter @prisma-next/adapter-mongo test` — PASS (215/215 tests).
- `pnpm --filter @prisma-next/mongo-codec test` — PASS.
- `pnpm --filter @prisma-next/mongo-contract test` — PASS (includes T4.10 sync regression suite).
- `pnpm --filter @prisma-next/mongo-runtime test` — PASS.
- `pnpm --filter @prisma-next/target-mongo test` — PASS (366/366 tests; pre-existing `MongoMigrationRunner` CAS flake did not reproduce on reviewer-side run).
- Workspace-wide `rg 'lower\('` audit — only one non-code occurrence at `packages/2-mongo-family/6-transport/mongo-lowering/README.md:7` (F4 stale narrative); all code-level call sites await.
- Workspace-wide `rg 'resolveValue\('` audit — all call sites await; the three unawaited test usages capture the Promise itself to assert concurrent dispatch ordering (intentional per test design).

### Compatibility / migration / risk (m4)

- **No public surface narrowing.** `MongoAdapter.lower()` widens its return type from `T` to `Promise<T>`; all in-tree consumers are migrated; the only out-of-tree caller (target-mongo test fixtures) is updated in `415d72c1c`. External consumers building their own `MongoAdapter` implementations — none known in-repo — would need the same `async`/`await` lift.
- **Build-time methods stay sync.** `validateMongoContract` and `createMongoAdapter()` retain their sync return types at type + runtime; T4.10's two regression suites prevent silent drift.
- **Decode-side parity is intentionally deferred.** Mongo doesn't decode rows today; adding one would invent a new subsystem orthogonal to async codecs. M5's ADR will record this as the natural next-project boundary.
- **No new walk-back constraints introduced.** Re-checked the seven-item walk-back inventory at m4 (per NFR #5 / AC-DW2): no per-codec async marker on `MongoCodec`; no `mongoCodecSync`/`mongoCodecAsync` variants; no `isSyncEncoder`/`isSyncDecoder` predicates; no conditional return types on Promise-returning methods; no `TRuntime` generic on `MongoCodec`; no mis-framed author-surface docs (factory JSDoc explicitly says "Authors may write `encode` / `decode` as sync or async; the factory lifts uniformly"); no async-dependent public guarantees added to `validateMongoContract` or `createMongoAdapter` (T4.10 regressions enforce sync).
- **F4 documentation hygiene.** The `mongo-lowering` package README narrates a stale sync signature; one-line edit closes the round.
- **Pre-existing `MongoMigrationRunner` CAS flake.** Out of scope for m4; surfaced as § Items for the user's attention #2 in [code-review.md](code-review.md). Concrete fix exists (`await onOperationComplete` callback in `mongo-runner.ts:174`) but is unrelated to async codecs.

### Follow-ups / open questions (m4 R1)

1. **F4 closure (R2 entry condition).** Update [`packages/2-mongo-family/6-transport/mongo-lowering/README.md` line 7](../../../packages/2-mongo-family/6-transport/mongo-lowering/README.md:7) to reflect the post-m4 signature `MongoAdapter.lower(plan: MongoQueryPlan): Promise<AnyMongoWireCommand>`.
2. **Items for the user's attention** (recorded in [code-review.md](code-review.md), require orchestrator/user decision):
   - **#1 — `MongoCodec` 4-vs-5 generic asymmetry.** Reviewer's permissive read PASSes AC-CX1; a strict reading would require `MongoCodec` to declare 5 generics matching `BaseCodec`. The cross-family test substantively demonstrates parity for the common `TInput=TOutput` case. M5's ADR (T5.6) should record the orchestrator/user decision unambiguously.
   - **#2 — `MongoMigrationRunner` CAS flake.** Pre-existing fragility; out of scope for m4/m5. Orchestrator should log a separate follow-up issue and not absorb the fix into m5.
3. **m5 carryover from m3.** The m3 R1 follow-up list (polymorphic `InferRootRow` + async codec; identity-default `encode` cast in the SQL factory) carries forward unchanged; m5 does not pick these up.
4. **m5 work ahead.** Security tests translation from PR #375 (AC-SE1–AC-SE4); ADR + walk-back closure (AC-DW1–AC-DW3); package READMEs refresh (T5.8); the `mongo-lowering` README is now flagged for inclusion in the m5 sweep regardless of how F4 lands in m4 R2.

## m4 R2 delta — strict cross-family parity (MongoCodec widening) + F4 closure

> **Scope.** m4 R2 is **SATISFIED** ([code-review.md § m4 — Round 2](code-review.md)) on the strength of two commits — `6f567afa3` (F4 README fix) and `47ce86a6f` (`MongoCodec` widening to 5 generics). HEAD: `47ce86a6f`. Worktree clean. No open findings.

### Sources (m4 R2)

- Commit range: `415d72c1c..47ce86a6f`
- Source-touching commits:
  - `6f567afa3` — `docs(mongo-lowering): narrate Promise<AnyMongoWireCommand> + async-at-the-boundary semantics (m4 R2 F4 fix)`
  - `47ce86a6f` — `feat(mongo-codec): widen MongoCodec to 5 generics for strict cross-family parity with BaseCodec (m4 R2)`

### Intent (m4 R2)

Close out m4 cleanly along two complementary axes. (a) Documentation hygiene: align the `mongo-lowering` package README with the `Promise<AnyMongoWireCommand>` interface that landed in m4 R1, and narrate the async-at-the-boundary contract for contributors. (b) Architectural promotion: widen `MongoCodec` from 4 generics to **5 generics matching `BaseCodec` exactly**, so the cross-family parity AC (AC-CX1) is satisfied at the strict reading rather than the permissive one — the asymmetric `TInput ≠ TOutput` case is now expressible in the Mongo family, and a single `codec({...})` value with asymmetric input/output types is structurally usable in both registries.

### Narrative (semantic steps, m4 R2)

1. **Close F4 by aligning the `mongo-lowering` README signature with the post-m4 interface** (commit `6f567afa3`). [`packages/2-mongo-family/6-transport/mongo-lowering/README.md` line 7](../../../packages/2-mongo-family/6-transport/mongo-lowering/README.md:7) was updated to narrate `lower(plan: MongoQueryPlan): Promise<AnyMongoWireCommand>` and to add a new sentence on the async-at-the-boundary semantics: callers must `await lower(...)` so adapters may run async codec encodes (e.g. `resolveValue`) before producing the wire shape. The narrated signature now exactly matches the source-of-truth interface in [`packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts (L5)`](../../../packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts:5). Lines 8 (`MongoDriver.execute<Row>`) and 13–14 (dependency narrative) were left untouched, as recommended in F4's recipe. The added async-semantics sentence is a value-add over the minimum recipe — it tells contributors not just what the type is, but why it's a `Promise`. README-only change; no validation gate needed beyond the standard sweep at the end of the round.

2. **Widen `MongoCodec` and `mongoCodec()` to 5 generics matching `BaseCodec` exactly** (commit `47ce86a6f`). The single source change is in [`packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts`](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts):
   - **Type alias (L30–L36):** `MongoCodec<Id, TTraits, TWire, TInput, TOutput = TInput> = BaseCodec<Id, TTraits, TWire, TInput, TOutput>` — same generic count, same generic order, same defaults as `BaseCodec`. JSDoc explicitly notes that the asymmetric `TInput ≠ TOutput` case (e.g. write `string`, read `Date`) is now expressible on the Mongo side too.
   - **Factory (L56–L88):** the `mongoCodec<Id, TTraits, TWire, TInput, TOutput = TInput>(config)` factory carries the same 5 generics. The config object's method types thread the `TInput`/`TOutput` split: `encode: (value: TInput) => TWire | Promise<TWire>` (L66), `decode: (wire: TWire) => TOutput | Promise<TOutput>` (L67), `encodeJson: (value: TInput) => JsonValue` (L68), `decodeJson: (json: JsonValue) => TInput` (L69). The factory lift mechanic is unchanged (sync author functions are uniformly lifted via `async (x) => fn(x)`).
   - **Type extractors (L90–L98):** `MongoCodecJsType<T>` is **replaced** (no backcompat alias, per the implementer's mandate) by `MongoCodecInput<T>` (L91–L92, infers position 4: `TInput`) and `MongoCodecOutput<T>` (L95–L98, infers position 5: `TOutput`), mirroring SQL's `CodecInput<T>` / `CodecOutput<T>` positionally.
   - **Exports** ([`packages/2-mongo-family/1-foundation/mongo-codec/src/exports/index.ts`](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/exports/index.ts)) updated to surface `MongoCodecInput` / `MongoCodecOutput`.
   - **Type tests** ([`packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts (L65–L112)`](../../../packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts:65-112)) pin four invariants: strict structural identity (`expectTypeOf<MongoCodec<…>>().toEqualTypeOf<BaseCodec<…>>()`), `TOutput=TInput` default, asymmetric `TInput ≠ TOutput` expressibility through method signatures, and extractor symmetric round-trip.
   - **Package README** ([`packages/2-mongo-family/1-foundation/mongo-codec/README.md`](../../../packages/2-mongo-family/1-foundation/mongo-codec/README.md)) narrates the new helpers.

The widening is structurally backward-compatible: every existing call site of `mongoCodec()` uses the symmetric `TInput=TOutput=TJs` form, and the `TOutput = TInput` default makes those call sites resolve to the same shape they did before. No built-in Mongo codec, no consumer test, and no integration fixture needed source changes — the entire workspace recompiles cleanly under the new shape.

### Behavior changes & evidence (m4 R2)

- **Behavior change: `mongo-lowering` README narrates the post-m4 interface and async-at-the-boundary semantics.**
  - **Before**: README line 7 narrated `lower(plan: MongoQueryPlan): AnyMongoWireCommand` (sync return) — out of step with the post-m4 interface.
  - **After**: README line 7 narrates `lower(plan: MongoQueryPlan): Promise<AnyMongoWireCommand>` and adds a sentence on async-at-the-boundary semantics: `callers must await lower(...) so adapters may run async codec encodes (e.g. resolveValue) before producing the wire shape`.
  - **Why**: Contributor-facing documentation must match the source-of-truth interface. The added semantics sentence answers the natural follow-up question ("why is this a Promise?") without forcing readers into the implementation source.
  - **Implementation**:
    - [packages/2-mongo-family/6-transport/mongo-lowering/README.md (L7)](../../../packages/2-mongo-family/6-transport/mongo-lowering/README.md:7) — narrated signature aligned; semantics sentence added.
  - **Tests (evidence)**: README-only change; the source-of-truth interface in [`packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts (L5)`](../../../packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts:5) is the canonical reference, and m4 R1's interface tests + audited consumer call sites already verify the runtime contract; the README update is documentation hygiene relative to that contract.

- **Behavior change: `MongoCodec` declares 5 generics in matching order with `BaseCodec`, achieving strict cross-family parity at the `BaseCodec` seam.**
  - **Before**: `MongoCodec<Id, TTraits, TWire, TJs>` (4 generics; `TInput=TOutput=TJs`). The asymmetric `TInput ≠ TOutput` case was structurally impossible — both positions collapsed into a single `TJs` slot. AC-CX1 was permissively PASS (cross-family parity for the symmetric case demonstrated by the integration test) but strictly the spec wording "structurally identical" was satisfied only at the shape contract, not at the generic-arity level.
  - **After**: `MongoCodec<Id, TTraits, TWire, TInput, TOutput = TInput>` aliases `BaseCodec` directly. Same 5 generics, same order, same defaults. Asymmetric `TInput ≠ TOutput` codecs are now authorable through `mongoCodec()` and the asymmetry surfaces on `Parameters<typeof codec.encode>` and `ReturnType<typeof codec.decode>`. AC-CX1 is now strictly PASS.
  - **Why**: The cross-family seam is at `BaseCodec<Id, TTraits, TWire, TInput, TOutput>` — the layer at which a single codec value structurally fits both family registries. SQL's `Codec` extends `BaseCodec` with family-specific extras (`meta`/`paramsSchema`/`init`/`TParams`/`THelper`); Mongo aliases `BaseCodec` directly because Mongo currently has no equivalent need. With the 4-vs-5 generic asymmetry resolved, a codec authored with `TInput ≠ TOutput` is now structurally usable in both family registries — the strict AC-CX1 reading is satisfied without compromise.
  - **Implementation**:
    - [packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts (L30–L36)](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts:30-36) — `MongoCodec` aliases `BaseCodec` with 5 generics in matching order.
    - [packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts (L56–L88)](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts:56-88) — factory carries the same 5 generics with `TOutput = TInput` default; `encode`/`decode`/`encodeJson`/`decodeJson` thread `TInput`/`TOutput` through every method position that needs it.
    - [packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts (L90–L98)](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts:90-98) — `MongoCodecInput<T>` and `MongoCodecOutput<T>` mirror SQL's `CodecInput<T>` / `CodecOutput<T>` positionally; legacy `MongoCodecJsType<T>` removed without backcompat alias.
  - **Tests (evidence)**:
    - [packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts (L65–L69)](../../../packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts:65-69) — `expectTypeOf<MongoCodec<…>>().toEqualTypeOf<BaseCodec<…>>()` pins **strict positional structural identity** (not just functional equivalence).
    - [packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts (L71–L75)](../../../packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts:71-75) — `TOutput = TInput` default verified by collapsing the omitted-`TOutput` case to the explicit-`TOutput` case.
    - [packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts (L82–L94)](../../../packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts:82-94) — asymmetric `TInput ≠ TOutput` expressibility through method signatures (`Parameters<typeof asymmetric.encode>[0] = string`, `ReturnType<typeof asymmetric.encode> extends Promise<number>`, etc.). Pinning at the method-signature level isolates the structural-identity invariant from the latent extractor behavior the implementer flagged for the orchestrator.
    - [packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts (L102–L112)](../../../packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts:102-112) — `MongoCodecInput<T>` / `MongoCodecOutput<T>` extract `string` for the canonical symmetric case, mirroring SQL's `CodecInput<T>` / `CodecOutput<T>`.
    - The cross-family integration test ([test/integration/test/cross-package/cross-family-codec.test.ts](../../../test/integration/test/cross-package/cross-family-codec.test.ts)) continues to PASS unchanged (3/3 in `pnpm test:integration`); the codec it shares between SQL and Mongo registries uses the canonical `TInput=TOutput=string` form, which the widening preserves bit-for-bit.

### Validation gates (m4 R2)

All gates re-run at HEAD `47ce86a6f`:

- `pnpm --filter @prisma-next/mongo-codec typecheck` — PASS.
- `pnpm --filter @prisma-next/mongo-codec test` — PASS (18/18 tests; +4 new type-test assertions vs R1's 14, all four pinning the widened shape).
- `pnpm --filter @prisma-next/adapter-mongo typecheck` — PASS.
- `pnpm --filter @prisma-next/adapter-mongo test` — PASS (215/215; widening did not break any built-in codec or adapter consumer).
- `pnpm --filter @prisma-next/target-mongo typecheck` — PASS.
- `pnpm --filter @prisma-next/target-mongo test` — PASS (366/366; pre-existing CAS flake did not reproduce on reviewer-side).
- `pnpm --filter @prisma-next/mongo-contract typecheck` — PASS.
- `pnpm --filter @prisma-next/mongo-contract test` — PASS (76/76).
- `pnpm --filter @prisma-next/mongo-lowering typecheck` — PASS.
- `pnpm --filter @prisma-next/mongo-lowering test` — PASS (0 tests; package is types-only at this milestone).
- `pnpm --filter @prisma-next/integration-tests exec vitest run --passWithNoTests cross-family-codec` — PASS (3/3 cross-family parity tests).
- `pnpm typecheck` (workspace-wide) — PASS (120/120 tasks).
- `pnpm test:packages` (workspace-wide) — PASS (111/111 tasks).
- `pnpm test:integration` (full suite) — PASS (104 files / 521 tests).
- `pnpm lint:deps` — PASS (no violations across 606 modules / 1198 deps).

### Compatibility / migration / risk (m4 R2)

- **Backward-compatible widening.** The widening is **strictly additive** at the type level: every existing call site of `mongoCodec()` uses the symmetric `TInput=TOutput=TJs` form, and the `TOutput = TInput` default collapses the new 5-generic shape to the old 4-generic shape for those call sites. No source change required in any consumer (built-in codecs, adapter, runtime, integration tests).
- **`MongoCodecJsType<T>` removal — no backcompat alias.** Per the orchestrator's mandate, the legacy `MongoCodecJsType<T>` extractor was replaced by `MongoCodecInput<T>` / `MongoCodecOutput<T>` without retaining a backcompat alias. Audit at HEAD confirms zero remaining references to `MongoCodecJsType` in source or tests; the rename is complete and clean.
- **F4 closure: README-only change.** No code, exports, types, or tests were touched in commit `6f567afa3`. The README narration aligns with the source-of-truth interface in `mongo-lowering/src/adapter-types.ts`.
- **Latent extractor union behavior on asymmetric codecs (informational, not a finding).** `MongoCodecInput<T>` / `MongoCodecOutput<T>` mirror SQL's `CodecInput<T>` / `CodecOutput<T>` exactly, including a shared latent behavior: both pairs of extractors return `TInput | TOutput` (the union) for asymmetric codecs because TypeScript collapses the `infer` slot with the defaulted `TOutput = TInput` slot. The implementer documented this inline and tested asymmetric expressibility through method signatures rather than the extractors. This is **not a finding** — it's pre-existing SQL behavior that Mongo is required to mirror per the strict-parity mandate. AC-CX1 is satisfied because the canonical `TInput=TOutput` case (used by every built-in codec) round-trips exactly through the extractors, and the asymmetric case is provably expressible at the method-signature level. The orchestrator may capture this in `user-attention.md` as a separate consideration.
- **Carryover from m4 R1.** Pre-existing `MongoMigrationRunner` CAS flake remains out of scope; reviewer-side did not reproduce in R2 either (target-mongo 366/366 PASS).
- **No new walk-back constraints introduced.** The widening preserves all seven walk-back constraints from NFR #5 (no per-codec async marker; no `mongoCodecSync`/`mongoCodecAsync`; no predicates; no conditional return types; no `TRuntime`; uniform factory lift in JSDoc; no async-dependent build-time guarantees).

### Follow-ups / open questions (m4 R2)

- **m4 R1 follow-up #1 (`MongoCodec` 4-vs-5 generic asymmetry).** **Resolved by widening.** AC-CX1 is now strictly PASS; M4.7.1 in [system-design-review.md](system-design-review.md) is closed by design.
- **m4 R1 follow-up #2 (`MongoMigrationRunner` CAS flake).** Carried over unchanged.
- **m5 work ahead.** Security tests translation (AC-SE1–AC-SE4); ADR + walk-back closure (AC-DW1–AC-DW3); package READMEs refresh (T5.8). The new ADR (T5.6) should record the m4 R2 decision: `MongoCodec` was widened to 5 generics matching `BaseCodec` exactly to satisfy strict spec wording and to enable asymmetric `TInput ≠ TOutput` codecs in the Mongo family. The orchestrator's optional `user-attention.md` capture of the latent extractor union behavior is a documentation-only follow-up.

### Independent re-verification (post-artifact-commit, m4 R2)

A second-pass reviewer re-ran the m4 R2 verification against on-disk state at HEAD `0d7bd780b` (the artifact-commit that landed this walkthrough delta and the SDR / code-review refreshes). The orchestrator's delegation cited HEAD `47ce86a6f` (the implementation HEAD, one commit prior); the second pass reconciled the snapshot drift by independently re-inspecting every cited source file and re-running every validation gate, rather than re-doing already-committed review work.

- **All cited sources concord with the narrative above.** [README L7](../../../packages/2-mongo-family/6-transport/mongo-lowering/README.md:7), [adapter-types L5](../../../packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts:5), [codecs.ts L30–L98](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts:30-98), and [codecs.test-d.ts L65–L112](../../../packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts:65-112) all match the m4 R2 delta bit-for-bit.
- **All 14 validation gates re-ran green** (mongo-codec 18/18; adapter-mongo 215/215; target-mongo 366/366 with no CAS-flake reproduction; mongo-contract 76/76; mongo-lowering types-only typecheck PASS; cross-family-codec 3/3; workspace typecheck 120/120; test:packages 111/111; test:integration 104 files / 521 tests; lint:deps 606 modules / 1198 deps no violations).
- **AC-CX1 strictly PASS confirmed**; no new findings filed.

The reviewer-side audit trail of this second pass is captured in [code-review.md § m4 — Round 2 — independent re-verification](code-review.md).
