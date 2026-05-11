# Plan — AST-bound codec resolution (TML-2456)

> Implementation plan for [`spec.md`](spec.md). Single branch, milestones land as separate commits, ships as one PR. Each commit is independently reviewable; tests precede or accompany implementation.

## Sequencing rationale

The spec calls out two independent dimensions:

1. **Substitution** — `codec: CodecRef` replaces `codecId + refs` on AST nodes; resolver replaces triangulation.
2. **Deletion** — eight heuristic artifacts retire.

The temptation is to do (1) additively first, then (2) as cleanup. Rejected: the additive interim leaves both paths live, which means every consumer site is doing both lookups during the transition, and the deletion PR touches the same files again. Worse, the additive version provides no forcing function — any consumer that still reads the legacy fields silently keeps working, and we discover the omission at PR review time or later.

Instead: **the AST shape change and the heuristic deletion land together at M3**, gated by tests added in M1–M2 that exercise the new resolver against the legacy AST shape. The legacy fields exist only in M1–M2 (so tests can be written against the old shape, then re-pointed at the new shape in M3). This shrinks the "two paths live" window to two commits and forces every consumer site to migrate at M3.

## Milestones

### M1 — `CodecRef`, `canonicalizeJson`, `AstCodecResolver` skeleton

**Scope.** Add the new types and resolver as standalone artifacts; no AST changes, no consumer migration. Pure addition.

**Files added.**

- `packages/1-framework/1-core/framework-components/src/codec-types.ts` — append `CodecRef` interface to existing exports.
- `packages/1-framework/1-core/framework-components/src/utils/canonicalize-json.ts` — lifted from `migration/src/canonicalize-json.ts` (copy verbatim; `migration` re-imports from new home in same commit).
- `packages/2-sql/5-runtime/src/codecs/ast-codec-resolver.ts` — `AstCodecResolver` interface + `createAstCodecResolver` factory. Wraps `descriptorFor(codecId).factory(typeParams)(ctx)` with content-keyed memoization. Constructor takes `CodecDescriptorRegistry` + a `SqlCodecInstanceContext` factory (so callers control `name` / `usedAt` for AST-supplied refs).
- `packages/2-sql/5-runtime/test/ast-codec-resolver.test.ts` — unit tests for the resolver:
  - cache hit returns same `Codec` reference
  - cache miss validates `typeParams` via `paramsSchema['~standard'].validate(...)`
  - invalid `typeParams` throws `RUNTIME.TYPE_PARAMS_INVALID`
  - non-parameterized codec keys as `${codecId}:undefined` and is shared
  - `canonicalizeJson` makes `{a:1, b:2}` and `{b:2, a:1}` cache-equivalent

**Tests precede implementation.**

**Validation gate.**

- `pnpm typecheck` — workspace-wide; M1 touches `framework-components` (foundation; many consumers).
- `pnpm test:packages` — workspace-wide for cross-package safety; M1 adds new exports from `framework-components` that downstream consumers will reference in M2.
- `pnpm lint:deps` — validate no layering violations from `framework-components/utils/canonicalize-json` move and `migration` re-import.

**Acceptance.** All gates green; new types/resolver compile and tests pass; no behavioral changes outside the new files.

### M2 — Pre-populate resolver from contract walk; introduce `codecRefForColumn`

**Scope.** Replace `byColumn` and `byCodecId` Maps in `buildContractCodecRegistry` with a single `byCodecRef` cache pre-populated from the contract walk. `descriptors.codecRefForColumn(table, column)` derives the canonical `CodecRef` from contract storage. `forColumn` becomes a thin wrapper.

**Files changed.**

- `packages/2-sql/5-runtime/src/sql-context.ts` — `buildContractCodecRegistry` rewritten:
  - One pass over `storage.tables[].columns[]`: for each column, derive `CodecRef` (resolving `typeRef` to `storage.types[ref].typeParams`); call `resolver.forCodecRef(ref)` to populate cache.
  - `byColumn` Map keeps existing `${table}.${column}` keying for the `forColumn(table, column)` API but stores `CodecRef`, not `Codec`. `forColumn` wrapper: `forCodecRef(byColumn.get(...))`.
  - `byCodecId` and `parameterizedRepresentatives` deleted.
  - `ambiguousCodecIds` deleted.
