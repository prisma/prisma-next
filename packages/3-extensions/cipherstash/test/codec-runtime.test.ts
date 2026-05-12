/**
 * Behavioural tests for the cipherstash storage codec runtime + the
 * parameterized codec descriptor.
 *
 * The codec runtime is constructed via `codec({ ... })` from
 * `@prisma-next/sql-relational-core/ast`. Author-side `encode`/`decode`
 * are sync; the factory lifts them to Promise-returning at the boundary
 * (same pattern pgvector follows).
 */

import type { SqlCodecCallContext } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it, vi } from 'vitest';
import {
  CIPHERSTASH_STRING_CODEC_ID,
  createCipherstashBigIntCodec,
  createCipherstashBooleanCodec,
  createCipherstashDateCodec,
  createCipherstashDoubleCodec,
  createCipherstashJsonCodec,
  createCipherstashStringCodec,
} from '../src/execution/codec-runtime';
import { EncryptedString, setHandleCiphertext } from '../src/execution/envelope';
import { EncryptedBigInt } from '../src/execution/envelope-bigint';
import { EncryptedBoolean } from '../src/execution/envelope-boolean';
import { EncryptedDate } from '../src/execution/envelope-date';
import { EncryptedDouble } from '../src/execution/envelope-double';
import { EncryptedJson } from '../src/execution/envelope-json';
import {
  createParameterizedCodecDescriptors,
  encryptedBigIntParamsSchema,
  encryptedBooleanParamsSchema,
  encryptedDateParamsSchema,
  encryptedDoubleParamsSchema,
  encryptedJsonParamsSchema,
  encryptedStringParamsSchema,
} from '../src/execution/parameterized';
import type { CipherstashSdk } from '../src/execution/sdk';
import {
  CIPHERSTASH_BIGINT_CODEC_ID,
  CIPHERSTASH_BOOLEAN_CODEC_ID,
  CIPHERSTASH_DATE_CODEC_ID,
  CIPHERSTASH_DOUBLE_CODEC_ID,
  CIPHERSTASH_JSON_CODEC_ID,
} from '../src/extension-metadata/constants';

function emptySdk(): CipherstashSdk {
  return {
    decrypt: vi.fn(),
    bulkEncrypt: vi.fn(),
    bulkDecrypt: vi.fn(),
  };
}

function ctxWithColumn(table: string, name: string): SqlCodecCallContext {
  return { column: { table, name } };
}

const ctxWithoutColumn: SqlCodecCallContext = {};

describe('createCipherstashStringCodec — registration shape', () => {
  it('uses cipherstash/string@1 as the codec id', () => {
    const codec = createCipherstashStringCodec(emptySdk());
    expect(codec.id).toBe(CIPHERSTASH_STRING_CODEC_ID);
    expect(CIPHERSTASH_STRING_CODEC_ID).toBe('cipherstash/string@1');
  });

  it('targets the eql_v2_encrypted Postgres native type', () => {
    const codec = createCipherstashStringCodec(emptySdk());
    expect(codec.descriptor.targetTypes).toEqual(['eql_v2_encrypted']);
    const dbMeta = codec.descriptor.meta?.['db'] as
      | { sql?: { postgres?: { nativeType?: string } } }
      | undefined;
    expect(dbMeta?.sql?.postgres?.nativeType).toBe('eql_v2_encrypted');
  });

  it('declares no codec traits — equality search routes through cipherstashEq', () => {
    // Regression test: cipherstash columns do NOT advertise the
    // framework`s `equality` trait at the
    // codec level. The framework`s built-in `eq` is gated on
    // `equality` and lowers to standard SQL `=`, which is wrong for
    // EQL ciphers (randomized nonces). Equality search on cipherstash
    // columns is delivered exclusively via the cipherstash-namespaced
    // `cipherstashEq` operator (see `src/execution/operators.ts`). Re-adding
    // a trait here without re-routing through the namespaced operator
    // would silently re-introduce the wrong-SQL footgun.
    const codec = createCipherstashStringCodec(emptySdk());
    expect(codec.descriptor.traits).toEqual([]);
  });
});

