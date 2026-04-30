import type { CodecInstanceContext } from '@prisma-next/framework-components/codec';
import type { SqlCodecCallContext } from '@prisma-next/sql-relational-core/ast';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  ARKTYPE_JSON_CODEC_ID,
  ARKTYPE_JSON_NATIVE_TYPE,
  arktypeJson,
  arktypeJsonCodec,
} from '../src/core/arktype-json-codec';

const SYNTH_CTX: CodecInstanceContext = {
  name: '<arktype-json-test>',
};

// Per-call context the runtime threads to every `codec.encode` /
// `codec.decode`. The test doesn't exercise abort or column metadata —
// an empty `{}` is the canonical no-signal SQL call ctx.
const CALL_CTX: SqlCodecCallContext = {};

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
      // function or a different library's schema) surfaces here, not
      // at contract-load time.
      // biome-ignore lint/suspicious/noExplicitAny: deliberate misuse for the negative case
      arktypeJson({ foo: 'bar' } as any),
    ).toThrow(/expects an arktype Type/);
  });

  it('rejects schemas with non-object json IR', () => {
    expect(() =>
      arktypeJson({
        expression: 'string',
        json: 'not-an-object',
        // biome-ignore lint/suspicious/noExplicitAny: deliberate misuse for the negative case
      } as any),
    ).toThrow(/missing `json` IR/);
  });
});

describe('arktypeJson encode/decode (Promise-lifted async surface)', () => {
  it('encode round-trips through JSON.stringify (Promise-returning)', async () => {
    const codec = arktypeJson(productSchema).type(SYNTH_CTX);
    const encoded = await codec.encode({ name: 'Widget', price: 10 }, CALL_CTX);
    expect(encoded).toBe('{"name":"Widget","price":10}');
  });

  it('decode validates the wire payload against the schema', async () => {
    const codec = arktypeJson(productSchema).type(SYNTH_CTX);
    const wire = JSON.stringify({ name: 'Widget', price: 10 });
    expect(await codec.decode(wire, CALL_CTX)).toEqual({ name: 'Widget', price: 10 });
  });

  it('decode rejects payloads missing required fields', async () => {
    const codec = arktypeJson(productSchema).type(SYNTH_CTX);
    const wire = JSON.stringify({ name: 'Widget' });
    await expect(codec.decode(wire, CALL_CTX)).rejects.toThrow(
      /JSON_SCHEMA_VALIDATION_FAILED|price/,
    );
  });

  it('decode rejects payloads with type-mismatched fields', async () => {
    const codec = arktypeJson(productSchema).type(SYNTH_CTX);
    const wire = JSON.stringify({ name: 'Widget', price: 'not-a-number' });
    await expect(codec.decode(wire, CALL_CTX)).rejects.toThrow(/price/);
  });

  it('decode accepts payloads with optional fields present', async () => {
    const codec = arktypeJson(productSchema).type(SYNTH_CTX);
    const wire = JSON.stringify({ name: 'Widget', price: 10, description: 'A widget' });
    expect(await codec.decode(wire, CALL_CTX)).toEqual({
      name: 'Widget',
      price: 10,
      description: 'A widget',
    });
  });
});

describe('arktypeJson roundtrip', () => {
  it('encode → decode preserves the value structurally', async () => {
    const codec = arktypeJson(productSchema).type(SYNTH_CTX);
    const original = { name: 'Widget', price: 10, description: 'A widget' };
    const encoded = await codec.encode(original, CALL_CTX);
    const decoded = await codec.decode(encoded as string, CALL_CTX);
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

  it('factory rehydrates the schema from typeParams.jsonIr and validates', async () => {
    const descriptor = arktypeJson(productSchema);
    const codec = arktypeJsonCodec.factory(descriptor.typeParams)(SYNTH_CTX);
    expect(codec.id).toBe(ARKTYPE_JSON_CODEC_ID);

    const validWire = JSON.stringify({ name: 'Widget', price: 10 });
    expect(await codec.decode(validWire, CALL_CTX)).toEqual({ name: 'Widget', price: 10 });

    const invalidWire = JSON.stringify({ name: 'Widget' });
    await expect(codec.decode(invalidWire, CALL_CTX)).rejects.toThrow();
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
  it("rehydrated schema's behavior matches the source", async () => {
    // The rehydration round-trip is the load-bearing guarantee for the
    // emit-vs-runtime parity check: the rehydrated schema validates the
    // same payloads as the source (semantic identity, even if the
    // expression diverges across arktype versions). The descriptor's
    // factory carries a defensive console.warn for expression
    // divergence; we only assert on the validation side here.
    const descriptor = arktypeJson(productSchema);
    const reCodec = arktypeJsonCodec.factory(descriptor.typeParams)(SYNTH_CTX);
    const sourceCodec = descriptor.type(SYNTH_CTX);

    const valid = { name: 'X', price: 1 };
    const validWire = JSON.stringify(valid);
    expect(await reCodec.decode(validWire, CALL_CTX)).toEqual(
      await sourceCodec.decode(validWire, CALL_CTX),
    );

    const invalid = { name: 'X' };
    const invalidWire = JSON.stringify(invalid);
    await expect(reCodec.decode(invalidWire, CALL_CTX)).rejects.toThrow();
    await expect(sourceCodec.decode(invalidWire, CALL_CTX)).rejects.toThrow();
  });

  it('preserves narrowed fields (literal unions) across rehydrate', async () => {
    const auditSchema = type({
      actor: "'system' | 'user' | 'admin'",
      at: 'number',
    });
    const descriptor = arktypeJson(auditSchema);
    const reCodec = arktypeJsonCodec.factory(descriptor.typeParams)(SYNTH_CTX);

    expect(await reCodec.decode(JSON.stringify({ actor: 'system', at: 1 }), CALL_CTX)).toEqual({
      actor: 'system',
      at: 1,
    });
    await expect(
      reCodec.decode(JSON.stringify({ actor: 'stranger', at: 1 }), CALL_CTX),
    ).rejects.toThrow(/actor/);
  });
});
