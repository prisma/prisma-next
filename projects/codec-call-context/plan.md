# Codec Call Context — Per-Query AbortSignal + Column Metadata

## Summary

Introduce `CodecCallContext` as the shared per-call context object the runtime threads to every `codec.encode` / `codec.decode` call, with a family-extension pattern. Two fields land in this project, split by layer:

- **Framework `CodecCallContext`** (in `framework-components`): `signal?: AbortSignal` only. Per-query cancellation; the runtime returns a `RUNTIME.ABORTED` envelope when the signal aborts; codec authors who forward the signal to their underlying SDK get true cancellation of in-flight network calls.
- **`SqlCodecCallContext extends CodecCallContext`** (in `relational-core`): adds `column?: SqlColumnRef` (`{ table, name }`). Populated on SQL **decode** call sites that can resolve a single underlying column ref; lets SQL codecs construct return values that carry column identity (e.g. envelopes that know what to bulk-decrypt against).
- **Mongo** uses framework `CodecCallContext` directly (no `MongoCodecCallContext` in this project).

No concurrency cap, no bulk-codec interface, no traits, no encode-side column plumbing — just one shared context object per query, threaded through the existing dispatch sites, with the SQL family extending it for column metadata.

**Spec:** [spec.md](spec.md)

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Project owner | Drives execution across all milestones |
| Architectural reviewer | Codec subsystem owner | Approves the `CodecCallContext` shape and the per-`execute` signal contract |
| Affected | Extension authors with network-backed codecs (CipherStash et al.) | Get cancellation forwarding for their SDK calls; existing codecs that ignore `ctx.signal` keep working |
| Affected | ORM client / DSL surface consumers | `runtime.execute(plan, { signal })` becomes the canonical entry point; per-call signal is opt-in |

## Execution shape

Single branch (`feat/codec-dispatch-abortsignal`), milestone-by-milestone with internal review/refine cycles between milestones. No stacked PRs. PR opening deferred until implementation is complete.

The change is structurally additive: the `ctx` arg on codec methods is optional, the `{ signal }` option on `execute` is optional, and the no-signal call path is bit-for-bit identical to today. This means each milestone leaves the workspace green; there is no progressive-failure window like in the codec-async-single-path project.

## Milestones

### Validation gate convention

Each milestone leaves the workspace **fully green**: `pnpm typecheck`, `pnpm test:packages`, and `pnpm lint:deps` workspace-wide. No expected-residual tolerance because the change is additive. `pnpm test:integration` runs at M2 and M3 boundaries (covering SQL and Mongo end-to-end respectively).

### Milestone 1 (m1): Codec interface + factory + framework runtime entry

Establishes the framework `CodecCallContext` shape (signal-only), the SQL family extension `SqlCodecCallContext` (adding `column`), the optional `ctx` arg on the framework `Codec.encode` / `Codec.decode` (narrowed to `SqlCodecCallContext` on the SQL `Codec` interface), the factories' acceptance of ctx-bearing author functions, and the `RuntimeCore.execute(plan, options?)` signature. Demonstrable via interface-shape and factory unit tests.

**Tasks:**

- [ ] **T1.1** Write tests pinning the public framework `Codec` interface shape: `encode(value, ctx?)` / `decode(wire, ctx?)`, where `ctx: CodecCallContext = { readonly signal?: AbortSignal }` (signal-only at the framework level, no `column`). Write tests pinning the SQL `Codec` interface narrows to `ctx?: SqlCodecCallContext` (`{ readonly signal?: AbortSignal; readonly column?: SqlColumnRef }`). Verify the existing single-arg call sites (`codec.encode(value)`) continue to typecheck for both.
- [ ] **T1.2** Write tests for `codec()` (SQL) factory accepting both author arities:
  - `(value) => …` (single-arg author) lifts as before.
  - `(value, ctx: SqlCodecCallContext) => …` (ctx-bearing author) preserves ctx through the lifted method (signal + column).
  - The `ctx.signal` reference passed to the codec is the same instance the runtime supplies (identity preservation).
  - Symmetric tests for `mongoCodec()` factory using `(value, ctx: CodecCallContext) => …` (no `column`).
