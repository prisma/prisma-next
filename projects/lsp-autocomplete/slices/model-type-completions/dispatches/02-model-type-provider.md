# Brief: model-type-provider

## Task

Add the model field type completion provider and explicit completion dispatch entry point in `@prisma-next/language-server`. The provider consumes Dispatch 1’s typed classifier output and returns stable LSP completion items for configured scalar types plus visible type-like symbols from the current `SymbolTable`. Unsupported contexts return `[]`.

## Scope

**In:**

- Provider/dispatcher module and focused tests in the language-server package.
- Candidate extraction from configured scalar types and the current symbol table.
- Candidate categories: configured scalars, top-level models, composite types, scalars, type aliases, namespace models, and namespace composite types.
- Prefix filtering and replacement metadata for bare, namespace-qualified, and contract-space-qualified model field type contexts already classified by Dispatch 1.
- Stable ordering that tests can pin.
- Explicit empty-list behavior for unsupported contexts.

**Out:**

- LSP `completionProvider` advertisement and `connection.onCompletion(...)` handler.
- Server/open-document configured-input gating.
- Generic block entry/parameter completions.
- Ordinary PSL `@` / `@@` attribute completions or attribute argument completions.
- Relation-aware completions.
- Creating a new external contract-space symbol index.
- Parser behavior changes, parser public exports, or completion-marker reparsing.

## Completed when

- [ ] Provider tests cover bare model field type completion candidates.
- [ ] Provider tests cover namespace-qualified prefixes and contract-space-qualified syntax positions using visible candidate data.
- [ ] Provider tests prove unsupported classifier contexts return `[]`.
- [ ] Provider tests prove generic block symbols are not returned as model field type candidates.
- [ ] The dispatcher/candidate-source seam is ready for the server route in Dispatch 3 without adding LSP request handling in this dispatch.
- [ ] Validation gates pass or any blocker is surfaced with concrete evidence.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal — even if it looks useful — halts and surfaces.

## References

**Slice-loop dispatch:**

- Slice spec: `projects/lsp-autocomplete/slices/model-type-completions/spec.md`
- Slice plan entry: `projects/lsp-autocomplete/slices/model-type-completions/plan.md` § Dispatch 2: model-type-provider
- Dispatch 1 hand-off: `packages/1-framework/3-tooling/language-server/src/completion-context.ts` and `packages/1-framework/3-tooling/language-server/test/completion-context.test.ts`
- Project spec / plan: `projects/lsp-autocomplete/spec.md`, `projects/lsp-autocomplete/plan.md`
- Code review log: `projects/lsp-autocomplete/reviews/code-review.md`
- Relevant code surfaces:
  - `packages/1-framework/3-tooling/language-server/src/project-artifacts.ts`
  - `packages/1-framework/3-tooling/language-server/src/pipeline.ts`
  - `packages/1-framework/2-authoring/psl-parser/src/symbol-table.ts`
  - `packages/1-framework/2-authoring/psl-parser/test/symbol-table.test.ts`

## Operational metadata

- **Model tier:** `implementer/fast` — routine code edits within a slice; persistent across rounds in this slice.
- **Time-box:** 90 minutes wall clock. Overrun means halt and surface current state rather than broadening scope.
- **Halt conditions:**
  - Candidate extraction requires a new external contract-space symbol index.
  - Completing provider tests requires LSP request handling or configured-input server wiring.
  - Generic block, ordinary attribute, relation-aware, or parser behavior work appears necessary.
  - Validation gates fail for reasons that look unrelated to this dispatch.

## Validation gates

- `pnpm --filter @prisma-next/language-server test`
- `pnpm --filter @prisma-next/language-server typecheck`
- `pnpm --filter @prisma-next/language-server lint`
