import type { Token, TokenKind } from '../tokenizer';
import { SyntaxNode } from './red';

export interface AstNode {
  readonly syntax: SyntaxNode;
}

export function findChildToken(node: SyntaxNode, kind: TokenKind): Token | undefined {
  for (const child of node.children()) {
    if (!(child instanceof SyntaxNode) && child.kind === kind) {
      return child;
    }
  }
  return undefined;
}

export function findFirstChild<T>(
  node: SyntaxNode,
  cast: (node: SyntaxNode) => T | undefined,
): T | undefined {
  for (const child of node.childNodes()) {
    const result = cast(child);
    if (result !== undefined) return result;
  }
  return undefined;
}

export function* filterChildren<T>(
  node: SyntaxNode,
  cast: (node: SyntaxNode) => T | undefined,
): Iterable<T> {
  for (const child of node.childNodes()) {
    const result = cast(child);
    if (result !== undefined) yield result;
  }
}

/**
 * Raw source text of a CST node — the concatenated token text it spans, which
 * reproduces the source slice. Leaf nodes carry no leading/trailing trivia, so
 * the result is already trimmed; quotes, brackets, and qualifiers are preserved
 * verbatim. Callers that want the decoded string value of a string literal
 * should decode it instead; `printSyntax` is for the cases that need the
 * unmodified source slice.
 */
export function printSyntax(node: SyntaxNode): string {
  let text = '';
  for (const token of node.tokens()) {
    text += token.text;
  }
  return text;
}