- `packages/2-sql/4-lanes/relational-core/src/codec-descriptor-registry.ts` — add `codecRefForColumn(table, column): CodecRef | undefined` to `CodecDescriptorRegistry` interface. Implementation walks `contract.storage.tables[].columns[].typeRef`/`typeParams`.
- `packages/2-sql/5-runtime/src/codecs/encoding.ts` — `resolveParamCodec` rewritten to consult resolver. Path narrows to: `if (paramRef.refs) → forColumn(refs.table, refs.column)` (legacy path, M3 deletes). The codec-id consistency check stays in M2 (still needed because legacy AST shape still in play); deletes in M3.
- `packages/2-sql/5-runtime/test/sql-context.codec-context.test.ts` — augment existing tests with `byCodecRef` cache assertions; preserve all current `byColumn`/`forCodecId` assertions (some delete in M3).

**Validation gate.**

- `pnpm typecheck` — workspace-wide; M2 changes the `ContractCodecRegistry` shape (adds `forCodecRef` / `codecRefForColumn`).
- `pnpm test:packages` — workspace-wide; the `sql-context` rewrite is consumer-visible from `sql-orm-client`, `sql-builder`, `pgvector`, `postgres-target`.
- `pnpm lint:deps` — validate that `codecRefForColumn`'s contract walk doesn't introduce a layering violation.

**Acceptance.** All gates green. All existing tests pass. New `codecRefForColumn` and `byCodecRef` cache exercised. The codec-id consistency check still runs (its deletion is M3c).

### M3 — AST shape change + heuristic deletion (the core change)

**Scope.** This is the substantive milestone. AST nodes get `codec: CodecRef | undefined`; eight heuristics retire; every builder site migrates. **Lands as three sub-commits** within M3 for review tractability:

- **M3a** — Descriptor honesty (AC-5): `PgVectorDescriptor.factory` signature honest; `PgVectorCodec.length` narrows to `number`; defensive `(params as VectorParams | undefined)?.length` cast deletes. Reviewable as a standalone descriptor cleanup; tests for the existing pgvector path keep passing because the runtime still calls `factory({length})` with real params (the representative-codec call site goes away in M3c).
- **M3b** — AST shape + builder migration: `ParamRef` and `ProjectionItem` carry `codec: CodecRef | undefined`; legacy `codecId`/`refs` fields delete in the same commit; every builder construction site migrates. Atomic by necessity — partial migration would leave the AST in a half-shape state. Includes the column-ref ProjectionItem stamping change (every column-bound projection populates `codec`, including bare `column-ref` expressions).
- **M3c** — Heuristic deletion: `validateParamRefRefs`, `alias-resolver.ts`, codec-id consistency check, `byCodecId`, `parameterizedRepresentatives`, `ambiguousCodecIds`, `forCodecId`, `factory.bind(descriptor)` all delete. The encode/decode dispatch collapses to `resolver.forCodecRef(node.codec)`.

**Tests precede implementation.** Before changing AST shape, augment AST tests in `packages/2-sql/4-lanes/relational-core/test/ast.test.ts` with `codec: CodecRef` shape assertions; rewrite `validate-param-refs.test.ts` to a deletion-marker test (asserts the file is gone after M3).

**Files changed.**

AST + builder layer (relational-core, sql-builder):

- `packages/2-sql/4-lanes/relational-core/src/ast/types.ts`:
  - `ParamRef`: replace `codecId?` and `refs?` with `codec?: CodecRef`. Update `static of`, constructor, `rewrite`, `fold`.
  - `ProjectionItem`: replace `codecId?` and `refs?` with `codec?: CodecRef`. Update `static of`, `withCodecId` (renamed `withCodec`), `rewrite` paths.
  - `ParamRefBindingRefs` interface deleted.
- `packages/2-sql/4-lanes/relational-core/src/ast/validate-param-refs.ts` — **deleted**.
- `packages/2-sql/4-lanes/relational-core/src/ast/util.ts` — `collectOrderedParamRefs` callers now read `codec?.codecId` instead of `codecId`.
- `packages/2-sql/4-lanes/relational-core/src/expression.ts` — `toExpr` helper: when column-bound, populate `codec` from `descriptors.codecRefForColumn(...)` instead of `refs`.
- `packages/2-sql/4-lanes/sql-builder/src/runtime/mutation-impl.ts` — INSERT VALUES / UPDATE SET binding sites populate `codec`.

