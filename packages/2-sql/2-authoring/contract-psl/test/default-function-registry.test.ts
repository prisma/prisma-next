import type {
  DefaultFunctionRegistryEntry,
  ParsedDefaultFunctionCall,
} from '@prisma-next/framework-components/control';
import type { PslSpan } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import { lowerDefaultFunctionWithRegistry } from '../src/default-function-registry';
import { createBuiltinLikeControlMutationDefaults } from './fixtures';

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

function call(name: string, args: readonly string[]): ParsedDefaultFunctionCall {
  const span = createSpan();
  return {
    name,
    raw: `${name}(${args.join(', ')})`,
    args: args.map((raw) => ({ raw, span })),
    span,
  };
}

const loweringContext = {
  sourceId: 'schema.prisma',
  modelName: 'User',
  fieldName: 'id',
} as const;

describe('default function registry', () => {
  const builtinRegistry = createBuiltinLikeControlMutationDefaults().defaultFunctionRegistry;

  it('lowers cuid(2) and rejects cuid() with actionable guidance', () => {
    const registry = builtinRegistry;

    const loweredCuid2 = lowerDefaultFunctionWithRegistry({
      call: call('cuid', ['2']),
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
      call: call('cuid', []),
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
    const customRegistry = new Map<string, DefaultFunctionRegistryEntry>([
      [
        'custom',
        {
          lower: () => ({
            ok: true,
            value: {
              kind: 'storage',
              defaultValue: {
                kind: 'function',
                expression: 'custom()',
              },
            },
          }),
        },
      ],
    ]);

    const loweredUnknown = lowerDefaultFunctionWithRegistry({
      call: call('mystery', []),
      registry: customRegistry,
      context: loweringContext,
    });

    expect(loweredUnknown.ok).toBe(false);
    if (loweredUnknown.ok) return;

    expect(loweredUnknown.diagnostic.message).toContain('Supported functions: custom().');
    expect(loweredUnknown.diagnostic.message).not.toContain('autoincrement()');
  });

  it('uses contributed usage signatures when provided', () => {
    const customRegistry = new Map<string, DefaultFunctionRegistryEntry>([
      [
        'custom',
        {
          lower: () => ({
            ok: true,
            value: {
              kind: 'storage',
              defaultValue: {
                kind: 'function',
                expression: 'custom()',
              },
            },
          }),
          usageSignatures: ['custom(size)'],
        },
      ],
    ]);

    const loweredUnknown = lowerDefaultFunctionWithRegistry({
      call: call('mystery', []),
      registry: customRegistry,
      context: loweringContext,
    });

    expect(loweredUnknown.ok).toBe(false);
    if (loweredUnknown.ok) return;
    expect(loweredUnknown.diagnostic.message).toContain('custom(size)');
    expect(loweredUnknown.diagnostic.message).not.toContain('custom().');
  });

  it('lists supported signatures for unknown generator-like function names', () => {
    const registry = builtinRegistry;

    const loweredUnknown = lowerDefaultFunctionWithRegistry({
      call: call('uuidv7', []),
      registry,
      context: loweringContext,
    });
    expect(loweredUnknown.ok).toBe(false);
    if (loweredUnknown.ok) return;

    expect(loweredUnknown.diagnostic.message).toContain('uuid(7)');
  });

  it('preserves escaped dbgenerated string content', () => {
    const registry = builtinRegistry;

    const lowered = lowerDefaultFunctionWithRegistry({
      call: call('dbgenerated', [String.raw`"nextval(\"public\".\"user_id_seq\")"`]),
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
    const registry = builtinRegistry;

    const badNanoid = lowerDefaultFunctionWithRegistry({
      call: call('nanoid', ['16', '32']),
      registry,
      context: loweringContext,
    });
    expect(badNanoid.ok).toBe(false);
    if (!badNanoid.ok) {
      expect(badNanoid.diagnostic.message).toContain('nanoid');
    }

    const missingDbgeneratedArg = lowerDefaultFunctionWithRegistry({
      call: call('dbgenerated', []),
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
      call: call('dbgenerated', ['123']),
      registry,
      context: loweringContext,
    });
    expect(nonStringDbgeneratedArg.ok).toBe(false);
    if (!nonStringDbgeneratedArg.ok) {
      expect(nonStringDbgeneratedArg.diagnostic.message).toContain('must be a string literal');
    }
  });
});
