/**
 * Behavioural tests for the `EncryptedBigInt` envelope.
 *
 * Pins AC-ENV3 / AC-ENV4 / AC-ENV5 for the `cipherstash/bigint@1`
 * codec; mirrors `envelope-double.test.ts` byte-for-byte beyond the
 * plaintext type and marker name.
 */

import { describe, expect, it, vi } from 'vitest';
import { EncryptedEnvelopeBase } from '../src/execution/envelope-base';
import { EncryptedBigInt } from '../src/execution/envelope-bigint';
import type { CipherstashSdk } from '../src/execution/sdk';

describe('EncryptedBigInt.from(plaintext)', () => {
  it('returns an EncryptedBigInt instance that extends EncryptedEnvelopeBase', () => {
    const envelope = EncryptedBigInt.from(9007199254740993n);
    expect(envelope).toBeInstanceOf(EncryptedBigInt);
    expect(envelope).toBeInstanceOf(EncryptedEnvelopeBase);
  });

  it('decrypt() resolves to the original bigint plaintext on the write side', async () => {
    const envelope = EncryptedBigInt.from(123456789012345678901234567890n);
    await expect(envelope.decrypt()).resolves.toBe(123456789012345678901234567890n);
  });

  it('preserves negative bigint values', async () => {
    await expect(EncryptedBigInt.from(-1n).decrypt()).resolves.toBe(-1n);
  });
});

describe('EncryptedBigInt.fromInternal(...) — read-side round-trip', () => {
  it('decrypt() calls the SDK single-cell decrypt and returns the bigint plaintext', async () => {
    const ciphertext = { c: 'cipher', i: { t: 'ledger', c: 'amount' } };
    const decryptMock = vi.fn().mockResolvedValue(7n);
    const sdk: CipherstashSdk = {
      decrypt: decryptMock,
      bulkEncrypt: vi.fn(),
      bulkDecrypt: vi.fn(),
    };

    const envelope = EncryptedBigInt.fromInternal({
      ciphertext,
      table: 'ledger',
      column: 'amount',
      sdk,
    });

    await expect(envelope.decrypt()).resolves.toBe(7n);
    expect(decryptMock).toHaveBeenCalledTimes(1);
  });
});

describe('EncryptedBigInt — accidental-exposure overrides', () => {
  it('toString() returns [REDACTED]', () => {
    expect(EncryptedBigInt.from(42n).toString()).toBe('[REDACTED]');
  });

  it('valueOf() returns [REDACTED]', () => {
    expect(EncryptedBigInt.from(42n).valueOf()).toBe('[REDACTED]');
  });

  it('JSON.stringify renders the per-type placeholder marker shape', () => {
    const envelope = EncryptedBigInt.from(42n);
    expect(JSON.parse(JSON.stringify(envelope))).toEqual({ $encryptedBigInt: '<opaque>' });
  });

  it('JSON.stringify cannot leak plaintext', () => {
    const envelope = EncryptedBigInt.from(987654321n);
    const json = JSON.stringify({ amount: envelope });
    expect(json).not.toContain('987654321');
  });
});
