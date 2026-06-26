# Slice plan: model-type-completions

**Spec:** `projects/lsp-autocomplete/slices/model-type-completions/spec.md`
**Parent project:** `projects/lsp-autocomplete/spec.md`
**Linear issue:** [TML-2946](https://linear.app/prisma-company/issue/TML-2946/lsp-autocomplete-model-type-completions)

## Dispatch plan

### Dispatch 1: cursor-classifier-substrate

- **Outcome:** A pure classifier identifies model field type completion contexts and unsupported contexts from existing cached `DocumentAst`, `SourceFile`, and syntax tree structure.
- **Builds on:** Existing parser recovery, `SourceFile.offsetAt(position)`, red-tree traversal, `FieldDeclarationAst.typeAnnotation()`, `TypeAnnotationAst`, and `QualifiedNameAst`.
- **Hands to:** A typed completion context union consumed by provider dispatch.
- **Focus:** Cursor offset conversion; touching/current/previous token handling; ancestor-based model field type detection; blank and partial type positions; bare, namespace-qualified, and contract-space-qualified prefixes; explicit rejection of ordinary `@` / `@@` attributes, attribute arguments, generic blocks, comments/trivia, constructor arguments, and invalid over-qualified names.
- **Completed when:**
  - Classifier tests cover blank type, partial bare type, namespace-qualified prefixes, contract-space-qualified prefixes, comments/trivia, ordinary attributes, attribute arguments, generic blocks, and unsupported contexts.
  - No completion-marker reparsing is introduced.
- **Validation gates:**
  - `pnpm --filter @prisma-next/language-server test`
  - `pnpm --filter @prisma-next/language-server typecheck`
  - `pnpm --filter @prisma-next/language-server lint`
  - If parser utilities or exports are changed: `pnpm --filter @prisma-next/psl-parser test`, `pnpm --filter @prisma-next/psl-parser typecheck`, `pnpm --filter @prisma-next/psl-parser lint`, and `pnpm lint:deps`.

### Dispatch 2: model-type-provider

- **Outcome:** The model-type provider returns stable LSP completion items for scalar and visible type-like symbol-table candidates when the classifier reports a model field type context.
- **Builds on:** Dispatch 1’s typed completion context union.
- **Hands to:** A completion entry point that can route context to provider output or `[]`.
- **Focus:** Candidate extraction from configured scalar types and the current `SymbolTable`; top-level models, composite types, scalars, type aliases; namespace models and composite types; stable ordering; prefix filtering for bare, namespace-qualified, and contract-space-qualified syntax; explicit exclusion of generic block symbols, ordinary attributes, relation-aware suggestions, and external contract-space indexes that do not exist in current artifacts.
- **Completed when:**
  - Provider tests cover bare type completions, namespace-qualified completions, contract-space-qualified syntax positions, and unsupported analysis returning `[]`.
  - Tests prove generic block symbols are not returned as model field type candidates.
  - The candidate-source seam can be extended later without changing the classifier contract.
- **Validation gates:**
  - `pnpm --filter @prisma-next/language-server test`
  - `pnpm --filter @prisma-next/language-server typecheck`
  - `pnpm --filter @prisma-next/language-server lint`

### Dispatch 3: lsp-completion-route

- **Outcome:** The language server advertises completion support and answers `textDocument/completion` for open, configured PSL inputs.
- **Builds on:** Dispatch 1’s classifier and Dispatch 2’s provider dispatch entry point.
- **Hands to:** End-to-end LSP completion behavior for configured documents.
- **Focus:** `server.ts` completion capability advertisement; `connection.onCompletion(...)` request handler; open-document lookup; configured-input gating; cached artifact lookup; empty results for unconfigured, missing, unsupported, or artifact-less documents; preservation of existing diagnostics and formatting behavior.
- **Completed when:**
  - Server tests cover initialize capability advertisement.
  - Server tests cover configured PSL completion returning expected labels at a model field type position.
  - Server tests cover unconfigured documents and unsupported contexts returning `[]`.
  - Existing diagnostics and formatting server tests still pass.
- **Validation gates:**
  - `pnpm --filter @prisma-next/language-server test`
  - `pnpm --filter @prisma-next/language-server typecheck`
  - `pnpm --filter @prisma-next/language-server lint`

### Dispatch 4: scope-docs-and-final-guardrails

- **Outcome:** Documentation and final guardrail tests accurately describe and protect the slice-1 completion scope.
- **Builds on:** Dispatch 3’s end-to-end completion route.
- **Hands to:** Slice `generic-block-completions` can add descriptor-backed contexts/providers without reworking the LSP request path.
- **Focus:** Update `packages/1-framework/3-tooling/language-server/README.md` so completion is no longer documented as wholly out of scope; document configured PSL inputs, model field type positions, visible symbol-table candidates, and qualified syntax support; explicitly exclude generic block completions, ordinary `@` / `@@` attributes, attribute arguments, relation-aware completions, and external contract-space candidate discovery unless a future slice adds it.
- **Completed when:**
  - README states the supported model-type completion scope without overclaiming slice-2 or future surfaces.
  - Final guardrail coverage includes at least one ordinary attribute context returning `[]` through the server path.
  - The slice-specific done conditions in `spec.md` are satisfied.
- **Validation gates:**
  - `pnpm --filter @prisma-next/language-server test`
  - `pnpm --filter @prisma-next/language-server typecheck`
  - `pnpm --filter @prisma-next/language-server lint`
  - If imports, exports, or package boundaries changed: `pnpm lint:deps`.

## Dispatch-INVEST check

- **Independent:** Each dispatch leaves a named hand-off usable by the next dispatch without concurrent sibling work.
- **Negotiable:** Dispatches name outcomes and leave implementation details to executor discovery inside the scoped surfaces.
- **Valuable:** Every dispatch materially advances the slice from classifier substrate to provider, LSP route, and final scope guardrails.
- **Estimable:** Each dispatch has binary completed-when checks and concrete validation commands.
- **Small:** Each dispatch is one coherent review lens: classifier, provider, route, or docs/guardrails.
- **Testable:** The language-server package test/typecheck/lint gates verify each dispatch, with parser gates added only if parser exports change.

## Open items

None.
