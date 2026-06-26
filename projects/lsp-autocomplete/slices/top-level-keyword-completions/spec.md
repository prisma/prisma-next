# Slice: top-level-keyword-completions

Parent project: `projects/lsp-autocomplete/`. This slice contributes declaration-keyword completion for configured PSL inputs at document top level and inside namespace bodies.

## At a glance

Configured PSL documents answer `textDocument/completion` where the cursor is positioned to start a block declaration. The slice adds native PSL declaration keywords, descriptor-backed generic block keywords, namespace-body filtering, and snippet/plain-text insertion variants gated by client completion capabilities.

## Chosen design

The existing completion route remains the only LSP entry point. This slice extends the classifier/provider seam with a declaration-keyword context instead of adding a second completion path:

```text
textDocument/completion
  → configured PSL input check
  → cached DocumentAst / SourceFile / SymbolTable lookup
  → SourceFile.offsetAt(position)
  → completion context analysis over the existing red tree + AST ancestors
  → declaration-keyword provider
  → CompletionItem[]
```

The classifier recognizes declaration positions in two scopes:

| Scope | Completion position | Native keyword candidates |
| --- | --- | --- |
| `document` | top-level document body | `model`, `type`, `types`, `namespace` |
| `namespace` | direct body of a `namespace` declaration | `model`, `type` |

Both scopes also include descriptor-backed generic PSL block keywords from `project.controlStack.pslBlockDescriptors`. Namespace-body completion deliberately excludes nested `namespace` and `types` because the parser diagnoses those inside namespaces even though recovery may still produce nodes for invalid syntax.

Prefix handling follows the existing tsserver-style previous/current token shape already used by model type and generic block completions: blank declaration positions have an empty prefix, partial identifiers like `mo|` filter to matching declaration keywords, and replacement starts at the beginning of the typed keyword prefix. Comments, model fields, ordinary PSL `@` / `@@` attributes, attribute arguments, type positions, and generic block member positions stay unsupported for this provider.

The provider emits the same labels in both insertion modes, but insertion detail is capability-gated:

- When `clientSupportsSnippets` is `true`, block keywords use `InsertTextFormat.Snippet` and snippets place the final cursor inside the new block body, for example `model ${1:Name} {\n  $0\n}`.
- When `clientSupportsSnippets` is `false`, the server returns plain-text completion items with no snippet syntax.

The language server derives `clientSupportsSnippets` from `InitializeParams.capabilities.textDocument?.completion?.completionItem?.snippetSupport === true` and threads that boolean into the completion provider input. This keeps CodeMirror-style clients that do not advertise snippet support on plain text while allowing snippet-capable editors to place the cursor inside completed blocks.

The existing namespace-member completion flow should remain intact. If the server capability does not already advertise `.` as a completion trigger character, this slice may add `triggerCharacters: ['.']` while preserving completion behavior for clients that invoke completion manually.

## Coherence rationale

This is one reviewable slice because declaration-position classification, keyword candidate selection, and snippet/plain insertion are one user-visible completion surface. Splitting snippets into a separate slice would ship the new keyword provider in the wrong insertion shape for snippet-capable clients, while folding ordinary attribute completions into this slice would add a separate syntactic domain and break the project's non-goals.

## Scope

**In:**

- Declaration-keyword completion contexts at document top level and direct namespace-body declaration positions.
- Native PSL declaration keyword candidates for each scope.
- Descriptor-backed generic block keyword candidates from `pslBlockDescriptors` in both document and namespace scopes.
- Prefix filtering and replacement ranges for blank and partial declaration keywords.
- Snippet completion items when the client advertises snippet support.
- Plain-text fallback completion items when snippets are not supported.
- Threading client snippet capability from LSP initialize state to completion provider input.
- Tests for classifier/provider/server behavior and README updates for the expanded completion scope.

**Out:**

- Ordinary PSL `@` / `@@` field or model attribute name completions.
- Attribute argument completions.
- Generic block value completions beyond descriptor-backed block/key surfaces already in scope for the project.
- Relation-aware completions.
- Nested namespace or `types` suggestions inside namespace bodies.
- Completion-marker reparsing.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Namespace-body native keyword set differs from document top-level keyword set. | In scope. | `model`, `type`, and descriptor-backed generic blocks are namespace-valid; `namespace` and `types` are document-only suggestions for this slice. |
| Snippet support varies by LSP client. | In scope. | Snippet syntax must be gated by the initialize capability and have a plain-text fallback. |

## Slice-specific done conditions

- [ ] Configured PSL completion suggests document-level and namespace-body declaration keywords with scope-appropriate filtering.
- [ ] Snippet-capable clients receive snippet insertion items, and non-snippet clients receive plain-text insertion items for the same keyword labels.
- [ ] The slice does not add ordinary PSL `@` / `@@` attribute completions or completion-marker reparsing.

## Open Questions

None.

## References

- Parent project: `projects/lsp-autocomplete/spec.md`
- Project plan: `projects/lsp-autocomplete/plan.md`
- Linear issue: [TML-2947](https://linear.app/prisma-company/issue/TML-2947/lsp-autocomplete-top-level-keyword-completions)
- Existing completion slice: `projects/lsp-autocomplete/slices/model-type-completions/`
- Relevant code surfaces:
  - `packages/1-framework/3-tooling/language-server/src/completion-context.ts`
  - `packages/1-framework/3-tooling/language-server/src/completion-provider.ts`
  - `packages/1-framework/3-tooling/language-server/src/server.ts`
  - `packages/1-framework/3-tooling/language-server/test/completion-context.test.ts`
  - `packages/1-framework/3-tooling/language-server/test/completion-provider.test.ts`
  - `packages/1-framework/3-tooling/language-server/test/server.test.ts`
  - `packages/1-framework/3-tooling/language-server/README.md`
