# Slice 05 — LSP interpreter diagnostics (lazy, mapped, degrading)

**Project:** [`../../spec.md`](../../spec.md) · **Project plan:** [`../../plans/plan.md`](../../plans/plan.md) § M4 · **Linear:** TML-2984
**Depends on:** slices 01–04 (all merged). This is the payoff slice: diagnostics appear in editors.

## Design (settled — project spec §§ At a glance, Cross-cutting)

All changes in `packages/1-framework/3-tooling/language-server/`:

1. **`config-resolution.ts`** — when the config has PSL inputs *and* a contract source
   that passes `hasPslInterpreter`, `ConfigResolution` additionally carries:
   - the guarded provider (`PslInterpretCapable`), and
   - a fully assembled `ContractSourceContext`, built **once per config (re)load** by
     property picks off `createControlStack(config)` (the slice-02/03 machinery:
     `extensionContracts`, `extensionPacks.map(p => p.id)`, `scalarTypeDescriptors`,
     `authoringContributions`, `codecLookup`, `controlMutationDefaults`,
     `capabilities`; `resolvedInputs` from the config's source inputs).
   Configs without the capability (typescript source, opaque, hand-rolled, no
   contract) carry neither — every downstream path then behaves byte-for-byte as
   today. The existing partial `PipelineInputs` derivation stays as-is.
2. **`diagnostic-mapping.ts`** — new mapper from `ContractSourceDiagnostic` to
   `LspDiagnostic`: spans are line/column (+offset) positions, unlike parser ranges —
   the implementer verifies base (0- vs 1-based) against real interpreter output and
   pins it in a test; **span-less diagnostics anchor at document start** (synthetic
   range at position 0..1, the tsserver convention) — never dropped.
3. **`project-artifacts.ts`** — `DocumentArtifacts` gains a **lazily computed,
   memoized interpret slot**: computed on first request at diagnostics-assembly time
   by invoking `provider.interpret({document, sourceFile, symbolTable, sourceId},
   context)` **as a method** (detached-`this` hazard — never extract the function),
   unwrapping `notOk → failure.diagnostics`, `ok → []`, mapping via (2), and caching
   until the existing `documentChanged`/`documentClosed` invalidation drops the
   document. `runPipeline` is untouched (semantic tokens / folding / completion never
   pay interpretation).
4. **Diagnostic assembly wiring** (`server.ts` `publish` + pull handler /
   `document-diagnostics.ts`) — combined response = existing parse/symbol-table
   diagnostics + the interpret slot's mapped diagnostics. Interpretation runs only
   when a diagnostics response/publication is being built.
5. **`interpret` never throws on recovered input** (provider-tested in slice 04); the
   LSP does not wrap it in try/catch — a throw here is a real bug that must surface,
   not be swallowed (config-*load*-time failures are slice 06's concern).

## Coherence rationale

One reviewable PR: "the LSP pulls interpreter diagnostics from its cached artifacts."
Context assembly, span mapping, lazy memoization, and wiring are one data path — any
subset would ship either dead code or unmapped diagnostics (forbidden by the
transitional-shape constraint: never publish without position mapping).

## Slice Definition of Done (beyond CI / reviewer / project-DoD)

- [ ] SDoD1 — For a `prismaContract` config and a schema with an interpreter error
      (e.g. unresolvable relation), the LSP's diagnostics response contains the
      interpreter diagnostic with the correct LSP range (span-mapping base pinned by
      test); fixing the schema clears it on the next pull (TC-9).
- [ ] SDoD2 — A span-less interpreter diagnostic surfaces anchored at document start,
      not dropped (TC-10; construct via a real span-less producer or a
      capability-shaped test double — implementer's choice, documented).
- [ ] SDoD3 — Graceful degradation (TC-11): a config whose provider lacks the
      capability (typescript source, opaque provider, absent contract) produces LSP
      behavior byte-for-byte identical to pre-slice — regression test comparing
      full diagnostic responses.
- [ ] SDoD4 — Laziness (TC-12): semantic-token, folding-range, and completion
      requests never invoke `interpret` (spy); repeated diagnostic pulls on unchanged
      content interpret at most once; an edit invalidates the memo (spy count
      increments exactly once after change).
- [ ] SDoD5 — Zero new casts; `pnpm lint:deps` green (language-server already
      depends on psl-parser and config; no new edges expected — flag if one appears).

## Edge cases (pre-investigated)

- **Span base mismatch**: `ContractSourceDiagnosticSpan` positions carry
  offset/line/column from the PSL source file; LSP ranges are 0-based
  line/character. `rangeToPslSpan` (psl-parser) is the existing forward conversion —
  its inverse defines the mapping; pin with a diagnostic whose expected range is
  hand-computed.
- **`sourceId` scope**: the LSP is single-input; pass the document URI (or the path
  form the project already uses for inputs) as `sourceId` and do not filter returned
  diagnostics by it (single-input model inherited as-is per the spec's non-goals).
- **Context lifetime**: the context is per-config-load, shared across documents and
  pulls; the interpret memo is per-document-version. A config reload replaces the
  store wholesale (existing behavior) — no stale-context path exists.
- **The pull handler and push path must share the assembly** — do not implement
  interpretation twice (one combined-diagnostics function consumed by both).

## Dispatch plan

Two dispatches, sequential.

### S5-D1 — context assembly + guarded provider in ConfigResolution/ProjectState

- **Outcome:** `ConfigResolution`/`ProjectState` carry the guarded provider + the
  assembled `ContractSourceContext` when the capability is present; nothing consumes
  them yet (dead until D2); resolution tests cover present/absent capability, and
  the context contents are pinned (extensionContracts flowing from the stack).
- **Builds on:** slices 01–04.
- **Hands to:** S5-D2.
- **Focus:** `config-resolution.ts`, `server.ts` (ProjectState threading only), tests.
- **Gate:** `pnpm --filter @prisma-next/language-server test` + typecheck + lint,
  `pnpm typecheck`, `pnpm lint:deps`.

### S5-D2 — span mapper + lazy memoized interpret + assembly wiring + regression/laziness tests

- **Outcome:** the full data path live: mapper (incl. span-less anchor), memoized
  interpret slot in project-artifacts, combined assembly consumed by both pull and
  push; SDoD1–4 tests green.
- **Builds on:** S5-D1.
- **Hands to:** slice 06 (config-failure surfacing), M6 (playground QA).
- **Focus:** `diagnostic-mapping.ts`, `project-artifacts.ts`,
  `document-diagnostics.ts`/`server.ts`, tests.
- **Gate:** `pnpm --filter @prisma-next/language-server test` + typecheck + lint,
  `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps`.
