# Design note: column DDL rendering resolves a CodecRef against the framework codec registry (retire `opRender`)

**Status:** accepted (operator, PR #921 review). Supersedes the `opRender` mechanism introduced in this slice's W5. In scope for the PR #921 fix round.

## The one-paragraph version

The migration planner needs codec-derived DDL for a column (its SQL type token, default, `ALTER TYPE` fragment). This slice solved that by **pre-rendering the DDL at contract→IR derivation and stamping the result onto the schema-IR node** as `readonly opRender?: unknown` (on `SqlColumnIR` and `SqlColumnDefaultIR`), read back by the target op-builders via `blindCast` + a runtime throw. That machinery was unnecessary: the framework already ships a **contract-free codec registry** (`CodecRegistry.forCodecRef(ref): Codec`) that the **control stack already carries** (`control-stack.ts:59`, `codecLookup: CodecRegistry`), and `CodecRef` is the established codec reference the query AST and the migration DDL renderer already use (TML-2456, TML-2918 — both Done). The correct shape: the column node carries a `CodecRef` (same as the query AST), and the op-builder resolves it against `codecLookup.forCodecRef` at plan time. `opRender` and the threaded `native-type-expander` are deleted.

## What `opRender` is and why it exists

W5 made the planner's structural op-render path "contract-free" — it reads nodes, not the contract. But DDL rendering genuinely needs codec knowledge (which codec, native-type expansion, storage types), which the path was forbidden to reach. The resolution taken: compute the rendered strings early, at derivation, where the codec hooks are in hand, and carry the result forward on the node.

Concretely (`contract-to-schema-ir.ts`):
- Line 401 — the column converter **deliberately drops `codecId`/`typeRef`**: "the schema IR only represents [state]".
- Lines 96/129 — a `renderColumnOps: ColumnOpRenderer` callback computes the target DDL payload and it is stamped as `opRender` on the node.
- `sql-column-ir.ts:55` / `sql-column-default-ir.ts:24` — `readonly opRender?: unknown`, non-enumerable.
- `postgres-column-op-render.ts` — `columnOpRenderOf` narrows `unknown` → `PostgresColumnOpRender` via `blindCast`, throwing if absent.

So the derivation had the `codecId` in hand, **threw it away as "not state," then stamped the entire pre-rendered DDL output onto the state node in its place.** It decided a small reference was too much for a state node and replaced it with a large, untyped output payload. That inconsistency is the smell the review caught.

## What already exists (and was bypassed)

- **`CodecRef`** (`framework-components/shared/codec-types.ts:18`): `{ codecId, typeParams?, many? }`. The serializable codec reference. The migration issue-planners already import it (`issue-planner.ts`).
- **`CodecRegistry.forCodecRef(ref): Codec`** (same file:69–90): materializes a codec from a ref; documented **contract-free**. `forColumn(namespaceId, table, column)` also exists but is contract-bound; the contract-free path is `forCodecRef`.
- **The control stack already holds the registry**: `control-stack.ts:59`, `readonly codecLookup: CodecRegistry`. `plan()` reaches it via `frameworkComponents` — the same path the codec-hook subsystem (extensions/types/field-events) already uses to reach codecs. So the planner already has contract-free codec access; the structural path pre-baked `opRender` specifically to avoid using it.
- **Prior shipped work this regressed against:**
  - **TML-2456 (Done)** — "AST-bound codec resolution: replace `ParamRef.refs/codecId` … with serializable `CodecRef`" put `CodecRef` on the query AST.
  - **TML-2918 (Done)** — "round-trip `codecRef` through `renderDdlColumnAsTsCall`" already round-trips a `codecRef` through migration DDL column rendering.
  - Standing direction: **TML-2405 (Backlog)** "reference codec instances on the AST, not lookup keys"; **TML-2317 (Backlog)** "replace target-postgres native-type-normalizer special-casing with codec-driven equivalence" — the `native-type-expander` smell by name.

## Why `opRender` is wrong (beyond "it reinvented things")

1. **DDL render output on a state node.** Schema IR represents database state (introspected actual / derived expected). `opRender` is precomputed output of a *different* subsystem (the planner's renderer) riding on the state node.
2. **Untyped seam.** `unknown` + `blindCast` + runtime throw. A derivation path that forgets to stamp it fails at runtime driving *DDL*, not at compile time.
3. **The "codec-free structural path" was a fiction.** A column's SQL type is inherently codec-determined. Pretending column rendering isn't codec work is what forced the pre-bake.

## The correct design

1. **The column node carries a `CodecRef`** — same as the query AST (TML-2456) and the DDL renderer (TML-2918). Revert the line-401 "drop `codecId`" decision: build a `CodecRef { codecId, typeParams?, many? }` from the contract column (the ids/params are right there at derivation) and carry it. A `CodecRef` is the column's *identity* — which codec produces its type — not another subsystem's cached output.
2. **The op-builder resolves the codec at plan time**: `codecLookup.forCodecRef(node.codecRef)` (contract-free) → `Codec`, then renders the DDL by calling the codec — the same call the runtime and the DDL renderer already make. `codecLookup` reaches the planner via `frameworkComponents`/the control stack it already receives.
3. **Delete `opRender`** from `SqlColumnIR` and `SqlColumnDefaultIR`, the `renderColumnOps` derivation callback, and `columnOpRenderOf` + its `blindCast`. Delete the threaded `native-type-expander` free function in favour of a codec-hook call on the resolved codec (this is TML-2317's direction; do the migration-render slice of it here).

The **render logic itself does not change** — the same helpers produce the same strings; only *when* (plan time vs derivation) and *how the codec is reached* (registry `forCodecRef` vs pre-baked payload) change. So the emitted ops stay byte-identical.

Note the diff-relevant resolved values (`resolvedNativeType`, `resolvedDefault`, resolved value-sets) **stay stamped at derivation** — those are state the differ compares, and Decision 2 ("resolution at derivation; the differ is pure") is unchanged. Only the *render payload* moves from pre-baked-on-node to resolved-at-plan-time.

## Byte-identity proof

Same as every op-touching change in this slice, and `fixtures:check` remains blind to it: the planner/adapter op→SQL `toBe` suites, the `migration plan` e2e journeys, the four multi-space guards, and a golden diff of real `plan()` output before/after the change. A drift there is a hard stop.

## Scope

In the PR #921 fix round. It is not a new subsystem and not the later codec-ops unification (extensions/types as first-class diff nodes; the field-event planner consuming the differ's issues) — it uses machinery already on the control stack. It does, however, retire the "structural path is codec-free" grep-clean property from this slice, which was the fiction generating the smell; the planner legitimately reaches codecs through the registry it already holds.

## Review miss (recorded honestly)

The architect pass flagged `opRender: unknown` as a shape smell (F2) and reasoned it was "defensible-but-debt" because shared-core columns force an untyped seam. Neither that pass, the principal-engineer pass, the per-unit reviewer across W1–W6, nor the orchestrator checked whether the framework already had a contract-free codec registry — it did, on the control stack, and `CodecRef` was already the established reference. The lesson: when a slice introduces a new mechanism to reach an existing capability (codecs), check for the existing capability before accepting the mechanism as debt.
