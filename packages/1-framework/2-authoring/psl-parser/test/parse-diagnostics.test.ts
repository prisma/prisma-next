import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import {
  BlockDeclarationAst,
  CompositeTypeDeclarationAst,
  DocumentAst,
  EnumDeclarationAst,
  ModelDeclarationAst,
  NamespaceDeclarationAst,
  TypesBlockAst,
} from '../src/syntax/ast/declarations';
import type { GreenElement } from '../src/syntax/green';
import { highlight } from './support';

function greenText(element: GreenElement): string {
  if (element.type === 'token') return element.text;
  return element.children.map(greenText).join('');
}

function diagnosticFor(source: string, code: string) {
  const result = parse(source);
  const diagnostic = result.diagnostics.find((d) => d.code === code);
  if (!diagnostic) {
    throw new Error(
      `expected a ${code} diagnostic for ${JSON.stringify(source)}, got [${result.diagnostics
        .map((d) => d.code)
        .join(', ')}]`,
    );
  }
  return { result, message: diagnostic.message, diagnostic };
}

describe('parse() syntactic diagnostics carry parsePslDocument-parity messages', () => {
  it('reports an unterminated block, anchored on the opening brace', () => {
    const source = 'model User {\n  id Int';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_UNTERMINATED_BLOCK');
    expect(message).toBe('Unterminated block declaration');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      model User {
                 ~
        id Int
      "
    `);
    expect(result.document).toBeInstanceOf(DocumentAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports an unsupported top-level declaration with the offending name', () => {
    const source = 'oops';
    const { result, message, diagnostic } = diagnosticFor(
      source,
      'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
    );
    expect(message).toBe('Unsupported top-level declaration "oops"');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      oops
      ~~~~
      "
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('commits a nameless model block to a typed node with a keyword-anchored diagnostic', () => {
    const source = 'model {\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "model"');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      model {
      ~~~~~
      }
      "
    `);
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(1);
    expect(decls[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports a stray invalid character as an unsupported top-level declaration', () => {
    const source = '§';
    const { result, message, diagnostic } = diagnosticFor(
      source,
      'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
    );
    expect(message).toBe('Unsupported top-level declaration "§"');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      §
      ~
      "
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports a recursive namespace block with the inner namespace name', () => {
    const source = 'namespace outer {\nnamespace inner {\n}\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_NAMESPACE_BLOCK');
    expect(message).toBe(
      'Recursive "namespace inner" block is not allowed; namespace blocks may not nest',
    );
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      namespace outer {
      namespace inner {
      ~~~~~~~~~
      }
      }
      "
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports a reserved namespace name', () => {
    const source = 'namespace __unspecified__ {\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_NAMESPACE_BLOCK');
    expect(message).toBe(
      'Namespace name "__unspecified__" is reserved for the parser-synthesised bucket for top-level declarations',
    );
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      namespace __unspecified__ {
      ~~~~~~~~~
      }
      "
    `);
  });

  it('reports a types block nested inside a namespace', () => {
    const source = 'namespace outer {\ntype {\n}\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_NAMESPACE_BLOCK');
    expect(message).toBe(
      '`types` blocks must be declared at the document top level, not inside a namespace block',
    );
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      namespace outer {
      type {
      ~~~~
      }
      }
      "
    `);
  });

  it('reports a malformed model member with the offending token', () => {
    const source = 'model M {\n  123\n  id Int\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_MODEL_MEMBER');
    expect(message).toBe('Invalid model member declaration "123"');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      model M {
        123
        ~~~
        id Int
      }
      "
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports a malformed enum member with the offending token', () => {
    const source = 'enum E {\n  123\n  OK\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_ENUM_MEMBER');
    expect(message).toBe('Invalid enum value declaration "123"');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      enum E {
        123
        ~~~
        OK
      }
      "
    `);
  });

  it('reports a malformed types-block member with the offending token', () => {
    const source = 'type {\n  123\n  Ok = Int\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_TYPES_MEMBER');
    expect(message).toBe('Invalid types declaration "123"');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      type {
        123
        ~~~
        Ok = Int
      }
      "
    `);
  });

  it('reports a malformed generic-block entry with implementer wording', () => {
    const source = 'datasource db {\n  123\n  provider = "x"\n}';
    const { result, message, diagnostic } = diagnosticFor(
      source,
      'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
    );
    expect(message).toBe('Invalid block entry');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      datasource db {
        123
        ~~~
        provider = "x"
      }
      "
    `);
  });

  it('reports a generic-block entry missing its "=", anchored on the key, keeping the pair', () => {
    const source = 'datasource db {\n  provider "x"\n}';
    const { result, message, diagnostic } = diagnosticFor(
      source,
      'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
    );
    expect(message).toBe('Expected "=" after "provider"');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      datasource db {
        provider "x"
        ~~~~~~~~
      }
      "
    `);
    const decl = Array.from(result.document.declarations())[0];
    expect(decl).toBeInstanceOf(BlockDeclarationAst);
    if (decl instanceof BlockDeclarationAst) {
      const entries = Array.from(decl.entries());
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key()?.token()?.text).toBe('provider');
    }
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports a bare generic-block key with no value as a missing "="', () => {
    const source = 'datasource db {\n  provider\n}';
    const { result, message, diagnostic } = diagnosticFor(
      source,
      'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
    );
    expect(message).toBe('Expected "=" after "provider"');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      datasource db {
        provider
        ~~~~~~~~
      }
      "
    `);
    const decl = Array.from(result.document.declarations())[0];
    expect(decl).toBeInstanceOf(BlockDeclarationAst);
    if (decl instanceof BlockDeclarationAst) {
      const entries = Array.from(decl.entries());
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key()?.token()?.text).toBe('provider');
    }
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports a types-block member missing its "=", anchored on the name', () => {
    const source = 'type {\n  UserId Int\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_TYPES_MEMBER');
    expect(message).toBe('Expected "=" after "UserId"');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      type {
        UserId Int
        ~~~~~~
      }
      "
    `);
    const decl = Array.from(result.document.declarations())[0];
    expect(decl).toBeInstanceOf(TypesBlockAst);
    if (decl instanceof TypesBlockAst) {
      const named = Array.from(decl.declarations());
      expect(named).toHaveLength(1);
      expect(named[0]!.name()?.token()?.text).toBe('UserId');
    }
    expect(greenText(result.document.syntax.green)).toBe(source);
  });
});

