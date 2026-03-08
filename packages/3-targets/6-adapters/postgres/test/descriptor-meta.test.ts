import { describe, expect, it } from 'vitest';
import { postgresAdapterDescriptorMeta } from '../src/core/descriptor-meta';

type RenderFn = { kind: 'function'; render: (params: Record<string, unknown>) => string };
type ExpandFn = (input: { nativeType: string; typeParams?: Record<string, unknown> }) => string;
type HooksMap = Record<string, { expandNativeType: ExpandFn }>;

const jsonbRenderer = postgresAdapterDescriptorMeta.types.codecTypes.parameterized[
  'pg/jsonb@1'
] as RenderFn;
const jsonRenderer = postgresAdapterDescriptorMeta.types.codecTypes.parameterized[
  'pg/json@1'
] as RenderFn;

describe('renderJsonTypeExpression via descriptor-meta', () => {
  describe('type expression path', () => {
    it('renders valid type expression from params.type', () => {
      expect(jsonbRenderer.render({ type: '{ name: string }' })).toBe('{ name: string }');
    });

    it('falls back to JsonValue for empty type', () => {
      expect(jsonbRenderer.render({ type: '' })).toBe('JsonValue');
    });

    it('falls back to JsonValue for whitespace-only type', () => {
      expect(jsonbRenderer.render({ type: '   ' })).toBe('JsonValue');
    });

    it('falls back to JsonValue when no type or schemaJson is provided', () => {
      expect(jsonbRenderer.render({})).toBe('JsonValue');
    });

    it('uses json renderer identically to jsonb renderer', () => {
      expect(jsonRenderer.render({ type: 'number' })).toBe('number');
    });
  });

  describe('isSafeTypeExpression rejects dangerous patterns in type path', () => {
    it('rejects import() expressions', () => {
      expect(jsonbRenderer.render({ type: "import('fs').PathLike" })).toBe('JsonValue');
    });

    it('rejects import with spaces', () => {
      expect(jsonbRenderer.render({ type: 'import  ("malicious")' })).toBe('JsonValue');
    });

    it('rejects require() expressions', () => {
      expect(jsonbRenderer.render({ type: "require('child_process')" })).toBe('JsonValue');
    });

    it('rejects declare statements', () => {
      expect(jsonbRenderer.render({ type: "declare module 'foo' {}" })).toBe('JsonValue');
    });

    it('rejects export statements', () => {
      expect(jsonbRenderer.render({ type: 'export const x = 1' })).toBe('JsonValue');
    });

    it('rejects eval() expressions', () => {
      expect(jsonbRenderer.render({ type: "eval('code')" })).toBe('JsonValue');
    });

    it('allows safe type expressions', () => {
      expect(jsonbRenderer.render({ type: 'string | number' })).toBe('string | number');
    });

    it('allows complex but safe type expressions', () => {
      expect(jsonbRenderer.render({ type: '{ a: string; b: number[] }' })).toBe(
        '{ a: string; b: number[] }',
      );
    });
  });

  describe('isSafeTypeExpression applied to JSON Schema renderer output', () => {
    it('renders safe JSON Schema types normally', () => {
      const schema = {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      };
      expect(jsonbRenderer.render({ schemaJson: schema })).toBe('{ name: string }');
    });

    it('falls back to JsonValue when no schemaJson or type', () => {
      expect(jsonbRenderer.render({ schemaJson: null })).toBe('JsonValue');
    });

    it('falls back to JsonValue for non-object schemaJson', () => {
      expect(jsonbRenderer.render({ schemaJson: 'not an object' })).toBe('JsonValue');
    });
  });

  describe('type expression takes precedence over schemaJson', () => {
    it('uses type when both type and schemaJson are provided', () => {
      expect(
        jsonbRenderer.render({
          type: '{ custom: true }',
          schemaJson: { type: 'object', properties: { other: { type: 'string' } } },
        }),
      ).toBe('{ custom: true }');
    });
  });
});

const hooks = postgresAdapterDescriptorMeta.types.codecTypes.controlPlaneHooks as HooksMap;

describe('expandNativeType hooks via descriptor-meta', () => {
  describe('expandLength (sql/char, sql/varchar, pg/char, pg/varchar, pg/bit, pg/varbit)', () => {
    const expand = hooks['sql/char@1']!.expandNativeType;

    it('appends length param to native type', () => {
      expect(expand({ nativeType: 'character', typeParams: { length: 10 } })).toBe('character(10)');
    });

    it('returns bare native type when typeParams is missing', () => {
      expect(expand({ nativeType: 'character' })).toBe('character');
    });

    it('returns bare native type when length is absent', () => {
      expect(expand({ nativeType: 'character', typeParams: {} })).toBe('character');
    });

    it('returns bare native type for non-integer length', () => {
      expect(expand({ nativeType: 'character', typeParams: { length: 1.5 } })).toBe('character');
    });

    it('returns bare native type for negative length', () => {
      expect(expand({ nativeType: 'character', typeParams: { length: -1 } })).toBe('character');
    });

    it('returns bare native type for non-number length', () => {
      expect(expand({ nativeType: 'character', typeParams: { length: 'big' } })).toBe('character');
    });
  });

  describe('expandPrecision (pg/timestamp, pg/timestamptz, pg/time, pg/timetz, pg/interval)', () => {
    const expand = hooks['pg/timestamp@1']!.expandNativeType;

    it('appends precision param to native type', () => {
      expect(expand({ nativeType: 'timestamp', typeParams: { precision: 3 } })).toBe(
        'timestamp(3)',
      );
    });

    it('returns bare native type when typeParams is missing', () => {
      expect(expand({ nativeType: 'timestamp' })).toBe('timestamp');
    });

    it('returns bare native type when precision is absent', () => {
      expect(expand({ nativeType: 'timestamp', typeParams: {} })).toBe('timestamp');
    });

    it('returns bare native type for non-integer precision', () => {
      expect(expand({ nativeType: 'timestamp', typeParams: { precision: 2.5 } })).toBe('timestamp');
    });

    it('returns bare native type for negative precision', () => {
      expect(expand({ nativeType: 'timestamp', typeParams: { precision: -1 } })).toBe('timestamp');
    });
  });

  describe('expandNumeric (pg/numeric)', () => {
    const expand = hooks['pg/numeric@1']!.expandNativeType;

    it('appends precision only when scale is absent', () => {
      expect(expand({ nativeType: 'numeric', typeParams: { precision: 10 } })).toBe('numeric(10)');
    });

    it('appends precision and scale when both are present', () => {
      expect(expand({ nativeType: 'numeric', typeParams: { precision: 10, scale: 2 } })).toBe(
        'numeric(10,2)',
      );
    });

    it('returns bare native type when typeParams is missing', () => {
      expect(expand({ nativeType: 'numeric' })).toBe('numeric');
    });

    it('returns bare native type when precision is absent', () => {
      expect(expand({ nativeType: 'numeric', typeParams: {} })).toBe('numeric');
    });

    it('ignores scale when precision is absent', () => {
      expect(expand({ nativeType: 'numeric', typeParams: { scale: 2 } })).toBe('numeric');
    });

    it('returns bare native type for negative precision', () => {
      expect(expand({ nativeType: 'numeric', typeParams: { precision: -5 } })).toBe('numeric');
    });

    it('ignores non-integer scale', () => {
      expect(expand({ nativeType: 'numeric', typeParams: { precision: 10, scale: 1.5 } })).toBe(
        'numeric(10)',
      );
    });
  });
});
