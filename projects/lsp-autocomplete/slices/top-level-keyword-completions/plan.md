# Slice plan: top-level-keyword-completions

**Spec:** `projects/lsp-autocomplete/slices/top-level-keyword-completions/spec.md`
**Parent project:** `projects/lsp-autocomplete/spec.md`
**Linear issue:** [TML-2947](https://linear.app/prisma-company/issue/TML-2947/lsp-autocomplete-top-level-keyword-completions)

## Dispatch plan

### Dispatch 1: declaration-keyword-completions

- **Outcome:** Configured PSL inputs complete declaration keywords at document top level and inside namespace bodies, with descriptor-backed generic block keywords and client-capability-gated snippet/plain insertion.
- **Builds on:** The existing LSP completion request path, completion context classifier, provider dispatch seam, generic block descriptor candidate source, namespace-aware type-position completion work, and generic block key completion work already present on the branch.
- **Hands to:** A completed top-level keyword completion surface for PR review: scoped declaration-position classification, scope-appropriate keyword candidates, snippet/plain insertion behavior, server capability threading, tests, and README coverage.
- **Focus:** Write tests before implementation; extend the language-server completion context with document-level and namespace-body declaration keyword positions; add provider output for native PSL block keywords and descriptor-backed generic block keywords; thread `clientSupportsSnippets` from initialize capabilities to provider input; emit snippet items only for snippet-capable clients and plain-text items otherwise; keep ordinary PSL attributes, attribute arguments, generic block values, relation-aware completions, and completion-marker reparsing out of scope; preserve existing model type, namespace member, generic block key, diagnostics, formatting, and folding-range behavior.
- **Completed when:**
  - Classifier/provider/server tests cover blank and partial document-level declaration keyword positions; blank and partial namespace-body declaration keyword positions; namespace-body exclusion of `namespace` and `types`; descriptor-backed generic block keyword candidates; snippet-supported output; plain-text fallback output; and unsupported ordinary `@` / `@@` attribute contexts returning no scoped keyword suggestions.
  - The server derives snippet support from `InitializeParams.capabilities.textDocument?.completion?.completionItem?.snippetSupport === true` and threads the boolean into completion provider input without assuming snippets for CodeMirror-style clients.
  - The README documents top-level and namespace-body keyword completion scope, snippet capability gating, and the continued exclusion of ordinary attributes and attribute arguments.
- **Validation gates:**
  - `pnpm --filter @prisma-next/language-server test`
  - `pnpm --filter @prisma-next/language-server typecheck`
  - `pnpm --filter @prisma-next/language-server lint`
  - If parser exports or generated parser declarations are changed: `pnpm --filter @prisma-next/psl-parser build`, then rerun the language-server gates.

### Dispatch 2: review-feedback-and-classifier-navigation

- **Outcome:** PR review feedback is addressed with the completion classifier refactored away from repeated whole-tree traversals and toward existing red-tree / AST navigation primitives.
- **Builds on:** Dispatch 1's completion classifier, provider, server wiring, tests, and README updates.
- **Hands to:** A review-cleaner autocomplete implementation where `completion-context.ts` uses existing parser navigation APIs for nearest tokens, siblings, ancestors, and source offsets; stale completion artifacts are refreshed from the current buffer; playground runtime endpoint path parsing is robust against malformed `Host` headers; and tests/validation cover the changed behavior.
- **Focus:** Inspect the parser red/green node and AST helper APIs before editing; write or adjust tests first where behavior changes; remove unused context fields and helper indirection called out in review; avoid replying to or resolving GitHub review threads; keep completion semantics unchanged except where tests expose stale-buffer or cursor-context bugs.
- **Completed when:**
  - Review comments on `completion-context.ts`, `server.ts`, and `apps/lsp-playground/src/cli.ts` are either implemented or explicitly reported as not applicable in the dispatch wrap-up.
  - `completion-context.ts` no longer does avoidable repeated whole-AST searches for current/previous context when existing node/token navigation APIs can answer the question locally.
  - Relevant tests cover any stale-buffer completion refresh behavior and classifier behavior preserved by the refactor.
- **Validation gates:**
  - `pnpm --filter @prisma-next/language-server test`
  - `pnpm --filter @prisma-next/language-server typecheck`
  - `pnpm --filter @prisma-next/language-server lint`
  - `pnpm --filter @prisma-next/lsp-playground typecheck`
  - `pnpm --filter @prisma-next/lsp-playground lint`

## Dispatch-INVEST check

- **Independent:** The dispatch produces a complete reviewable surface on top of the already-landed completion route and does not require a sibling slice to merge concurrently.
- **Negotiable:** The dispatch pins the outcome and capability behavior while leaving implementation discovery over the existing classifier/provider/server files to the executor.
- **Valuable:** It directly closes the user's requested declaration-keyword completion gap, including namespace-body behavior and snippet/plain insertion variants.
- **Estimable:** The completed-when checklist is binary and covered by tests plus package gates.
- **Small:** The work is one coherent language-server completion surface in one package, with one syntactic context family and one provider output family.
- **Testable:** The language-server package tests/typecheck/lint gates verify the slice; parser build is only required if implementation changes parser declarations.

## Open items

None.
