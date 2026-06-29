import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { describe, expect, it } from 'vitest';
import type { InterpretCtx } from '../src/exports';
import {
  enumOf,
  fieldAttribute,
  fieldRef,
  identifierName,
  interpretAttribute,
  list,
  str,
} from '../src/exports';
import { Cursor, parse, parseAttribute } from '../src/parse';
import type { SourceFile } from '../src/source-file';
import { buildSymbolTable } from '../src/symbol-table';
import { FieldAttributeAst } from '../src/syntax/ast/attributes';
import type { ExpressionAst } from '../src/syntax/ast/expressions';
import { createSyntaxTree } from '../src/syntax/red';

function makeCtx(
  sourceFile: SourceFile,
  diagnosticCode: PslDiagnostic['code'] = 'PSL_INVALID_ATTRIBUTE_SYNTAX',
): InterpretCtx {
  const { document, sourceFile: modelSource } = parse('model M {\n  id Int @id\n}\n');
  const { table } = buildSymbolTable({
    document,
    sourceFile: modelSource,
    scalarTypes: ['String', 'Int'],
    pslBlockDescriptors: {},
  });
  const selfModel = table.topLevel.models.M;
  if (!selfModel) throw new Error('expected model M in the symbol table');
  return {
    level: 'field',
    sourceId: 'schema.prisma',
    sourceFile,
    symbols: table,
    selfModel,
    resolveReferencedModel: () => undefined,
    diagnosticCode,
  };
}

/** Parses `@x(<exprSource>)` and returns the first argument's expression plus a context. */
function argOf(exprSource: string): { expr: ExpressionAst; ctx: InterpretCtx } {
  const cursor = new Cursor(`@x(${exprSource})`);
  const node = FieldAttributeAst.cast(createSyntaxTree(parseAttribute(cursor)));
  if (!node) throw new Error('expected a field attribute');
  const first = [...(node.argList()?.args() ?? [])][0];
  const expr = first?.value();
  if (!expr) throw new Error('expected an argument expression');
  return { expr, ctx: makeCtx(cursor.sourceFile) };
}

describe('str', () => {
  it('parses a quoted string into its value', () => {
    const { expr, ctx } = argOf('"Posts"');

    const result = str().parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('Posts');
  });

  it('rejects a non-string token with the threaded code', () => {
    const { expr, ctx } = argOf('42');

    const result = str().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });
});

describe('enumOf', () => {
  it('accepts a string member of a mixed set', () => {
    const { expr, ctx } = argOf('"Cascade"');

    const result = enumOf('Cascade', 'SetNull', 1, 2).parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('Cascade');
  });

  it('accepts a number member of a mixed set', () => {
    const { expr, ctx } = argOf('2');

    const result = enumOf('Cascade', 'SetNull', 1, 2).parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(2);
  });

  it('rejects a non-member of the set', () => {
    const { expr, ctx } = argOf('"Nope"');

    const result = enumOf('Cascade', 'SetNull').parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
  });

  it('rejects a token of the wrong kind', () => {
    const { expr, ctx } = argOf('["Cascade"]');

    const result = enumOf('Cascade', 1).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });
});

describe('fieldRef', () => {
  it('returns the bare identifier name', () => {
    const { expr, ctx } = argOf('title');

    const result = fieldRef('self').parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('title');
  });

  it('returns the name without emitting an existence diagnostic for an unknown field', () => {
    const { expr, ctx } = argOf('ghostField');

    const result = fieldRef('self').parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('ghostField');
  });

  it('carries the scope as combinator metadata', () => {
    expect(fieldRef('self').scope).toBe('self');
    expect(fieldRef('referenced').scope).toBe('referenced');
  });

  it('rejects a non-identifier token', () => {
    const { expr, ctx } = argOf('"title"');

    const result = fieldRef('self').parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
  });
});

describe('identifierName', () => {
  it('returns the bare identifier name', () => {
    const { expr, ctx } = argOf('Cascade');

    const result = identifierName().parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('Cascade');
  });

  it('returns an unknown identifier name without a set or existence check', () => {
    const { expr, ctx } = argOf('WeirdAction');

    const result = identifierName().parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('WeirdAction');
  });

  it('rejects a quoted string with the threaded code', () => {
    const { expr, ctx } = argOf('"Cascade"');

    const result = identifierName().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
  });
});

describe('list', () => {
  it('maps each element through the element combinator', () => {
    const { expr, ctx } = argOf('["a", "b"]');

    const result = list(str()).parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(['a', 'b']);
  });

  it('rejects an empty list when nonEmpty is set', () => {
    const { expr, ctx } = argOf('[]');

    const result = list(str(), { nonEmpty: true }).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });

  it('rejects duplicates when unique is set, anchored per offending element', () => {
    const { expr, ctx } = argOf('["a", "a"]');

    const result = list(str(), { unique: true }).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });

  it('propagates an element parse error', () => {
    const { expr, ctx } = argOf('["a", 1]');

    const result = list(str()).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
  });

  it('rejects a non-array argument', () => {
    const { expr, ctx } = argOf('"a"');

    const result = list(str()).parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });
});

describe('combinator code parity through interpretAttribute', () => {
  it('emits a leaf diagnostic carrying the spec diagnostic code', () => {
    const cursor = new Cursor('@rel(1)');
    const node = FieldAttributeAst.cast(createSyntaxTree(parseAttribute(cursor)));
    if (!node) throw new Error('expected a field attribute');
    const ctx = makeCtx(cursor.sourceFile);
    const spec = fieldAttribute('rel', {
      positional: [{ key: 'name', type: str() }],
      diagnosticCode: 'PSL_INVALID_RELATION_ATTRIBUTE',
    });

    const result = interpretAttribute(node, spec, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_RELATION_ATTRIBUTE');
    }
  });
});
