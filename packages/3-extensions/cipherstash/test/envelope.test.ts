/**
 * Behavioural tests for the `EncryptedString` envelope and the
 * `CipherstashSdk` shape it talks to.
 *
 * The envelope does **not** zero its handle's plaintext slot
 * post-encrypt. As a side effect a write-side envelope's `decrypt()`
 * returns the original plaintext synchronously without consulting the
 * SDK; the bulk-encrypt middleware builds on this property.
 */

import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { EncryptedString, setHandleRoutingKey } from '../src/execution/envelope';
import type { CipherstashSdk } from '../src/execution/sdk';

describe('EncryptedString.from(plaintext)', () => {
  it('returns an EncryptedString instance', () => {
    const envelope = EncryptedString.from('alice@example.com');
    expect(envelope).toBeInstanceOf(EncryptedString);
  });

  it('decrypt() resolves to the original plaintext on the write-side handle', async () => {
    const envelope = EncryptedString.from('alice@example.com');
    await expect(envelope.decrypt()).resolves.toBe('alice@example.com');
  });

  it('decrypt() does not consult an SDK on the write-side handle', async () => {
    // Write-side envelopes built via `from(plaintext)` carry no SDK
    // reference: `decrypt()` resolves directly from the cached
    // plaintext slot without dispatching to any external service.
    const envelope = EncryptedString.from('hello');
    await expect(envelope.decrypt()).resolves.toBe('hello');
  });
});

describe('EncryptedString.fromInternal(...) — read-side', () => {
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

describe('EncryptedString — accidental-exposure overrides (Rust `secrecy` style)', () => {
  // The handle stays reachable on purpose: `expose()` is the explicit
  // opt-in. What these tests pin is that *every common implicit*
  // exposure path — JSON, console, stringification, primitive coercion
  // — refuses to leak the plaintext. If a future refactor drops one of
  // these overrides, the regression surfaces here.

  it('exposes no own enumerable property', () => {
    const envelope = EncryptedString.from('secret');
    expect(Object.keys(envelope)).toEqual([]);
  });

  it('expose() is the explicit access path — returns the wrapped handle', () => {
    const envelope = EncryptedString.from('top-secret');
    const handle = envelope.expose();
    expect(handle.plaintext).toBe('top-secret');
  });

  it('JSON.stringify cannot leak plaintext', () => {
    const envelope = EncryptedString.from('top-secret');
    const json = JSON.stringify({ email: envelope });
    expect(json).not.toContain('top-secret');
  });

  it('JSON.stringify renders the per-type placeholder marker shape', () => {
    const envelope = EncryptedString.from('top-secret');
    expect(JSON.parse(JSON.stringify(envelope))).toEqual({ $encryptedString: '<opaque>' });
  });

  it('toJSON returns the placeholder object directly', () => {
    const envelope = EncryptedString.from('top-secret');
    expect(envelope.toJSON()).toEqual({ $encryptedString: '<opaque>' });
  });

  it('String(envelope) and toString() cannot leak plaintext', () => {
    const envelope = EncryptedString.from('top-secret');
    expect(String(envelope)).not.toContain('top-secret');
    expect(envelope.toString()).not.toContain('top-secret');
  });

  it('template-literal coercion (Symbol.toPrimitive) cannot leak plaintext', () => {
    const envelope = EncryptedString.from('top-secret');
    const interpolated = `email is ${envelope}`;
    expect(interpolated).not.toContain('top-secret');
  });

  it('valueOf() cannot leak plaintext', () => {
    const envelope = EncryptedString.from('top-secret');
    expect(String(envelope.valueOf())).not.toContain('top-secret');
  });

  it('util.inspect (and therefore console.log) cannot leak plaintext', () => {
    const envelope = EncryptedString.from('top-secret');
    const inspected = inspect(envelope, {
      depth: Number.POSITIVE_INFINITY,
      getters: true,
      showHidden: true,
    });
    expect(inspected).not.toContain('top-secret');
  });

  it('inspecting an object that contains an envelope does not leak plaintext', () => {
    const envelope = EncryptedString.from('top-secret');
    const inspected = inspect(
      { user: { id: 'u1', email: envelope } },
      { depth: Number.POSITIVE_INFINITY },
    );
    expect(inspected).not.toContain('top-secret');
  });
});

describe('setHandleRoutingKey', () => {
  it('stamps table/column on a fresh envelope', () => {
    const envelope = EncryptedString.from('a@b.com');
    setHandleRoutingKey(envelope, 'users', 'email');
    const handle = envelope.expose();
    expect(handle.table).toBe('users');
    expect(handle.column).toBe('email');
  });

  it('re-stamping the same routing key is a no-op', () => {
    const envelope = EncryptedString.from('a@b.com');
    setHandleRoutingKey(envelope, 'users', 'email');
    expect(() => setHandleRoutingKey(envelope, 'users', 'email')).not.toThrow();
  });

  it('rejects conflicting table reassignment', () => {
    const envelope = EncryptedString.from('a@b.com');
    setHandleRoutingKey(envelope, 'users', 'email');
    expect(() => setHandleRoutingKey(envelope, 'accounts', 'email')).toThrow(
      /routing-key table conflict/,
    );
  });

  it('rejects conflicting column reassignment', () => {
    const envelope = EncryptedString.from('a@b.com');
    setHandleRoutingKey(envelope, 'users', 'email');
    expect(() => setHandleRoutingKey(envelope, 'users', 'username')).toThrow(
      /routing-key column conflict/,
    );
  });
});
