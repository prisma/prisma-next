# Plan — codec-agnostic Mongo aggregation builder

Spec: [`./spec.md`](./spec.md). Linear: **TML-2964**. Branch: `tml-2964-agg-codec-source` (off main incl. #897).

## Grounding (from codebase investigation)

- The field proxy already exists and is generic (`createFieldAccessor`, minted per-call in 6 stage methods); `f.field` already satisfies `TypedAggExpr` as a `fn.*` argument. Nothing to build there.
- 6 stages are already single-arg callbacks (`project` spec-overload, `addFields`, `group`, `replaceRoot`, `sortByCount`, `redact`); `match` is callback too. Widening signatures is mechanical.
- `fn`/`acc` call sites: 1 production (`mongo-control-adapter.ts`, incl. standalone `fn.setUnion` and `fn.eq` inside `match`), 3 examples, 2 integration-test files, ~9 package test files.
- The builder-side codec need is exactly one thing: the **operation→output-codec table** (value + type). The builder stamps ids; only the runtime resolves ids to codecs, and it already has the registry. So the port the query-builder defines is just the table — no registry threading.
- `mongoQuery` has one production call site (`buildMongoStaticContext`), where the context and adapter are already in scope.

## Slices (stack: 1 → 2 → 3)

Stacked, not parallel: all three rework the same type vocabulary (`types.ts`), the helper factories, and the result-shape reifier — file contention would eat any parallel win — and slice 3 upgrades placeholders slice 2 introduces (`push`/`addToSet`).

### Slice 1 — the spine: context-bound `fn` with adapter-declared output codecs

**Outcome:** the adapter declares the operation→output-codec table (value + type, the Mongo `queryOperationTypes` analog); it flows adapter → context → `mongoQuery` (required param, no default) → `PipelineChain`. `fn` is minted from the root (exposed there) and handed to the stage callbacks (`project`/`addFields`/`replaceRoot`/`sortByCount`/`redact`/`match` gain the `fn` param). Role-fixed scalar helpers (string/bool/date/numeric/objectId outputs) and `count`/`sortByCount` stamp table-sourced codecs at the value **and** type level (generics carry the table type; input params constrained by decoded output type, so `dateToString({date: f.createdAt})` compiles uncast). The result-shape reifier consumes the same table, so role-fixed computed scalars decode at runtime. The free-floating `fn` export is deleted; array/document helpers temporarily stamp no codec (observable behavior unchanged — their fake codecs already resolved to `unknown`). `acc` untouched.
**Hands to:** the threaded table + context-bound minting pattern + decoded-output input typing, which slices 2–3 reuse.
**End-to-end test:** `fn.dateToString({date: f.createdAt})`/`fn.dateDiff` compile uncast; a `$project` with `fn.toDate`/`fn.dateToString` decodes at runtime (integration); grep-guard: no `mongo/*@1` in `expression-helpers.ts`/`types.ts`/`builder.ts`.

### Slice 2 — propagation + accumulators

**Outcome:** `acc` becomes context-bound the same way; free-floating `acc` export deleted; `group` callback gains `acc` (`group((f, fn, acc) => …)`). Propagation rules land: `$min`/`$max`/`$first`/`$last`/`$cond`-branches carry the operand's codec; multi-operand arithmetic propagates when all codec-bearing operands agree (literals ignored), else falls back to the declared output; `acc.sum` propagates, `acc.avg`/`stdDev*` use declared outputs; `$group {_id:null}` becomes a structural null marker (no `mongo/null@1`). `push`/`addToSet` stamp no codec (placeholder, upgraded in slice 3). Reifier applies the same propagation during replay, so propagated accumulator outputs decode.
**Hands to:** propagation machinery (builder + reifier) that slice 3's element propagation reuses; the one canonical accumulator table TML-2954 slices 2/4 consume.
**End-to-end test:** `$group` with `acc.max(<date field>)` decodes a `Date`; `acc.sum(<double field>)` propagates and decodes; arithmetic agreement/disagreement type tests; grep-guard extends to `accumulator-helpers.ts`.

### Slice 3 — structural outputs

**Outcome:** array/document results become real structural shapes: `$split`→array of declared-string elements, `$range`→array of declared-numeric elements, `$concatArrays`/`$setUnion`/`$slice`/`$reverseArray`/element-access propagate the input element, `$map`/`$zip`/`$objectToArray`→unknown element; `$arrayToObject`/`$getField`/`$regexFind`/etc.→document shapes (`Record<string,unknown>`); `push`/`addToSet` upgraded to array-of-element. Type level and reifier agree; decodable elements decode.
**Hands to:** project close-out; final DoD grep across the package incl. emitted `.d.ts`.
**End-to-end test:** `$split` of a contract string field decodes its elements; `$arrayToObject` types as `Record<string,unknown>`; `acc.push(<date field>)` yields `Date[]` decoded.

## Delivery mechanics

- Implementers: **sonnet**, tests-first, per `references/dispatch-work.md`; reviewer: **opus** before each PR.
- One PR per slice; slice 1 on `tml-2964-agg-codec-source`, subsequent slices branch after merge.
- Full gate before each PR: build, typecheck, lint (incl. `lint:deps`, `lint:casts`), `fixtures:check`, all three test suites, examples.
- TML-2954 slices 2–4 (`$group`/`$unwind`/`$replaceRoot` reify) resume after slice 2 lands, consuming its accumulator resolution.
