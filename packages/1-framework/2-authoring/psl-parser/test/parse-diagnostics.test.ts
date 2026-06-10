import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import {
  CompositeTypeDeclarationAst,
  DocumentAst,
  EnumDeclarationAst,
  ModelDeclarationAst,
  NamespaceDeclarationAst,
  TypesBlockAst,
} from '../src/syntax/ast/declarations';
import type { GreenElement } from '../src/syntax/green';

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
  const start = result.sourceFile.offsetAt(diagnostic.range.start);
  const end = result.sourceFile.offsetAt(diagnostic.range.end);
  return { result, message: diagnostic.message, span: source.slice(start, end), start };
}

describe('parse() syntactic diagnostics carry parsePslDocument-parity messages', () => {
  it('reports an unterminated block, anchored on the opening brace', () => {
    const source = 'model User {\n  id Int';
    const { result, message, span } = diagnosticFor(source, 'PSL_UNTERMINATED_BLOCK');
    expect(message).toBe('Unterminated block declaration');
    expect(span).toBe('{');
    expect(result.document).toBeInstanceOf(DocumentAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports an unsupported top-level declaration with the offending name', () => {
    const source = 'oops';
    const { result, message, span } = diagnosticFor(source, 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK');
    expect(message).toBe('Unsupported top-level declaration "oops"');
    expect(span).toBe('oops');
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('commits a nameless model block to a typed node with a keyword-anchored diagnostic', () => {
    const source = 'model {\n}';
    const { result, message, span } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "model"');
    expect(span).toBe('model');
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(1);
    expect(decls[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports a stray invalid character as an unsupported top-level declaration', () => {
    const source = '§';
    const { result, message, span } = diagnosticFor(source, 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK');
    expect(message).toBe('Unsupported top-level declaration "§"');
    expect(span).toBe('§');
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports a recursive namespace block with the inner namespace name', () => {
    const source = 'namespace outer {\nnamespace inner {\n}\n}';
    const { result, message, span, start } = diagnosticFor(source, 'PSL_INVALID_NAMESPACE_BLOCK');
    expect(message).toBe(
      'Recursive "namespace inner" block is not allowed; namespace blocks may not nest',
    );
    expect(span).toBe('namespace');
    expect(start).toBe(18);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports a reserved namespace name', () => {
    const source = 'namespace __unspecified__ {\n}';
    const { message, span } = diagnosticFor(source, 'PSL_INVALID_NAMESPACE_BLOCK');
    expect(message).toBe(
      'Namespace name "__unspecified__" is reserved for the parser-synthesised bucket for top-level declarations',
    );
    expect(span).toBe('namespace');
  });

  it('reports a types block nested inside a namespace', () => {
    const source = 'namespace outer {\ntype {\n}\n}';
    const { message, span } = diagnosticFor(source, 'PSL_INVALID_NAMESPACE_BLOCK');
    expect(message).toBe(
      '`types` blocks must be declared at the document top level, not inside a namespace block',
    );
    expect(span).toBe('type');
  });

  it('reports a malformed model member with the offending token', () => {
    const source = 'model M {\n  123\n  id Int\n}';
    const { result, message, span } = diagnosticFor(source, 'PSL_INVALID_MODEL_MEMBER');
    expect(message).toBe('Invalid model member declaration "123"');
    expect(span).toBe('123');
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports a malformed enum member with the offending token', () => {
    const source = 'enum E {\n  123\n  OK\n}';
    const { message, span } = diagnosticFor(source, 'PSL_INVALID_ENUM_MEMBER');
    expect(message).toBe('Invalid enum value declaration "123"');
    expect(span).toBe('123');
  });

  it('reports a malformed types-block member with the offending token', () => {
    const source = 'type {\n  123\n  Ok = Int\n}';
    const { message, span } = diagnosticFor(source, 'PSL_INVALID_TYPES_MEMBER');
    expect(message).toBe('Invalid types declaration "123"');
    expect(span).toBe('123');
  });

  it('reports a malformed generic-block entry with implementer wording', () => {
    const source = 'datasource db {\n  123\n  provider = "x"\n}';
    const { message, span } = diagnosticFor(source, 'PSL_INVALID_EXTENSION_BLOCK_MEMBER');
    expect(message).toBe('Invalid block entry');
    expect(span).toBe('123');
  });
});

describe('parse() commits reserved declaration keywords on the keyword alone', () => {
  it('model with a missing name yields a typed node anchored on the keyword', () => {
    const source = 'model {\n}';
    const { result, message, span, start } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "model"');
    expect(span).toBe('model');
    expect(start).toBe(0);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('model with a missing brace yields a typed node and reports the brace', () => {
    const source = 'model User';
    const { result, message, span } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected "{" to open the "model" block');
    expect(span).toBe('model');
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('a bare model keyword yields a typed node and reports the missing name', () => {
    const source = 'model';
    const { result, message, span } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "model"');
    expect(span).toBe('model');
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('enum with a missing name yields a typed node', () => {
    const source = 'enum {\n}';
    const { result, message, span } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "enum"');
    expect(span).toBe('enum');
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(EnumDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('enum with a missing brace yields a typed node and reports the brace', () => {
    const source = 'enum Color';
    const { result, message, span } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected "{" to open the "enum" block');
    expect(span).toBe('enum');
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(EnumDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('a bare enum keyword yields a typed node and reports the missing name', () => {
    const source = 'enum';
    const { result, message, span } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "enum"');
    expect(span).toBe('enum');
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(EnumDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('namespace with a missing name yields a typed node', () => {
    const source = 'namespace {\n}';
    const { result, message, span } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "namespace"');
    expect(span).toBe('namespace');
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(NamespaceDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('namespace with a missing brace yields a typed node and reports the brace', () => {
    const source = 'namespace outer';
    const { result, message, span } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected "{" to open the "namespace" block');
    expect(span).toBe('namespace');
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(NamespaceDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('a bare namespace keyword yields a typed node and reports the missing name', () => {
    const source = 'namespace';
    const { result, message, span } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "namespace"');
    expect(span).toBe('namespace');
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(NamespaceDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('type with a name but no brace yields a composite type and reports the brace', () => {
    const source = 'type Address';
    const { result, message, span } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected "{" to open the "type" block');
    expect(span).toBe('type');
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(
      CompositeTypeDeclarationAst,
    );
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('a bare type keyword yields a types block and reports the missing brace', () => {
    const source = 'type';
    const { result, message, span } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected "{" to open the "type" block');
    expect(span).toBe('type');
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
    const { result, message, span } = diagnosticFor(source, 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK');
    expect(message).toBe('Unsupported top-level declaration "datasource"');
    expect(span).toBe('datasource');
    expect(result.diagnostics.map((d) => d.code)).not.toContain('PSL_INVALID_DECLARATION');
    expect(greenText(result.document.syntax.green)).toBe(source);
  });
});