- [ ] **T1.3** Write tests pinning ADR 204 walk-back constraints: no `TRuntime` generic; no `runtime` / `kind` discriminator on the public interface; no conditional return types.
- [ ] **T1.4** Update [`packages/1-framework/1-core/framework-components/src/codec-types.ts`](../../packages/1-framework/1-core/framework-components/src/codec-types.ts):
  - Define `CodecCallContext = { readonly signal?: AbortSignal }` (signal-only, family-agnostic) and export it.
  - Update the framework `Codec` interface: `encode(value: TInput, ctx?: CodecCallContext): Promise<TWire>`; `decode(wire: TWire, ctx?: CodecCallContext): Promise<TInput>`.
  - **Do not** add a `column` field. Column metadata is a SQL-family concept and lives on `SqlCodecCallContext` in the SQL layer.
- [ ] **T1.5** Update [`packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts`](../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts):
  - Define `SqlColumnRef = { readonly table: string; readonly name: string }` and `SqlCodecCallContext extends CodecCallContext { readonly column?: SqlColumnRef }`; export both.
  - Narrow the SQL `Codec` interface (which already extends the framework `BaseCodec`) by redeclaring `encode` and `decode` with `ctx?: SqlCodecCallContext`. The framework method is parameter-bivariant on object types, so the narrowed override is structurally compatible; if TypeScript's strict checks complain, fall back to declaring the SQL interface as `Codec<TInput, TWire>` extending `BaseCodec<TInput, TWire>` and rely on the union-arity factory for type inference at call sites.
  - Update `codec()` factory: accept author functions of either arity (`(value)` or `(value, ctx: SqlCodecCallContext)`); lift via `async (value, ctx) => userEncode(value, ctx)` (preserves ctx through the lift). Identity default for omitted `encode` continues to work.
- [ ] **T1.6** Update [`packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts`](../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts) `mongoCodec()` factory the same way, but the ctx-bearing arity uses framework `CodecCallContext` (no Mongo extension in this project).
- [ ] **T1.7** Land the `RUNTIME.ABORTED` artifact set in [`packages/1-framework/1-core/framework-components/src/runtime-error.ts`](../../packages/1-framework/1-core/framework-components/src/runtime-error.ts). Runtime error codes are not enumerated in a single registry; the codes live as string literals at call sites. The right artifacts are: a `RUNTIME_ABORTED = 'RUNTIME.ABORTED' as const` constant, a `RuntimeAbortedPhase = 'encode' | 'decode' | 'stream'` discriminator, and a `runtimeAborted(phase, cause?)` envelope-construction helper colocated with `runtimeError`. (The helper construction was originally framed as part of T2.8, but it lands here in m1 because T1.8's entry pre-check needs a construction site — see T2.8 note.)
- [ ] **T1.8** Update [`packages/1-framework/1-core/framework-components/src/runtime-core.ts`](../../packages/1-framework/1-core/framework-components/src/runtime-core.ts) `RuntimeCore`:
  - `execute<Row>(plan, options?: { signal?: AbortSignal }): AsyncIterableResult<Row>`.
  - Pass the signal through to `lower(plan, ctx?)` (one new optional arg) and into the row-stream wrapper.
  - Pre-check `signal.aborted` at entry; throw `RUNTIME.ABORTED` envelope with `{ phase: 'stream' }` if already aborted.
- [ ] **T1.9** Update [`packages/1-framework/1-core/framework-components/src/runtime-middleware.ts`](../../packages/1-framework/1-core/framework-components/src/runtime-middleware.ts) `RuntimeExecutor` interface:
  - `execute<Row>(plan, options?: { signal?: AbortSignal }): AsyncIterableResult<Row>`.
- [ ] **T1.10** Run M1 tests; iterate until green.
- [ ] **T1.11** Internal review/refine gate with the project owner before M2.

**Validation gate:**

- `framework-components`, `relational-core`, `mongo-codec` — `pnpm typecheck` and `pnpm test`.
- Workspace-wide `pnpm lint:deps`.
- All existing in-tree codecs continue to compile (single-arg `encode/decode` signatures still satisfy the interface).
- All existing `runtime.execute(plan)` call sites continue to compile (options arg is optional).

### Milestone 2 (m2): SQL runtime threads signal + abort semantics

The SQL runtime accepts and threads the per-`execute` signal through every codec call site, races `Promise.all` against the signal, and short-circuits the row stream on abort. Demonstrable via SQL runtime tests covering already-aborted, mid-encode-abort, mid-decode-abort, between-rows-abort, codec-forwards-signal, and codec-ignores-signal scenarios.

**Tasks:**

- [ ] **T2.1** Write tests for `encodeParams(plan, registry, ctx?: SqlCodecCallContext)` threading:
  - Each codec's `encode(value, ctx)` receives the same `ctx` instance; the runtime leaves `ctx.column` undefined on encode (encode-side column context is the middleware's domain).
  - When `ctx` is undefined, behavior is bit-for-bit identical to today (regression).
  - When `ctx.signal` aborts mid-`Promise.all`, the call rejects with `RUNTIME.ABORTED` (`{ phase: 'encode' }`); cause carries the abort reason.
  - Already-aborted signal at entry short-circuits before any codec call (verified with mock codec call counter).
