# lsp-autocomplete — Plan

**Spec:** `projects/lsp-autocomplete/spec.md`
**Linear Project:** [Language Tools Support Prisma Next PSL](https://linear.app/prisma-company/project/language-tools-support-prisma-next-psl-3422a7e44b9c)

## At a glance

This project is a three-slice stack. Slice 1 lands the completion request path, shared cursor-context classifier, and first model-type provider; slice 2 reuses that hand-off to add descriptor-backed generic block entry/parameter completions; slice 3 extends the same classifier/provider seam with declaration keyword completions, including namespace-body filtering and snippet/plain insertion behavior.

## Composition

### Stack (deliver in order)

1. **Slice `model-type-completions`** — Linear: [TML-2946](https://linear.app/prisma-company/issue/TML-2946/lsp-autocomplete-model-type-completions)
   - **Outcome:** Configured PSL inputs answer `textDocument/completion` at model field type positions, including bare, namespace-qualified, and contract-space-qualified prefixes such as `User`, `auth.User`, and `supabase:auth.User`.
   - **Builds on:** Existing language-server diagnostics/formatting ownership, cached `DocumentAst` / `SourceFile` / `SymbolTable` project artifacts, and the parser's recovered `TypeAnnotation` / `QualifiedName` CST shape.
   - **Hands to:** A tested completion capability, request handler, cursor-context classifier, explicit provider dispatch shape, and model-type provider that unsupported contexts can safely bypass.
   - **Focus:** LSP completion wiring for configured PSL documents, pure cursor classification over existing parse artifacts, symbol-table-backed model field type suggestions, namespace-qualified type positions, and guardrails that keep ordinary `@` / `@@` attribute contexts empty.

2. **Slice `generic-block-completions`** — Linear: [TML-2945](https://linear.app/prisma-company/issue/TML-2945/lsp-autocomplete-generic-block-entry-completions)
   - **Outcome:** Configured PSL inputs answer `textDocument/completion` inside descriptor-backed generic PSL blocks for blank entry positions and partial keys/parameters on the current `GenericBlockDeclaration`.
   - **Builds on:** Slice `model-type-completions`' completion handler, cursor-context classifier, provider dispatch shape, unsupported-context behavior, and access to the language-server control stack.
   - **Hands to:** The scoped first autocomplete surface described by the original project spec: model field type completions plus generic block entry/parameter completions, with ordinary PSL attributes still out of scope.
   - **Focus:** Using `pslBlockDescriptors`, `GenericBlockDeclarationAst`, `KeyValuePairAst`, and reconstructed block symbols to produce descriptor-backed generic block suggestions; documentation for supported and excluded completion contexts.

3. **Slice `top-level-keyword-completions`** — Linear: [TML-2947](https://linear.app/prisma-company/issue/TML-2947/lsp-autocomplete-top-level-keyword-completions)
   - **Outcome:** Configured PSL inputs answer `textDocument/completion` at document-level and namespace-body declaration keyword positions, with native PSL block keywords, descriptor-backed generic block keywords, and snippet/plain insertion variants gated by client capability.
   - **Builds on:** The established completion handler, cursor-context classifier, provider dispatch shape, generic block descriptor candidate source, and namespace-aware completion behavior already present on the branch.
   - **Hands to:** The expanded first autocomplete surface now includes model field type completions, generic block entry/parameter completions, and declaration keyword completions without adding ordinary PSL attribute completions.
   - **Focus:** Declaration-position classification; document-vs-namespace native keyword sets; descriptor-backed generic block keyword suggestions; snippet support derived from LSP initialize capabilities; plain-text fallbacks for non-snippet clients; README and guardrail tests.

### Parallel groups

None. All slices touch the same language-server completion route and classifier. The generic block and declaration keyword providers are simpler and safer once the model-type slice has established provider dispatch, unsupported-context semantics, and server request wiring.

## Dependencies (external)

- [x] Linear Project exists — [Language Tools Support Prisma Next PSL](https://linear.app/prisma-company/project/language-tools-support-prisma-next-psl-3422a7e44b9c), Terminal team.
- [x] Existing LSP scaffold exists — diagnostics and formatting already run through `packages/1-framework/3-tooling/language-server/src/server.ts` and cache project artifacts in `project-artifacts.ts`.
- [x] Existing parser/symbol substrate exists — `parseTypeAnnotation()` uses `QualifiedName`, `SourceFile` maps offsets, red-tree nodes expose offsets/parents/ancestors/tokens, and `buildSymbolTable()` exposes model/composite/scalar/type-alias/block symbols.
- [x] Existing generic block descriptor path exists — `pslBlockDescriptors` is resolved into the language-server control stack and `BlockSymbol.block` is reconstructed from `GenericBlockDeclarationAst`.
- [x] Linear slice issue exists for declaration keyword completion — [TML-2947](https://linear.app/prisma-company/issue/TML-2947/lsp-autocomplete-top-level-keyword-completions), Terminal team.

## Sequencing rationale

The only real dependency is the shared completion route and cursor-context classifier. Model type completions are the narrower end-to-end slice because they depend on existing `TypeAnnotation` / `QualifiedName` and symbol-table shapes but do not need descriptor-specific block semantics. Generic block completions then consume the established request path and classifier, adding descriptor-backed context handling without reopening the LSP wiring decision. Declaration keyword completions build last because they reuse both the classifier/provider dispatch seam and the generic block descriptor candidate source while adding LSP snippet capability threading.

The slices are not parallelized because they would otherwise make independent edits to the same provider routing and unsupported-context behavior. Keeping them stacked avoids duplicate classifier designs and makes each later review about one syntactic domain rather than LSP plumbing.