describe('codec.decode(wire, ctx)', () => {
  it('constructs an envelope carrying the column identity from ctx.column', async () => {
    const sdk = emptySdk();
    const codec = createCipherstashStringCodec(sdk);
    const wire = `("${JSON.stringify({ c: 'cipher' }).replaceAll('"', '""')}")`;
    const envelope = await codec.decode(wire, ctxWithColumn('user', 'email'));
    expect(envelope).toBeInstanceOf(EncryptedString);
    const handle = envelope.expose();
    expect(handle.table).toBe('user');
    expect(handle.column).toBe('email');
    expect(handle.sdk).toBe(sdk);
  });

  it('throws a clear error when ctx.column is absent', async () => {
    const codec = createCipherstashStringCodec(emptySdk());
    const wire = `("${JSON.stringify({}).replaceAll('"', '""')}")`;
    await expect(codec.decode(wire, ctxWithoutColumn)).rejects.toThrow(/ctx\.column/);
  });
});

describe('codec.encode(envelope, ctx)', () => {
  it('extracts the ciphertext from the envelope handle', async () => {
    const codec = createCipherstashStringCodec(emptySdk());
    const envelope = EncryptedString.from('alice@example.com');
    const ciphertextPayload = { c: 'cipher', i: { t: 'user', c: 'email' } };
    setHandleCiphertext(envelope, ciphertextPayload);
    const wire = await codec.encode(envelope, ctxWithoutColumn);
    expect(typeof wire).toBe('string');
    expect(wire).toBe(`("${JSON.stringify(ciphertextPayload).replaceAll('"', '""')}")`);
  });

  it('throws when the envelope handle has no ciphertext (middleware did not run)', async () => {
    const codec = createCipherstashStringCodec(emptySdk());
    const envelope = EncryptedString.from('alice@example.com');
    await expect(codec.encode(envelope, ctxWithoutColumn)).rejects.toThrow(
      /bulk-encrypt middleware/,
    );
  });
});

describe('codec.descriptor.renderOutputType', () => {
  it('returns "EncryptedString"', () => {
    const codec = createCipherstashStringCodec(emptySdk());
    expect(codec.descriptor.renderOutputType?.({})).toBe('EncryptedString');
  });
});

describe('eql_v2_encrypted wire-format round-trip — wire-format fix', () => {
  it('encode then decode preserves the ciphertext payload through composite text format', async () => {
    const sdk = emptySdk();
    const codec = createCipherstashStringCodec(sdk);
    const payload = {
      c: 'mBbLh1eMyM/Iq/M=',
      i: { t: 'user', c: 'email' },
      v: 2,
    };
    const envelope = EncryptedString.from('alice@example.com');
    setHandleCiphertext(envelope, payload);

    const wire = await codec.encode(envelope, ctxWithoutColumn);
    expect(typeof wire).toBe('string');
    const wireString = wire as string;
    expect(wireString.startsWith('("')).toBe(true);
    expect(wireString.endsWith('")')).toBe(true);

    const decoded = await codec.decode(wireString, ctxWithColumn('user', 'email'));
    expect(decoded.expose().ciphertext).toEqual(payload);
  });

  it('decode accepts a pre-parsed { data: ... } row from the pg driver', async () => {
    const sdk = emptySdk();
    const codec = createCipherstashStringCodec(sdk);
    const payload = { c: 'cipher', i: { t: 'user', c: 'email' } };
    const decoded = await codec.decode(
      { data: payload } as unknown as string,
      ctxWithColumn('user', 'email'),
    );
    expect(decoded.expose().ciphertext).toEqual(payload);
  });

  it('decode passes through null/undefined unchanged', async () => {
    const codec = createCipherstashStringCodec(emptySdk());
    const decoded = await codec.decode(null as unknown as string, ctxWithColumn('user', 'email'));
    expect(decoded.expose().ciphertext).toBeNull();
  });

  it('encode then decode preserves embedded double quotes via the composite text-format escape', async () => {
    const codec = createCipherstashStringCodec(emptySdk());
    const payload = { c: 'has "quotes" inside' };
    const envelope = EncryptedString.from('plain');
    setHandleCiphertext(envelope, payload);
    const wire = await codec.encode(envelope, ctxWithoutColumn);
    const wireString = wire as string;
    expect(wireString.includes('""')).toBe(true);
    const decoded = await codec.decode(wireString, ctxWithColumn('user', 'email'));
    expect(decoded.expose().ciphertext).toEqual(payload);
  });
});

