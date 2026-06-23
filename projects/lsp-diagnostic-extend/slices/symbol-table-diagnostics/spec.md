# Slice: symbol-table-diagnostics

**Project spec:** `projects/lsp-diagnostic-extend/spec.md`
**Linear:** [TML-2934](https://linear.app/prisma-company/issue/TML-2934)

## Chosen design

Extend `@prisma-next/language-server` so it computes diagnostics through stages it owns, run against the in-memory document buffer:

```text
publish(uri, text)
  → parse(text)                                   // CST/AST + parse diagnostics  (exists)
  → buildSymbolTable({ document, sourceFile,      // symbol table + symbol-table diagnostics (NEW)
        scalarTypes, pslBlockDescriptors })
  → mapParseDiagnostics(parse ∪ symbol-table)     // both are ParseDiagnostic-shaped
  → connection.sendDiagnostics
```

`scalarTypes` and `pslBlockDescriptors` come from `createControlStack(config)` (`@prisma-next/framework-components/control`), the same way `executeContractEmit` builds them:

- `scalarTypes = [...stack.scalarTypeDescriptors.keys()]`
- `pslBlockDescriptors = stack.authoringContributions.pslBlockDescriptors`

The control stack is resolved once per config and cached on `ProjectState`, alongside the existing `inputs`, reusing the current config-resolution + config-watch invalidation (`loadProject` / `queueProjectLoad` / `refreshProject`). It is never rebuilt per keystroke.

The staged pipeline lives in a module that returns both the diagnostics **and** the intermediate artifacts (CST/`DocumentAst` + `SymbolTable`), so a future completion/semantic-tokens slice consumes the artifacts without re-architecting. `computeDocumentDiagnostics` becomes a thin reader over that pipeline.

**Layering:** the new static imports are `@prisma-next/psl-parser` (`buildSymbolTable`, already a dep) and `@prisma-next/framework-components` (`createControlStack`, new dep). Both are framework-domain. No `@prisma-next/sql-contract-psl` / `…mongo…` import. `pnpm lint:deps` stays clean.

## Acceptance criteria

- **AC-1 — Symbol-table diagnostics publish live.** Opening/editing a configured PSL input publishes parse **and** symbol-table diagnostics. A duplicate top-level declaration emits `PSL_DUPLICATE_DECLARATION`; an over-qualified field type emits `PSL_INVALID_QUALIFIED_TYPE`. Fixing each clears its marker; a clean document publishes `[]`.
- **AC-2 — Build parity.** For a given source, the published symbol-table diagnostics match the codes, messages, and ranges that the contract-psl provider produces for that source (asserted by a test that runs `parse` + `buildSymbolTable` with the same `scalarTypes` / `pslBlockDescriptors`).
- **AC-3 — Control stack resolved from config + cached.** `ProjectState` carries the control-stack-derived `scalarTypes` + `pslBlockDescriptors`, built via `createControlStack(config)` once per config and refreshed on config change; not rebuilt per document/keystroke.
- **AC-4 — Stages exposed as artifacts.** The CST (`DocumentAst`) and `SymbolTable` are returned from the pipeline module through a typed surface, not inlined as locals in the diagnostics function.
- **AC-5 — No target dependency.** `@prisma-next/language-server` has no static import of any `sql` / `mongo` domain package; `pnpm lint:deps` clean. Asserted by the dep check / architecture config.
- **AC-6 — Fault tolerance + non-regression.** A malformed/half-typed buffer never crashes the server; a document not in `inputs`, or a non-`psl` source, still gets no diagnostics; existing parse-tier behavior is unchanged.
- **AC-7 — Playground.** `apps/lsp-playground` works end-to-end against its default-postgres config, showing the new diagnostics live.
- **AC-8 — Project-level preservation of parsed artifacts.** The project (per config) preserves the per-document AST keyed by URI **and** one project-level symbol table, both readable for reuse by future features (completion / semantic tokens). A document edit re-parses only that URI's AST and rebuilds the project symbol table; closing a document drops its AST; a config change rebuilds the symbol table. Published diagnostics are unchanged in content vs the pre-cache behavior (parity). Target model: **AST per document URI + one symbol table per project.** The multi-file merge that fills the project table from several inputs — and reading unopened `inputs` from disk — remains the deferred cross-file work; today the project table is built from the open configured input(s) only.

## Pre-investigated edge cases

- **`createControlStack(config)` for a config with no contract / a TypeScript source.** The server only diagnoses `sourceFormat === 'psl'` inputs (existing `resolveSchemaInputs` guard). Build the control stack only when there are PSL inputs; if `createControlStack` throws (malformed config), fall back to `resolveProjectIfLoadable`'s existing catch → stop managing the project. Symbol-table diagnosis must degrade to parse-only rather than crash if the stack can't be built.
- **Empty `pslBlockDescriptors` / `scalarTypes`.** `buildSymbolTable` still produces `PSL_DUPLICATE_DECLARATION` + `PSL_INVALID_QUALIFIED_TYPE` (structural, descriptor-independent). Extension-block param validation depends on descriptors — the real stack supplies them, so parity holds; do not hand it empty maps on the live path.
- **Diagnostic ordering.** Merge parse diagnostics then symbol-table diagnostics; if the editor expects positional order, sort by range. Confirm against the existing single-tier behavior so markers don't reorder spuriously.

## Slice Definition of Done

Inherits the team slice-DoD floor (`drive/calibration/dod.md`). Slice-specific:

- [ ] AC-1 … AC-7 verified.
- [ ] `pnpm --filter @prisma-next/language-server test` + `cd packages/1-framework/3-tooling/language-server && pnpm typecheck` green; `pnpm lint:deps` green.
- [ ] `architecture.config.json` unchanged or correctly reflects the new framework-domain dep; no new layering violation.
- [ ] `drive-qa-plan` script + ≥1 `drive-qa-run` report for the playground.
- [ ] ADR drafted: "language server owns the PSL pipeline stages; one server per project" (extends the TML-2930 ADR line).
