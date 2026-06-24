import { describe, expect, it } from 'vitest';
import { Cursor, parse, parseAttributeArg, parseExpression } from '../src/parse';
import { readResolvedAttribute } from '../src/resolve';
import type { ModelDeclarationAst } from '../src/syntax/ast/declarations';
import { ArrayLiteralAst, AttributeArgAst } from '../src/syntax/ast/expressions';
import { IdentifierAst } from '../src/syntax/ast/identifier';
import { QualifiedNameAst } from '../src/syntax/ast/qualified-name';
import type { GreenElement, GreenNode } from '../src/syntax/green';
import { createSyntaxTree } from '../src/syntax/red';
import { printTree } from './support';

function greenText(element: GreenElement): string {
  if (element.type === 'token') return element.text;
  return element.children.map(greenText).join('');
}

function parseArg(source: string) {
  const cursor = new Cursor(source);
  const node = parseAttributeArg(cursor);
  return { node, diagnostics: cursor.diagnostics };
}

/** The resolved value string `getNamedArgument(attr, name)` returns downstream. */
function resolvedNamedArg(
  source: string,
  attributeName: string,
  argName: string,
): string | undefined {
  const result = parse(source);
  const model = Array.from(result.document.declarations())[0] as ModelDeclarationAst;
  for (const field of model.fields()) {
    for (const attribute of field.attributes()) {
      const resolved = readResolvedAttribute(attribute, result.sourceFile);
      if (resolved.name !== attributeName) continue;
      const arg = resolved.args.find((a) => a.kind === 'named' && a.name === argName);
      if (arg) return arg.value;
    }
  }
  return undefined;
}

describe('member-access argument value', () => {
  it('parses a qualified Identifier.Identifier value into a QualifiedName node', () => {
    const source = 'through: Foo.bar';
    const { node, diagnostics } = parseArg(source);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "AttributeArg
        Identifier
          Ident "through"
        Colon ":"
        Whitespace " "
        QualifiedName
          Identifier
            Ident "Foo"
          Dot "."
          Identifier
            Ident "bar""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toEqual([]);
  });

  it('exposes both segments of the qualified value through the AST', () => {
    const { node } = parseArg('through: Foo.bar');
    const value = AttributeArgAst.cast(createSyntaxTree(node))!.value();
    expect(value).toBeInstanceOf(QualifiedNameAst);
    if (value instanceof QualifiedNameAst) {
      expect(value.path()).toEqual(['Foo', 'bar']);
    }
  });

  it('surfaces the full dotted string to the resolver (what getNamedArgument returns)', () => {
    const source = [
      'model Follow {',
      '  follower User @relation(through: Follow.follower)',
      '}',
    ].join('\n');
    expect(resolvedNamedArg(source, 'relation', 'through')).toBe('Follow.follower');
  });
});

describe('member-access value — no regression on simpler forms', () => {
  it('keeps a bare identifier value as an Identifier node', () => {
    const source = 'through: Foo';
    const { node, diagnostics } = parseArg(source);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "AttributeArg
        Identifier
          Ident "through"
        Colon ":"
        Whitespace " "
        Identifier
          Ident "Foo""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toEqual([]);

    const value = AttributeArgAst.cast(createSyntaxTree(node))!.value();
    expect(value).toBeInstanceOf(IdentifierAst);
  });

  it('resolves a bare identifier value to its name', () => {
    const source = ['model M {', '  rel Other @relation(through: Foo)', '}'].join('\n');
    expect(resolvedNamedArg(source, 'relation', 'through')).toBe('Foo');
  });

  it('keeps a bracketed list value as an ArrayLiteral node', () => {
    const source = 'from: [a, b]';
    const { node, diagnostics } = parseArg(source);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "AttributeArg
        Identifier
          Ident "from"
        Colon ":"
        Whitespace " "
        ArrayLiteral
          LBracket "["
          Identifier
            Ident "a"
          Comma ","
          Whitespace " "
          Identifier
            Ident "b"
          RBracket "]""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toEqual([]);

    const value = AttributeArgAst.cast(createSyntaxTree(node))!.value();
    expect(value).toBeInstanceOf(ArrayLiteralAst);
  });

  it('resolves a bracketed list value to its rendered source', () => {
    const source = ['model M {', '  rel Other @relation(from: [a, b])', '}'].join('\n');
    expect(resolvedNamedArg(source, 'relation', 'from')).toBe('[a, b]');
  });
});

describe('member-access value — expression entry point', () => {
  it('parseExpression yields a QualifiedName for a dotted value', () => {
    const cursor = new Cursor('Foo.bar');
    const node = parseExpression(cursor) as GreenNode;
    expect(node.kind).toBe('QualifiedName');
    expect(greenText(node)).toBe('Foo.bar');
    expect(cursor.diagnostics).toEqual([]);
  });

  it('parseExpression yields a bare Identifier when no dot follows', () => {
    const cursor = new Cursor('Foo');
    const node = parseExpression(cursor) as GreenNode;
    expect(node.kind).toBe('Identifier');
    expect(greenText(node)).toBe('Foo');
    expect(cursor.diagnostics).toEqual([]);
  });
});

describe('member-access value — three-segment bound', () => {
  // Two segments is the disambiguation form (`through: J.field`). A third
  // segment round-trips but is over-qualified: the shared qualified-name
  // mechanism flags it with PSL_INVALID_QUALIFIED_NAME, the same bound the
  // type-annotation and call grammars carry.
  it('round-trips a.b.c but flags the extra segment, still exposing all segments', () => {
    const source = 'through: a.b.c';
    const { node, diagnostics } = parseArg(source);

    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_QUALIFIED_NAME');

    const value = AttributeArgAst.cast(createSyntaxTree(node))!.value();
    expect(value).toBeInstanceOf(QualifiedNameAst);
    if (value instanceof QualifiedNameAst) {
      expect(value.path()).toEqual(['a', 'b', 'c']);
    }
  });
});
