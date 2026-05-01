import { describe, expect, it, vi } from 'vitest';
import { EncryptedString } from '../src/core/envelope';
import type { CipherstashSdk } from '../src/core/sdk';

describe('EncryptedString.from(plaintext) — AC-ENV1', () => {
  it('returns an envelope', () => {
    const envelope = EncryptedString.from('alice@example.com');
    expect(envelope).toBeInstanceOf(EncryptedString);
  });

  it('subsequent decrypt() resolves with the original plaintext (no SDK needed)', async () => {
    const envelope = EncryptedString.from('alice@example.com');
    await expect(envelope.decrypt()).resolves.toBe('alice@example.com');
  });

  it('decrypt() does not require the SDK on the write-side handle', async () => {
    const sdk: CipherstashSdk = {
      decrypt: vi.fn(),
      bulkEncrypt: vi.fn(),
      bulkDecrypt: vi.fn(),
    };
    const envelope = EncryptedString.from('hello');
    await envelope.decrypt();
    expect(sdk.decrypt).not.toHaveBeenCalled();
  });
});

describe('EncryptedString.fromInternal(...) — AC-ENV2 (read-side)', () => {
  it('decrypt({signal}) calls the SDK single-cell decrypt and returns plaintext', async () => {
    const ciphertext = { c: 'cipher', i: { t: 'user', c: 'email' } };
    const decryptMock = vi.fn().mockResolvedValue('alice@example.com');
    const sdk: CipherstashSdk = {
      decrypt: decryptMock,
      bulkEncrypt: vi.fn(),
      bulkDecrypt: vi.fn(),
    };

    const envelope = EncryptedString.fromInternal({
      ciphertext,
      table: 'user',
      column: 'email',
      sdk,
    });

    const ac = new AbortController();
    const result = await envelope.decrypt({ signal: ac.signal });

    expect(result).toBe('alice@example.com');
    expect(decryptMock).toHaveBeenCalledTimes(1);
    const callArg = decryptMock.mock.calls[0]?.[0];
    expect(callArg).toMatchObject({
      ciphertext,
      table: 'user',
      column: 'email',
      signal: ac.signal,
    });
  });

  it('forwards the caller-provided AbortSignal to the SDK by identity', async () => {
    const decryptMock = vi.fn().mockResolvedValue('plain');
    const sdk: CipherstashSdk = {
      decrypt: decryptMock,
      bulkEncrypt: vi.fn(),
      bulkDecrypt: vi.fn(),
    };
    const envelope = EncryptedString.fromInternal({
      ciphertext: 'wire',
      table: 't',
      column: 'c',
      sdk,
    });
    const ac = new AbortController();
    await envelope.decrypt({ signal: ac.signal });
    const callArg = decryptMock.mock.calls[0]?.[0] as { signal?: AbortSignal };
    expect(callArg.signal).toBe(ac.signal);
  });

  it('decrypt() without an explicit signal omits signal in the SDK call (or passes undefined)', async () => {
    const decryptMock = vi.fn().mockResolvedValue('plain');
    const sdk: CipherstashSdk = {
      decrypt: decryptMock,
      bulkEncrypt: vi.fn(),
      bulkDecrypt: vi.fn(),
    };
    const envelope = EncryptedString.fromInternal({
      ciphertext: 'wire',
      table: 't',
      column: 'c',
      sdk,
    });
    await envelope.decrypt();
    const callArg = decryptMock.mock.calls[0]?.[0] as { signal?: AbortSignal };
    expect(callArg.signal).toBeUndefined();
  });
});

describe('EncryptedString — handle is package-private — AC-ENV4', () => {
  it('does not expose the handle as an own enumerable property', () => {
    const envelope = EncryptedString.from('secret');
    expect(Object.keys(envelope)).toEqual([]);
  });

  it('JSON.stringify produces no plaintext leak', () => {
    const envelope = EncryptedString.from('top-secret');
    const json = JSON.stringify(envelope);
    expect(json).not.toContain('top-secret');
  });

  it('public methods are limited to decrypt; no handle-accessor on the prototype', () => {
    const proto = Object.getPrototypeOf(EncryptedString.from('x')) as object;
    const ownNames = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
    expect(ownNames.sort()).toEqual(['decrypt', 'toJSON']);
  });
});
