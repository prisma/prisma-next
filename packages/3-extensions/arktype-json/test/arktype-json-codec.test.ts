import type { CodecInstanceContext } from '@prisma-next/framework-components/codec';
import type { SqlCodecCallContext } from '@prisma-next/sql-relational-core/ast';
import { type Type, type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  ARKTYPE_JSON_CODEC_ID,
  ARKTYPE_JSON_NATIVE_TYPE,
  arktypeJson,
  arktypeJsonCodec,
  arktypeJsonEmitCodec,
} from '../src/core/arktype-json-codec';
import { arktypeJsonPackMeta } from '../src/core/pack-meta';

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

  it('rejects non-callable schema lookalikes at the call site', () => {
    // The runtime check enforces the column-author surface accepts
    // callable arktype `Type`s only — a plain object lookalike (with
    // `expression` and `json` fields shaped right but not callable)
    // would have passed the field checks and only blown up at the
    // first `decode`/`decodeJson`. Reject early instead.
    const notASchema = { foo: 'bar' } as unknown as Type<unknown>;
    expect(() => arktypeJson(notASchema)).toThrow(/callable arktype Type/);
  });

  it('rejects callable schemas missing the `expression` field', () => {
    // A callable that doesn't carry arktype's `expression` getter is
    // not an arktype `Type` — the column descriptor relies on
    // `expression` for emit-path rendering.
    const callableWithoutExpression = (() => undefined) as unknown as Type<unknown>;
    expect(() => arktypeJson(callableWithoutExpression)).toThrow(/missing `expression: string`/);
  });

  it('rejects callable schemas with non-object json IR', () => {
    // A callable that carries `expression` but lacks the `json` IR
    // can't be rehydrated at runtime; reject at authoring time.
    const malformedSchema = Object.assign(() => undefined, {
      expression: 'string',
      json: 'not-an-object',
    }) as unknown as Type<unknown>;
    expect(() => arktypeJson(malformedSchema)).toThrow(/missing `json` IR/);
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

describe('decodeJson schema enforcement', () => {
  // `decode` (wire string → JS) and `decodeJson` (JsonValue → JS) must
  // both run the schema. Without enforcement on `decodeJson`, any
  // adapter/runtime path that hands parsed JSON straight to the codec
  // would bypass schema validation and return unchecked data.
  it('decodeJson runs the schema against typed JsonValue payloads', () => {
    const codec = arktypeJson(productSchema).type(SYNTH_CTX);
    expect(codec.decodeJson({ name: 'Widget', price: 10 })).toEqual({
      name: 'Widget',
      price: 10,
    });
  });

  it('decodeJson throws when payload misses required fields', () => {
    const codec = arktypeJson(productSchema).type(SYNTH_CTX);
    expect(() => codec.decodeJson({ name: 'Widget' })).toThrow(
      /JSON_SCHEMA_VALIDATION_FAILED|price/,
    );
  });

  it('decodeJson throws when payload has type-mismatched fields', () => {
    const codec = arktypeJson(productSchema).type(SYNTH_CTX);
    expect(() => codec.decodeJson({ name: 'Widget', price: 'not-a-number' })).toThrow(/price/);
  });
});

describe('arktypeJsonEmitCodec (emit-only shim)', () => {
  // The emit-only codec carries `renderOutputType` so the framework
  // emitter's `CodecLookup` can resolve the column's TS type at emit
  // time. encode/decode are sentinels that throw if invoked — runtime
  // materialization always goes through the descriptor's factory.
  it('exposes the codec id and native type', () => {
    expect(arktypeJsonEmitCodec.id).toBe(ARKTYPE_JSON_CODEC_ID);
    expect(arktypeJsonEmitCodec.targetTypes).toEqual([ARKTYPE_JSON_NATIVE_TYPE]);
    expect(arktypeJsonEmitCodec.traits).toEqual(['equality']);
  });

  it('renderOutputType returns expression for well-formed typeParams', () => {
    expect(
      arktypeJsonEmitCodec.renderOutputType?.({
        expression: '{ name: string }',
        jsonIr: { domain: 'object' },
      }),
    ).toBe('{ name: string }');
  });

  it('renderOutputType returns undefined for malformed typeParams', () => {
    expect(arktypeJsonEmitCodec.renderOutputType?.({ expression: 42, jsonIr: {} })).toBeUndefined();
    expect(
      arktypeJsonEmitCodec.renderOutputType?.({ expression: 'x', jsonIr: null }),
    ).toBeUndefined();
    expect(
      arktypeJsonEmitCodec.renderOutputType?.({ expression: 'x', jsonIr: 'str' }),
    ).toBeUndefined();
  });

  it('encode/decode reject because runtime materialization goes through the descriptor', async () => {
    await expect(arktypeJsonEmitCodec.encode('value')).rejects.toThrow(/emit-only/);
    await expect(arktypeJsonEmitCodec.decode('wire')).rejects.toThrow(/emit-only/);
  });

  it('encodeJson/decodeJson identity-pass JsonValue payloads', () => {
    expect(arktypeJsonEmitCodec.encodeJson('payload')).toBe('payload');
    expect(arktypeJsonEmitCodec.decodeJson({ a: 1 })).toEqual({ a: 1 });
  });
});

describe('arktypeJsonPackMeta', () => {
  // Pack metadata threads the emit-only `Codec` instance into the
  // codec-id-keyed `CodecLookup` and declares the storage backing
  // (`jsonb` on Postgres). Asserting the structure protects the
  // framework-composition entry point.
  it('declares kind, id, family, and target', () => {
    expect(arktypeJsonPackMeta.kind).toBe('extension');
    expect(arktypeJsonPackMeta.id).toBe('arktype-json');
    expect(arktypeJsonPackMeta.familyId).toBe('sql');
    expect(arktypeJsonPackMeta.targetId).toBe('postgres');
  });

  it('threads arktypeJsonEmitCodec into codecInstances for emit-path lookup', () => {
    expect(arktypeJsonPackMeta.types.codecTypes.codecInstances).toContain(arktypeJsonEmitCodec);
  });

  it('declares jsonb storage backing for the codec id', () => {
    expect(arktypeJsonPackMeta.types.storage).toEqual([
      {
        typeId: ARKTYPE_JSON_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'jsonb',
      },
    ]);
  });

  it('declares the type-side import spec', () => {
    expect(arktypeJsonPackMeta.types.codecTypes.import).toEqual({
      package: '@prisma-next/extension-arktype-json/codec-types',
      named: 'CodecTypes',
      alias: 'ArktypeJsonTypes',
    });
  });
});
