import type { TokenKind } from '../tokenizer';
import { SyntaxNode, type SyntaxToken } from './red';

export interface AstNode {
  readonly syntax: SyntaxNode;
}

export function findChildToken(node: SyntaxNode, kind: TokenKind): SyntaxToken | undefined {
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
 * Raw source text of a CST node, verbatim (quotes and brackets preserved). For
 * the decoded value of a string literal, decode it instead.
 */
export function printSyntax(node: SyntaxNode): string {
  let text = '';
  for (const token of node.tokens()) {
    text += token.text;
  }
  return text;
}
