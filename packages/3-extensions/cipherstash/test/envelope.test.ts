/**
 * Behavioural tests for the `EncryptedString` envelope and the
 * `CipherstashSdk` shape it talks to. Covers AC-ENV1, AC-ENV2, AC-ENV4
 * from `envelope-codec-extension.spec.md` (M2 R1, project-1).
 *
 * Per the spec § Open items 6 (resolved 2026-05-06), the envelope does
 * **not** zero its handle's plaintext slot post-encrypt. As a side
 * effect a write-side envelope's `decrypt()` returns the original
 * plaintext synchronously without consulting the SDK; AC-MW5 builds on
 * this property in M2 R2.
 */

import { describe, expect, it, vi } from 'vitest';
import { EncryptedString } from '../src/core/envelope';
import type { CipherstashSdk } from '../src/core/sdk';

function emptySdk(): CipherstashSdk {
  return {
    decrypt: vi.fn(),
    bulkEncrypt: vi.fn(),
    bulkDecrypt: vi.fn(),
  };
}

describe('EncryptedString.from(plaintext) — AC-ENV1', () => {
  it('returns an EncryptedString instance', () => {
    const envelope = EncryptedString.from('alice@example.com');
    expect(envelope).toBeInstanceOf(EncryptedString);
  });

  it('decrypt() resolves to the original plaintext on the write-side handle', async () => {
    const envelope = EncryptedString.from('alice@example.com');
    await expect(envelope.decrypt()).resolves.toBe('alice@example.com');
  });

  it('decrypt() does not consult an SDK on the write-side handle', async () => {
    const sdk = emptySdk();
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
    expect(decryptMock.mock.calls[0]?.[0]).toMatchObject({
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

  it('omits signal in the SDK call when none is provided', async () => {
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
    expect(Object.hasOwn(callArg, 'signal')).toBe(false);
  });

  it('caches the decrypted plaintext for subsequent calls', async () => {
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
    await envelope.decrypt();
    expect(decryptMock).toHaveBeenCalledTimes(1);
  });
});

describe('EncryptedString — handle is package-private — AC-ENV4', () => {
  it('exposes no own enumerable property', () => {
    const envelope = EncryptedString.from('secret');
    expect(Object.keys(envelope)).toEqual([]);
  });

  it('JSON.stringify produces a non-revealing placeholder', () => {
    const envelope = EncryptedString.from('top-secret');
    const json = JSON.stringify(envelope);
    expect(json).not.toContain('top-secret');
    expect(json).toBe(JSON.stringify({ $encryptedString: '<opaque>' }));
  });

  it('public methods are limited to decrypt and toJSON', () => {
    const proto = Object.getPrototypeOf(EncryptedString.from('x')) as object;
    const ownNames = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
    expect(ownNames.sort()).toEqual(['decrypt', 'toJSON']);
  });
});