- [ ] **T2.2** Write tests for `decodeRow(row, plan, registry, validators, ctx?: SqlCodecCallContext)` and `decodeField` threading:
  - Each codec's `decode(wire, ctx)` receives a `ctx` whose `signal` is the same instance across encode and decode of the query.
  - `ctx.column = { table, name }` (a `SqlColumnRef` projected from the resolved per-cell `ColumnRef`) is populated for cells whose `ColumnRef` resolves at the decode site (matching the existing per-cell `ColumnRef` resolution used for `RUNTIME.DECODE_FAILED` envelopes).
  - `ctx.column = undefined` for cells the runtime cannot resolve to a single `(table, name)` (aggregate aliases, include aggregate fields, computed projections without a simple ref).
  - The `ctx.column` value passed to the codec is sourced from the same `ColumnRef` resolution used for error wrapping (no duplicate resolution; if `SqlColumnRef` is a structural projection rather than the `ColumnRef` itself, the test pins `column.table === resolvedRef.table && column.name === resolvedRef.name`).
  - No-ctx case is bit-for-bit identical (regression).
  - Mid-decode abort throws `RUNTIME.ABORTED` (`{ phase: 'decode' }`).
- [ ] **T2.3** Write tests for the `executeAgainstQueryable` for-await loop:
  - Signal aborting between rows exits the loop with `RUNTIME.ABORTED` (`{ phase: 'stream' }`) before pulling the next row.
  - When an in-flight `decodeRow` is awaiting, abort surfaces promptly via `abortable(signal)` race; in-flight codec bodies that ignore the signal complete in the background but the runtime returns immediately.
- [ ] **T2.4** Write tests for codec-side signal forwarding:
  - A fixture codec that calls a fake fetch with the forwarded signal observes the fake fetch abort when the runtime's signal aborts.
  - A fixture codec that ignores `ctx.signal` keeps running (a `setTimeout`-based body completes after the abort) without breaking the runtime's `RUNTIME.ABORTED` return.
- [ ] **T2.5** Update [`packages/2-sql/5-runtime/src/codecs/encoding.ts`](../../packages/2-sql/5-runtime/src/codecs/encoding.ts):
  - `encodeParam(value, descriptor, paramIndex, registry, ctx?: SqlCodecCallContext)` accepts and forwards `ctx` to `codec.encode(value, ctx)`. Encode call sites do not populate `ctx.column`.
  - `encodeParams(plan, registry, ctx?: SqlCodecCallContext)` accepts `ctx`, pre-checks `ctx?.signal?.aborted`, races the `Promise.all` against `abortable(ctx.signal)` when present, throws `RUNTIME.ABORTED` envelope on abort.
