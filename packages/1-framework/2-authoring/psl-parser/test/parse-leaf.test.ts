import { describe, expect, it } from 'vitest';
import {
  createParserCursor,
  type ParseDiagnostic,
  parseAttribute,
  parseAttributeArg,
  parseAttributeArgList,
  parseExpression,
  parseTypeAnnotation,
  pullTokens,
} from '../src/parse';
import type { GreenElement, GreenNode } from '../src/syntax/green';
import { GreenNodeBuilder } from '../src/syntax/green-builder';

function greenText(element: GreenElement): string {
  if (element.type === 'token') return element.text;
  return element.children.map(greenText).join('');
}

describe('pullTokens', () => {
  it('keeps trivia, Invalid, and the terminating Eof with absolute per-token offsets', () => {
    const source = 'a  b\n§';
    const { tokens, offsets } = pullTokens(source);
    expect(tokens.map((t) => t.kind)).toEqual([
      'Ident',
      'Whitespace',
      'Ident',
      'Newline',
      'Invalid',
      'Eof',
    ]);
    expect(offsets).toEqual([0, 1, 3, 4, 5, 6]);
    for (let i = 0; i < tokens.length; i++) {
      expect(source.slice(offsets[i], offsets[i]! + tokens[i]!.text.length)).toBe(tokens[i]!.text);
    }
  });
});

describe('peekKind', () => {
  it('reports upcoming significant kinds without consuming or emitting trivia', () => {
    const cursor = createParserCursor('  model User');
    expect(cursor.peekKind()).toBe('Ident');
    expect(cursor.peekKind(1)).toBe('Ident');
    // repeated peeks are stable — nothing was consumed
    expect(cursor.peekKind()).toBe('Ident');
    expect(cursor.diagnostics).toHaveLength(0);

    cursor.startNode('Document');
    cursor.bump();
    const doc = cursor.finishNode();
    // the leading whitespace skipped by peek is still present once we bump
    expect(doc.children[0]).toEqual({ type: 'token', kind: 'Whitespace', text: '  ' });
    expect(doc.children[1]).toEqual({ type: 'token', kind: 'Ident', text: 'model' });
  });
});

describe('recoverToSyncPoint', () => {
  it('appends raw tokens up to the next Newline and stops before it', () => {
    const cursor = createParserCursor('broken stuff\nnext');
    cursor.startNode('Document');
    cursor.recoverToSyncPoint();
    const node = cursor.finishNode();
    expect(greenText(node)).toBe('broken stuff');
    expect(cursor.peekKind()).toBe('Ident');
  });

  it('stops before the enclosing RBrace', () => {
    const cursor = createParserCursor('junk}');
    cursor.startNode('Document');
    cursor.recoverToSyncPoint();
    const node = cursor.finishNode();
    expect(greenText(node)).toBe('junk');
    expect(cursor.peekKind()).toBe('RBrace');
  });

  it('stops at Eof', () => {
    const cursor = createParserCursor('only garbage here');
    cursor.startNode('Document');
    cursor.recoverToSyncPoint();
    const node = cursor.finishNode();
    expect(greenText(node)).toBe('only garbage here');
    expect(cursor.peekKind()).toBe('Eof');
  });
});

function parse(source: string, run: (cursor: ReturnType<typeof createParserCursor>) => GreenNode) {
  const cursor = createParserCursor(source);
  const node = run(cursor);
  return { node, diagnostics: cursor.diagnostics, cursor };
}

