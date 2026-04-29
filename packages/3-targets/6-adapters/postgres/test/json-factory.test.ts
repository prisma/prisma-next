import type { Ctx } from '@prisma-next/framework-components/codec';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { type as arktype } from 'arktype';
import { describe, expect, it } from 'vitest';
import { json, jsonb, pgJsonbCodec, pgJsonCodec } from '../src/codecs/json-factory';

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

    it('decode throws RUNTIME.JSON_SCHEMA_VALIDATION_FAILED when the schema validator is async', () => {
      // Standard Schema permits async validators; the factory rejects them at
      // decode time because the runtime decode path is synchronous.
      const asyncSchema: StandardSchemaV1<unknown, { ok: true }> = {
        '~standard': {
          version: 1,
          vendor: 'test-async',
          validate: () => Promise.resolve({ value: { ok: true } }),
        },
      };
      const codec = json(asyncSchema)(synthCtx);
      expect(() => codec.decode('{}')).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
          details: expect.objectContaining({ codecId: 'pg/json@1' }),
        }),
      );
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

  it('paramsSchema rejects a null input (must be an object)', () => {
    const result = pgJsonCodec.paramsSchema['~standard'].validate(null);
    if (result instanceof Promise) {
      throw new Error('paramsSchema validator must be synchronous');
    }
    expect(result.issues).toBeDefined();
  });

  it('paramsSchema rejects a primitive input', () => {
    const result = pgJsonCodec.paramsSchema['~standard'].validate('not-an-object');
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

    it('falls back to "unknown" for the legacy serialized typeParams shape', () => {
      // Pre-M4 contract IR carries `{ schemaJson, type? }` rather than `{ schema }`.
      // The descriptor's `renderOutputType` destructures `schema` (undefined here)
      // and the renderer routes to the `'unknown'` sentinel; the emit path then
      // falls through to the legacy serialized-typeParams renderer registered
      // separately. This test pins the sentinel behaviour at the descriptor edge.
      const rendered = pgJsonCodec.renderOutputType!({
        schemaJson: { type: 'object' },
      } as unknown as { schema: StandardSchemaV1 });
      expect(rendered).toBe('unknown');
    });
  });
});

describe('jsonb factory', () => {
  const auditSchema = arktype({ action: 'string', actorId: 'number' });

  it('produces a codec keyed under pg/jsonb@1', () => {
    const codec = jsonb(auditSchema)(synthCtx);
    expect(codec.id).toBe('pg/jsonb@1');
    expect(codec.targetTypes).toEqual(['jsonb']);
    expect(codec.traits).toEqual(['equality']);
  });

  it('decode validates against the schema and returns the parsed value', () => {
    const codec = jsonb(auditSchema)(synthCtx);
    const wire = JSON.stringify({ action: 'create', actorId: 7 });
    expect(codec.decode(wire)).toEqual({ action: 'create', actorId: 7 });
  });

  it('decode throws RUNTIME.JSON_SCHEMA_VALIDATION_FAILED on schema mismatch', () => {
    const codec = jsonb(auditSchema)(synthCtx);
    const wire = JSON.stringify({ action: 'create' });
    expect(() => codec.decode(wire)).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
        details: expect.objectContaining({ codecId: 'pg/jsonb@1' }),
      }),
    );
  });

  it('encode returns a JSON string of the value', () => {
    const codec = jsonb(auditSchema)(synthCtx);
    expect(codec.encode!({ action: 'create', actorId: 7 })).toBe(
      JSON.stringify({ action: 'create', actorId: 7 }),
    );
  });

  it('json round-trip is identity on the encodeJson / decodeJson surface', () => {
    const codec = jsonb(auditSchema)(synthCtx);
    const value = { action: 'update', actorId: 1 };
    const json = codec.encodeJson(value);
    expect(json).toEqual(value);
    expect(codec.decodeJson(json)).toEqual(value);
  });
});

describe('pgJsonbCodec descriptor', () => {
  const schema = arktype({ a: 'string' });

  it('codecId is pg/jsonb@1', () => {
    expect(pgJsonbCodec.codecId).toBe('pg/jsonb@1');
  });

  it('paramsSchema accepts a Standard Schema params.schema', () => {
    const result = pgJsonbCodec.paramsSchema['~standard'].validate({ schema });
    if (result instanceof Promise) throw new Error('expected sync validator');
    expect(result.issues).toBeUndefined();
  });

  it('paramsSchema rejects a missing schema field', () => {
    const result = pgJsonbCodec.paramsSchema['~standard'].validate({});
    if (result instanceof Promise) throw new Error('expected sync validator');
    expect(result.issues).toBeDefined();
  });

  it('factory unwraps params.schema and delegates to jsonb()', () => {
    const codec = pgJsonbCodec.factory({ schema })(synthCtx);
    expect(codec.id).toBe('pg/jsonb@1');
  });

  it('renderOutputType reads schema.expression for arktype schemas', () => {
    expect(pgJsonbCodec.renderOutputType!({ schema })).toBe(schema.expression);
  });
});
