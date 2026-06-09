import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { DocumentAst } from '../src/syntax/ast/declarations';
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

  it('reports an unsupported top-level block when a brace follows', () => {
    const source = 'model {\n}';
    const { message, span } = diagnosticFor(source, 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK');
    expect(message).toBe('Unsupported top-level block "model"');
    expect(span).toBe('model');
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

  it('reports a second top-level types block', () => {
    const source = 'type {\n}\ntype {\n}';
    const { message, span } = diagnosticFor(source, 'PSL_INVALID_TYPES_MEMBER');
    expect(message).toBe('Only one top-level `types` block is allowed per document');
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
