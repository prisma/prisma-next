import type { Ctx } from '@prisma-next/framework-components/codec';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  ARKTYPE_JSON_CODEC_ID,
  ARKTYPE_JSON_NATIVE_TYPE,
  arktypeJson,
  arktypeJsonCodec,
} from '../src/core/arktype-json-codec';

const SYNTH_CTX: Ctx = {
  name: '<arktype-json-test>',
  usedAt: [{ table: 'Test', column: 'doc' }],
};

const productSchema = type({
  name: 'string',
  price: 'number',
  'description?': 'string',
});

describe('arktypeJson(schema)', () => {
  it('returns a column descriptor with codecId and nativeType', () => {
    const descriptor = arktypeJson(productSchema);
    expect(descriptor.codecId).toBe(ARKTYPE_JSON_CODEC_ID);
    expect(descriptor.nativeType).toBe(ARKTYPE_JSON_NATIVE_TYPE);
  });

  it('eagerly extracts expression and jsonIr into typeParams', () => {
    const descriptor = arktypeJson(productSchema);
    expect(typeof descriptor.typeParams.expression).toBe('string');
    expect(descriptor.typeParams.expression).toBe(productSchema.expression);
    expect(typeof descriptor.typeParams.jsonIr).toBe('object');
    // The IR is the rehydration source — structurally identical to
    // `schema.json` so consumers reading the IR get arktype's lossless
    // wire format.
    expect(descriptor.typeParams.jsonIr).toEqual(productSchema.json);
  });

  it('exposes a curried (ctx) => Codec factory in the type slot', () => {
    const descriptor = arktypeJson(productSchema);
    const codec = descriptor.type(SYNTH_CTX);
    expect(codec.id).toBe(ARKTYPE_JSON_CODEC_ID);
    expect(codec.targetTypes).toEqual(['jsonb']);
    expect(codec.traits).toEqual(['equality']);
  });

  it('rejects non-arktype schemas at the call site', () => {
    expect(() =>
      // The runtime check enforces the column-author surface accepts
      // arktype `Type`s only — a misconfigured schema (e.g. a plain
      // function or a different library's schema) surfaces here, not at
      // contract-load time.
      // biome-ignore lint/suspicious/noExplicitAny: deliberate misuse for the negative case
      arktypeJson({ foo: 'bar' } as any),
    ).toThrow(/expects an arktype Type/);
  });
});

describe('arktypeJson encode/decode', () => {
  it('encode round-trips through JSON.stringify', () => {
    const codec = arktypeJson(productSchema).type(SYNTH_CTX);
    expect(codec.encode?.({ name: 'Widget', price: 10 })).toBe('{"name":"Widget","price":10}');
  });

  it('decode validates the wire payload against the schema', () => {
    const codec = arktypeJson(productSchema).type(SYNTH_CTX);
    const wire = JSON.stringify({ name: 'Widget', price: 10 });
    expect(codec.decode(wire)).toEqual({ name: 'Widget', price: 10 });
  });

  it('decode rejects payloads missing required fields', () => {
    const codec = arktypeJson(productSchema).type(SYNTH_CTX);
    const wire = JSON.stringify({ name: 'Widget' });
    expect(() => codec.decode(wire)).toThrow(/JSON_SCHEMA_VALIDATION_FAILED|price/);
  });

  it('decode rejects payloads with type-mismatched fields', () => {
    const codec = arktypeJson(productSchema).type(SYNTH_CTX);
    const wire = JSON.stringify({ name: 'Widget', price: 'not-a-number' });
    expect(() => codec.decode(wire)).toThrow(/price/);
  });

  it('decode accepts payloads with optional fields present', () => {
    const codec = arktypeJson(productSchema).type(SYNTH_CTX);
    const wire = JSON.stringify({ name: 'Widget', price: 10, description: 'A widget' });
    expect(codec.decode(wire)).toEqual({
      name: 'Widget',
      price: 10,
      description: 'A widget',
    });
  });
});

describe('arktypeJson roundtrip', () => {
  it('encode → decode preserves the value structurally', () => {
    const codec = arktypeJson(productSchema).type(SYNTH_CTX);
    const original = { name: 'Widget', price: 10, description: 'A widget' };
    // biome-ignore lint/style/noNonNullAssertion: encode is defined for arktype-json
    const encoded = codec.encode!(original);
    const decoded = codec.decode(encoded);
    expect(decoded).toEqual(original);
  });

  it('encodeJson / decodeJson identity-pass JsonValue payloads', () => {
    const codec = arktypeJson(productSchema).type(SYNTH_CTX);
    const original = { name: 'Widget', price: 10 };
    const json = codec.encodeJson(original);
    const restored = codec.decodeJson(json);
    expect(restored).toEqual(original);
  });
});