describe('createParameterizedCodecDescriptors', () => {
  // R4 wires the full six-descriptor surface — string + double +
  // bigint + date + boolean + json — pinning AC-CODEC2.
  it('exposes the cipherstash/{string,double,bigint,date,boolean,json}@1 descriptors in stable order', () => {
    const descriptors = createParameterizedCodecDescriptors(emptySdk());
    expect(descriptors).toHaveLength(6);
    expect(descriptors.map((d) => d.codecId)).toEqual([
      CIPHERSTASH_STRING_CODEC_ID,
      CIPHERSTASH_DOUBLE_CODEC_ID,
      CIPHERSTASH_BIGINT_CODEC_ID,
      CIPHERSTASH_DATE_CODEC_ID,
      CIPHERSTASH_BOOLEAN_CODEC_ID,
      CIPHERSTASH_JSON_CODEC_ID,
    ]);
    for (const descriptor of descriptors) {
      expect(descriptor.targetTypes).toEqual(['eql_v2_encrypted']);
      // No codec traits — see the `declares no codec traits` test
      // above for the rationale.
      expect(descriptor.traits).toEqual([]);
    }
  });

  it('renderOutputType returns the per-codec envelope class name', () => {
    const [
      stringDescriptor,
      doubleDescriptor,
      bigIntDescriptor,
      dateDescriptor,
      booleanDescriptor,
      jsonDescriptor,
    ] = createParameterizedCodecDescriptors(emptySdk());
    expect(
      stringDescriptor?.renderOutputType?.({
        equality: true,
        freeTextSearch: true,
        orderAndRange: true,
      }),
    ).toBe('EncryptedString');
    expect(doubleDescriptor?.renderOutputType?.({ equality: true, orderAndRange: true })).toBe(
      'EncryptedDouble',
    );
    expect(bigIntDescriptor?.renderOutputType?.({ equality: true, orderAndRange: true })).toBe(
      'EncryptedBigInt',
    );
    expect(dateDescriptor?.renderOutputType?.({ equality: true, orderAndRange: true })).toBe(
      'EncryptedDate',
    );
    expect(booleanDescriptor?.renderOutputType?.({ equality: true })).toBe('EncryptedBoolean');
    expect(jsonDescriptor?.renderOutputType?.({ searchableJson: true })).toBe('EncryptedJson');
  });

  it('paramsSchema accepts { equality, freeTextSearch, orderAndRange } booleans via Standard Schema', () => {
    const result = encryptedStringParamsSchema['~standard'].validate({
      equality: true,
      freeTextSearch: false,
      orderAndRange: true,
    });
    if (result instanceof Promise) throw new Error('expected synchronous validation');
    if (result.issues)
      throw new Error(`expected success, got issues: ${JSON.stringify(result.issues)}`);
    expect(result.value).toEqual({
      equality: true,
      freeTextSearch: false,
      orderAndRange: true,
    });
  });

  it('paramsSchema rejects non-boolean fields via Standard Schema', () => {
    const result = encryptedStringParamsSchema['~standard'].validate({
      equality: 'yes',
      freeTextSearch: false,
      orderAndRange: true,
    });
    if (result instanceof Promise) throw new Error('expected synchronous validation');
    expect(result.issues?.length).toBeGreaterThan(0);
  });

  it('factory(params)(ctx) yields the codec instance', () => {
    const sdk = emptySdk();
    const [descriptor] = createParameterizedCodecDescriptors(sdk);
    const codecForInstance = descriptor!.factory({
      equality: true,
      freeTextSearch: false,
      orderAndRange: true,
    })({
      name: 'User.email',
    });
    expect(codecForInstance.id).toBe(CIPHERSTASH_STRING_CODEC_ID);
  });

  it('numeric paramsSchemas accept { equality, orderAndRange } booleans via Standard Schema', () => {
    for (const schema of [encryptedDoubleParamsSchema, encryptedBigIntParamsSchema]) {
      const ok = schema['~standard'].validate({ equality: true, orderAndRange: false });
      if (ok instanceof Promise) throw new Error('expected synchronous validation');
      if (ok.issues) throw new Error(`expected success, got issues: ${JSON.stringify(ok.issues)}`);
      expect(ok.value).toEqual({ equality: true, orderAndRange: false });

      const bad = schema['~standard'].validate({ equality: 'yes', orderAndRange: true });
      if (bad instanceof Promise) throw new Error('expected synchronous validation');
      expect(bad.issues?.length).toBeGreaterThan(0);
    }
  });
});

