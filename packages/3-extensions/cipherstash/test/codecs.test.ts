import type { SqlCodecCallContext } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it, vi } from 'vitest';
import { CIPHERSTASH_STRING_CODEC_ID, createCipherstashStringCodec } from '../src/core/codecs';
import { EncryptedString, getInternalHandle, setHandleCiphertext } from '../src/core/envelope';
import type { CipherstashSdk } from '../src/core/sdk';

function makeSdk(): CipherstashSdk {
  return {
    decrypt: vi.fn().mockResolvedValue('decrypted'),
    bulkEncrypt: vi.fn(),
    bulkDecrypt: vi.fn(),
  };
}

describe('cipherstash codec — AC-CODEC1 (registration shape)', () => {
  it('codec id is `cipherstash/string@1` with target type `eql_v2_encrypted` and traits `[equality]`', () => {
    const codec = createCipherstashStringCodec(makeSdk());
    expect(codec.id).toBe(CIPHERSTASH_STRING_CODEC_ID);
    expect(codec.targetTypes).toEqual(['eql_v2_encrypted']);
    expect(codec.traits).toEqual(['equality']);
  });

  it('codec carries postgres-native-type meta `eql_v2_encrypted`', () => {
    const codec = createCipherstashStringCodec(makeSdk());
    expect(codec.meta).toMatchObject({
      db: { sql: { postgres: { nativeType: 'eql_v2_encrypted' } } },
    });
  });
});

describe('cipherstash codec — AC-CODEC2 (decode constructs envelope from ctx.column)', () => {
  it('decode(wire, ctx) builds an envelope whose handle carries {table, column} from ctx.column', async () => {
    const sdk = makeSdk();
    const codec = createCipherstashStringCodec(sdk);
    const ctx: SqlCodecCallContext = {
      column: { table: 'user', name: 'email' },
    };
    const wire = { c: 'cipher-blob', i: { t: 'user', c: 'email' } };

    const envelope = await codec.decode(wire, ctx);

    expect(envelope).toBeInstanceOf(EncryptedString);
    const handle = getInternalHandle(envelope);
    expect(handle.table).toBe('user');
    expect(handle.column).toBe('email');
    expect(handle.ciphertext).toBe(wire);
    expect(handle.sdk).toBe(sdk);
  });

  it('decode without ctx.column throws (the codec needs the column ref to construct a routing-aware envelope)', async () => {
    const codec = createCipherstashStringCodec(makeSdk());
    await expect(codec.decode('wire', {})).rejects.toThrow(/requires ctx\.column/);
  });
});

describe('cipherstash codec — AC-CODEC3 (encode reads ciphertext from handle)', () => {
  it('after the middleware has populated ciphertext, encode returns the ciphertext', async () => {
    const codec = createCipherstashStringCodec(makeSdk());
    const envelope = EncryptedString.from('secret');
    setHandleCiphertext(envelope, { c: 'wire-blob' });

    const wire = await codec.encode(envelope, {});
    expect(wire).toEqual({ c: 'wire-blob' });
  });

  it('encode of an envelope whose ciphertext slot is empty (middleware did not run) throws a clear error', async () => {
    const codec = createCipherstashStringCodec(makeSdk());
    const envelope = EncryptedString.from('secret');
    await expect(codec.encode(envelope, {})).rejects.toThrow(/bulk-encrypt middleware/);
  });
});

describe('cipherstash codec — AC-CODEC4 (renderOutputType)', () => {
  it('renderOutputType returns `EncryptedString`', () => {
    const codec = createCipherstashStringCodec(makeSdk());
    expect(codec.renderOutputType?.({})).toBe('EncryptedString');
    expect(codec.renderOutputType?.({ equality: true, freeTextSearch: false })).toBe(
      'EncryptedString',
    );
  });
});