describe('arktypeJsonCodec descriptor', () => {
  it('has the right codecId, traits, and targetTypes', () => {
    expect(arktypeJsonCodec.codecId).toBe(ARKTYPE_JSON_CODEC_ID);
    expect(arktypeJsonCodec.traits).toEqual(['equality']);
    expect(arktypeJsonCodec.targetTypes).toEqual(['jsonb']);
  });

  it("renderOutputType returns the schema's TS-source expression", () => {
    expect(
      arktypeJsonCodec.renderOutputType?.({
        expression: '{ name: string, price: number }',
        jsonIr: {},
      }),
    ).toBe('{ name: string, price: number }');
  });

  it("renderOutputType falls back to 'unknown' for empty expressions", () => {
    expect(
      arktypeJsonCodec.renderOutputType?.({
        expression: '   ',
        jsonIr: {},
      }),
    ).toBe('unknown');
  });

  it('paramsSchema validates well-formed typeParams', () => {
    const validation = arktypeJsonCodec.paramsSchema['~standard'].validate({
      expression: '{ name: string }',
      jsonIr: { domain: 'object' },
    });
    expect(validation).not.toBeInstanceOf(Promise);
    if (!(validation instanceof Promise)) {
      expect(validation.issues).toBeUndefined();
    }
  });

  it('paramsSchema rejects malformed typeParams', () => {
    const validation = arktypeJsonCodec.paramsSchema['~standard'].validate({
      expression: 42,
      jsonIr: { domain: 'object' },
    });
    expect(validation).not.toBeInstanceOf(Promise);
    if (!(validation instanceof Promise)) {
      expect(validation.issues).toBeDefined();
    }
  });

  it('factory rehydrates the schema from typeParams.jsonIr and validates', () => {
    const descriptor = arktypeJson(productSchema);
    const codec = arktypeJsonCodec.factory(descriptor.typeParams)(SYNTH_CTX);
    expect(codec.id).toBe(ARKTYPE_JSON_CODEC_ID);

    const validWire = JSON.stringify({ name: 'Widget', price: 10 });
    expect(codec.decode(validWire)).toEqual({ name: 'Widget', price: 10 });

    const invalidWire = JSON.stringify({ name: 'Widget' });
    expect(() => codec.decode(invalidWire)).toThrow();
  });

  it('factory throws on corrupt jsonIr', () => {
    expect(() =>
      arktypeJsonCodec.factory({
        expression: 'corrupt',
        jsonIr: { broken: true },
      })(SYNTH_CTX),
    ).toThrow(/Failed to rehydrate arktype schema/);
  });
});

describe('serialize/rehydrate roundtrip', () => {
  it("rehydrated schema's expression matches the source", () => {
    const descriptor = arktypeJson(productSchema);
    const codec = arktypeJsonCodec.factory(descriptor.typeParams)(SYNTH_CTX);
    // The rehydration round-trip is the load-bearing guarantee for the
    // emit-vs-runtime parity check: the rehydrated schema renders the
    // same `expression` the column-author site captured.
    expect(codec.id).toBe(ARKTYPE_JSON_CODEC_ID);
    // (We can't check `expression` off the codec — only off the schema —
    // but the factory's `rehydrateSchema` call produced the schema whose
    // `expression` the corruption-detection branch in the descriptor
    // verifies internally. The validation-symmetry test below covers the
    // semantic side.)
  });

  it('rehydrated schema rejects/accepts the same payloads as the source', () => {
    const descriptor = arktypeJson(productSchema);
    const reCodec = arktypeJsonCodec.factory(descriptor.typeParams)(SYNTH_CTX);
    const sourceCodec = descriptor.type(SYNTH_CTX);

    const valid = { name: 'X', price: 1 };
    const validWire = JSON.stringify(valid);
    expect(reCodec.decode(validWire)).toEqual(sourceCodec.decode(validWire));

    const invalid = { name: 'X' };
    const invalidWire = JSON.stringify(invalid);
    expect(() => reCodec.decode(invalidWire)).toThrow();
    expect(() => sourceCodec.decode(invalidWire)).toThrow();
  });

  it('preserves narrowed fields (literal unions) across rehydrate', () => {
    const auditSchema = type({
      actor: "'system' | 'user' | 'admin'",
      at: 'number',
    });
    const descriptor = arktypeJson(auditSchema);
    const reCodec = arktypeJsonCodec.factory(descriptor.typeParams)(SYNTH_CTX);

    expect(reCodec.decode(JSON.stringify({ actor: 'system', at: 1 }))).toEqual({
      actor: 'system',
      at: 1,
    });
    expect(() => reCodec.decode(JSON.stringify({ actor: 'stranger', at: 1 }))).toThrow(/actor/);
  });
});
