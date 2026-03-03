import type { PslSpan } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import {
  createBuiltinDefaultFunctionRegistry,
  type DefaultFunctionLoweringHandler,
  lowerDefaultFunctionWithRegistry,
  parseDefaultFunctionCall,
} from '../src/default-function-registry';

function createSpan(overrides?: Partial<PslSpan['start']>): PslSpan {
  return {
    start: {
      offset: overrides?.offset ?? 0,
      line: overrides?.line ?? 1,
      column: overrides?.column ?? 1,
    },
    end: {
      offset: overrides?.offset ?? 0,
      line: overrides?.line ?? 1,
      column: overrides?.column ?? 1,
    },
  };
}

const loweringContext = {
  sourceId: 'schema.prisma',
  modelName: 'User',
  fieldName: 'id',
} as const;

describe('default function registry', () => {
  it('returns undefined for invalid function-call shapes', () => {
    expect(parseDefaultFunctionCall('uuid', createSpan())).toBeUndefined();
    expect(parseDefaultFunctionCall('uuid(4', createSpan())).toBeUndefined();
    expect(parseDefaultFunctionCall('4uuid()', createSpan())).toBeUndefined();
  });

  it('parses top-level args with nested commas and escapes', () => {
    const call = parseDefaultFunctionCall(
      String.raw`fn("a,b", inner(1, 2), [x, y], "escaped \"quote\"")`,
      createSpan(),
    );

    expect(call).toBeDefined();
    if (!call) return;

    expect(call.args.map((arg) => arg.raw)).toEqual([
      '"a,b"',
      'inner(1, 2)',
      '[x, y]',
      String.raw`"escaped \"quote\""`,
    ]);
  });

  it('rejects empty argument slots in function calls', () => {
    expect(parseDefaultFunctionCall('uuid(4, )', createSpan())).toBeUndefined();
    expect(parseDefaultFunctionCall('uuid(,4)', createSpan())).toBeUndefined();
    expect(parseDefaultFunctionCall('uuid(,)', createSpan())).toBeUndefined();
  });

  it('computes multiline spans for parsed function calls', () => {
    const call = parseDefaultFunctionCall(
      `dbgenerated(
  "gen_random_uuid()"
)`,
      createSpan({ offset: 10, line: 3, column: 4 }),
    );

    expect(call).toBeDefined();
    if (!call) return;

    expect(call.span.start).toMatchObject({ line: 3, column: 4 });
    expect(call.span.end).toMatchObject({ line: 5, column: 2 });
    expect(call.args).toHaveLength(1);
    expect(call.args[0]?.span.start).toMatchObject({ line: 4, column: 3 });
  });

  it('handles carriage-return line breaks in spans', () => {
    const call = parseDefaultFunctionCall(
      `dbgenerated(\r\n  "gen_random_uuid()"\r\n)`,
      createSpan({ offset: 2, line: 9, column: 8 }),
    );

    expect(call).toBeDefined();
    if (!call) return;

    expect(call.span.start).toMatchObject({ line: 9, column: 8 });
    expect(call.span.end).toMatchObject({ line: 11, column: 2 });
  });

  it('lowers cuid(2) and rejects cuid() with actionable guidance', () => {
    const registry = createBuiltinDefaultFunctionRegistry();
    const cuid2Call = parseDefaultFunctionCall('cuid(2)', createSpan());
    const cuidCall = parseDefaultFunctionCall('cuid()', createSpan({ line: 7 }));

    expect(cuid2Call).toBeDefined();
    expect(cuidCall).toBeDefined();
    if (!cuid2Call || !cuidCall) return;

    const loweredCuid2 = lowerDefaultFunctionWithRegistry({
      call: cuid2Call,
      registry,
      context: loweringContext,
    });
    expect(loweredCuid2.ok).toBe(true);
    if (!loweredCuid2.ok) return;
    expect(loweredCuid2.value).toMatchObject({
      kind: 'execution',
      generated: { kind: 'generator', id: 'cuid2' },
    });

    const loweredCuid = lowerDefaultFunctionWithRegistry({
      call: cuidCall,
      registry,
      context: loweringContext,
    });
    expect(loweredCuid.ok).toBe(false);
    if (loweredCuid.ok) return;
    expect(loweredCuid.diagnostic).toMatchObject({
      code: 'PSL_UNKNOWN_DEFAULT_FUNCTION',
      message: expect.stringContaining('Use `cuid(2)`'),
    });
  });

  it('derives unknown-function supported list from registry keys', () => {
    const customRegistry = new Map<string, DefaultFunctionLoweringHandler>([
      [
        'custom',
        () => ({
          ok: true,
          value: {
            kind: 'storage',
            defaultValue: {
              kind: 'function',
              expression: 'custom()',
            },
          },
        }),
      ],
    ]);
    const unknownCall = parseDefaultFunctionCall('mystery()', createSpan());

    expect(unknownCall).toBeDefined();
    if (!unknownCall) return;

    const loweredUnknown = lowerDefaultFunctionWithRegistry({
      call: unknownCall,
      registry: customRegistry,
      context: loweringContext,
    });

    expect(loweredUnknown.ok).toBe(false);
    if (loweredUnknown.ok) return;

    expect(loweredUnknown.diagnostic.message).toContain('Supported functions: custom().');
    expect(loweredUnknown.diagnostic.message).not.toContain('autoincrement()');
  });

  it('includes additive suggestion for known mistyped generator ids', () => {
    const unknownCall = parseDefaultFunctionCall('uuidv7()', createSpan());
    const registry = createBuiltinDefaultFunctionRegistry();

    expect(unknownCall).toBeDefined();
    if (!unknownCall) return;

    const loweredUnknown = lowerDefaultFunctionWithRegistry({
      call: unknownCall,
      registry,
      context: loweringContext,
    });
    expect(loweredUnknown.ok).toBe(false);
    if (loweredUnknown.ok) return;

    expect(loweredUnknown.diagnostic.message).toContain('Use `uuid(7)`.');
  });

  it('preserves escaped dbgenerated string content', () => {
    const registry = createBuiltinDefaultFunctionRegistry();
    const call = parseDefaultFunctionCall(
      String.raw`dbgenerated("nextval(\"public\".\"user_id_seq\")")`,
      createSpan(),
    );

    expect(call).toBeDefined();
    if (!call) return;

    const lowered = lowerDefaultFunctionWithRegistry({
      call,
      registry,
      context: loweringContext,
    });
    expect(lowered.ok).toBe(true);
    if (!lowered.ok) return;

    expect(lowered.value).toMatchObject({
      kind: 'storage',
      defaultValue: {
        kind: 'function',
        expression: String.raw`nextval(\"public\".\"user_id_seq\")`,
      },
    });
  });

  it('returns diagnostics for nanoid and dbgenerated invalid argument shapes', () => {
    const registry = createBuiltinDefaultFunctionRegistry();
    const badNanoidCall = parseDefaultFunctionCall('nanoid(16, 32)', createSpan());
    const missingDbgeneratedArgCall = parseDefaultFunctionCall('dbgenerated()', createSpan());
    const nonStringDbgeneratedArgCall = parseDefaultFunctionCall('dbgenerated(123)', createSpan());

    expect(badNanoidCall).toBeDefined();
    expect(missingDbgeneratedArgCall).toBeDefined();
    expect(nonStringDbgeneratedArgCall).toBeDefined();
    if (!badNanoidCall || !missingDbgeneratedArgCall || !nonStringDbgeneratedArgCall) return;

    const badNanoid = lowerDefaultFunctionWithRegistry({
      call: badNanoidCall,
      registry,
      context: loweringContext,
    });
    expect(badNanoid.ok).toBe(false);
    if (!badNanoid.ok) {
      expect(badNanoid.diagnostic.message).toContain('nanoid');
    }

    const missingDbgeneratedArg = lowerDefaultFunctionWithRegistry({
      call: missingDbgeneratedArgCall,
      registry,
      context: loweringContext,
    });
    expect(missingDbgeneratedArg.ok).toBe(false);
    if (!missingDbgeneratedArg.ok) {
      expect(missingDbgeneratedArg.diagnostic.message).toContain(
        'requires exactly one string argument',
      );
    }

    const nonStringDbgeneratedArg = lowerDefaultFunctionWithRegistry({
      call: nonStringDbgeneratedArgCall,
      registry,
      context: loweringContext,
    });
    expect(nonStringDbgeneratedArg.ok).toBe(false);
    if (!nonStringDbgeneratedArg.ok) {
      expect(nonStringDbgeneratedArg.diagnostic.message).toContain('must be a string literal');
    }
  });
});
