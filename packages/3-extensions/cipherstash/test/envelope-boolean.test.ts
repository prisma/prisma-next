/**
 * Behavioural tests for the `EncryptedBoolean` envelope.
 *
 * Pins AC-ENV3 / AC-ENV4 / AC-ENV5 for the `cipherstash/boolean@1`
 * codec.
 */

import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { EncryptedEnvelopeBase } from '../src/execution/envelope-base';
import { EncryptedBoolean } from '../src/execution/envelope-boolean';
import type { CipherstashSdk } from '../src/execution/sdk';

function emptySdk(): CipherstashSdk {
  return {
    decrypt: vi.fn(),
    bulkEncrypt: vi.fn(),
    bulkDecrypt: vi.fn(),
  };
}

describe('EncryptedBoolean.from(plaintext)', () => {
  it('returns an EncryptedBoolean instance that extends EncryptedEnvelopeBase', () => {
    const envelope = EncryptedBoolean.from(true);
    expect(envelope).toBeInstanceOf(EncryptedBoolean);
    expect(envelope).toBeInstanceOf(EncryptedEnvelopeBase);
  });

  it('decrypt() resolves to the original boolean plaintext on the write side', async () => {
    await expect(EncryptedBoolean.from(true).decrypt()).resolves.toBe(true);
    await expect(EncryptedBoolean.from(false).decrypt()).resolves.toBe(false);
  });
});

describe('EncryptedBoolean.fromInternal(...) — read-side round-trip', () => {
  it('decrypt({signal}) calls the SDK single-cell decrypt and returns the boolean plaintext', async () => {
    const ciphertext = { c: 'cipher', i: { t: 'feature', c: 'enabled' } };
    const decryptMock = vi.fn().mockResolvedValue(true);
    const sdk: CipherstashSdk = {
      decrypt: decryptMock,
      bulkEncrypt: vi.fn(),
      bulkDecrypt: vi.fn(),
    };

    const envelope = EncryptedBoolean.fromInternal({
      ciphertext,
      table: 'feature',
      column: 'enabled',
      sdk,
    });

    const result = await envelope.decrypt();
    expect(result).toBe(true);
    expect(decryptMock).toHaveBeenCalledTimes(1);
  });
});

describe('EncryptedBoolean — accidental-exposure overrides', () => {
  it('toString() returns [REDACTED]', () => {
    expect(EncryptedBoolean.from(true).toString()).toBe('[REDACTED]');
  });

  it('valueOf() returns [REDACTED]', () => {
    expect(EncryptedBoolean.from(true).valueOf()).toBe('[REDACTED]');
  });

  it('Symbol.toPrimitive returns [REDACTED] for template-literal coercion', () => {
    expect(`v=${EncryptedBoolean.from(true)}`).toBe('v=[REDACTED]');
  });

  it('util.inspect returns [REDACTED]', () => {
    const envelope = EncryptedBoolean.from(true);
    const inspected = inspect(envelope, { depth: Number.POSITIVE_INFINITY, getters: true });
    expect(inspected).not.toContain('true');
    expect(inspected).toContain('[REDACTED]');
  });

  it('JSON.stringify renders the per-type placeholder marker shape', () => {
    const envelope = EncryptedBoolean.from(true);
    expect(JSON.parse(JSON.stringify(envelope))).toEqual({ $encryptedBoolean: '<opaque>' });
  });

  it('JSON.stringify cannot leak plaintext', () => {
    const envelope = EncryptedBoolean.from(true);
    const json = JSON.stringify({ value: envelope });
    expect(json).not.toContain('true');
  });
});

describe('EncryptedBoolean — fromInternal preserves SDK references', () => {
  it('exposes the (table, column) routing context + SDK on the handle', () => {
    const sdk = emptySdk();
    const envelope = EncryptedBoolean.fromInternal({
      ciphertext: 'wire',
      table: 'feature',
      column: 'enabled',
      sdk,
    });
    const handle = envelope.expose();
    expect(handle.table).toBe('feature');
    expect(handle.column).toBe('enabled');
    expect(handle.sdk).toBe(sdk);
    expect(handle.plaintext).toBeUndefined();
  });
});