describe('createCipherstashDoubleCodec — registration shape', () => {
  it('uses cipherstash/double@1 as the codec id and targets eql_v2_encrypted', () => {
    const codec = createCipherstashDoubleCodec(emptySdk());
    expect(codec.id).toBe(CIPHERSTASH_DOUBLE_CODEC_ID);
    expect(codec.descriptor.targetTypes).toEqual(['eql_v2_encrypted']);
    expect(codec.descriptor.traits).toEqual([]);
    expect(codec.descriptor.renderOutputType?.({})).toBe('EncryptedDouble');
  });

  it('encode → decode round-trip preserves the ciphertext through the composite text format', async () => {
    const sdk = emptySdk();
    const codec = createCipherstashDoubleCodec(sdk);
    const payload = { c: 'numeric-cipher', i: { t: 'metric', c: 'value' }, v: 2 };
    const envelope = EncryptedDouble.from(3.14);
    // The base's `setHandleCiphertext` helper accepts any envelope
    // subclass; we re-use the string export as it's the same generic
    // helper. (envelope.ts re-exports it; the function itself lives
    // in envelope-base.ts and is generic over `T`.)
    setHandleCiphertext(envelope, payload);

    const wire = await codec.encode(envelope, ctxWithoutColumn);
    const decoded = await codec.decode(wire as string, ctxWithColumn('metric', 'value'));
    expect(decoded).toBeInstanceOf(EncryptedDouble);
    expect(decoded.expose().ciphertext).toEqual(payload);
  });
});

describe('createCipherstashBigIntCodec — registration shape', () => {
  it('uses cipherstash/bigint@1 as the codec id and targets eql_v2_encrypted', () => {
    const codec = createCipherstashBigIntCodec(emptySdk());
    expect(codec.id).toBe(CIPHERSTASH_BIGINT_CODEC_ID);
    expect(codec.descriptor.targetTypes).toEqual(['eql_v2_encrypted']);
    expect(codec.descriptor.traits).toEqual([]);
    expect(codec.descriptor.renderOutputType?.({})).toBe('EncryptedBigInt');
  });

  it('encode → decode round-trip preserves the ciphertext', async () => {
    const sdk = emptySdk();
    const codec = createCipherstashBigIntCodec(sdk);
    const payload = { c: 'bigint-cipher', i: { t: 'ledger', c: 'amount' } };
    const envelope = EncryptedBigInt.from(42n);
    setHandleCiphertext(envelope, payload);
    const wire = await codec.encode(envelope, ctxWithoutColumn);
    const decoded = await codec.decode(wire as string, ctxWithColumn('ledger', 'amount'));
    expect(decoded).toBeInstanceOf(EncryptedBigInt);
    expect(decoded.expose().ciphertext).toEqual(payload);
  });
});

describe('createCipherstashDateCodec — registration shape + round-trip', () => {
  it('uses cipherstash/date@1 as the codec id and targets eql_v2_encrypted', () => {
    const codec = createCipherstashDateCodec(emptySdk());
    expect(codec.id).toBe(CIPHERSTASH_DATE_CODEC_ID);
    expect(codec.descriptor.targetTypes).toEqual(['eql_v2_encrypted']);
    expect(codec.descriptor.traits).toEqual([]);
    expect(codec.descriptor.renderOutputType?.({})).toBe('EncryptedDate');
  });

  it('encode → decode round-trip preserves the ciphertext', async () => {
    const sdk = emptySdk();
    const codec = createCipherstashDateCodec(sdk);
    const payload = { c: 'date-cipher', i: { t: 'event', c: 'occurred_on' } };
    const envelope = EncryptedDate.from(new Date('2024-01-01'));
    setHandleCiphertext(envelope, payload);
    const wire = await codec.encode(envelope, ctxWithoutColumn);
    const decoded = await codec.decode(wire as string, ctxWithColumn('event', 'occurred_on'));
    expect(decoded).toBeInstanceOf(EncryptedDate);
    expect(decoded.expose().ciphertext).toEqual(payload);
  });
});

