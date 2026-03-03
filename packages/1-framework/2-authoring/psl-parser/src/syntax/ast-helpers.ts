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