describe('parseAttribute well-formed', () => {
  it('parses a simple field attribute', () => {
    const source = '@id';
    const { node, diagnostics } = parse(source, parseAttribute);

    const b = new GreenNodeBuilder();
    b.startNode('FieldAttribute');
    b.token('At', '@');
    b.startNode('Identifier');
    b.token('Ident', 'id');
    b.finishNode();
    const expected = b.finishNode();

    expect(node).toEqual(expected);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a namespaced field attribute', () => {
    const source = '@db.VarChar';
    const { node, diagnostics } = parse(source, parseAttribute);

    const b = new GreenNodeBuilder();
    b.startNode('FieldAttribute');
    b.token('At', '@');
    b.startNode('Identifier');
    b.token('Ident', 'db');
    b.finishNode();
    b.token('Dot', '.');
    b.startNode('Identifier');
    b.token('Ident', 'VarChar');
    b.finishNode();
    const expected = b.finishNode();

    expect(node).toEqual(expected);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a field attribute with an argument list', () => {
    const source = '@default(autoincrement())';
    const { node, diagnostics } = parse(source, parseAttribute);

    const b = new GreenNodeBuilder();
    b.startNode('FieldAttribute');
    b.token('At', '@');
    b.startNode('Identifier');
    b.token('Ident', 'default');
    b.finishNode();
    b.startNode('AttributeArgList');
    b.token('LParen', '(');
    b.startNode('AttributeArg');
    b.startNode('FunctionCall');
    b.startNode('Identifier');
    b.token('Ident', 'autoincrement');
    b.finishNode();
    b.token('LParen', '(');
    b.token('RParen', ')');
    b.finishNode();
    b.finishNode();
    b.token('RParen', ')');
    b.finishNode();
    const expected = b.finishNode();

    expect(node).toEqual(expected);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a block attribute with a double-at', () => {
    const source = '@@map';
    const { node, diagnostics } = parse(source, parseAttribute);

    const b = new GreenNodeBuilder();
    b.startNode('ModelAttribute');
    b.token('DoubleAt', '@@');
    b.startNode('Identifier');
    b.token('Ident', 'map');
    b.finishNode();
    const expected = b.finishNode();

    expect(node).toEqual(expected);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('parseAttributeArg well-formed', () => {
  it('parses a positional identifier argument', () => {
    const source = 'id';
    const { node, diagnostics } = parse(source, parseAttributeArg);

    const b = new GreenNodeBuilder();
    b.startNode('AttributeArg');
    b.startNode('Identifier');
    b.token('Ident', 'id');
    b.finishNode();
    const expected = b.finishNode();

    expect(node).toEqual(expected);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a named argument with a colon and array value', () => {
    const source = 'fields: [id]';
    const { node, diagnostics } = parse(source, parseAttributeArg);

    const b = new GreenNodeBuilder();
    b.startNode('AttributeArg');
    b.startNode('Identifier');
    b.token('Ident', 'fields');
    b.finishNode();
    b.token('Colon', ':');
    b.token('Whitespace', ' ');
    b.startNode('ArrayLiteral');
    b.token('LBracket', '[');
    b.startNode('Identifier');
    b.token('Ident', 'id');
    b.finishNode();
    b.token('RBracket', ']');
    b.finishNode();
    const expected = b.finishNode();

    expect(node).toEqual(expected);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('parseAttributeArgList well-formed', () => {
  it('parses an empty argument list', () => {
    const source = '()';
    const { node, diagnostics } = parse(source, parseAttributeArgList);

    const b = new GreenNodeBuilder();
    b.startNode('AttributeArgList');
    b.token('LParen', '(');
    b.token('RParen', ')');
    const expected = b.finishNode();

    expect(node).toEqual(expected);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a comma-separated positional list, attaching inter-arg trivia to the list', () => {
    const source = '(id, name)';
    const { node, diagnostics } = parse(source, parseAttributeArgList);

    const b = new GreenNodeBuilder();
    b.startNode('AttributeArgList');
    b.token('LParen', '(');
    b.startNode('AttributeArg');
    b.startNode('Identifier');
    b.token('Ident', 'id');
    b.finishNode();
    b.finishNode();
    b.token('Comma', ',');
    b.token('Whitespace', ' ');
    b.startNode('AttributeArg');
    b.startNode('Identifier');
    b.token('Ident', 'name');
    b.finishNode();
    b.finishNode();
    b.token('RParen', ')');
    const expected = b.finishNode();

    expect(node).toEqual(expected);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('parseExpression well-formed', () => {
  it('parses an array literal with inter-element trivia attached to the array', () => {
    const source = '[id, name]';
    const { node, diagnostics } = parse(source, (c) => parseExpression(c) as GreenNode);

    const b = new GreenNodeBuilder();
    b.startNode('ArrayLiteral');
    b.token('LBracket', '[');
    b.startNode('Identifier');
    b.token('Ident', 'id');
    b.finishNode();
    b.token('Comma', ',');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'name');
    b.finishNode();
    b.token('RBracket', ']');
    const expected = b.finishNode();

    expect(node).toEqual(expected);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a function call with empty parens', () => {
    const source = 'autoincrement()';
    const { node, diagnostics } = parse(source, (c) => parseExpression(c) as GreenNode);

    const b = new GreenNodeBuilder();
    b.startNode('FunctionCall');
    b.startNode('Identifier');
    b.token('Ident', 'autoincrement');
    b.finishNode();
    b.token('LParen', '(');
    b.token('RParen', ')');
    const expected = b.finishNode();

    expect(node).toEqual(expected);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a string literal', () => {
    const source = '"hello"';
    const { node } = parse(source, (c) => parseExpression(c) as GreenNode);
    expect(node.kind).toBe('StringLiteralExpr');
    expect(greenText(node)).toBe(source);
  });

  it('parses a number literal', () => {
    const source = '42';
    const { node } = parse(source, (c) => parseExpression(c) as GreenNode);
    expect(node.kind).toBe('NumberLiteralExpr');
    expect(greenText(node)).toBe(source);
  });

  it('parses boolean idents as boolean literal expressions', () => {
    const source = 'true';
    const { node } = parse(source, (c) => parseExpression(c) as GreenNode);
    expect(node.kind).toBe('BooleanLiteralExpr');
    expect(greenText(node)).toBe(source);
  });
});

describe('parseTypeAnnotation well-formed', () => {
  it('parses a bare reference', () => {
    const source = 'String';
    const { node, diagnostics } = parse(source, parseTypeAnnotation);

    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    b.startNode('Identifier');
    b.token('Ident', 'String');
    b.finishNode();
    const expected = b.finishNode();

    expect(node).toEqual(expected);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a dot-qualified reference', () => {
    const source = 'auth.User';
    const { node, diagnostics } = parse(source, parseTypeAnnotation);

    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    b.startNode('Identifier');
    b.token('Ident', 'auth');
    b.finishNode();
    b.token('Dot', '.');
    b.startNode('Identifier');
    b.token('Ident', 'User');
    b.finishNode();
    const expected = b.finishNode();

    expect(node).toEqual(expected);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a colon-prefixed cross-space reference with namespace and optional suffix', () => {
    const source = 'supabase:auth.User?';
    const { node, diagnostics } = parse(source, parseTypeAnnotation);

    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    b.startNode('Identifier');
    b.token('Ident', 'supabase');
    b.finishNode();
    b.token('Colon', ':');
    b.startNode('Identifier');
    b.token('Ident', 'auth');
    b.finishNode();
    b.token('Dot', '.');
    b.startNode('Identifier');
    b.token('Ident', 'User');
    b.finishNode();
    b.token('Question', '?');
    const expected = b.finishNode();

    expect(node).toEqual(expected);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a colon-prefixed reference without namespace', () => {
    const source = 'supabase:User';
    const { node, diagnostics } = parse(source, parseTypeAnnotation);

    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    b.startNode('Identifier');
    b.token('Ident', 'supabase');
    b.finishNode();
    b.token('Colon', ':');
    b.startNode('Identifier');
    b.token('Ident', 'User');
    b.finishNode();
    const expected = b.finishNode();

    expect(node).toEqual(expected);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses an inline constructor call', () => {
    const source = 'Vector(1536)';
    const { node, diagnostics } = parse(source, parseTypeAnnotation);

    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    b.startNode('FunctionCall');
    b.startNode('Identifier');
    b.token('Ident', 'Vector');
    b.finishNode();
    b.token('LParen', '(');
    b.startNode('AttributeArg');
    b.startNode('NumberLiteralExpr');
    b.token('NumberLiteral', '1536');
    b.finishNode();
    b.finishNode();
    b.token('RParen', ')');
    b.finishNode();
    const expected = b.finishNode();

    expect(node).toEqual(expected);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a list suffix', () => {
    const source = 'String[]';
    const { node, diagnostics } = parse(source, parseTypeAnnotation);

    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    b.startNode('Identifier');
    b.token('Ident', 'String');
    b.finishNode();
    b.token('LBracket', '[');
    b.token('RBracket', ']');
    const expected = b.finishNode();

    expect(node).toEqual(expected);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });
});

function offendingOffset(
  cursor: ReturnType<typeof createParserCursor>,
  diagnostic: ParseDiagnostic,
) {
  return cursor.sourceFile.offsetAt(diagnostic.range.start);
}

describe('parseTypeAnnotation fault tolerance', () => {
  it('flags triple-dot over-qualification but still yields a subtree that round-trips', () => {
    const source = 'a.b.c';
    const { node, diagnostics, cursor } = parse(source, parseTypeAnnotation);

    expect(node.kind).toBe('TypeAnnotation');
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_QUALIFIED_TYPE');
    expect(diagnostics[0]!.message).toBe('Qualified type reference has too many segments');
    // range points at the offending second dot
    expect(offendingOffset(cursor, diagnostics[0]!)).toBe(3);
    expect(source[offendingOffset(cursor, diagnostics[0]!)]).toBe('.');
  });

  it('flags double-colon over-qualification but still yields a subtree', () => {
    const source = 'a:b:c';
    const { node, diagnostics, cursor } = parse(source, parseTypeAnnotation);

    expect(node.kind).toBe('TypeAnnotation');
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_QUALIFIED_TYPE');
    expect(diagnostics[0]!.message).toBe('Qualified type reference has too many segments');
    expect(offendingOffset(cursor, diagnostics[0]!)).toBe(3);
    expect(source[offendingOffset(cursor, diagnostics[0]!)]).toBe(':');
  });
});

describe('parseAttribute fault tolerance', () => {
  it('flags a bare at with no name but still yields an attribute subtree', () => {
    const source = '@';
    const { node, diagnostics, cursor } = parse(source, parseAttribute);

    expect(node.kind).toBe('FieldAttribute');
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    expect(diagnostics[0]!.message).toBe('Attribute name expected');
    expect(offendingOffset(cursor, diagnostics[0]!)).toBe(0);
    expect(source[offendingOffset(cursor, diagnostics[0]!)]).toBe('@');
  });

  it('flags a missing name after a dotted attribute segment', () => {
    const source = '@ns.';
    const { node, diagnostics } = parse(source, parseAttribute);

    expect(node.kind).toBe('FieldAttribute');
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    expect(diagnostics[0]!.message).toBe('Attribute name expected after "."');
  });
});

describe('argument-position object literal', () => {
  it('captures an unrecognised object literal as balanced raw tokens so the round-trip holds', () => {
    const source = '{ a: 1 }';
    const { node, diagnostics } = parse(source, parseAttributeArg);

    expect(node.kind).toBe('AttributeArg');
    expect(greenText(node)).toBe(source);
    // no node kind is invented; the braces land as raw tokens
    expect(node.children.every((child) => child.type === 'token')).toBe(true);
    expect(diagnostics).toHaveLength(0);
  });

  it('balances nested braces inside the captured object literal', () => {
    const source = '{ a: { b: 1 } }';
    const { node } = parse(source, parseAttributeArg);
    expect(greenText(node)).toBe(source);
  });
});
