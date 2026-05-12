/**
 * Behavioural tests for the `EncryptedDouble` envelope.
 *
 * Pins the subclass surface (`from` + `fromInternal` + decrypt
 * round-trip), the four non-`toJSON` redaction overrides (return
 * `[REDACTED]`), and the `JSON.stringify(envelope)` placeholder
 * shape `{ "$encryptedDouble": "<opaque>" }`.
 */

import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { EncryptedEnvelopeBase } from '../src/execution/envelope-base';
import { EncryptedDouble } from '../src/execution/envelope-double';
import type { CipherstashSdk } from '../src/execution/sdk';

function emptySdk(): CipherstashSdk {
  return {
    decrypt: vi.fn(),
    bulkEncrypt: vi.fn(),
    bulkDecrypt: vi.fn(),
  };
}

describe('EncryptedDouble.from(plaintext)', () => {
  it('returns an EncryptedDouble instance that extends EncryptedEnvelopeBase', () => {
    const envelope = EncryptedDouble.from(3.14);
    expect(envelope).toBeInstanceOf(EncryptedDouble);
    expect(envelope).toBeInstanceOf(EncryptedEnvelopeBase);
  });

  it('decrypt() resolves to the original numeric plaintext on the write side', async () => {
    const envelope = EncryptedDouble.from(2.5);
    await expect(envelope.decrypt()).resolves.toBe(2.5);
  });

  it('preserves negative and zero values without coercion', async () => {
    await expect(EncryptedDouble.from(-1.5).decrypt()).resolves.toBe(-1.5);
    await expect(EncryptedDouble.from(0).decrypt()).resolves.toBe(0);
  });
});

describe('EncryptedDouble.fromInternal(...) — read-side round-trip', () => {
  it('decrypt({signal}) calls the SDK single-cell decrypt and returns the numeric plaintext', async () => {
    const ciphertext = { c: 'cipher', i: { t: 'metric', c: 'value' } };
    const decryptMock = vi.fn().mockResolvedValue(42.5);
    const sdk: CipherstashSdk = {
      decrypt: decryptMock,
      bulkEncrypt: vi.fn(),
      bulkDecrypt: vi.fn(),
    };

    const envelope = EncryptedDouble.fromInternal({
      ciphertext,
      table: 'metric',
      column: 'value',
      sdk,
    });

    const ac = new AbortController();
    const result = await envelope.decrypt({ signal: ac.signal });

    expect(result).toBe(42.5);
    expect(decryptMock).toHaveBeenCalledTimes(1);
    expect(decryptMock.mock.calls[0]?.[0]).toMatchObject({
      ciphertext,
      table: 'metric',
      column: 'value',
      signal: ac.signal,
    });
  });
});

describe('EncryptedDouble — accidental-exposure overrides', () => {
  // The four non-`toJSON` coercion paths return `[REDACTED]`;
  // `toJSON` returns the per-type placeholder object.
  it('toString() returns [REDACTED] regardless of plaintext value', () => {
    expect(EncryptedDouble.from(42).toString()).toBe('[REDACTED]');
  });

  it('valueOf() returns [REDACTED]', () => {
    expect(EncryptedDouble.from(42).valueOf()).toBe('[REDACTED]');
  });

  it('Symbol.toPrimitive returns [REDACTED] for template-literal coercion', () => {
    const envelope = EncryptedDouble.from(42);
    expect(`v=${envelope}`).toBe('v=[REDACTED]');
  });

  it('util.inspect returns [REDACTED]', () => {
    const envelope = EncryptedDouble.from(42);
    const inspected = inspect(envelope, { depth: Number.POSITIVE_INFINITY, getters: true });
    expect(inspected).not.toContain('42');
    expect(inspected).toContain('[REDACTED]');
  });

  it('JSON.stringify renders the per-type placeholder marker shape', () => {
    const envelope = EncryptedDouble.from(42);
    expect(JSON.parse(JSON.stringify(envelope))).toEqual({ $encryptedDouble: '<opaque>' });
  });

  it('JSON.stringify cannot leak plaintext', () => {
    const envelope = EncryptedDouble.from(123.456789);
    const json = JSON.stringify({ value: envelope });
    expect(json).not.toContain('123.456789');
  });
});

describe('EncryptedDouble — fromInternal preserves SDK references', () => {
  it('exposes the (table, column) routing context + SDK on the handle', () => {
    const sdk = emptySdk();
    const envelope = EncryptedDouble.fromInternal({
      ciphertext: 'wire',
      table: 'metric',
      column: 'value',
      sdk,
    });
    const handle = envelope.expose();
    expect(handle.table).toBe('metric');
    expect(handle.column).toBe('value');
    expect(handle.sdk).toBe(sdk);
    expect(handle.plaintext).toBeUndefined();
  });
});
