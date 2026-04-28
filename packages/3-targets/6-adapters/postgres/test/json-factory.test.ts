import type { Ctx } from '@prisma-next/framework-components/codec';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { type as arktype } from 'arktype';
import { describe, expect, it } from 'vitest';
import { json, pgJsonCodec } from '../src/codecs/json-factory';

const synthCtx: Ctx = {
  name: '<anon:test.metadata>',
  usedAt: [{ table: 'test', column: 'metadata' }],
};

describe('json factory', () => {
  describe('decode runtime validation', () => {
    const productSchema = arktype({
      name: 'string',
      price: 'number',
    });

    it('decode returns the parsed value when payload matches schema', () => {
      const codec = json(productSchema)(synthCtx);
      const wire = JSON.stringify({ name: 'pen', price: 1.5 });
      expect(codec.decode(wire)).toEqual({ name: 'pen', price: 1.5 });
    });

    it('decode throws RUNTIME.JSON_SCHEMA_VALIDATION_FAILED when the parsed value misses a required field', () => {
      const codec = json(productSchema)(synthCtx);
      const wire = JSON.stringify({ name: 'pen' });
      expect(() => codec.decode(wire)).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
          category: 'RUNTIME',
          details: expect.objectContaining({ codecId: 'pg/json@1' }),
        }),
      );
    });

    it('decode throws when the parsed value has wrong type for a field', () => {
      const codec = json(productSchema)(synthCtx);
      const wire = JSON.stringify({ name: 'pen', price: 'free' });
      expect(() => codec.decode(wire)).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
          details: expect.objectContaining({ codecId: 'pg/json@1' }),
        }),
      );
    });

    it('decode throws when the wire is not valid JSON', () => {
      const codec = json(productSchema)(synthCtx);
      expect(() => codec.decode('not-json')).toThrow();
    });

    it('encode returns a JSON string of the value', () => {
      const codec = json(productSchema)(synthCtx);
      expect(codec.encode!({ name: 'pen', price: 1.5 })).toBe(
        JSON.stringify({ name: 'pen', price: 1.5 }),
      );
    });
  });

  describe('codec metadata', () => {
    const schema = arktype({ a: 'string' });

    it('codec.id is pg/json@1', () => {
      const codec = json(schema)(synthCtx);
      expect(codec.id).toBe('pg/json@1');
    });

    it('codec.targetTypes is ["json"]', () => {
      const codec = json(schema)(synthCtx);
      expect(codec.targetTypes).toEqual(['json']);
    });

    it('codec.traits is ["equality"]', () => {
      const codec = json(schema)(synthCtx);
      expect(codec.traits).toEqual(['equality']);
    });
  });

  describe('factory invocation lifecycle', () => {
    const schema = arktype({ a: 'string' });

    it('returns a function that captures ctx (factory is curried)', () => {
      const partial = json(schema);
      expect(typeof partial).toBe('function');
      const codec = partial(synthCtx);
      expect(codec).toMatchObject({ id: 'pg/json@1' });
    });

    it('two factory invocations with the same schema produce independent codec instances', () => {
      const partial = json(schema);
      const a = partial(synthCtx);
      const b = partial(synthCtx);
      expect(a).not.toBe(b);
      // both decode the same payload identically
      const wire = JSON.stringify({ a: 'x' });
      expect(a.decode(wire)).toEqual({ a: 'x' });
      expect(b.decode(wire)).toEqual({ a: 'x' });
    });
  });
});

describe('pgJsonCodec descriptor', () => {
  it('codecId matches the codec returned by the factory', () => {
    expect(pgJsonCodec.codecId).toBe('pg/json@1');
  });

  it('paramsSchema is a Standard Schema validator', () => {
    expect(pgJsonCodec.paramsSchema).toBeDefined();
    expect(pgJsonCodec.paramsSchema['~standard']).toBeDefined();
  });

  it('paramsSchema rejects params whose schema field is missing', () => {
    const result = pgJsonCodec.paramsSchema['~standard'].validate({});
    if (result instanceof Promise) {
      throw new Error('paramsSchema validator must be synchronous');
    }
    expect(result.issues).toBeDefined();
  });

  it('paramsSchema rejects params whose schema field is not a Standard Schema', () => {
    const result = pgJsonCodec.paramsSchema['~standard'].validate({ schema: 42 });
    if (result instanceof Promise) {
      throw new Error('paramsSchema validator must be synchronous');
    }
    expect(result.issues).toBeDefined();
  });

  it('paramsSchema accepts params whose schema field is a Standard Schema', () => {
    const schema = arktype({ a: 'string' });
    const result = pgJsonCodec.paramsSchema['~standard'].validate({ schema });
    if (result instanceof Promise) {
      throw new Error('paramsSchema validator must be synchronous');
    }
    expect(result.issues).toBeUndefined();
  });

  it('factory unwraps params.schema and delegates to json()', () => {
    const schema = arktype({ a: 'string' });
    const codec = pgJsonCodec.factory({ schema })(synthCtx);
    expect(codec.id).toBe('pg/json@1');
    const wire = JSON.stringify({ a: 'x' });
    expect(codec.decode(wire)).toEqual({ a: 'x' });
  });

  describe('renderOutputType', () => {
    it('returns the schema.expression when present (arktype path)', () => {
      const schema = arktype({ a: 'string' });
      // arktype Type carries `.expression: string` — verify the renderer reads it.
      expect(typeof schema.expression).toBe('string');
      const rendered = pgJsonCodec.renderOutputType!({ schema });
      expect(rendered).toBe(schema.expression);
    });

    it('produces the expected TS source for a representative arktype schema (snapshot)', () => {
      const schema = arktype({
        action: 'string',
        actorId: 'number',
      });
      const rendered = pgJsonCodec.renderOutputType!({ schema });
      expect(rendered).toMatchInlineSnapshot(`"{ action: string, actorId: number }"`);
    });

    it('falls back to "unknown" for schemas without an expression', () => {
      const schemaWithoutExpression: StandardSchemaV1 = {
        '~standard': {
          version: 1,
          vendor: 'fixture',
          validate: (value: unknown) => ({ value }),
        },
      };
      const rendered = pgJsonCodec.renderOutputType!({ schema: schemaWithoutExpression });
      expect(rendered).toBe('unknown');
    });
  });
});
