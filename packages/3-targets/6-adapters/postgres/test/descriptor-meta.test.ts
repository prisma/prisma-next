import { describe, expect, it } from 'vitest';
import { postgresAdapterDescriptorMeta } from '../src/core/descriptor-meta';

type RenderFn = { kind: 'function'; render: (params: Record<string, unknown>) => string };

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

    it('falls back to JsonValue when no type or schema is provided', () => {
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
      expect(jsonbRenderer.render({ schema })).toBe('{ name: string }');
    });

    it('falls back to JsonValue when no schema or type', () => {
      expect(jsonbRenderer.render({ schema: null })).toBe('JsonValue');
    });

    it('falls back to JsonValue for non-object schema', () => {
      expect(jsonbRenderer.render({ schema: 'not an object' })).toBe('JsonValue');
    });
  });

  describe('type expression takes precedence over schema', () => {
    it('uses type when both type and schema are provided', () => {
      expect(
        jsonbRenderer.render({
          type: '{ custom: true }',
          schema: { type: 'object', properties: { other: { type: 'string' } } },
        }),
      ).toBe('{ custom: true }');
    });
  });
});
