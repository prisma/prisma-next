# Slice spec: parser-red-tree-navigation

**Parent project:** `projects/lsp-autocomplete/spec.md`

## At a glance

The PSL parser red tree (`packages/1-framework/2-authoring/psl-parser/src/syntax/red.ts`) currently lets you walk *down and across nodes* (`children`, `childNodes`, `ancestors`, `firstChild`, `lastChild`, `nextSibling`, `prevSibling`, `descendants`, `tokens`) but tokens are dead ends: `wrapElement` returns a bare `SyntaxToken` of shape `{ kind, text, offset }` with no link back to its parent, and there is no offset-query entry point. As a result the language-server completion classifier reconstructs token context by scanning `root.tokens()` from the document root and by reasoning over raw source text.

This slice adds the rust-analyzer-style navigation primitives that make a cursor position a first-class, locally-navigable thing, so downstream tooling (completion now; hover/go-to-definition later) can start from a token and walk outward instead of re-scanning the whole tree.

## Chosen design

Adopt rust-analyzer's `syntax` navigation idioms, with one explicit exception: we do **not** adopt the fake-identifier completion marker. Our parser is error-tolerant and macro-free, so an empty position already yields usable nodes.

Concretely:

- **Navigable tokens.** Give the red token a link to its parent `SyntaxNode` and previous/next-token traversal. Follow rust-analyzer, where `SyntaxToken` carries its parent and offers `prev_token()` / `next_token()`. The parent is already known inside `wrapElement` (it is currently discarded) — thread it through rather than recomputing.
- **Offset queries on `SyntaxNode`.** Add `tokenAtOffset(offset)` mirroring rust-analyzer's `TokenAtOffset` (the between-two-tokens case must be representable, with `leftBiased()` / `rightBiased()` selectors), and a covering-element lookup mirroring `covering_element(range)`.
- **Trivia-skipping helpers.** Provide the equivalents of rust-analyzer's `skip_trivia_token` / `non_trivia_sibling` / `previous_non_trivia_token`, expressed over the new token navigation. Trivia kinds are the existing `Whitespace` / `Newline` / `Comment`.
- **Export surface.** Re-export the new types/functions from `@prisma-next/psl-parser/syntax` (`src/exports/syntax.ts`), where `SyntaxNode` / `SyntaxToken` / `SyntaxElement` already live.

Implementation shape (class vs free functions, exact selector names) is the implementer's call — follow rust-analyzer idioms where in doubt.

## Coherence rationale

One reviewer can hold this in a sitting: it is a single capability ("the red tree is cursor-navigable and offset-queryable") landing in one package with unit tests, no consumer rewrites. The completion rewrite that consumes it is a separate slice, so this slice's diff stays about the parser substrate only.

## Scope

**In:**

- `packages/1-framework/2-authoring/psl-parser/src/syntax/red.ts` — token parent linkage, token prev/next traversal, `tokenAtOffset`, covering element.
- A trivia/navigation helper home (new file under `syntax/`, or additions to `ast-helpers.ts`/`red.ts` — implementer's call).
- `packages/1-framework/2-authoring/psl-parser/src/exports/syntax.ts` — export the new surface.
- Unit tests in `psl-parser` covering the new primitives.
- Any in-package construction sites of `SyntaxToken` updated for the new shape.

**Deliberately out:**

- Any change to `completion-context.ts` or the language server (that is the next slice).
- Fake-identifier / completion-marker reparsing.
- Grammar, tokenizer, or green-tree changes beyond what token-parent linkage strictly requires.
- Performance work beyond not regressing the existing single-pass cost.

## Pre-investigated edge cases

| Case | Note |
| --- | --- |
| Cursor between two tokens (e.g. `foo|bar` boundary, or at a token seam) | `tokenAtOffset` must represent the two-token case and offer left/right bias, like rust-analyzer's `TokenAtOffset::Between`. The completion slice depends on `leftBiased()`. |
| Zero-width / empty nodes | `containsOffset` already special-cases `textLength === 0`; covering-element and `tokenAtOffset` must stay consistent with that rule. |
| EOF / offset at end of file | Left-biased lookup must still return the final significant token. |

## Slice-specific done conditions

- A consumer can, from an offset, obtain the anchor token and walk to its parent node, previous/next token, and nearest non-trivia neighbor without scanning from the document root.

## Open questions

None.

## References

- `packages/1-framework/2-authoring/psl-parser/src/syntax/red.ts` — current red tree.
- `packages/1-framework/2-authoring/psl-parser/src/syntax/ast-helpers.ts` — existing `findChildToken` / `filterChildren` helpers.
- `packages/1-framework/2-authoring/psl-parser/src/exports/syntax.ts` — export barrel.
- rust-analyzer `crates/syntax` (`SyntaxToken`, `TokenAtOffset`, `algo::{skip_trivia_token, non_trivia_sibling, previous_non_trivia_token}`) — idiom reference.
