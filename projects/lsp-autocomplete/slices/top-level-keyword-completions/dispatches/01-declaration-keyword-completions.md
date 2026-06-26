# Brief: declaration-keyword-completions

## Task

Implement top-level declaration keyword completions for configured PSL inputs in the language server. Extend the existing completion classifier/provider route so document-level declaration positions complete native PSL block keywords plus descriptor-backed generic block keywords, namespace-body declaration positions complete only namespace-valid native keywords plus descriptor-backed generic block keywords, and completion item insertion is snippet-capability gated with a plain-text fallback.

## Scope

**In:**

- Language-server tests first for classifier/provider/server behavior covering document-level and namespace-body declaration keyword completions.
- `packages/1-framework/3-tooling/language-server/src/completion-context.ts` declaration-position context, including blank and partial keyword prefixes and replacement range metadata.
- `packages/1-framework/3-tooling/language-server/src/completion-provider.ts` native keyword and descriptor-backed generic block keyword candidates, stable filtering/ordering, snippet/plain insertion variants, and unsupported-context routing.
- `packages/1-framework/3-tooling/language-server/src/server.ts` snippet-support detection from `InitializeParams.capabilities.textDocument?.completion?.completionItem?.snippetSupport === true` and threading into provider input.
- Server capability preservation, including `completionProvider.triggerCharacters: ['.']` if that is not already advertised for namespace-member completion.
- `packages/1-framework/3-tooling/language-server/README.md` documentation of top-level and namespace-body keyword completion scope, snippet capability gating, and explicit exclusions.

**Out:**

- Ordinary PSL `@` / `@@` field or model attribute name completions.
- Attribute argument completions.
- Generic block value completions.
- Relation-aware completions.
- Nested `namespace` or `types` keyword suggestions inside namespace bodies.
- Completion-marker reparsing or a second parser pass.
- Parser public API changes unless implementation proves the existing red-tree/AST surface is insufficient. If parser exports or generated declarations must change, halt and explain why before doing so.
- Reapplying or modifying unrelated local dirt, especially `apps/lsp-playground/src/client/runtime.ts`.

## Completed when

- [ ] Tests cover blank and partial document-level declaration keyword positions; blank and partial namespace-body declaration keyword positions; namespace-body exclusion of `namespace` and `types`; descriptor-backed generic block keyword candidates; snippet-supported output; plain-text fallback output; and ordinary `@` / `@@` attribute contexts returning no scoped keyword suggestions.
- [ ] The implementation derives and threads `clientSupportsSnippets` from initialize capabilities, emitting snippet items only when true and plain-text items otherwise.
- [ ] Existing model type completions, namespace member completions, generic block key completions, diagnostics, formatting, and folding-range behavior remain covered and green.
- [ ] README accurately documents the expanded completion scope and exclusions.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal — even if it looks useful — halts and surfaces.

## References

**Slice-loop dispatch:**

- Slice spec: `projects/lsp-autocomplete/slices/top-level-keyword-completions/spec.md`
- Slice plan entry: `projects/lsp-autocomplete/slices/top-level-keyword-completions/plan.md` § Dispatch 1: declaration-keyword-completions
- Parent project spec: `projects/lsp-autocomplete/spec.md`
- Parent project plan: `projects/lsp-autocomplete/plan.md`
- Code review log: `projects/lsp-autocomplete/reviews/code-review.md`
- Existing completion slice artifacts: `projects/lsp-autocomplete/slices/model-type-completions/`
- Linear issue: `TML-2947` — https://linear.app/prisma-company/issue/TML-2947/lsp-autocomplete-top-level-keyword-completions

**Code surfaces to inspect during pre-flight:**

- `packages/1-framework/3-tooling/language-server/src/completion-context.ts`
- `packages/1-framework/3-tooling/language-server/src/completion-provider.ts`
- `packages/1-framework/3-tooling/language-server/src/server.ts`
- `packages/1-framework/3-tooling/language-server/test/completion-context.test.ts`
- `packages/1-framework/3-tooling/language-server/test/completion-provider.test.ts`
- `packages/1-framework/3-tooling/language-server/test/server.test.ts`
- `packages/1-framework/3-tooling/language-server/README.md`

## Operational metadata

- **Model tier:** mid — one coherent language-server feature touching classifier/provider/server tests and docs, with snippet capability gating and namespace-specific behavior.
- **Time-box:** 90 minutes wall-clock. If this runs materially longer, pause and report the current state rather than expanding scope.
- **Halt conditions:** Halt if declaration-position detection cannot be implemented from existing cached parse artifacts; if parser public exports or generated parser declarations appear necessary; if ordinary PSL attributes or attribute arguments must be touched to complete this; if completion-marker reparsing seems necessary; if unrelated local changes block validation; or if validation failures appear unrelated to this dispatch and cannot be isolated.

## Validation gates

- `pnpm --filter @prisma-next/language-server test`
- `pnpm --filter @prisma-next/language-server typecheck`
- `pnpm --filter @prisma-next/language-server lint`
- If parser exports or generated parser declarations are changed after an explicit halt/approval: `pnpm --filter @prisma-next/psl-parser build`, then rerun the language-server gates.
