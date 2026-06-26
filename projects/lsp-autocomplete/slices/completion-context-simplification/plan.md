# Slice plan: completion-context-simplification

**Spec:** `projects/lsp-autocomplete/slices/completion-context-simplification/spec.md`
**Parent project:** `projects/lsp-autocomplete/spec.md`
**Depends on:** `projects/lsp-autocomplete/slices/parser-red-tree-navigation`

## Dispatch plan

### Dispatch 1: rewrite-classifier-on-navigation-api

- **Outcome:** `completion-context.ts` classifies from a single anchor token via parent/ancestor dispatch with one unified replacement-range helper, with the bespoke whole-tree token plumbing deleted and all existing language-server tests passing with unchanged behavior.
- **Builds on:** Slice `parser-red-tree-navigation`'s token-navigation API (`tokenAtOffset` + left/right bias, navigable tokens, non-trivia helpers).
- **Hands to:** A smaller, rust-analyzer-shaped completion classifier ready for PR review on the existing branch.
- **Focus:** Anchor on `tokenAtOffset(offset).leftBiased()` and navigate from `token.parent`; collapse the three `classifyX` re-derivations toward one parent/ancestor dispatch (using `closestAst` as the `match_ast!` analog); derive the edit range once from the anchor token like rust-analyzer's `source_range()`; delete `findCursorContext`, located-element/token bookkeeping, `tokensBetween`, `lineStartOffsetFromTokens`, `containsOnlyWhitespaceTokens`, and the duplicated prefix logic; re-express whitespace/line checks via the slice-A non-trivia helpers. Preserve completion semantics. Use rust-analyzer idioms when in doubt. Do **not** change the parser, add fake-identifier reparsing, or alter the already-landed server/playground changes.
- **Completed when:**
  - `completion-context.ts` no longer contains `findCursorContext`, `tokensBetween`, `lineStartOffsetFromTokens`, or `containsOnlyWhitespaceTokens`, and computes the edit range in one place.
  - Classification anchors on the navigation API rather than scanning `root.tokens()` from the document root.
  - The full language-server test suite passes with behavior unchanged; tests change only where they asserted removed internals.
- **Validation gates:**
  - `pnpm --filter @prisma-next/language-server test`
  - `pnpm --filter @prisma-next/language-server typecheck`
  - `pnpm --filter @prisma-next/language-server lint`

### Dispatch 2: derive-type-name-prefix-from-ast

- **Outcome:** `typeNamePrefix` derives the qualified type-name prefix (contract-space / namespace / name segments) from the `QualifiedNameAst` and segment token offsets instead of slicing raw source and re-scanning for `:` / `.`; `splitQualifiedPrefix` and its text-only helpers are deleted.
- **Builds on:** Dispatch 1's classifier and the parser's `QualifiedNameAst` API (`space()`, `namespace()`, `identifier()`, `path()`, `colon()`, `dot()`, `isOverQualified()`) plus segment `IdentifierAst` offsets.
- **Hands to:** A type-position classifier with no text re-tokenization of qualified names; the only source touch is the partial identifier segment under the cursor (one token's text truncated at the offset).
- **Focus:** Replace the `source.slice(...)` + `splitQualifiedPrefix` character scan with AST navigation over the qualified-name segments; determine which segments precede the cursor and which segment the cursor sits in from token ranges; read contract-space/namespace from `space()`/`namespace()` and the trailing-separator (`auth.|`, `space:|`) cases from the `dot()`/`colon()` tokens; keep the partial-segment text as a single-token slice. Preserve every existing qualified-prefix case. Do not change the parser or grammar.
- **Completed when:**
  - `splitQualifiedPrefix`, `pathFromSegments`, `segmentAt`, and any raw-source separator scanning are gone from `completion-context.ts`.
  - `typeNamePrefix` produces the same `TypeNamePrefix` results as today for bare `U`, `auth.`/`auth.U`, `space:`/`space:U`, `space:auth.`/`space:auth.U`, and over-qualified (rejected) inputs, sourced from the AST.
  - The full language-server test suite passes; tests are extended where a case was only implicitly covered.
- **Validation gates:**
  - `pnpm --filter @prisma-next/language-server test`
  - `pnpm --filter @prisma-next/language-server typecheck`
  - `pnpm --filter @prisma-next/language-server lint`

## Dispatch-INVEST check

- **Independent:** Single-file rewrite once slice A has landed; no concurrent work.
- **Negotiable:** Outcome (anchor-token + parent dispatch + unified range, bespoke plumbing gone) is pinned; exact dispatch structure is the implementer's discovery against rust-analyzer idioms.
- **Valuable:** Delivers the simplification the operator approved; removes the workaround code root-caused in slice A.
- **Estimable:** Completed-when is binary and test-backed.
- **Small:** One file, one package, behavior fixed by existing tests.
- **Testable:** The language-server suite plus package gates verify it.

## Open items

None.
