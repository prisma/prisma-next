import { describe, expect, it, vi } from 'vitest';
import { CIPHERSTASH_STRING_CODEC_ID } from '../src/core/codecs';
import {
  createParameterizedCodecDescriptors,
  encryptedStringParamsSchema,
} from '../src/core/parameterized';
import type { CipherstashSdk } from '../src/core/sdk';
import { createCipherstashRuntimeDescriptor } from '../src/exports/runtime';

function makeSdk(): CipherstashSdk {
  return {
    decrypt: vi.fn(),
    bulkEncrypt: vi.fn(),
    bulkDecrypt: vi.fn(),
  };
}

describe('cipherstash runtime descriptor — AC-CODEC5 (parameterized codec descriptor)', () => {
  it('exposes one parameterized descriptor for `cipherstash/string@1`', () => {
    const sdk = makeSdk();
    const descriptor = createCipherstashRuntimeDescriptor({ sdk });
    const descriptors = descriptor.parameterizedCodecs();
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]?.codecId).toBe(CIPHERSTASH_STRING_CODEC_ID);
  });

  it('descriptor traits and target types match the codec', () => {
    const sdk = makeSdk();
    const descriptor = createCipherstashRuntimeDescriptor({ sdk });
    const [first] = descriptor.parameterizedCodecs();
    expect(first?.traits).toEqual(['equality']);
    expect(first?.targetTypes).toEqual(['eql_v2_encrypted']);
  });

  it('descriptor renderOutputType returns `EncryptedString`', () => {
    const sdk = makeSdk();
    const descriptor = createCipherstashRuntimeDescriptor({ sdk });
    const [first] = descriptor.parameterizedCodecs();
    expect(first?.renderOutputType?.({ equality: true, freeTextSearch: false })).toBe(
      'EncryptedString',
    );
  });
});

describe('cipherstash parameterized codec — params schema (arktype)', () => {
  const validate = encryptedStringParamsSchema['~standard'].validate;

  it('accepts `{equality, freeTextSearch}` with both booleans', async () => {
    const result = await validate({ equality: true, freeTextSearch: false });
    expect(result).not.toHaveProperty('issues');
  });

  it('rejects missing equality', async () => {
    const result = await validate({ freeTextSearch: false });
    expect(result).toHaveProperty('issues');
  });

  it('rejects missing freeTextSearch', async () => {
    const result = await validate({ equality: true });
    expect(result).toHaveProperty('issues');
  });

  it('rejects non-boolean equality', async () => {
    const result = await validate({ equality: 'yes', freeTextSearch: false });
    expect(result).toHaveProperty('issues');
  });
});

describe('cipherstash parameterized codec descriptors — sdk-bound factory', () => {
  it('createParameterizedCodecDescriptors(sdk) returns the descriptor list', () => {
    const sdk = makeSdk();
    const descriptors = createParameterizedCodecDescriptors(sdk);
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]?.codecId).toBe(CIPHERSTASH_STRING_CODEC_ID);
  });

  it('descriptor.factory(params)(ctx) yields a codec wired to the captured sdk', async () => {
    const sdk = makeSdk();
    const descriptors = createParameterizedCodecDescriptors(sdk);
    const factory = descriptors[0]?.factory;
    expect(factory).toBeDefined();
    const resolved = factory?.({ equality: true, freeTextSearch: false })({
      name: 'cipherstash-string-instance',
    });
    expect(resolved).toBeDefined();
    expect(resolved?.id).toBe(CIPHERSTASH_STRING_CODEC_ID);
  });
});
