import { describe, expect, it } from 'vitest';
import { GreenNodeBuilder } from '../../src/syntax/green-builder';
import { createSyntaxTree, SyntaxNode } from '../../src/syntax/red';

/** Builds a tree for: model User {\n  id Int @id\n} */
function buildSampleTree() {
  const b = new GreenNodeBuilder();
  b.startNode('Document');
  b.startNode('ModelDeclaration');
  b.token('Ident', 'model');
  b.token('Whitespace', ' ');
  b.startNode('Identifier');
  b.token('Ident', 'User');
  b.finishNode();
  b.token('Whitespace', ' ');
  b.token('LBrace', '{');
  b.token('Newline', '\n');
  b.token('Whitespace', '  ');
  b.startNode('FieldDeclaration');
  b.startNode('Identifier');
  b.token('Ident', 'id');
  b.finishNode();
  b.token('Whitespace', ' ');
  b.startNode('TypeAnnotation');
  b.token('Ident', 'Int');
  b.finishNode();
  b.token('Whitespace', ' ');
  b.startNode('FieldAttribute');
  b.token('At', '@');
  b.startNode('Identifier');
  b.token('Ident', 'id');
  b.finishNode();
  b.finishNode();
  b.finishNode();
  b.token('Newline', '\n');
  b.token('RBrace', '}');
  b.finishNode();
  return b.finishNode();
}

describe('createSyntaxTree', () => {
  it('wraps green root with offset 0 and no parent', () => {
    const green = buildSampleTree();
    const root = createSyntaxTree(green);
    expect(root.offset).toBe(0);
    expect(root.parent).toBeUndefined();
    expect(root.kind).toBe('Document');
  });
});

describe('SyntaxNode offset correctness', () => {
  it('computes correct offsets for all tokens', () => {
    const source = 'model User {\n  id Int @id\n}';
    const green = buildSampleTree();
    const root = createSyntaxTree(green);

    const tokens = Array.from(root.tokens());
    let expectedOffset = 0;
    for (const tok of tokens) {
      expect(tok.offset).toBe(expectedOffset);
      expectedOffset += tok.text.length;
    }
    expect(expectedOffset).toBe(source.length);
  });

  it('computes correct offset for nested nodes', () => {
    const green = buildSampleTree();
    const root = createSyntaxTree(green);

    // Document at 0
    expect(root.offset).toBe(0);

    // ModelDeclaration at 0
    const model = root.firstChild;
    expect(model).toBeInstanceOf(SyntaxNode);
    if (model instanceof SyntaxNode) {
      expect(model.offset).toBe(0);
      expect(model.kind).toBe('ModelDeclaration');
    }
  });
});

describe('SyntaxNode.parent', () => {
  it('root has undefined parent', () => {
    const root = createSyntaxTree(buildSampleTree());
    expect(root.parent).toBeUndefined();
  });

  it('child nodes point back to parent', () => {
    const root = createSyntaxTree(buildSampleTree());
    const model = root.firstChild;
    expect(model).toBeInstanceOf(SyntaxNode);
    if (model instanceof SyntaxNode) {
      expect(model.parent).toBe(root);
    }
  });
});

describe('SyntaxNode.firstChild / lastChild', () => {
  it('returns first and last children', () => {
    const root = createSyntaxTree(buildSampleTree());
    const model = root.firstChild;
    expect(model).toBeInstanceOf(SyntaxNode);
    expect(root.lastChild).toBeInstanceOf(SyntaxNode);
    // Document has only one child (ModelDeclaration), so first === last by green identity
    if (model instanceof SyntaxNode) {
      expect(model.kind).toBe('ModelDeclaration');
    }
  });

  it('returns undefined for empty node', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    const green = b.finishNode();
    const root = createSyntaxTree(green);
    expect(root.firstChild).toBeUndefined();
    expect(root.lastChild).toBeUndefined();
  });
});

describe('SyntaxNode.nextSibling / prevSibling', () => {
  it('navigates between siblings', () => {
    // Build a Document with two children: model identifier tokens
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    b.startNode('Identifier');
    b.token('Ident', 'A');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'B');
    b.finishNode();
    const green = b.finishNode();
    const root = createSyntaxTree(green);

    const first = root.firstChild;
    expect(first).toBeInstanceOf(SyntaxNode);
    if (first instanceof SyntaxNode) {
      const next = first.nextSibling;
      // next sibling should be a whitespace token
      expect(next).toBeDefined();
      expect(next).not.toBeInstanceOf(SyntaxNode);
      if (next && !(next instanceof SyntaxNode)) {
        expect(next.kind).toBe('Whitespace');
      }
    }
  });

  it('returns undefined for no sibling', () => {
    const root = createSyntaxTree(buildSampleTree());
    // Root has no parent, so no siblings
    expect(root.nextSibling).toBeUndefined();
    expect(root.prevSibling).toBeUndefined();
  });
});

describe('SyntaxNode.ancestors', () => {
  it('walks from node to root', () => {
    const root = createSyntaxTree(buildSampleTree());
    // Navigate: Document > ModelDeclaration > first child node
    const model = root.firstChild;
    expect(model).toBeInstanceOf(SyntaxNode);
    if (model instanceof SyntaxNode) {
      const ancestors = Array.from(model.ancestors());
      expect(ancestors).toHaveLength(1);
      expect(ancestors[0]).toBe(root);
    }
  });

  it('yields nothing for root', () => {
    const root = createSyntaxTree(buildSampleTree());
    const ancestors = Array.from(root.ancestors());
    expect(ancestors).toHaveLength(0);
  });
});

describe('SyntaxNode.descendants', () => {
  it('yields elements in depth-first pre-order', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    b.startNode('Identifier');
    b.token('Ident', 'A');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'B');
    b.finishNode();
    const green = b.finishNode();
    const root = createSyntaxTree(green);

    const kinds: string[] = [];
    for (const el of root.descendants()) {
      if (el instanceof SyntaxNode) {
        kinds.push(`node:${el.kind}`);
      } else {
        kinds.push(`token:${el.kind}`);
      }
    }

    expect(kinds).toEqual([
      'node:Document',
      'node:Identifier',
      'token:Ident', // A
      'token:Whitespace',
      'node:Identifier',
      'token:Ident', // B
    ]);
  });
});
