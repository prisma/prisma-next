import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { ok } from '@prisma-next/utils/result';
import { describe, expect, it } from 'vitest';
import type { ArgType, InterpretCtx } from '../src/exports';
import {
  fieldAttribute,
  fieldRef,
  identifier,
  interpretAttribute,
  list,
  nodePslSpan,
  oneOf,
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
    selfModel,
    resolveReferencedModel: () => undefined,
    diagnosticCode,
  };
}

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

describe('identifier', () => {
  it('matches a bare identifier equal to the pinned name', () => {
    const { expr, ctx } = argOf('Cascade');

    const result = identifier('Cascade').parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('Cascade');
  });

  it('rejects a bare identifier with a different name', () => {
    const { expr, ctx } = argOf('Cascade');

    const result = identifier('NoAction').parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });

  it('rejects a quoted string with the same characters', () => {
    const { expr, ctx } = argOf('"Cascade"');

    const result = identifier('Cascade').parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });

  it('rejects a number token', () => {
    const { expr, ctx } = argOf('1');

    const result = identifier('Cascade').parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });
});

describe('oneOf', () => {
  it('returns the first alternative that succeeds', () => {
    const { expr, ctx } = argOf('Cascade');
    const first: ArgType<'first'> = { kind: 'const', label: 'first', parse: () => ok('first') };
    const second: ArgType<'second'> = { kind: 'const', label: 'second', parse: () => ok('second') };

    const result = oneOf(first, second).parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('first');
  });

  it('matches whichever alternative accepts the argument', () => {
    const { expr, ctx } = argOf('SetNull');

    const result = oneOf(identifier('Cascade'), identifier('SetNull')).parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('SetNull');
  });

  it('emits a single aggregate diagnostic anchored to the arg node when every alternative fails', () => {
    const { expr, ctx } = argOf('WeirdAction');
    const relationCtx: InterpretCtx = { ...ctx, diagnosticCode: 'PSL_INVALID_RELATION_ATTRIBUTE' };

    const result = oneOf(identifier('Cascade'), identifier('SetNull')).parse(expr, relationCtx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_RELATION_ATTRIBUTE');
      expect(result.failure[0]?.span).toEqual(nodePslSpan(expr.syntax, ctx.sourceFile));
      expect(result.failure[0]?.message).toContain('Cascade');
      expect(result.failure[0]?.message).toContain('SetNull');
    }
  });
});

describe('fieldRef', () => {
  it('resolves a field that exists on the self model', () => {
    const { expr, ctx } = argOf('id');

    const result = fieldRef('self').parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('id');
  });

  it('emits an existence diagnostic for a field missing from the self model', () => {
    const { expr, ctx } = argOf('ghostField');

    const result = fieldRef('self').parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    }
  });

  it('resolves a field against the referenced model when it is in scope', () => {
    const { expr, ctx } = argOf('id');
    const referencedCtx: InterpretCtx = { ...ctx, resolveReferencedModel: () => ctx.selfModel };

    const result = fieldRef('referenced').parse(expr, referencedCtx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('id');
  });

  it('carries a referenced name through when the referenced model is out of scope', () => {
    const { expr, ctx } = argOf('ghostField');

    const result = fieldRef('referenced').parse(expr, ctx);

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

  it('accepts a populated list when nonEmpty is set', () => {
    const { expr, ctx } = argOf('["a", "b"]');

    const result = list(str(), { nonEmpty: true }).parse(expr, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(['a', 'b']);
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
