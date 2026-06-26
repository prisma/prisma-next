# Slice spec: completion-context-simplification

**Parent project:** `projects/lsp-autocomplete/spec.md`
**Depends on:** `projects/lsp-autocomplete/slices/parser-red-tree-navigation` (its token-navigation API)

## At a glance

`packages/1-framework/3-tooling/language-server/src/completion-context.ts` currently reconstructs cursor context the hard way: `findCursorContext` scans `root.tokens()` from the document root, and helpers (`tokensBetween`, `lineStartOffsetFromTokens`, `containsOnlyWhitespaceTokens`) re-scan tokens or reason over offsets to answer "what is left of the cursor" and "is there only indentation here". rust-analyzer answers the same questions by anchoring on one token and walking the tree: `token_at_offset(offset).left_biased()`, then `token.parent()`, then a single `match_ast!` dispatch over the parent/ancestor type, with the edit range derived once from the anchor token (`source_range()`).

This slice rewrites the classifier onto the navigation API delivered by the `parser-red-tree-navigation` slice, matching rust-analyzer's shape. Behavior is unchanged; the existing classifier/provider/server tests are the guardrail.

## Chosen design

- **Single anchor token.** Replace `findCursorContext`'s from-root scan with `tokenAtOffset(offset).leftBiased()` and navigate from the token's parent. Mirror rust-analyzer's `original_token` + `token.parent()` entry.
- **Parent/ancestor dispatch.** Collapse the independent re-derivations in `classifyDeclarationKeyword` / `classifyGenericBlockParameter` / `classifyModelFieldType` toward one dispatch keyed on the anchor's parent/ancestor AST type, mirroring `classify_name_ref`'s `match_ast!`. The existing `closestAst(node, …Ast.cast)` is our `match_ast!` analog.
- **One replacement-range helper.** Derive the edit range once from the anchor token — identifier/keyword token ⇒ its range; otherwise an empty range at the cursor — mirroring `source_range()`. Remove the three separate prefix-slice computations.
- **Trivia/line checks via navigation.** Replace `containsOnlyWhitespaceTokens` / `lineStartOffsetFromTokens` / `tokensBetween` with the slice-A non-trivia/sibling/previous-token helpers.
- **No fake identifier.** Keep relying on the error-tolerant single parse.

## Coherence rationale

One file rewrite in one package, with the existing language-server test suite (completion-context, completion-provider, server) holding behavior fixed. One reviewer can confirm "same behavior, rust-analyzer shape, bespoke plumbing deleted" in one sitting.

## Scope

**In:**

- `packages/1-framework/3-tooling/language-server/src/completion-context.ts` — rewrite onto the navigation API; delete `findCursorContext`, located-element/token bookkeeping, `tokensBetween`, `lineStartOffsetFromTokens`, `containsOnlyWhitespaceTokens`, and the duplicated prefix/replacement-range logic.
- `completion-provider.ts` only if the context's public shape changes (e.g. a unified replacement range now travels on the context).
- Existing language-server tests updated only where they assert removed internals; behavior assertions must stay.

**Deliberately out:**

- New completion *features* or semantics (model/namespace/generic-block/declaration-keyword behavior is fixed).
- Parser changes (those are slice A; if a gap appears, halt and route back, do not patch the parser here).
- Fake-identifier reparsing.
- Server stale-artifact refresh and playground changes already landed earlier on the branch.

## Pre-investigated edge cases

| Case | Note |
| --- | --- |
| Empty type position `author |` | Must remain a `modelFieldType` context; previously relied on `containsOnlyWhitespaceTokens`. Re-express via non-trivia navigation, not text scan. |
| `author\n  |` and `author // |` | Must remain unsupported; the previous-non-trivia-token / newline-trivia distinction now comes from navigation helpers. |
| Declaration keyword after another token on the same line (`model User {} mo|`) | Must remain unsupported; comes from the previous-non-trivia-token, not a line scan. |

## Slice-specific done conditions

- The bespoke whole-tree token plumbing named above is gone, and the full language-server test suite passes unchanged in behavior.

## Open questions

None.

## References

- `packages/1-framework/3-tooling/language-server/src/completion-context.ts` — current classifier.
- `packages/1-framework/3-tooling/language-server/test/completion-context.test.ts` — behavior guardrail.
- rust-analyzer `crates/ide-completion/src/context.rs` (`source_range`, `original_token`) and `context/analysis.rs` (`classify_name_ref`, `match_ast!`) — idiom reference.