ORM layer:

- `packages/3-extensions/sql-orm-client/src/query-plan-mutations.ts` — populate `codec` at mutation binding sites.
- `packages/3-extensions/sql-orm-client/src/where-binding.ts` — populate `codec` at WHERE binding.
- `packages/3-extensions/sql-orm-client/src/types.ts` — ORM param descriptor construction populates `codec`.

Runtime layer (the heuristic deletion):

- `packages/2-sql/5-runtime/src/codecs/encoding.ts`:
  - `resolveParamCodec` rewritten to single `if (paramRef.codec) return resolver.forCodecRef(paramRef.codec)`. Codec-id consistency check deleted. Alias-resolver call deleted.
  - `ParamMetadata.refs` field deleted (now `codec?: CodecRef`).
- `packages/2-sql/5-runtime/src/codecs/decoding.ts` — analogous changes for projection-side dispatch (read `projectionItem.codec` directly).
- `packages/2-sql/5-runtime/src/codecs/alias-resolver.ts` — **deleted**.
- `packages/2-sql/5-runtime/src/sql-context.ts` — `buildContractCodecRegistry`:
  - `byCodecId` Map deleted.
  - `parameterizedRepresentatives` Map deleted.
  - `ambiguousCodecIds` Set deleted.
  - `forCodecId` method removed from returned `ContractCodecRegistry` interface; interface narrows to `forColumn` + `forCodecRef`.
  - `factory.bind(descriptor)` calls deleted (descriptors are called as methods, not detached).
  - `factory(undefined as unknown as ...)` representative-codec materialization deleted.
- `packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts`:
  - `ContractCodecRegistry` interface narrows: `forCodecId` removed; `forCodecRef` added.

Descriptor-side honesty (AC-5):

- `packages/3-extensions/pgvector/src/core/codecs.ts`:
  - `PgVectorDescriptor.factory(params: VectorParams)` reads `params.length` directly. Defensive `(params as VectorParams | undefined)?.length` cast deleted.
  - `PgVectorCodec.length` field type narrows from `number | undefined` to `number` (matches the now-honest signature).
  - "Representative codec" doc paragraph deleted.

**Tests.**

- Update every `ParamRef.of(value, { codecId, refs })` test-site to `ParamRef.of(value, { codec: { codecId, typeParams } })`.
- Augment `packages/2-sql/5-runtime/test/sql-context.codec-context.test.ts`: assert `forCodecId` removed from registry; assert content-keyed dispatch.
- Add tests for self-join case (Case S in spec): two `ParamRef`s in a self-join carry identical `CodecRef`s; encode produces one resolver lookup per ref, no alias resolution.

**Acceptance.** `pnpm typecheck` green. All package tests green. `pnpm fixtures:check` green (demo emit unchanged). Real-Postgres e2e (vector encode/decode) green.

### M4 — Refs-less raw SQL hard fail

**Scope.** Tighten the build path: refs-less `ParamRef` construction without an explicit `codec` argument throws at build time naming the value site.

**Files changed.**

- `packages/2-sql/4-lanes/sql-builder/src/...` — wherever `sql.value(value)` and `sql.raw\`...${value}\`` construct `ParamRef`s, validate that `codec` is supplied (or the construction site can derive one from a column-bound context).
- New diagnostic: `runtimeError('RUNTIME.PARAM_REF_CODEC_REQUIRED', ...)`. (No `BUILD.*` error namespace exists in the codebase today; sql-builder errors use bare `throw new Error(...)` or `runtimeError(...)`. We pick `runtimeError` for the structured envelope; the diagnostic message names the value site and the JS type.)
- Tests: `packages/2-sql/4-lanes/sql-builder/test/raw-sql-codec-required.test.ts` — explicit codec passes, missing codec throws.

**Acceptance.** Existing tests of raw-SQL paths that relied on silent fallback either pass an explicit codec or the test's intent moves to a different surface.

### M5 — `dataTransformAst` op + round-trip fixture

**Scope.** New SQL migration op type that embeds the serialized `AnyQueryAst` in `ops.json`; fixture exercising the round-trip end-to-end.

**Files added.**

