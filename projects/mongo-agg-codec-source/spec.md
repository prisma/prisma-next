# Spec — codec-agnostic Mongo aggregation builder

Linear: **TML-2964** (subsumes cancelled TML-2963). Plan: [`./plan.md`](./plan.md).

## Problem

The Mongo aggregation helpers `fn`/`acc` are free-floating module exports that stamp hardcoded codec-id literals (`mongo/double@1`, `mongo/string@1`, …) into every computed expression — both as runtime `_field` values (`expression-helpers.ts`, `accumulator-helpers.ts`, `builder.ts` `count`/`sortByCount`) and as type-level literals (`types.ts`). The family layer must not know specific codec ids; that is adapter knowledge. Because the helpers are detached from any execution context, they had no codec source to consult and inlined literals instead. Flagged on #897.

## Outcome

`fn`/`acc` become context-bound: minted from the query-builder root, which is constructed with the execution context's codec knowledge. They are delivered to callers through stage callbacks (mirroring the SQL builder) and remain available standalone from the root. Computed and contract fields share one representation — real codec ids — so they interoperate with no casts. Array/document/null results are structural, not codecs. The family names Mongo operators and nothing else; every codec id, at the value level and the type level, originates from the adapter or the contract.

## Codec resolution

An operator's output codec is determined by exactly one of:

