# Slice: model-type-completions

Parent project: `projects/lsp-autocomplete/`. This slice contributes the first end-to-end PSL completion surface: model field type completions for configured language-server inputs.

## At a glance

Configured PSL documents answer `textDocument/completion` at model field type positions. The slice establishes the shared completion capability, request handler, cursor-context classifier, provider dispatch seam, and model-type provider that the later generic-block slice can extend without reshaping the LSP route.

## Chosen design

The language server adds completion as another configured-input-only surface next to diagnostics and formatting. The request path is:

```text
textDocument/completion
  → open document lookup
  → configured PSL input check
  → cached DocumentAst / SourceFile / SymbolTable lookup
  → SourceFile.offsetAt(position)
  → completion context analysis over the existing red tree + AST ancestors
  → explicit provider dispatch
  → CompletionItem[]
```

Unsupported, unconfigured, missing-document, and missing-artifact cases return an empty completion list. Completion does not parse a second copy of the document with a marker inserted.

The classifier is a pure layer in the language-server package. It uses `SourceFile.offsetAt(position)`, red-tree offsets/tokens/ancestors, `FieldDeclarationAst.typeAnnotation()`, `TypeAnnotationAst.name()`, and `QualifiedNameAst` to identify model field type contexts. It recognizes blank and partial type positions such as:

```prisma
model Post {
  author |
  reviewer U|
  owner auth.|
  editor auth.U|
  external supabase:|
  externalUser supabase:auth.|
}
```

The classifier explicitly rejects ordinary PSL `@` / `@@` attributes, attribute arguments, generic blocks, comments/trivia, constructor argument positions, and malformed over-qualified names that are not valid type-prefix contexts. This rejection is required because parser recovery can keep attribute syntax under nearby field structure; a field ancestor alone is not enough to classify a cursor as a type position.

Provider dispatch is explicit. Slice 1 has one productive provider:

| Context | Provider behavior |
| --- | --- |
| model field type position | Complete configured scalar types plus visible model, composite type, scalar, and type-alias symbols from the current project symbol table. |
| unsupported context | Return `[]`. |

The model-type provider reads candidates from the configured scalar type set and the current `SymbolTable`: top-level models, composite types, scalars, type aliases, and namespace models/composite types. It ignores generic block symbols and does not provide relation-aware suggestions. Qualified prefixes preserve the user’s syntactic shape: bare `User`, namespace-qualified `auth.User`, and contract-space-qualified `supabase:auth.User` positions are classified and filtered as type positions. This slice does not invent a new external contract-space symbol index; contract-space-qualified completions use the visible candidate data already available to the language server.

The server test harness grows a completion request helper analogous to the existing diagnostics/formatting helpers. Server tests cover capability advertisement and configured/unconfigured document behavior.

## Coherence rationale

This is one reviewable PR because the capability, classifier, provider dispatch seam, and first provider are one end-to-end feature path. Splitting the LSP route from the model-type provider would ship a completion capability with no useful completion behavior, while bundling generic block descriptor semantics would add a second syntactic domain and exceed the slice’s review coherence.

## Scope

**In:**

- `packages/1-framework/3-tooling/language-server` completion capability and request handler.
- A pure language-server cursor-context classifier over cached `DocumentAst`, `SourceFile`, red-tree syntax, and the current `SymbolTable`.
- Model field type completion provider backed by configured scalar types and visible type-like symbol-table entries.
- Bare, namespace-qualified, and contract-space-qualified type-position classification and prefix filtering.
- Empty results for unsupported contexts, unconfigured documents, missing documents, and unavailable artifacts.
- Focused classifier/provider/server tests for model type positions and unsupported contexts.
- Language-server README update for the newly supported narrow completion scope.

**Out:**

- Generic block entry/parameter completions; those belong to slice `generic-block-completions`.
- Ordinary PSL `@` / `@@` attribute name completions.
- Attribute argument completions.
- Relation-aware completions such as `fields`, `references`, inverse relation suggestions, or field-specific relation ranking.
- A new external contract-space symbol index beyond the language server’s current project artifacts.
- Parser-wide public cursor helper exports unless implementation proves a local language-server helper is insufficient.
- Completion-marker reparsing.

## Pre-investigated edge cases

**None pre-investigated from outside the codebase.** The known code-grounded constraints are captured in the chosen design; new edge cases that surface at dispatch time amend the spec via `drive-discussion` per invariant I12.

## Slice-specific done conditions

- [ ] The completed slice leaves a typed classifier/provider dispatch seam that `generic-block-completions` can extend without changing the LSP request handler.
- [ ] Language-server documentation no longer says completion is wholly out of scope and does not overclaim generic block, ordinary attribute, relation-aware, or external contract-space candidate support.

## Open Questions

None.

## References

- Parent project: `projects/lsp-autocomplete/spec.md`
- Project plan: `projects/lsp-autocomplete/plan.md`
- Linear issue: [TML-2946](https://linear.app/prisma-company/issue/TML-2946/lsp-autocomplete-model-type-completions)
- Relevant code surfaces:
  - `packages/1-framework/3-tooling/language-server/src/server.ts`
  - `packages/1-framework/3-tooling/language-server/src/project-artifacts.ts`
  - `packages/1-framework/3-tooling/language-server/src/pipeline.ts`
  - `packages/1-framework/3-tooling/language-server/test/server.test.ts`
  - `packages/1-framework/2-authoring/psl-parser/src/source-file.ts`
  - `packages/1-framework/2-authoring/psl-parser/src/syntax/red.ts`
  - `packages/1-framework/2-authoring/psl-parser/src/syntax/ast/declarations.ts`
  - `packages/1-framework/2-authoring/psl-parser/src/syntax/ast/type-annotation.ts`
  - `packages/1-framework/2-authoring/psl-parser/src/syntax/ast/qualified-name.ts`
  - `packages/1-framework/2-authoring/psl-parser/src/symbol-table.ts`
