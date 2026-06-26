# Slice plan: parser-red-tree-navigation

**Spec:** `projects/lsp-autocomplete/slices/parser-red-tree-navigation/spec.md`
**Parent project:** `projects/lsp-autocomplete/spec.md`

## Dispatch plan

### Dispatch 1: red-tree-cursor-navigation

- **Outcome:** The PSL parser red tree exposes navigable tokens (parent + previous/next), `SyntaxNode.tokenAtOffset` with left/right bias, a covering-element lookup, and trivia-skip helpers, all exported from `@prisma-next/psl-parser/syntax` and covered by unit tests.
- **Builds on:** The existing red/green tree, AST wrappers, and node-level navigation (`children`/`ancestors`/`prevSibling`/`tokens`).
- **Hands to:** A cursor-navigation API the completion classifier consumes in the next slice: from an offset, get the anchor token, its parent node, previous/next token, and nearest non-trivia neighbor.
- **Focus:** Thread the already-known parent through `wrapElement` into the red token; add token prev/next traversal; add `tokenAtOffset` (representing the between-two-tokens case with left/right bias) and covering-element lookup on `SyntaxNode`; add `skip_trivia_token` / `non_trivia_sibling` / `previous_non_trivia_token` equivalents; export the new surface; update any in-package `SyntaxToken` construction sites; write unit tests. Use rust-analyzer idioms when in doubt about API shape or helper implementation. Do **not** add fake-identifier reparsing, touch the language server, or change grammar/tokenizer.
- **Completed when:**
  - Red tokens expose their parent node and previous/next-token traversal.
  - `SyntaxNode.tokenAtOffset(offset)` exists, represents the between-two-tokens case, and offers left/right bias selectors; a covering-element lookup exists.
  - Non-trivia skip/sibling/previous helpers exist over the new token navigation.
  - New primitives are exported from `src/exports/syntax.ts` and covered by unit tests, including the between-tokens, zero-width-node, and EOF cases named in the slice spec.
- **Validation gates:**
  - `pnpm --filter @prisma-next/psl-parser test`
  - `pnpm --filter @prisma-next/psl-parser typecheck`
  - `pnpm --filter @prisma-next/psl-parser lint`
  - `pnpm --filter @prisma-next/psl-parser build` (refresh `dist/*.d.mts` consumed by the language server in the next slice)
  - Workspace guard for the changed token shape: `pnpm --filter @prisma-next/language-server typecheck` (must still pass; flags any token-shape break in the existing consumer)

## Dispatch-INVEST check

- **Independent:** Lands as one PR-able parser change; no concurrent sibling work required.
- **Negotiable:** Outcome (navigable tokens + offset queries + trivia helpers) is pinned; class-vs-free-function and exact selector names are the implementer's discovery, guided by rust-analyzer idioms.
- **Valuable:** Removes the root cause (non-navigable tokens) behind the completion classifier's whole-tree scans; reusable by hover/go-to-definition later.
- **Estimable:** Completed-when checklist is binary and test-backed.
- **Small:** One package, one coherent capability, no consumer rewrites; the language-server typecheck is a guard, not a migration.
- **Testable:** `psl-parser` unit tests plus the package gates verify it.

## Open items

None.