describe('createCipherstashBooleanCodec — registration shape + round-trip', () => {
  it('uses cipherstash/boolean@1 as the codec id and targets eql_v2_encrypted', () => {
    const codec = createCipherstashBooleanCodec(emptySdk());
    expect(codec.id).toBe(CIPHERSTASH_BOOLEAN_CODEC_ID);
    expect(codec.descriptor.targetTypes).toEqual(['eql_v2_encrypted']);
    expect(codec.descriptor.traits).toEqual([]);
    expect(codec.descriptor.renderOutputType?.({})).toBe('EncryptedBoolean');
  });

  it('encode → decode round-trip preserves the ciphertext', async () => {
    const sdk = emptySdk();
    const codec = createCipherstashBooleanCodec(sdk);
    const payload = { c: 'bool-cipher', i: { t: 'feature', c: 'enabled' } };
    const envelope = EncryptedBoolean.from(true);
    setHandleCiphertext(envelope, payload);
    const wire = await codec.encode(envelope, ctxWithoutColumn);
    const decoded = await codec.decode(wire as string, ctxWithColumn('feature', 'enabled'));
    expect(decoded).toBeInstanceOf(EncryptedBoolean);
    expect(decoded.expose().ciphertext).toEqual(payload);
  });
});

describe('createCipherstashJsonCodec — registration shape + round-trip', () => {
  it('uses cipherstash/json@1 as the codec id and targets eql_v2_encrypted', () => {
    const codec = createCipherstashJsonCodec(emptySdk());
    expect(codec.id).toBe(CIPHERSTASH_JSON_CODEC_ID);
    expect(codec.descriptor.targetTypes).toEqual(['eql_v2_encrypted']);
    expect(codec.descriptor.traits).toEqual([]);
    expect(codec.descriptor.renderOutputType?.({})).toBe('EncryptedJson');
  });

  it('encode → decode round-trip preserves the ciphertext for arbitrary JSON', async () => {
    const sdk = emptySdk();
    const codec = createCipherstashJsonCodec(sdk);
    const payload = { c: 'json-cipher', i: { t: 'audit', c: 'payload' } };
    const envelope = EncryptedJson.from({ event: 'login', userId: 42 });
    setHandleCiphertext(envelope, payload);
    const wire = await codec.encode(envelope, ctxWithoutColumn);
    const decoded = await codec.decode(wire as string, ctxWithColumn('audit', 'payload'));
    expect(decoded).toBeInstanceOf(EncryptedJson);
    expect(decoded.expose().ciphertext).toEqual(payload);
  });
});

describe('paramsSchemas for date / boolean / json', () => {
  it('encryptedDateParamsSchema accepts { equality, orderAndRange } booleans', () => {
    const ok = encryptedDateParamsSchema['~standard'].validate({
      equality: true,
      orderAndRange: false,
    });
    if (ok instanceof Promise) throw new Error('expected synchronous validation');
    if (ok.issues) throw new Error(`expected success, got: ${JSON.stringify(ok.issues)}`);
    expect(ok.value).toEqual({ equality: true, orderAndRange: false });
  });

  it('encryptedBooleanParamsSchema accepts { equality } and rejects extras of wrong type', () => {
    const ok = encryptedBooleanParamsSchema['~standard'].validate({ equality: true });
    if (ok instanceof Promise) throw new Error('expected synchronous validation');
    if (ok.issues) throw new Error(`expected success, got: ${JSON.stringify(ok.issues)}`);
    expect(ok.value).toEqual({ equality: true });

    const bad = encryptedBooleanParamsSchema['~standard'].validate({ equality: 'yes' });
    if (bad instanceof Promise) throw new Error('expected synchronous validation');
    expect(bad.issues?.length).toBeGreaterThan(0);
  });

  it('encryptedJsonParamsSchema accepts { searchableJson } booleans', () => {
    const ok = encryptedJsonParamsSchema['~standard'].validate({ searchableJson: false });
    if (ok instanceof Promise) throw new Error('expected synchronous validation');
    if (ok.issues) throw new Error(`expected success, got: ${JSON.stringify(ok.issues)}`);
    expect(ok.value).toEqual({ searchableJson: false });
  });
});
