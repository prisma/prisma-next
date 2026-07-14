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

- [x] SDoD1 — interpreter diagnostic in the response at a hand-verifiable mapped
      range (1-based PslSpan → 0-based LSP, base pinned against the real
      `rangeToPslSpan` via roundtrip inversion); fix clears on next pull. ✓
      `e1f1f584d` (server tests; doubles typed `PslInterpretCapable['interpret']` —
      compiler-enforced fidelity; real-provider integration pinned in slice 04;
      end-to-end closes in M6 playground QA).
- [x] SDoD2 — span-less → document-start anchor (0,0→0,1), never dropped. ✓
      (capability-shaped double, choice documented).
- [x] SDoD3 — degradation byte-for-byte on both channels (full diagnostic objects
      deep-equaled; absent-capability slot is a constant `[]`). ✓
- [x] SDoD4 — laziness matrix through real harness request paths: semantic
      tokens/folding/completion → 0 interpret calls; two pulls → 1; edit + pull → 2;
      memo rides the existing document-drop lifecycle. ✓
- [x] SDoD5 — zero production casts; one new dependency edge flagged as instructed
      (language-server → config, direct instead of transitive — honest, downward,
      lint:deps green); no D2 edges. ✓

**Slice-close ritual (2026-07-14):** D1+D2 SATISFIED R1, zero findings; 5/5 SDoD
PASS; `origin/main` rebased (one attribute-specs commit) + gates re-verified
(typecheck 143/143, LSP 218/218, psl-parser 625/625); manual QA: covered by M6
playground script (reviewer directive: include one real `prismaContract` project
with an interpreter error — the last un-doubled link). Grep gate: zero `projects/`
references in long-lived files. Method-detachment hazard converted to a failing
test (`spy.mock.contexts[0]`).

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
