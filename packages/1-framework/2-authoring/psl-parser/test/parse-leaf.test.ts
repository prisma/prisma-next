import { describe, expect, it } from 'vitest';
import {
  Cursor,
  parseArrayLiteral,
  parseAttribute,
  parseAttributeArg,
  parseAttributeArgList,
  parseBooleanLiteralExpr,
  parseExpression,
  parseFunctionCall,
  parseIdentifierExpr,
  parseNumberLiteralExpr,
  parseObjectLiteralExpr,
  parseStringLiteralExpr,
  parseTypeAnnotation,
} from '../src/parse';
import {
  AttributeArgAst,
  NumberLiteralExprAst,
  ObjectLiteralExprAst,
  StringLiteralExprAst,
} from '../src/syntax/ast/expressions';
import type { GreenElement, GreenNode } from '../src/syntax/green';
import { createSyntaxTree } from '../src/syntax/red';
import { highlight, printTree } from './support';

function greenText(element: GreenElement): string {
  if (element.type === 'token') return element.text;
  return element.children.map(greenText).join('');
}

describe('offset tracking', () => {
  it('maps a diagnostic range through interspersed trivia using the running offset', () => {
    // The second `.` is the offending separator; a newline precedes it, so its
    // start offset is only correct if every consumed token (the leading
    // segments and that trivia) advanced the running offset counter.
    const source = 'a.b\n.c';
    const { diagnostics, cursor } = parse(source, parseTypeAnnotation);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_QUALIFIED_TYPE');
    expect(highlight(cursor.sourceFile, diagnostics[0]!.range)).toMatchInlineSnapshot(`
      "
      .c
      ~"
    `);
  });
});

describe('peekKind', () => {
  it('reports upcoming significant kinds without consuming or emitting trivia', () => {
    const cursor = new Cursor('  model User');
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
    const cursor = new Cursor('broken stuff\nnext');
    cursor.startNode('Document');
    cursor.recoverToSyncPoint();
    const node = cursor.finishNode();
    expect(greenText(node)).toBe('broken stuff');
    expect(cursor.peekKind()).toBe('Ident');
  });

  it('stops before the enclosing RBrace', () => {
    const cursor = new Cursor('junk}');
    cursor.startNode('Document');
    cursor.recoverToSyncPoint();
    const node = cursor.finishNode();
    expect(greenText(node)).toBe('junk');
    expect(cursor.peekKind()).toBe('RBrace');
  });

  it('stops at Eof', () => {
    const cursor = new Cursor('only garbage here');
    cursor.startNode('Document');
    cursor.recoverToSyncPoint();
    const node = cursor.finishNode();
    expect(greenText(node)).toBe('only garbage here');
    expect(cursor.peekKind()).toBe('Eof');
  });
});

function parse(source: string, run: (cursor: Cursor) => GreenNode) {
  const cursor = new Cursor(source);
  const node = run(cursor);
  return { node, diagnostics: cursor.diagnostics, cursor };
}

