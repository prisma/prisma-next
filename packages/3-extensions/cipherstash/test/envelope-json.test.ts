/**
 * Behavioural tests for the `EncryptedJson` envelope.
 *
 * Pins the subclass surface, redaction overrides, and `toJSON`
 * placeholder shape for the `cipherstash/json@1` codec.
 * The plaintext type is intentionally `unknown` (any
 * JSON-serialisable shape) — we exercise objects, arrays, and
 * primitives to confirm the envelope round-trips opaque payloads
 * without inspecting their structure.
 */

import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { EncryptedEnvelopeBase } from '../src/execution/envelope-base';
import { EncryptedJson } from '../src/execution/envelope-json';
import type { CipherstashSdk } from '../src/execution/sdk';

function emptySdk(): CipherstashSdk {
  return {
    decrypt: vi.fn(),
    bulkEncrypt: vi.fn(),
    bulkDecrypt: vi.fn(),
  };
}

describe('EncryptedJson.from(plaintext)', () => {
  it('returns an EncryptedJson instance that extends EncryptedEnvelopeBase', () => {
    const envelope = EncryptedJson.from({ k: 1 });
    expect(envelope).toBeInstanceOf(EncryptedJson);
    expect(envelope).toBeInstanceOf(EncryptedEnvelopeBase);
  });

  it('decrypt() round-trips an object plaintext on the write side', async () => {
    const payload = { user: 'alice', roles: ['admin', 'editor'] };
    await expect(EncryptedJson.from(payload).decrypt()).resolves.toBe(payload);
  });

  it('decrypt() round-trips array and primitive JSON plaintexts', async () => {
    await expect(EncryptedJson.from([1, 2, 3]).decrypt()).resolves.toEqual([1, 2, 3]);
    await expect(EncryptedJson.from(null).decrypt()).resolves.toBeNull();
  });
});

describe('EncryptedJson.fromInternal(...) — read-side round-trip', () => {
  it('decrypt({signal}) calls the SDK single-cell decrypt and returns the JSON plaintext as-is', async () => {
    const ciphertext = { c: 'cipher', i: { t: 'audit', c: 'payload' } };
    const decoded = { event: 'login', userId: 42 };
    const decryptMock = vi.fn().mockResolvedValue(decoded);
    const sdk: CipherstashSdk = {
      decrypt: decryptMock,
      bulkEncrypt: vi.fn(),
      bulkDecrypt: vi.fn(),
    };

    const envelope = EncryptedJson.fromInternal({
      ciphertext,
      table: 'audit',
      column: 'payload',
      sdk,
    });

    const result = await envelope.decrypt();
    expect(result).toBe(decoded);
    expect(decryptMock).toHaveBeenCalledTimes(1);
  });
});

describe('EncryptedJson — accidental-exposure overrides', () => {
  it('toString() returns [REDACTED]', () => {
    expect(EncryptedJson.from({ secret: 'value' }).toString()).toBe('[REDACTED]');
  });

  it('valueOf() returns [REDACTED]', () => {
    expect(EncryptedJson.from({ secret: 'value' }).valueOf()).toBe('[REDACTED]');
  });

  it('Symbol.toPrimitive returns [REDACTED] for template-literal coercion', () => {
    expect(`v=${EncryptedJson.from({ secret: 'value' })}`).toBe('v=[REDACTED]');
  });

  it('util.inspect returns [REDACTED]', () => {
    const envelope = EncryptedJson.from({ secret: 'leak-me' });
    const inspected = inspect(envelope, { depth: Number.POSITIVE_INFINITY, getters: true });
    expect(inspected).not.toContain('leak-me');
    expect(inspected).toContain('[REDACTED]');
  });

  it('JSON.stringify renders the per-type placeholder marker shape', () => {
    const envelope = EncryptedJson.from({ k: 'v' });
    expect(JSON.parse(JSON.stringify(envelope))).toEqual({ $encryptedJson: '<opaque>' });
  });

  it('JSON.stringify cannot leak nested plaintext fields', () => {
    const envelope = EncryptedJson.from({ secret: 'TOPSECRET' });
    const json = JSON.stringify({ value: envelope });
    expect(json).not.toContain('TOPSECRET');
    expect(json).not.toContain('secret');
  });
});

describe('EncryptedJson — fromInternal preserves SDK references', () => {
  it('exposes the (table, column) routing context + SDK on the handle', () => {
    const sdk = emptySdk();
    const envelope = EncryptedJson.fromInternal({
      ciphertext: 'wire',
      table: 'audit',
      column: 'payload',
      sdk,
    });
    const handle = envelope.expose();
    expect(handle.table).toBe('audit');
    expect(handle.column).toBe('payload');
    expect(handle.sdk).toBe(sdk);
    expect(handle.plaintext).toBeUndefined();
  });
});