**Adapter-declared operation outputs.** The Mongo adapter declares an operation→output-codec table for operators whose output type is fixed and input-independent: `$concat`/`$toLower`/`$toUpper`/`$toString`/`$dateToString`/`$type`/… → its string codec; `$eq`/`$gt`/`$regexMatch`/`$isArray`/… → its bool codec; `$toDate`/`$dateAdd`/`$dateSubtract`/`$dateTrunc`/`$dateFromString` → its date codec; `$year`/`$size`/`$strLenCP`/`$cmp`/`$dateDiff`/`$count`/… → its numeric codec of choice; `$toObjectId` → its objectId codec. The table is exported as a value **and** as a type (the Mongo analog of SQL's `queryOperationTypes`), so one declaration drives both runtime stamping and compile-time output types. The adapter owns every choice in it — including which numeric codec `$count` returns.

**Propagation.** Operators whose output is the operand's own type (`$min`/`$max`/`$first`/`$last`, `$cond` branches, element access into a known array) carry the operand's codec forward. This is operator semantics, which the family legitimately owns; no codec is named. Multi-operand arithmetic (`$add`/`$subtract`/`$multiply`/`$divide`): when every codec-bearing operand carries the same codec id, that codec propagates (codec-less literals are ignored); otherwise the result falls back to the adapter's declared output for that operation. Date arithmetic goes through `fn.dateAdd`/`fn.dateSubtract` (declared date outputs); plain `$add`/`$subtract` over a date types as the declared numeric output — documented, and no worse than the previous hardcode.

**Structure.** Arrays and documents are shapes, not codecs — the adapter registers no array/document/null codec. Arrays are an array shape whose element is a descriptor: propagated from the input array (`$concatArrays`/`$setUnion`/`$slice`/`$reverseArray`/`$arrayElemAt`/`$first`/`$last` element access), a declared leaf (`$split` → string elements, `$range` → numeric elements), or `unknown` (`$map` body, `$zip`, `$objectToArray`). Documents are a document shape — `Record<string, unknown>` for dynamic keys (`$arrayToObject`, `$getField`, `$regexFind`), merged shapes where statically known. `$group { _id: null }` is the literal `null`, a structural marker. This reuses the runtime `MongoResultShape` vocabulary (leaf/array/document/unknown) and the builder's existing `ObjectField`/`ModelArrayField` markers; only leaves carry codecs.

## Input typing without labels

Helper parameters that require a particular value type (`dateToString`'s `date`, `trim`'s `input`, `regexMatch`'s `regex`, …) are constrained by **decoded output type**, not codec identity: the parameter accepts any expression whose codec decodes to `Date` (resp. `string`, `number`, `boolean`), computed as a type-level filter over the contract's codec-type map — the same filtering pattern as SQL's `CodecIdsWithTrait`, keyed on decoded output type instead of traits. A contract `createdAt` column and a computed `fn.toDate(...)` both satisfy the date constraint: one representation, no casts, no category labels anywhere in the family.

## Delivery

- **Stage callbacks:** `project((f, fn) => spec)`, `addFields((f, fn) => spec)`, `group((f, fn, acc) => spec)`, `replaceRoot((f, fn) => expr)`, `sortByCount((f, fn) => expr)`, `redact((f, fn) => expr)`, and `match((f, fn) => filter)` — the control adapter already needs `fn.eq` inside `match`. `f` is the existing `createFieldAccessor` proxy over the stage's current shape; no new proxy. Existing single-param callbacks keep compiling (a callback taking fewer parameters is assignable).
- **Standalone:** the context-bound `fn`/`acc` are also exposed on the query root (and via the static context), because real consumers build expressions outside stage callbacks — `mongo-control-adapter.ts` builds `fn.setUnion(...)` standalone.
- The free-floating, context-free `fn`/`acc` module exports are **deleted**. A detached helper cannot source a codec, so no context-free form exists. All call sites migrate (~9 files: the control adapter, three examples, integration tests, package tests).

## Threading and layering

`mongoQuery` requires a codec source (the operation-output table plus codec lookup); there is **no default** — a builder without codec knowledge cannot mint the helpers, and a family-level fallback table is exactly what this project removes. `buildMongoStaticContext` already has the context in scope and passes it through (`mongo-static.ts` → `query.ts` → `state-classes.ts` → `PipelineChain`). Direct `mongoQuery({contractJson})` callers migrate to `mongoStatic()`/the facade (the supported surface since #888) or supply a source explicitly; tests construct a test-local source.

The query-builder package defines the minimal interface it consumes (a codec-source port); the runtime context and adapter satisfy it structurally. The family imports nothing from the runtime or target layers — `lint:deps` stays green.

At the type level, the builder's generics carry the operation-table type and the contract's codec-type map, so computed expressions' output codec ids and TS types resolve entirely from type parameters. No `mongo/*@1` literal remains in the family's source **or** its emitted `.d.ts`.

## Runtime decode of computed scalars

A computed scalar carries a real codec id, so the per-stage result shape (TML-2954's reifier) records it as a leaf and the runtime decodes it — `fn.toDate(...)` returns a real `Date`, `fn.dateToString(...)` a real string: the same "every field through its codec" invariant as any other read. The propagation/agreement rules keep decode sound — a leaf is only stamped with a codec the value actually has (int32-vs-double mixes are benign; both decode to JS number). Slice tests cover date arithmetic explicitly.

## Non-goals

- Decoding heterogeneous/computed structural results (`$map` body, `$zip`, dynamic-key documents) — they stay `unknown` (pass-through). Correct final answer, not a gap.
- Contract-field codec handling — unchanged; contract fields already carry their contract codec.
- The `$group`/`$unwind`/`$replaceRoot` runtime result-shape reify — owned by TML-2954 slices 2–4, which consume this project's resolution (one table, no drift).
- Explicit-codec literals (`fn.literal(v, codec)`) — consistent with TML-2959's direction but out of scope; literals stay codec-less here and are ignored by propagation.

## Definition of done

- Grep-guard: no `mongo/*@1` literal in query-builder source or emitted `.d.ts`.
- `fn`/`acc` are context-bound (stage callbacks + root); the free-floating exports are deleted; all call sites migrated (control adapter, three examples, integration and package tests).
- `fn.dateDiff({ startDate: f.createdAt, … })` and `fn.dateToString({ date: f.createdAt, … })` type-check with no cast — contract/computed unification proven.
- Computed scalars decode at runtime — integration tests: `$toDate`, `$dateToString`, and a propagated `$max` return decoded values; date-arithmetic covered.
- Structural outputs resolve structurally: array element propagation, `$split`→string elements, `Record<string,unknown>` documents, `null` group id.
- Full gate: build, typecheck, lint (incl. `lint:deps`, `lint:casts`), fixtures:check, all three test suites; examples green.

## Alternatives considered

- **Scalar-kind vocabulary** (TML-2963): a parallel type classification (`string`/`number`/…) beside codecs. Rejected — codecs are the single type vocabulary; it also split computed and contract fields into non-interoperable representations, breaking `dateToString({date: f.createdAt})`.
- **Adapter role→codec table** (`numeric`/`textual`/`boolean`/`date`/`objectId` → codec): lighter than per-operation declarations, but reintroduces scalar-category labels into the family and cannot express per-operation facts (which numeric codec `$count` returns; date-arithmetic signatures). Rejected in favor of per-operation output declarations.
- **Trait-based resolution:** traits are a compile-time input-typing device; no runtime trait query exists, `date`/`objectId` have no trait, and `numeric` is ambiguous (double and int32 both carry it). Rejected.
- **Defaulted codec source on `mongoQuery`:** implies a family-level fallback codec table — the thing being removed. Rejected; the source is required.
- **Inferring literal codecs from JS value shape:** rejected repo-wide (TML-2959 deletes the SQL inferer); literals stay codec-less.