- `packages/2-sql/4-lanes/relational-core/src/ast/parse.ts` — new `parseAnyQueryAst(json, registry): AnyQueryAst` parser (per M5.R below). Walks `kind` discriminator, reconstructs class instances via existing `static of(...)` factories, validates each `ParamRef.codec.typeParams` via `registry.descriptorFor(codecId).paramsSchema['~standard'].validate(...)`.
- `packages/2-sql/4-lanes/relational-core/test/ast-parse.test.ts` — round-trip tests (`parse(JSON.parse(JSON.stringify(ast)))` produces structurally identical AST); negative tests for malformed `typeParams` throwing `RUNTIME.TYPE_PARAMS_INVALID`.
- `packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform-ast.ts` — new op factory. Same shape as `dataTransform` but skips the `adapter.lower(...)` step; embeds the JSON-serialized AST in the op payload. Apply-time runner calls `parseAnyQueryAst(jsonAst, registry)` then `adapter.lower(parsedAst, {contract})` to materialize `{sql, params}` at apply time.
- `packages/3-targets/3-targets/postgres/src/exports/data-transform.ts` — re-export `dataTransformAst`.
- `packages/3-targets/3-targets/postgres/test/migrations/data-transform-ast.test.ts` — unit + integration tests covering build → JSON → parse → resolver → encode/execute path.
- New migration directory `examples/prisma-next-demo/migrations/app/<timestamp>_vector-backfill-ast/` with a `migration.ts` that authors a `dataTransformAst`, an emitted `ops.json`, and the corresponding fixture entries `pnpm fixtures:check` validates byte-for-byte.

**Acceptance.** `pnpm fixtures:check` covers the new fixture. `pnpm test:integration` exercises the apply path.

### M6 — Documentation

**Scope.** Update ADR 208 + related docs to reflect AST-bound resolution; no code changes.

**Files changed.**

- **New ADR** — assign next free number (find by `ls "docs/architecture docs/adrs/" | sort` at commit time; today the highest is 211). Title: "AST-bound codec resolution". Single-page; documents the eight-heuristic dissolution as structural justification; references ADR 208 (codec model — composes with), ADR 192 (`ops.json` migration contract — round-trip relevance), ADR 207 (call context — composes with). Adds itself to the Resolves-section of ADR 208's `ParamRef.refs` trade-off paragraph.
- `docs/architecture docs/adrs/ADR 208 - Higher-order codecs for parameterized types.md` — amend "How it composes § 4. Runtime materialization and dispatch" to describe `byCodecRef` content-keyed cache and `AstCodecResolver`. Update "Consequences § Trade-offs" to note `forCodecId` retired and the structural reasons (refs is the wrong fact); link forward to the new ADR. Mark `ParamRef.refs`-related paragraphs superseded with retrospective note pointing to the new ADR.
- `packages/2-sql/4-lanes/relational-core/DEVELOPING.md` — create if missing; document the `CodecRef` invariant for AST authors: every codec-bearing AST node carries `codec: CodecRef | undefined`; refs-less raw-SQL paths require explicit codec at call site.

**Acceptance.** Docs reflect the implemented behavior.

### M7 — Validation gates + final sweep

**Scope.** Run all gates; fix any holdouts; close-out.