describe('parseAttribute well-formed', () => {
  it('parses a simple field attribute', () => {
    const source = '@id';
    const { node, diagnostics } = parse(source, parseAttribute);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "FieldAttribute
        At "@"
        Identifier
          Ident "id""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a namespaced field attribute', () => {
    const source = '@db.VarChar';
    const { node, diagnostics } = parse(source, parseAttribute);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "FieldAttribute
        At "@"
        Identifier
          Ident "db"
        Dot "."
        Identifier
          Ident "VarChar""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a field attribute with an argument list', () => {
    const source = '@default(autoincrement())';
    const { node, diagnostics } = parse(source, parseAttribute);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "FieldAttribute
        At "@"
        Identifier
          Ident "default"
        AttributeArgList
          LParen "("
          AttributeArg
            FunctionCall
              Identifier
                Ident "autoincrement"
              LParen "("
              RParen ")"
          RParen ")""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a block attribute with a double-at', () => {
    const source = '@@map';
    const { node, diagnostics } = parse(source, parseAttribute);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "ModelAttribute
        DoubleAt "@@"
        Identifier
          Ident "map""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('parseAttributeArg well-formed', () => {
  it('parses a positional identifier argument', () => {
    const source = 'id';
    const { node, diagnostics } = parse(source, parseAttributeArg);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "AttributeArg
        Identifier
          Ident "id""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a named argument with a colon and array value', () => {
    const source = 'fields: [id]';
    const { node, diagnostics } = parse(source, parseAttributeArg);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "AttributeArg
        Identifier
          Ident "fields"
        Colon ":"
        Whitespace " "
        ArrayLiteral
          LBracket "["
          Identifier
            Ident "id"
          RBracket "]""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('parseAttributeArgList well-formed', () => {
  it('parses an empty argument list', () => {
    const source = '()';
    const { node, diagnostics } = parse(source, parseAttributeArgList);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "AttributeArgList
        LParen "("
        RParen ")""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a comma-separated positional list, attaching inter-arg trivia to the list', () => {
    const source = '(id, name)';
    const { node, diagnostics } = parse(source, parseAttributeArgList);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "AttributeArgList
        LParen "("
        AttributeArg
          Identifier
            Ident "id"
        Comma ","
        Whitespace " "
        AttributeArg
          Identifier
            Ident "name"
        RParen ")""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('parseExpression well-formed', () => {
  it('parses an array literal with inter-element trivia attached to the array', () => {
    const source = '[id, name]';
    const { node, diagnostics } = parse(source, (c) => parseExpression(c) as GreenNode);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "ArrayLiteral
        LBracket "["
        Identifier
          Ident "id"
        Comma ","
        Whitespace " "
        Identifier
          Ident "name"
        RBracket "]""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a function call with empty parens', () => {
    const source = 'autoincrement()';
    const { node, diagnostics } = parse(source, (c) => parseExpression(c) as GreenNode);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "FunctionCall
        Identifier
          Ident "autoincrement"
        LParen "("
        RParen ")""
    `);
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

    expect(printTree(node)).toMatchInlineSnapshot(`
      "TypeAnnotation
        Identifier
          Ident "String""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a dot-qualified reference', () => {
    const source = 'auth.User';
    const { node, diagnostics } = parse(source, parseTypeAnnotation);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "TypeAnnotation
        Identifier
          Ident "auth"
        Dot "."
        Identifier
          Ident "User""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a colon-prefixed cross-space reference with namespace and optional suffix', () => {
    const source = 'supabase:auth.User?';
    const { node, diagnostics } = parse(source, parseTypeAnnotation);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "TypeAnnotation
        Identifier
          Ident "supabase"
        Colon ":"
        Identifier
          Ident "auth"
        Dot "."
        Identifier
          Ident "User"
        Question "?""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a colon-prefixed reference without namespace', () => {
    const source = 'supabase:User';
    const { node, diagnostics } = parse(source, parseTypeAnnotation);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "TypeAnnotation
        Identifier
          Ident "supabase"
        Colon ":"
        Identifier
          Ident "User""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses an inline constructor call', () => {
    const source = 'Vector(1536)';
    const { node, diagnostics } = parse(source, parseTypeAnnotation);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "TypeAnnotation
        FunctionCall
          Identifier
            Ident "Vector"
          LParen "("
          AttributeArg
            NumberLiteralExpr
              NumberLiteral "1536"
          RParen ")""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a list suffix', () => {
    const source = 'String[]';
    const { node, diagnostics } = parse(source, parseTypeAnnotation);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "TypeAnnotation
        Identifier
          Ident "String"
        LBracket "["
        RBracket "]""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('parseTypeAnnotation fault tolerance', () => {
  it('flags triple-dot over-qualification but still yields a subtree that round-trips', () => {
    const source = 'a.b.c';
    const { node, diagnostics, cursor } = parse(source, parseTypeAnnotation);

    expect(node.kind).toBe('TypeAnnotation');
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_QUALIFIED_TYPE');
    expect(diagnostics[0]!.message).toBe('Qualified type reference has too many segments');
    expect(highlight(cursor.sourceFile, diagnostics[0]!.range)).toMatchInlineSnapshot(`
      "
      a.b.c
         ~"
    `);
  });

  it('flags double-colon over-qualification but still yields a subtree', () => {
    const source = 'a:b:c';
    const { node, diagnostics, cursor } = parse(source, parseTypeAnnotation);

    expect(node.kind).toBe('TypeAnnotation');
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_QUALIFIED_TYPE');
    expect(diagnostics[0]!.message).toBe('Qualified type reference has too many segments');
    expect(highlight(cursor.sourceFile, diagnostics[0]!.range)).toMatchInlineSnapshot(`
      "
      a:b:c
         ~"
    `);
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
    expect(highlight(cursor.sourceFile, diagnostics[0]!.range)).toMatchInlineSnapshot(`
      "
      @
      ~"
    `);
  });

  it('flags a missing name after a dotted attribute segment', () => {
    const source = '@ns.';
    const { node, diagnostics, cursor } = parse(source, parseAttribute);

    expect(node.kind).toBe('FieldAttribute');
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    expect(diagnostics[0]!.message).toBe('Attribute name expected after "."');
    expect(highlight(cursor.sourceFile, diagnostics[0]!.range)).toMatchInlineSnapshot(`
      "
      @ns.
          ~"
    `);
  });
});

describe('argument-position object literal', () => {
  it('parses an object literal argument into an ObjectLiteralExpr queryable via fields()', () => {
    const source = '{ a: 1, b: "x" }';
    const { node, diagnostics } = parse(source, parseAttributeArg);

    expect(node.kind).toBe('AttributeArg');
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);

    const obj = AttributeArgAst.cast(createSyntaxTree(node))!.value();
    expect(obj).toBeInstanceOf(ObjectLiteralExprAst);
    if (obj instanceof ObjectLiteralExprAst) {
      const fields = Array.from(obj.fields());
      expect(fields).toHaveLength(2);
      expect(fields[0]!.key()?.token()?.text).toBe('a');
      expect(fields[0]!.value()).toBeInstanceOf(NumberLiteralExprAst);
      expect(fields[1]!.key()?.token()?.text).toBe('b');
      expect(fields[1]!.value()).toBeInstanceOf(StringLiteralExprAst);
    }
  });

  it('parses a nested object literal recursively, round-tripping losslessly', () => {
    const source = '{ a: { b: 1 } }';
    const { node, diagnostics } = parse(source, parseAttributeArg);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);

    const obj = AttributeArgAst.cast(createSyntaxTree(node))!.value();
    expect(obj).toBeInstanceOf(ObjectLiteralExprAst);
    if (obj instanceof ObjectLiteralExprAst) {
      const [field] = Array.from(obj.fields());
      expect(field!.value()).toBeInstanceOf(ObjectLiteralExprAst);
    }
  });

  it('allows a trailing comma', () => {
    const source = '{ a: 1, }';
    const { node, diagnostics } = parse(source, parseAttributeArg);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);

    const obj = AttributeArgAst.cast(createSyntaxTree(node))!.value();
    expect(obj).toBeInstanceOf(ObjectLiteralExprAst);
    if (obj instanceof ObjectLiteralExprAst) {
      expect(Array.from(obj.fields())).toHaveLength(1);
    }
  });

  it('reports a missing colon but still yields a best-effort node and round-trips', () => {
    const source = '{ a 1 }';
    const { node, diagnostics } = parse(source, parseAttributeArg);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_OBJECT_LITERAL');
    expect(diagnostics[0]!.message).toBe('Expected ":" after "a"');
    expect(AttributeArgAst.cast(createSyntaxTree(node))!.value()).toBeInstanceOf(
      ObjectLiteralExprAst,
    );
  });

  it('reports a missing value but still yields a best-effort node and round-trips', () => {
    const source = '{ a: }';
    const { node, diagnostics } = parse(source, parseAttributeArg);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_OBJECT_LITERAL');
    expect(diagnostics[0]!.message).toBe('Expected a value after ":"');
  });

  it('reports an unterminated object literal anchored on the opening brace', () => {
    const source = '{ a: 1';
    const { node, diagnostics, cursor } = parse(source, parseAttributeArg);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_OBJECT_LITERAL');
    expect(diagnostics[0]!.message).toBe('Unterminated object literal');
    expect(highlight(cursor.sourceFile, diagnostics[0]!.range)).toMatchInlineSnapshot(`
      "
      { a: 1
      ~"
    `);
  });
});

function expectNoOpReject(source: string, run: (cursor: Cursor) => GreenNode | undefined): void {
  const cursor = new Cursor(source);
  expect(run(cursor)).toBeUndefined();
  expect(cursor.diagnostics).toEqual([]);
  cursor.startNode('Document');
  while (cursor.peekKind() !== 'Eof') {
    cursor.bump();
  }
  cursor.flushTrivia();
  expect(greenText(cursor.finishNode())).toBe(source);
}

describe('expression alternatives are no-ops on non-match', () => {
  it('parseStringLiteralExpr rejects a non-string token without consuming', () => {
    expectNoOpReject('42', parseStringLiteralExpr);
  });

  it('parseNumberLiteralExpr rejects a non-number token without consuming', () => {
    expectNoOpReject('"hi"', parseNumberLiteralExpr);
  });

  it('parseArrayLiteral rejects a non-bracket token without consuming', () => {
    expectNoOpReject('foo', parseArrayLiteral);
  });

  it('parseFunctionCall rejects an identifier with no following paren without consuming', () => {
    expectNoOpReject('foo', parseFunctionCall);
  });

  it('parseBooleanLiteralExpr rejects a non-boolean identifier without consuming', () => {
    expectNoOpReject('foo', parseBooleanLiteralExpr);
  });

  it('parseIdentifierExpr rejects a non-identifier token without consuming', () => {
    expectNoOpReject('42', parseIdentifierExpr);
  });

  it('parseObjectLiteralExpr rejects a non-brace token without consuming', () => {
    expectNoOpReject('foo', parseObjectLiteralExpr);
  });
});
