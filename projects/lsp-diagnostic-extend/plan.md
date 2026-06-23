# lsp-diagnostic-extend — Plan

**Spec:** `projects/lsp-diagnostic-extend/spec.md`
**Linear Project:** [Language Tools Support Prisma Next PSL](https://linear.app/prisma-company/project/language-tools-support-prisma-next-psl-3422a7e44b9c)

## At a glance

Single-slice project: one coherent, single-PR change that extends the language server to publish symbol-table-tier diagnostics by owning the staged pipeline (parse → symbol table) against the live buffer. The natural "second slice" — the interpretation tier — is deliberately a **separate future project** (it needs a provider contract-surface change), so this project is one slice delivered as a dispatch sequence, not a multi-slice stack.

## Composition

### Stack (deliver in order)

1. **Slice `symbol-table-diagnostics`** — Linear: [TML-2934](https://linear.app/prisma-company/issue/TML-2934) — folder: `projects/lsp-diagnostic-extend/slices/symbol-table-diagnostics/`
   - **Outcome:** Opening or editing a configured PSL input in `prisma-next lsp` publishes parse **and** symbol-table diagnostics live (duplicate declarations, invalid qualified types, extension-block parameter issues), matching what the build reports for those tiers. The language server owns `parse` (CST/AST) and `buildSymbolTable` as stages run against the in-memory buffer, with the control stack (`scalarTypes`, `pslBlockDescriptors`) resolved from config via `createControlStack(config)` and cached per config on the existing config-watch lifecycle. The CST and symbol table are exposed as a typed, reusable seam. `apps/lsp-playground` works end-to-end. No target-domain dependency is added; `pnpm lint:deps` stays clean.
   - **Builds on:** None within this project. Externally: TML-2930 (the scaffold + parse-tier diagnostics) and TML-2929 (the CST parser + `buildSymbolTable`), both merged on `main`.
   - **Hands to:** The deferred interpretation-tier project — a buffer-built symbol table and a staged-pipeline seam it can extend, plus the recorded mechanism (config-borne `source` provider) for reaching the interpreter.
   - **Focus:** In scope — control-stack resolution + caching in the server, `parse` + `buildSymbolTable` against the buffer, diagnostic merge + publish, the typed stage seam, parity tests, playground QA, and the ADR. Out of scope (other project) — interpretation-tier (PSL → Contract) diagnostics and the granular provider `interpret` seam they require; any new LSP capability (completion, semantic tokens, hover, go-to-def); cross-file symbol resolution.

_No parallel groups: single slice._

## Dependencies (external)

- [x] TML-2930 (`lsp-scaffold`) — language server, `prisma-next lsp`, parse-tier diagnostics, config-watch lifecycle. Merged on `main`.
- [x] TML-2929 — CST parser + `buildSymbolTable` resolution layer. Merged on `main`.
- [ ] None blocking. `createControlStack` (`@prisma-next/framework-components/control`) and `buildSymbolTable` (`@prisma-next/psl-parser`) are both available and framework-domain; adding them as `@prisma-next/language-server` dependencies is layering-legal (framework/tooling → framework/core, framework/authoring).

## Sequencing rationale

There is nothing to sequence: this is one slice. It is deliberately *not* split into a "control-stack substrate" slice and a "diagnostics" slice — the calibration's mis-sizing pattern (TML-2502 / runtime-target-layer) applies directly: those would be layers of a single reviewable change, and the substrate-first half would ship state the second half immediately consumes with no independent value. The internal substrate → wiring → seam → tests/QA decomposition is dispatch-level work for `drive-plan-slice`, run when the slice is picked up. The interpretation tier is a separate future project rather than a second slice here because it requires a `@prisma-next/config` contract-surface change (a granular, buffer-friendly `interpret` seam on the provider), giving it its own purpose and blast radius.
