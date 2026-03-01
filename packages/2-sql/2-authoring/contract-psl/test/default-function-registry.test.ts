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
});
