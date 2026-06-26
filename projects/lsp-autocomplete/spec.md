# lsp-autocomplete

## Purpose

Give PSL authors the first useful LSP autocomplete loop for schema authoring while validating the repo's cursor-context design against the existing recovered CST/AST. The project exists to prove completion can be built on the current parser, source-file, red-tree, and symbol-table artifacts without introducing speculative completion-marker reparsing.

## At a glance

The first autocomplete surface is intentionally narrow: when editing a configured PSL input, the language server classifies the cursor against the cached `DocumentAst`, `SourceFile`, and project `SymbolTable`, then routes to focused completion providers.

```prisma
model Post {
  author |
}
```

At a model field type position, completion suggests valid type names from the configured scalar set and known schema symbols such as models, composite types, scalar aliases, and type aliases. Qualified type positions are in scope: completion must handle bare `User`, namespace-qualified `auth.User`, and contract-space-qualified `supabase:auth.User` prefixes in the existing type-annotation grammar.

```prisma
datasource db {
  |
}
```

Inside a generic block, completion suggests descriptor-backed block entries/parameters for that block kind. In this spec, “generic block attributes” means the key/value-style generic block members represented by `GenericBlockDeclaration` / `KeyValuePairAst` and extension-block descriptors. Ordinary PSL `@` / `@@` field/model attributes are deliberately out of scope for this part.

At declaration positions, completion suggests top-level PSL block keywords and descriptor-backed generic block keywords. Document top level includes `model`, `type`, `types`, and `namespace`; namespace bodies include only namespace-valid declaration keywords such as `model`, `type`, and descriptor-backed generic block keywords. Completion items support snippet-capable clients while retaining plain-text fallbacks for clients that do not advertise snippet support.

The intended shape is:

```text
LSP completion position
  → configured PSL document check
  → SourceFile.offsetAt(position)
  → red-tree touching token / previous token / ancestor context
  → CompletionAnalysis
  → explicit provider dispatch
  → LSP CompletionItem[]
```

## Non-goals

- Ordinary PSL `@` / `@@` field or model attribute name completions.
- Attribute argument completions, including relation-specific argument completions.
- Relation-aware completions such as `fields`, `references`, or inverse relation suggestions.
- Completion for unopened configured inputs or cross-file project tables beyond the current cached project artifact shape.
- Speculative completion-marker reparsing.
- Hover, go-to-definition, semantic tokens, diagnostics redesign, or formatting changes.
- A complete ranking/scoring engine for completion entries beyond stable, useful ordering for the scoped providers.

## Place in the larger world

This project layers on the existing language-server and parser artifacts rather than replacing them.

- `packages/1-framework/3-tooling/language-server/src/server.ts` currently supports diagnostics and formatting. It also exposes `getDocumentAst()` and `getProjectSymbolTable()` as future-feature hooks.
- `packages/1-framework/3-tooling/language-server/src/project-artifacts.ts` preserves each open document's `DocumentAst` and `SourceFile`, plus one project `SymbolTable`.
- `packages/1-framework/3-tooling/language-server/src/pipeline.ts` runs `parse()` and `buildSymbolTable()` and documents that malformed input should not throw.
- `packages/1-framework/2-authoring/psl-parser/src/parse.ts` already has fault-tolerant recovery for block declarations, fields, type annotations, attributes, and generic block key/value entries. Its `parseTypeAnnotation()` consumes a `QualifiedName`, and `parseQualifiedName()` accepts `[space ':']? Ident ('.' Ident)*`, matching type references such as `auth.User` and `supabase:auth.User`.
- `packages/1-framework/2-authoring/psl-parser/src/syntax/red.ts` provides offsets, parents, ancestors, child iteration, descendants, and token iteration.
- `packages/1-framework/2-authoring/psl-parser/src/symbol-table.ts` provides model, composite type, scalar, type-alias, block, and field symbols that completion can reuse. The resolved field shape already splits type references into `typeName`, `typeNamespaceId`, and `typeContractSpaceId`, and reports `PSL_INVALID_QUALIFIED_TYPE` for over-qualified field types.
- Generic block entry completions depend on the `pslBlockDescriptors` already passed through the language-server control stack.