describe('parse() commits reserved declaration keywords on the keyword alone', () => {
  it('model with a missing name yields a typed node anchored on the keyword', () => {
    const source = 'model {\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "model"');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      model {
      ~~~~~
      }
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('model with a missing brace yields a typed node and reports the brace', () => {
    const source = 'model User';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected "{" to open the "model" block');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      model User
      ~~~~~
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('a bare model keyword yields a typed node and reports the missing name', () => {
    const source = 'model';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "model"');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      model
      ~~~~~
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('enum with a missing name yields a typed node', () => {
    const source = 'enum {\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "enum"');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      enum {
      ~~~~
      }
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(EnumDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('enum with a missing brace yields a typed node and reports the brace', () => {
    const source = 'enum Color';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected "{" to open the "enum" block');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      enum Color
      ~~~~
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(EnumDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('a bare enum keyword yields a typed node and reports the missing name', () => {
    const source = 'enum';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "enum"');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      enum
      ~~~~
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(EnumDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('namespace with a missing name yields a typed node', () => {
    const source = 'namespace {\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "namespace"');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      namespace {
      ~~~~~~~~~
      }
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(NamespaceDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('namespace with a missing brace yields a typed node and reports the brace', () => {
    const source = 'namespace outer';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected "{" to open the "namespace" block');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      namespace outer
      ~~~~~~~~~
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(NamespaceDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('a bare namespace keyword yields a typed node and reports the missing name', () => {
    const source = 'namespace';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "namespace"');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      namespace
      ~~~~~~~~~
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(NamespaceDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('type with a name but no brace yields a composite type and reports the brace', () => {
    const source = 'type Address';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected "{" to open the "type" block');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      type Address
      ~~~~
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(
      CompositeTypeDeclarationAst,
    );
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('a bare type keyword yields a types block and reports the missing brace', () => {
    const source = 'type';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected "{" to open the "type" block');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      type
      ~~~~
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(TypesBlockAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('keeps parsing later declarations after a malformed reserved header', () => {
    const source = 'model User\nmodel Order {\n}';
    const result = parse(source);
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_INVALID_DECLARATION');
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(2);
    expect(decls[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(decls[1]).toBeInstanceOf(ModelDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('still reports a bare non-reserved identifier as an unsupported declaration', () => {
    const source = 'datasource';
    const { result, message, diagnostic } = diagnosticFor(
      source,
      'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
    );
    expect(message).toBe('Unsupported top-level declaration "datasource"');
    expect(highlight(result.sourceFile, diagnostic.range)).toMatchInlineSnapshot(`
      "
      datasource
      ~~~~~~~~~~
      "
    `);
    expect(result.diagnostics.map((d) => d.code)).not.toContain('PSL_INVALID_DECLARATION');
    expect(greenText(result.document.syntax.green)).toBe(source);
  });
});
