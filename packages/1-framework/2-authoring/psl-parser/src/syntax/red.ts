import type { Token } from '../tokenizer';
import type { GreenElement, GreenNode } from './green';
import type { SyntaxKind } from './syntax-kind';

/**
 * A token in the red tree. Unlike the green-layer {@link Token} (kind + text
 * only), a red token also carries its absolute `offset` within the source,
 * computed lazily as the tree is walked.
 */
export interface SyntaxToken extends Token {
  readonly offset: number;
}

export type SyntaxElement = SyntaxNode | SyntaxToken;

export class SyntaxNode {
  readonly green: GreenNode;
  readonly offset: number;
  readonly parent: SyntaxNode | undefined;

  constructor(green: GreenNode, offset: number, parent: SyntaxNode | undefined) {
    this.green = green;
    this.offset = offset;
    this.parent = parent;
  }

  get kind(): SyntaxKind {
    return this.green.kind;
  }

  get textLength(): number {
    return this.green.textLength;
  }

  get firstChild(): SyntaxElement | undefined {
    return childAt(this, 0);
  }

  get lastChild(): SyntaxElement | undefined {
    const len = this.green.children.length;
    if (len === 0) return undefined;
    return childAt(this, len - 1);
  }

  get nextSibling(): SyntaxElement | undefined {
    if (!this.parent) return undefined;
    const siblings = this.parent.green.children;
    let offset = this.parent.offset;
    let found = false;
    for (const child of siblings) {
      if (found) {
        return wrapElement(child, offset, this.parent);
      }
      const childLen = elementTextLength(child);
      if (child.type === 'node' && offset === this.offset && child === this.green) {
        found = true;
      }
      offset += childLen;
    }
    return undefined;
  }

  get prevSibling(): SyntaxElement | undefined {
    if (!this.parent) return undefined;
    const siblings = this.parent.green.children;
    let offset = this.parent.offset;
    let prev: { green: GreenElement; offset: number } | undefined;
    for (const child of siblings) {
      if (child.type === 'node' && offset === this.offset && child === this.green) {
        if (!prev) return undefined;
        return wrapElement(prev.green, prev.offset, this.parent);
      }
      prev = { green: child, offset };
      offset += elementTextLength(child);
    }
    return undefined;
  }

  *children(): Iterable<SyntaxElement> {
    let offset = this.offset;
    for (const child of this.green.children) {
      yield wrapElement(child, offset, this);
      offset += elementTextLength(child);
    }
  }

  *childNodes(): Iterable<SyntaxNode> {
    for (const child of this.children()) {
      if (child instanceof SyntaxNode) yield child;
    }
  }

  *ancestors(): Iterable<SyntaxNode> {
    let current: SyntaxNode | undefined = this.parent;
    while (current) {
      yield current;
      current = current.parent;
    }
  }

  *descendants(): Iterable<SyntaxElement> {
    const stack: SyntaxElement[] = [this];
    for (let el = stack.pop(); el !== undefined; el = stack.pop()) {
      yield el;
      if (el instanceof SyntaxNode) {
        const children = Array.from(el.children());
        for (let i = children.length - 1; i >= 0; i--) {
          const child = children[i];
          if (child !== undefined) {
            stack.push(child);
          }
        }
      }
    }
  }

  *tokens(): Iterable<SyntaxToken> {
    for (const el of this.descendants()) {
      if (!(el instanceof SyntaxNode)) {
        yield el;
      }
    }
  }
}

function elementTextLength(el: GreenElement): number {
  return el.type === 'token' ? el.text.length : el.textLength;
}

function wrapElement(green: GreenElement, offset: number, parent: SyntaxNode): SyntaxElement {
  if (green.type === 'token') {
    const token: SyntaxToken = { kind: green.kind, text: green.text, offset };
    return token;
  }
  return new SyntaxNode(green, offset, parent);
}

function childAt(node: SyntaxNode, index: number): SyntaxElement | undefined {
  const children = node.green.children;
  const target = children[index];
  if (target === undefined) return undefined;
  let offset = node.offset;
  for (let i = 0; i < index; i++) {
    const child = children[i];
    if (child !== undefined) {
      offset += elementTextLength(child);
    }
  }
  return wrapElement(target, offset, node);
}

export function createSyntaxTree(green: GreenNode): SyntaxNode {
  return new SyntaxNode(green, 0, undefined);
}
