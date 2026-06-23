# Slice plan: symbol-table-diagnostics

**Spec:** `projects/lsp-diagnostic-extend/slices/symbol-table-diagnostics/spec.md`

One implementer + one reviewer, resumed across dispatches. Validation gate (all dispatches): `cd packages/1-framework/3-tooling/language-server && pnpm typecheck` + `pnpm --filter @prisma-next/language-server test`; plus `pnpm lint:deps` once the dependency / imports change (D1).

## Dispatches

### D1 — Staged pipeline + control-stack resolution (substrate)

- **Outcome:** A pure pipeline module in `@prisma-next/language-server` computes, from `(uri, text, { scalarTypes, pslBlockDescriptors, inputs })`, the merged parse + symbol-table diagnostics **and** returns the intermediate artifacts (`DocumentAst` + `SymbolTable`). Config resolution additionally builds the control stack via `createControlStack(config)` and exposes `scalarTypes` + `pslBlockDescriptors`; `@prisma-next/framework-components` added as a dependency.
- **Builds on:** none.
- **Hands to:** the typed pipeline function + a `ProjectState` shape carrying `scalarTypes`/`pslBlockDescriptors` for D2 to wire into `publish`.
- **Completed when:**
  - New pipeline module exports a function returning `{ diagnostics, document, symbolTable }` (names at implementer's discretion); unit tests cover duplicate-declaration + invalid-qualified-type + clean + malformed inputs.
  - `resolveConfigInputs` (or successor) returns control-stack-derived `scalarTypes` + `pslBlockDescriptors`; `createControlStack` failure degrades gracefully (parse-only or stop-managing), never throws out of `publish`.
  - `pnpm lint:deps` green with the new framework-components dep; no `sql`/`mongo` import.
  - Gate green.
- **Halt conditions:** `createControlStack(config)` needs inputs the loaded config doesn't carry (surface — spec assumed parity with `executeContractEmit`); any need to import a target package (scope/approach wrong).

### D2 — Server wiring + parity + non-regression

- **Outcome:** The server's `publish` path uses the pipeline against the buffer with the project's cached control stack; symbol-table diagnostics reach the editor; `computeDocumentDiagnostics` is a thin reader over the pipeline. Build-parity, fault-tolerance, and non-regression tests pass.
- **Builds on:** D1's pipeline + `ProjectState` shape.
- **Hands to:** a working server for D3's manual QA.
- **Completed when:**
  - `ProjectState` carries the control-stack data; `publish` threads it into the pipeline; cached per config, refreshed on config change (existing watch).
  - Parity test (AC-2), fault-tolerance + non-regression tests (AC-6), and the not-an-input / non-psl guards still pass.
  - Diagnostic ordering verified stable against the prior single-tier behavior.
  - Gate green.
- **Halt conditions:** parity test reveals the server path diverges from the provider's symbol-table tier in a way the spec didn't anticipate.

### D3 — Playground QA + ADR

- **Outcome:** `apps/lsp-playground` verified end-to-end against its default-postgres config (manual-QA script + run report); ADR drafted for the stage-ownership decision.
- **Builds on:** D2's working server.
- **Hands to:** slice DoD / PR.
- **Completed when:** `drive-qa-plan` script + ≥1 `drive-qa-run` report exist under the slice; ADR drafted (or committed at project close-out per the ADR-cadence convention).
- **Halt conditions:** playground regresses (e.g. `createControlStack` slow/broken on the default config) — route back to D1/D2.

## Open items

- None. Decisions confirmed in the project spec's *Resolved Decisions*.