No contract or adapter impact is expected. This project changes editor tooling behavior only; it should not change emitted contracts, runtime behavior, migration output, or target adapters.

## Cross-cutting requirements

- Completion uses the existing cached parse artifacts for the open configured PSL input. It must not create a parallel parse pipeline for normal operation.
- Cursor classification is implemented as a pure, testable layer that maps `(document, sourceFile, offset, symbolTable, controlStack)` to a typed completion context.
- The classifier uses tsserver-style previous/current token handling where prefix typing matters, for example partial identifiers after a field name or inside a generic block.
- Provider routing is explicit. Completion providers should not independently rediscover syntactic context.
- Completion is available only for configured PSL inputs, matching the current diagnostics/formatting ownership rules.
- Diagnostics and formatting behavior remain unchanged while completion is added.
- The first provider set is limited to model field type completions, including namespace-qualified type positions, generic block entry/parameter completions, and declaration keyword completions at document top level and inside namespace bodies.
- Ordinary PSL `@` / `@@` attribute contexts must not accidentally receive the new generic block, model type, or declaration keyword suggestions.
- Tests are written before or alongside implementation changes.

## Transitional-shape constraints

- Do not introduce speculative completion-marker reparsing unless a concrete parser/AST gap is proven by a failing test that cannot be solved with red-tree cursor utilities.
- Parser or syntax export changes must be minimal and justified by completion’s cursor-context needs.
- Each intermediate slice keeps diagnostics and formatting tests green.
- The language server may advertise completion only once unsupported contexts safely return empty results rather than misleading suggestions.
- Generic block completions may initially be descriptor-name focused; richer value-specific completions can come later without changing the classifier shape.

## Project Definition of Done

- [ ] Team-DoD floor items inherited from `drive/calibration/dod.md`.
- [ ] The language server advertises completion support for configured PSL inputs without changing diagnostics or formatting behavior.
- [ ] Model field type positions complete configured scalar types plus visible model, composite type, scalar, and type-alias symbols from the current project symbol table, including namespace-qualified and contract-space-qualified type prefixes.
- [ ] Generic block entry/parameter positions complete descriptor-backed keys or values for the current `GenericBlockDeclaration` where descriptor data is available.
- [ ] Document top-level and namespace-body declaration positions complete scope-appropriate native PSL block keywords plus descriptor-backed generic block keywords, with snippet-capable and plain-text client behavior covered.
- [ ] Ordinary PSL `@` / `@@` field/model attribute contexts return no scoped suggestions from this project’s providers.
- [ ] Cursor-context classification has focused tests for blank model bodies, field-name prefixes, bare and namespace-qualified field-type positions, generic block blank lines, generic block partial keys, declaration keyword positions at document top level and inside namespace bodies, comments/trivia, and unsupported contexts.
- [ ] LSP/server tests cover completion requests against an open configured PSL document.
- [ ] Package documentation or README notes the supported completion scope and explicitly names the out-of-scope attribute surfaces.
- [ ] Validation gates for touched packages pass, including typecheck, lint, and relevant package tests.

## Open Questions

None.

## References

- Linear Project: not linked in this chat.
- Sibling / dependent projects: current language-server diagnostics and formatting surfaces.
- ADRs: N/A — no durable architectural shift expected beyond the local completion-context pattern.
- Code references:
  - `packages/1-framework/3-tooling/language-server/src/server.ts`
  - `packages/1-framework/3-tooling/language-server/src/project-artifacts.ts`
  - `packages/1-framework/3-tooling/language-server/src/pipeline.ts`
  - `packages/1-framework/2-authoring/psl-parser/src/parse.ts`
  - `packages/1-framework/2-authoring/psl-parser/src/syntax/red.ts`
  - `packages/1-framework/2-authoring/psl-parser/src/symbol-table.ts`
