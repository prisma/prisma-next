import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { resolve } from '../src/resolve';
import { TypesBlockAst } from '../src/syntax/ast/declarations';
import {
  type ExpressionAst,
  FunctionCallAst,
  type NumberLiteralExprAst,
  ObjectLiteralExprAst,
  StringLiteralExprAst,
} from '../src/syntax/ast/expressions';
import type { GreenElement } from '../src/syntax/green';
import type { SyntaxNode } from '../src/syntax/red';

function greenText(element: GreenElement): string {
  if (element.type === 'token') return element.text;
  return element.children.map(greenText).join('');
}

function rawArgText(expr: ExpressionAst): string {
  let text = '';
  for (const token of expr.syntax.tokens()) {
    text += token.text;
  }
  return text;
}

function onlyTypeConstructorArgs(source: string): readonly ExpressionAst[] {
  const result = parse(source);
  expect(result.diagnostics).toHaveLength(0);
  expect(greenText(result.document.syntax.green)).toBe(source);
  const typesBlock = Array.from(result.document.declarations()).find(
    (decl): decl is TypesBlockAst => decl instanceof TypesBlockAst,
  );
  const named = Array.from(typesBlock?.declarations() ?? [])[0];
  const ctor = named?.typeAnnotation()?.constructorCall();
  if (!ctor) throw new Error('expected a type constructor call');
  return Array.from(ctor.args(), (arg) => arg.value()).filter(
    (v): v is ExpressionAst => v !== undefined,
  );
}

describe('parse() accepts single-quoted string literals (parsePslDocument parity)', () => {
  it('tokenizes a single-quoted positional argument and unquotes it via value()', () => {
    const args = onlyTypeConstructorArgs("types {\n  T = sql.Enum('Tag', ['a'])\n}\n");
    const first = args[0];
    expect(first).toBeInstanceOf(StringLiteralExprAst);
    expect(StringLiteralExprAst.cast((first as StringLiteralExprAst).syntax)?.value()).toBe('Tag');
  });

  it('tokenizes a single-quoted value inside an object-literal argument', () => {
    const args = onlyTypeConstructorArgs("types {\n  T = sql.String({ label: 'short' })\n}\n");
    const object = args[0];
    expect(object).toBeInstanceOf(ObjectLiteralExprAst);
    const field = Array.from((object as ObjectLiteralExprAst).fields())[0];
    const value = field?.value();
    expect(value).toBeInstanceOf(StringLiteralExprAst);
    expect((value as StringLiteralExprAst).value()).toBe('short');
    // The raw arg text round-trips the single quotes, matching the legacy reader.
    expect(rawArgText(object as ExpressionAst)).toBe("{ label: 'short' }");
  });

  it('unquotes both quote styles and decodes escaped single quotes', () => {
    const args = onlyTypeConstructorArgs('types {\n  T = sql.Enum(\'a\\\'b\', "c\\"d")\n}\n');
    expect((args[0] as StringLiteralExprAst).value()).toBe("a'b");
    expect((args[1] as StringLiteralExprAst).value()).toBe('c"d');
  });

  it('still diagnoses an unterminated single-quoted literal', () => {
    const source = "model M {\n  id Int @default('oops";
    const result = parse(source);
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_UNTERMINATED_STRING');
    expect(greenText(result.document.syntax.green)).toBe(source);
  });
});

describe('parse() accepts double-quoted object-literal keys (parsePslDocument parity)', () => {
  it('accepts a string-literal key with no diagnostic and exposes the unquoted name', () => {
    const args = onlyTypeConstructorArgs('types {\n  T = sql.String({ "length": 35 })\n}\n');
    const object = args[0] as ObjectLiteralExprAst;
    const field = Array.from(object.fields())[0];
    expect(field?.keyName()).toBe('length');
    expect((field?.value() as NumberLiteralExprAst | undefined)?.value()).toBe(35);
    expect(rawArgText(object)).toBe('{ "length": 35 }');
  });

  it('accepts a mix of identifier and string-literal keys', () => {
    const args = onlyTypeConstructorArgs(
      'types {\n  T = sql.String({ "length": 35, label: "short" })\n}\n',
    );
    const object = args[0] as ObjectLiteralExprAst;
    const keys = Array.from(object.fields(), (f) => f.keyName());
    expect(keys).toEqual(['length', 'label']);
  });
});

describe('parse() accepts qualified default-function calls (parsePslDocument parity)', () => {
  it('parses ns.fn() in default-value position as one qualified FunctionCall', () => {
    const source = 'model M {\n  id Int @default(temporal.updatedAt())\n}\n';
    const result = parse(source);
    expect(result.diagnostics).toHaveLength(0);
    expect(greenText(result.document.syntax.green)).toBe(source);

    const calls: FunctionCallAst[] = [];
    const visit = (node: SyntaxNode): void => {
      const call = FunctionCallAst.cast(node);
      if (call) calls.push(call);
      for (const child of node.childNodes()) visit(child);
    };
    visit(result.document.syntax);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path()).toEqual(['temporal', 'updatedAt']);
    // The raw text the downstream resolver reads is the full qualified call —
    // never split into a bare `temporal` plus a trailing parse error.
    expect(rawArgText(calls[0] as ExpressionAst)).toBe('temporal.updatedAt()');
  });
});

describe('resolve() reads qualified @@-block attributes (parsePslDocument parity)', () => {
  it('reconstructs the namespace-qualified name for a qualified model attribute', () => {
    const source = 'model M {\n  id Int\n  @@pgvector.index(length: 3)\n}\n';
    const result = parse(source);
    expect(result.diagnostics).toHaveLength(0);
    expect(greenText(result.document.syntax.green)).toBe(source);

    const resolved = resolve(result.document);
    const models = Array.from(resolved.namespaces.values()).flatMap((ns) =>
      Array.from(ns.models.values()),
    );
    const attribute = models[0]?.attributes[0];
    expect(attribute?.name).toBe('pgvector.index');
  });
});
