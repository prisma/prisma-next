# Brief: cursor-classifier-substrate

## Task

Add the test-first cursor-classifier substrate for PSL completion in `@prisma-next/language-server`. The classifier must be pure and must identify model field type completion contexts from the existing cached parser artifacts (`DocumentAst`, `SourceFile`, red-tree syntax, AST ancestors) while returning an unsupported context for everything outside slice-1 scope.

## Scope

**In:**

- New language-server classifier module and focused tests.
- Offset conversion with `SourceFile.offsetAt(position)`.
- Touching/current/previous token or node lookup implemented locally in the language-server package using existing red-tree traversal APIs.
- Model field type context detection for blank type positions, partial bare types, namespace-qualified prefixes, and contract-space-qualified prefixes.
- Unsupported classification for ordinary `@` / `@@` attributes, attribute arguments, generic blocks, comments/trivia, constructor argument positions, unconfigured provider contexts, and invalid over-qualified names that are not valid type-prefix contexts.

**Out:**

- LSP `completionProvider` advertisement and `connection.onCompletion(...)` handler.
- Completion item generation and symbol-table candidate extraction.
- Generic block entry/parameter completions.
- Ordinary PSL attribute completions or attribute argument completions.
- Relation-aware completions.
- Completion-marker reparsing.
- Parser behavior changes or new public parser exports unless you halt and surface evidence that local language-server traversal cannot work.

## Completed when

- [ ] Classifier tests cover blank type, partial bare type, namespace-qualified prefix, contract-space-qualified prefix, comments/trivia, ordinary `@` / `@@` attributes, attribute arguments, generic block contexts, and unsupported contexts.
- [ ] The classifier exposes a typed context union that later dispatches can route to a model-type provider or `[]`.
- [ ] No completion-marker reparsing, parser behavior changes, or public parser exports are introduced.
- [ ] Validation gates pass or any blocker is surfaced with concrete evidence.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal — even if it looks useful — halts and surfaces.

## References

**Slice-loop dispatch:**

- Slice spec: `projects/lsp-autocomplete/slices/model-type-completions/spec.md`
- Slice plan entry: `projects/lsp-autocomplete/slices/model-type-completions/plan.md` § Dispatch 1: cursor-classifier-substrate
- Project spec / plan: `projects/lsp-autocomplete/spec.md`, `projects/lsp-autocomplete/plan.md`
- Code review log: `projects/lsp-autocomplete/reviews/code-review.md`
- Calibration: `drive/calibration/sizing.md` § Dispatch INVEST — specialised for this repo
- Relevant code surfaces from prior grounding:
  - `packages/1-framework/3-tooling/language-server/src/server.ts`
  - `packages/1-framework/3-tooling/language-server/src/project-artifacts.ts`
  - `packages/1-framework/3-tooling/language-server/src/pipeline.ts`
  - `packages/1-framework/3-tooling/language-server/test/server.test.ts`
  - `packages/1-framework/2-authoring/psl-parser/src/source-file.ts`
  - `packages/1-framework/2-authoring/psl-parser/src/syntax/red.ts`
  - `packages/1-framework/2-authoring/psl-parser/src/syntax/ast/declarations.ts`
  - `packages/1-framework/2-authoring/psl-parser/src/syntax/ast/type-annotation.ts`
  - `packages/1-framework/2-authoring/psl-parser/src/syntax/ast/qualified-name.ts`

## Operational metadata

- **Model tier:** `implementer/fast` — routine code edits within a slice; persistent across rounds in this slice.
- **Time-box:** 90 minutes wall clock. Overrun means halt and surface current state rather than broadening scope.
- **Halt conditions:**
  - A parser behavior change or new public parser export appears necessary.
  - Completing the classifier requires touching LSP request handling, completion item generation, generic block provider behavior, ordinary attribute completion, or relation-aware completion.
  - Existing parser recovery cannot represent one of the required contexts with current red-tree/AST artifacts.
  - Validation gates fail for reasons that look unrelated to this dispatch.

## Validation gates

- `pnpm --filter @prisma-next/language-server test`
- `pnpm --filter @prisma-next/language-server typecheck`
- `pnpm --filter @prisma-next/language-server lint`
