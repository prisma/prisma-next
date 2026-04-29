import type { Ctx } from '@prisma-next/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  jsonRuntimeParamsSchema,
  pgJsonbRuntimeFactory,
  pgJsonRuntimeFactory,
} from '../src/codecs/json-runtime-factory';

const ctx: Ctx = { name: '<anon:Doc.payload>', usedAt: [{ table: 'Doc', column: 'payload' }] };

const productJsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    price: { type: 'number' },
  },
  required: ['name', 'price'],
  additionalProperties: false,
} as const;

describe('jsonRuntimeParamsSchema', () => {
  it('accepts a serialized typeParams shape with a JSON Schema object', () => {
    const result = jsonRuntimeParamsSchema['~standard'].validate({
      schemaJson: productJsonSchema,
    });
    if (result instanceof Promise) throw new Error('expected sync validator');
    expect(result.issues).toBeUndefined();
  });

  it('accepts a serialized typeParams shape with optional `type` source string', () => {
    const result = jsonRuntimeParamsSchema['~standard'].validate({
      schemaJson: productJsonSchema,
      type: '{ name: string; price: number }',
    });
    if (result instanceof Promise) throw new Error('expected sync validator');
    expect(result.issues).toBeUndefined();
  });

  it('rejects params missing schemaJson', () => {
    const result = jsonRuntimeParamsSchema['~standard'].validate({});
    if (result instanceof Promise) throw new Error('expected sync validator');
    expect(result.issues).toBeDefined();
  });
});

describe('pgJsonRuntimeFactory', () => {
  // The first compileJsonSchemaValidator call cold-loads Ajv; allow the cold
  // path the same headroom the json-schema-validator suite uses.
  it('produces a JsonCodecInstance carrying a validate function', { timeout: 2000 }, () => {
    const codec = pgJsonRuntimeFactory({ schemaJson: productJsonSchema })(ctx);
    expect(codec.id).toBe('pg/json@1');
    expect(codec.targetTypes).toEqual(['json']);
    expect(codec.traits).toEqual(['json-validator']);
    expect(typeof codec.validate).toBe('function');
  });

  it('validate accepts payloads matching the JSON schema', () => {
    const codec = pgJsonRuntimeFactory({ schemaJson: productJsonSchema })(ctx);
    const result = codec.validate({ name: 'pen', price: 1.5 });
    expect(result.valid).toBe(true);
  });

  it('validate rejects payloads that violate the JSON schema', () => {
    const codec = pgJsonRuntimeFactory({ schemaJson: productJsonSchema })(ctx);
    const result = codec.validate({ name: 'pen' });
    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('decode passes wire through (validation lives on the codec.validate field)', () => {
    const codec = pgJsonRuntimeFactory({ schemaJson: productJsonSchema })(ctx);
    const wire = { name: 'pen', price: 1.5 };
    expect(codec.decode(wire)).toEqual(wire);
  });

  it('encodeJson / decodeJson are wire-level identity', () => {
    const codec = pgJsonRuntimeFactory({ schemaJson: productJsonSchema })(ctx);
    const value = { name: 'pen', price: 1.5 };
    expect(codec.encodeJson(value as never)).toEqual(value);
    expect(codec.decodeJson(value as never)).toEqual(value);
  });
});

describe('pgJsonbRuntimeFactory', () => {
  it('produces a JsonCodecInstance keyed under pg/jsonb@1', () => {
    const codec = pgJsonbRuntimeFactory({ schemaJson: productJsonSchema })(ctx);
    expect(codec.id).toBe('pg/jsonb@1');
    expect(codec.targetTypes).toEqual(['jsonb']);
    expect(codec.traits).toEqual(['json-validator']);
  });

  it('emits a different validator instance for each factory invocation', () => {
    const a = pgJsonbRuntimeFactory({ schemaJson: productJsonSchema })(ctx);
    const b = pgJsonbRuntimeFactory({ schemaJson: productJsonSchema })(ctx);
    expect(a).not.toBe(b);
    expect(a.validate).not.toBe(b.validate);
  });
});
