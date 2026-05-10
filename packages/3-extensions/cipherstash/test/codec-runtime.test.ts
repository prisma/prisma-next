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
  createCipherstashStringCodec,
} from '../src/execution/codec-runtime';
import { EncryptedString, setHandleCiphertext } from '../src/execution/envelope';
import {
  createParameterizedCodecDescriptors,
  encryptedStringParamsSchema,
} from '../src/execution/parameterized';
import type { CipherstashSdk } from '../src/execution/sdk';

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
    expect(codec.targetTypes).toEqual(['eql_v2_encrypted']);
    expect(codec.meta?.db?.sql?.postgres?.nativeType).toBe('eql_v2_encrypted');
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
    expect(codec.traits).toEqual([]);
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

describe('codec.renderOutputType', () => {
  it('returns "EncryptedString"', () => {
    const codec = createCipherstashStringCodec(emptySdk());
    expect(codec.renderOutputType?.({})).toBe('EncryptedString');
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
  it('exposes a single descriptor for cipherstash/string@1', () => {
    const descriptors = createParameterizedCodecDescriptors(emptySdk());
    expect(descriptors).toHaveLength(1);
    const [descriptor] = descriptors;
    expect(descriptor?.codecId).toBe(CIPHERSTASH_STRING_CODEC_ID);
    expect(descriptor?.targetTypes).toEqual(['eql_v2_encrypted']);
    // No codec traits — see the `declares no codec traits` test
    // above for the rationale (mirrors the runtime codec`s trait
    // declaration so contract emit and runtime agree).
    expect(descriptor?.traits).toEqual([]);
    expect(descriptor?.renderOutputType?.({ equality: true, freeTextSearch: true })).toBe(
      'EncryptedString',
    );
  });

  it('paramsSchema accepts { equality, freeTextSearch } booleans via Standard Schema', () => {
    const result = encryptedStringParamsSchema['~standard'].validate({
      equality: true,
      freeTextSearch: false,
    });
    if (result instanceof Promise) throw new Error('expected synchronous validation');
    if (result.issues)
      throw new Error(`expected success, got issues: ${JSON.stringify(result.issues)}`);
    expect(result.value).toEqual({ equality: true, freeTextSearch: false });
  });

  it('paramsSchema rejects non-boolean fields via Standard Schema', () => {
    const result = encryptedStringParamsSchema['~standard'].validate({
      equality: 'yes',
      freeTextSearch: false,
    });
    if (result instanceof Promise) throw new Error('expected synchronous validation');
    expect(result.issues?.length).toBeGreaterThan(0);
  });

  it('factory(params)(ctx) yields the codec instance', () => {
    const sdk = emptySdk();
    const [descriptor] = createParameterizedCodecDescriptors(sdk);
    const codecForInstance = descriptor!.factory({ equality: true, freeTextSearch: false })({
      name: 'User.email',
    });
    expect(codecForInstance.id).toBe(CIPHERSTASH_STRING_CODEC_ID);
  });
});