- [ ] **T2.6** Update [`packages/2-sql/5-runtime/src/codecs/decoding.ts`](../../packages/2-sql/5-runtime/src/codecs/decoding.ts):
  - `decodeField(...args, ctx?: SqlCodecCallContext)` accepts the row-level `ctx` (signal-bearing, no `column`) and packages a per-cell `SqlCodecCallContext` whose `column = { table, name }` is sourced from the resolved `ColumnRef` (or `undefined` if unresolved). Forwards the per-cell ctx to `codec.decode(wire, ctx)`.
  - The per-cell `ColumnRef` is the same value used by `wrapDecodeFailure` for envelope construction — share the resolution, do not duplicate. (The `SqlColumnRef` value passed to the codec is a structural projection of the resolved `ColumnRef`; if `ColumnRef`'s public shape already satisfies `SqlColumnRef`, reuse the same object.)
  - `decodeRow(row, plan, registry, validators, ctx?: SqlCodecCallContext)` accepts the row-level `ctx`, pre-checks `ctx?.signal?.aborted`, races the per-cell `Promise.all` against `abortable(ctx.signal)`, throws `RUNTIME.ABORTED` envelope on abort.
- [ ] **T2.7** Update [`packages/2-sql/5-runtime/src/sql-runtime.ts`](../../packages/2-sql/5-runtime/src/sql-runtime.ts):
  - `SqlRuntimeImpl.execute(plan, options?)` accepts the options bag.
  - `executeAgainstQueryable` builds a single query-level `ctx: SqlCodecCallContext = { signal }` (the `column` field is populated per-cell at the decode site).
  - The for-await row loop checks `signal.aborted` between rows and exits with `RUNTIME.ABORTED` (`{ phase: 'stream' }`).
  - `lower(plan, ctx?: SqlCodecCallContext)` accepts and forwards `ctx` to `encodeParams`.
- [ ] **T2.8** Use the existing `runtimeAborted(phase, cause?)` helper (landed in m1 under T1.7) at the SQL throw sites added in T2.5 / T2.6 / T2.7. The helper itself is already in place in [`packages/1-framework/1-core/framework-components/src/runtime-error.ts`](../../packages/1-framework/1-core/framework-components/src/runtime-error.ts) — m2's job is the family-side wiring that calls it (no fresh helper construction).
- [ ] **T2.9** Run M2 SQL runtime tests; iterate until green.
- [ ] **T2.10** Internal review/refine gate with the project owner before M3.

**Validation gate:**

- M1 packages green plus `sql-runtime`, `adapter-postgres`, `sql-orm-client`, `extension-pgvector` — `pnpm typecheck` and `pnpm test`.
- `pnpm test:integration` — SQL integration tests pass, including a new integration test exercising `db.execute(plan, { signal })` with a real abort sequence.
- Workspace-wide `pnpm lint:deps`.
- Regression: existing SQL runtime tests pass with no behavioral change when `signal` is omitted.

### Milestone 3 (m3): Mongo runtime threads signal + abort semantics

Mirror M2 for the Mongo encode dispatch. Demonstrable via Mongo runtime tests covering the same abort scenarios on the encode side. (Mongo decode is out of scope per ADR 204.)

**Tasks:**

- [ ] **T3.1** Write tests for `resolveValue(value, codecs, ctx?)`:
  - Each codec's `encode(value, ctx)` receives the same `ctx` instance.
  - No-ctx case is bit-for-bit identical (regression).
  - Mid-encode abort throws `RUNTIME.ABORTED` (`{ phase: 'encode' }`).
  - Recursive walk preserves `ctx` identity across nested object/array branches.
- [ ] **T3.2** Write tests for `MongoRuntime.execute(plan, options?)`:
  - Already-aborted signal short-circuits.
  - Signal threads through `lower → adapter.lower → resolveValue` to each codec call.
- [ ] **T3.3** Update [`packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts`](../../packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts):
  - Accept `ctx?: CodecCallContext` (the framework type, signal-only) as a third arg. Mongo does not extend `CodecCallContext` in this project.
  - Forward `ctx` to `codec.encode(value, ctx)`.
  - Forward `ctx` recursively to nested `resolveValue` calls so identity is preserved.
- [ ] **T3.4** Update [`packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts`](../../packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts) and [`packages/3-mongo-target/2-mongo-adapter/src/lowering.ts`](../../packages/3-mongo-target/2-mongo-adapter/src/lowering.ts):
  - `MongoAdapter.lower(plan, ctx?: CodecCallContext)` accepts and forwards `ctx` to its internal `resolveValue` calls.
- [ ] **T3.5** Update [`packages/2-mongo-family/7-runtime/src/mongo-runtime.ts`](../../packages/2-mongo-family/7-runtime/src/mongo-runtime.ts):
  - `MongoRuntime.execute(plan, options?)` accepts the options bag.
  - `lower(plan, ctx?)` accepts and forwards `ctx` to `adapter.lower`.
  - Pre-check `signal.aborted` at entry; throw `RUNTIME.ABORTED` if already aborted.
- [ ] **T3.6** Run M3 Mongo runtime tests; iterate until green.
- [ ] **T3.7** Internal review/refine gate with the project owner before M4.

**Validation gate:**

- M1+M2 packages green plus `mongo-codec`, `mongo-adapter`, `mongo-runtime` — `pnpm typecheck` and `pnpm test`.
- `pnpm test:integration` — Mongo integration tests pass; new integration test exercising `mongoRuntime.execute(plan, { signal })` with abort.
- Workspace-wide `pnpm lint:deps`.

### Milestone 4 (m4): Documentation, ADR, project close-out

Document the decision and resolve the related cross-references.

**Tasks:**

- [ ] **T4.1** Draft a new ADR (e.g. *ADR 0NN — Codec call context: per-query AbortSignal + column metadata*) covering:
  - The framework `CodecCallContext` shape (signal-only) and the family-extension pattern (`SqlCodecCallContext` adds `column`; Mongo doesn't extend today). Articulate the layering rationale: per-call shape-of-call metadata that's family-specific (SQL's `(table, column)` addressing) lives in the family layer; only family-agnostic call-time metadata (cancellation) belongs at the framework level.
  - The per-`execute` signal contract; cooperative-cancellation semantics (the runtime returns promptly; in-flight bodies are abandoned).
  - The `RUNTIME.ABORTED` envelope and its `phase` values.
  - The decode-side column-context contract on the SQL family: when `ctx.column` is populated, when it's `undefined`, and the explicit decision to leave encode-side column context to middleware (linking to *Middleware-driven param transformation*).
  - Walk-back framing: the addition does not preclude later concurrency-cap / bulk-codec / per-instance work; it does not introduce any of ADR 204's seven walk-back constraints.
- [ ] **T4.2** Update [ADR 204 §"Risks & mitigations"](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md): add a "Resolved by ADR 0NN" pointer for the AbortSignal half. The concurrency-cap half remains "tracked under TML-2330 / framework-gaps G4."
- [ ] **T4.3** Update [`docs/reference/framework-gaps.md`](../../docs/reference/framework-gaps.md):
  - G10 marked "Resolved" with link to the new ADR.
  - G1 marked "Partially resolved (decode-side `(table, name)` plumbed); richer encode-side metadata is the middleware's domain — see *Middleware-driven param transformation*."
  - G4 stays open (concurrency / bulk).
- [ ] **T4.4** Update the codec author docs / READMEs (in `framework-components/codec`, `relational-core`, `mongo-codec`) with two example sketches:
  - A network-backed codec that forwards `ctx.signal` to its underlying SDK.
  - A codec that uses `ctx.column` on decode to construct a return value carrying column identity (envelope pattern stub — full pattern doc lives in the *Document the envelope-codec + middleware-encrypt pattern* ticket).
  Keep examples minimal.
- [ ] **T4.5** Update the Linear ticket TML-2330: rename to *"Codec call context: per-query AbortSignal + column metadata"*, replace description to point at this project's spec, and move it into the Cipherstash Integration project. The rate-limit half is dropped from the title; concurrency-cap follow-up remains tracked under framework-gaps G4.
- [ ] **T4.6** Open the PR. Title and description reference TML-2330 (so the Linear GitHub integration auto-transitions on merge) and the ADR.
- [ ] **T4.7** **Close-out (final task on this branch):** migrate the new ADR into [`docs/architecture docs/adrs/`](../../docs/architecture%20docs/adrs/) (if it isn't already), strip any repo-wide references to `projects/codec-call-context/**` (replace with canonical `docs/` links), and delete `projects/codec-call-context/`. The close-out commit may live in this PR or a follow-up close-out PR — the project owner decides which.

**Validation gate:**

- `pnpm test:all` workspace-wide.
- `pnpm lint:deps` workspace-wide.
- The ADR is committed; ADR 204 and framework-gaps cross-references are updated; Linear ticket reflects the narrowed scope.

## Risks

| Risk | Mitigation |
|---|---|
| Signal-listener leaks in `abortable(signal)` if a `Promise.all` resolves before the signal fires | The existing `abortable` helper attaches a one-shot listener (`{ once: true }`); verify no additional cleanup is required. Add a regression test exercising 1k `Promise.all` cycles to confirm no listener accumulation. |
| Per-cell `ctx` allocation cost on the hot decode path | The decode site already resolves a `ColumnRef` per cell for `RUNTIME.DECODE_FAILED` envelopes; the new ctx wrapper shares that resolution. Benchmark the decode hot-path before/after with a no-column-context-using codec to confirm no measurable regression. |
| Type-erasure of the `ctx` arg through middleware-rewritten plans | Middleware doesn't touch codec invocation directly (it observes plans + rows), so `ctx` doesn't traverse middleware boundaries. Confirm by inspection during M2. |
| In-flight codec bodies that ignore `ctx.signal` continue running and emit log-spam after `RUNTIME.ABORTED` returned | Documented as cooperative-cancellation behavior in the ADR. Codec authors who care about this property forward the signal. Not a framework correctness issue. |
| `ctx.column` undefined for cells that codecs assume always have one (e.g. an envelope codec attached to an aggregate alias) | Documented in the spec and ADR: codecs that require column identity must handle `undefined` explicitly. The runtime never silently defaults `ctx.column`. Codec authors decide whether to throw, return a context-less value, or otherwise degrade gracefully. |
| Driver-level cancellation gap (in-flight SQL query keeps running after `RUNTIME.ABORTED` returns) | Out of scope for this project; the spec calls it out explicitly. Follow-up ticket. |
| Existing call sites passing `null`/`undefined` instead of omitting the new options arg | The options arg is `options?: { signal?: AbortSignal }`; both omission and `undefined` are valid. Add a typecheck-only test ensuring `runtime.execute(plan)`, `runtime.execute(plan, undefined)`, and `runtime.execute(plan, {})` all compile. |

## References

- [`spec.md`](spec.md)
- [ADR 204 — Single-Path Async Codec Runtime](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md)
- [TML-2330](https://linear.app/prisma-company/issue/TML-2330)
- [`docs/reference/framework-gaps.md`](../../docs/reference/framework-gaps.md) — G10 (resolved here), G4 (deferred)
- [`packages/1-framework/0-foundation/utils/src/abortable.ts`](../../packages/1-framework/0-foundation/utils/src/abortable.ts) — the helper used to race `Promise.all` against signal abort