- `pnpm typecheck` — green.
- `pnpm lint:deps` — green (verify no layering violations from `framework-components/utils/canonicalize-json` move).
- `pnpm test:packages` — green.
- `pnpm test:e2e` — green.
- `pnpm test:integration` — green.
- `pnpm fixtures:check` — green; demo emit byte-identical against `origin/main`.
- `pnpm build` — green.
- Grep sweep for stale references: `validateParamRefRefs`, `forCodecId`, `alias-resolver`, `ambiguousCodecIds`, `parameterizedRepresentatives`, `ParamRefBindingRefs`, `byCodecId`, `factory.bind(descriptor)` — all zero.
- Linear ticket closes via PR merge integration (PR title or branch contains `tml-2456` so Linear's GitHub integration auto-transitions).

## Risks and open questions per milestone

### M1

- **Q.** Should `canonicalizeJson` move to `framework-components/utils` or live in a smaller new package? **A.** Move to `framework-components/utils`. Migration's existing import becomes a re-export from the new home; `pnpm lint:deps` validates layering (migration depends on framework-components already).

### M2

- **R.** `byCodecRef` cache pre-population now does N descriptor materializations where N = total columns + storage.types entries. Today it's roughly the same N, just split across two maps. Net-zero overhead. **Mitigation.** Benchmark `createExecutionContext` time on the demo contract pre/post-M2.

### M3

- **R.** The "two paths live in M2, both die at M3" approach means the M3 milestone is large. **Mitigation.** Sub-commits M3a/M3b/M3c (specified above). Each sub-commit reviewable independently; M3a is a pure cleanup, M3b is the atomic shape change, M3c is pure deletion.
- **Q.** When `ParamRef.codec` is `undefined`, what does `resolveParamCodec` return? **A.** `undefined` (param flows through driver as-is). Same as today's behavior when both `codecId` and `refs` were undefined.
- **Q.** Column-ref ProjectionItem stamping: today `column-ref` projections leave `refs` undefined and decode reads `forColumn(item.expr.table, item.expr.column)`. After M3, do we stamp `codec` on these projections too? **A.** Yes (per spec AC-3 clarification). Every codec-bearing ProjectionItem carries `codec: CodecRef`; the decode path has one read shape (`item.codec → forCodecRef`). The marginal builder cost is one cache-hit lookup per projection item; the win is single-path decode.

### M4

- **R.** Existing tests may be using raw `sql.value(...)` without codec, relying on silent fallback. **Mitigation.** Grep first; either supply explicit codec or refactor test to use a column-bound builder path.

### M5

- **Q.** Does `dataTransformAst` participate in invariant-aware routing the same way `dataTransform` does (`invariantId?`)? **A.** Yes; same options shape, same routing semantics. The only difference is serialization timing.
- **R.** No AST parser/deserializer exists in the codebase today. The class-based AST uses `accept<R>(visitor)` methods, so naive `JSON.parse` returns plain objects that don't satisfy the `AnyQueryAst` class instance shape. **Decision.** Add a structural AST parser at `packages/2-sql/4-lanes/relational-core/src/ast/parse.ts` (`parseAnyQueryAst(json: JsonValue): AnyQueryAst`) that walks the `kind` discriminator and reconstructs class instances via the existing `static of(...)` factories. The parser is part of M5 scope; tests cover round-trip equality (`parse(serialize(ast))` produces a structurally identical AST that passes the same visitor traversals).
- **R.** AST serialization needs canonical, stable shape. **Mitigation.** AST classes already produce frozen objects with `kind`-discriminated, enumerable own properties; default `JSON.stringify` produces the canonical shape. No custom `toJSON()` methods needed.
- **Q.** Apply-time validation: where does `paramsSchema['~standard'].validate(typeParams)` run? **A.** Inside `parseAnyQueryAst` — when reconstructing a `ParamRef` whose `codec` is present, the parser consults the `CodecDescriptorRegistry` (passed in at parse time) and validates `typeParams` via the descriptor's `paramsSchema`. Throws `RUNTIME.TYPE_PARAMS_INVALID` on rejection. The migration-apply caller threads the registry from the apply-time `ExecutionContext`.

### M6

- **Decision.** New ADR (next free number, currently 212+). The change is structural enough (AST carries codec identity; runtime dispatch dissolves) to warrant its own decision record. ADR 208 stays the codec-model authority; new ADR supersedes the dispatch-side details only.

## PR sizing check

Estimated diff:

- M1: +200 LoC (mostly tests)
- M2: +100/-150 LoC (cache reshape)
- M3: +400/-700 LoC (the substantive change; deletions outnumber additions)
- M4: +50/-100 LoC
- M5: +300 LoC (new op + fixture + tests)
- M6: +150 LoC (docs)
- M7: cleanup, near-zero LoC

Total: ~1200/-950 LoC, ~2150 LoC of churn. Comfortably one PR. If review feedback demands a split, the natural cut is between M4 and M5: M1–M4 are the substitution+deletion (the core change); M5–M7 are the round-trip op + docs (additive, lower risk).

## Out of scope (re-stating from spec)

- Default-codec ergonomics for refs-less paths
- Mongo family AST-bound resolution (TML-2442)
- `pgEnumCodec` factory audit
- Reshaping `CodecDescriptor`, `Codec`, `CodecCallContext`, `CodecInstanceContext`
- Op-type changes beyond `dataTransformAst`
