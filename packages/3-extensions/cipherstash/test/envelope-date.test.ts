/**
 * Behavioural tests for the `EncryptedDate` envelope.
 *
 * Pins the per-type `parseDecryptedValue` narrowing path for the
 * `cipherstash/date@1` codec (the SDK returns `unknown`; the
 * envelope coerces ISO strings / numeric epoch ms / `Date`
 * instances into a single `Date` shape for the user).
 */

import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { EncryptedEnvelopeBase } from '../src/execution/envelope-base';
import { EncryptedDate } from '../src/execution/envelope-date';
import type { CipherstashSdk } from '../src/execution/sdk';

function emptySdk(): CipherstashSdk {
  return {
    decrypt: vi.fn(),
    bulkEncrypt: vi.fn(),
    bulkDecrypt: vi.fn(),
  };
}

describe('EncryptedDate.from(plaintext)', () => {
  it('returns an EncryptedDate instance that extends EncryptedEnvelopeBase', () => {
    const envelope = EncryptedDate.from(new Date('2024-01-01'));
    expect(envelope).toBeInstanceOf(EncryptedDate);
    expect(envelope).toBeInstanceOf(EncryptedEnvelopeBase);
  });

  it('decrypt() resolves to the original Date plaintext on the write side', async () => {
    const original = new Date('2024-06-15');
    const envelope = EncryptedDate.from(original);
    await expect(envelope.decrypt()).resolves.toBe(original);
  });
});

describe('EncryptedDate.fromInternal(...) — read-side round-trip + parseDecryptedValue narrowing', () => {
  it('coerces an ISO date string from the SDK into a Date instance', async () => {
    const ciphertext = { c: 'cipher', i: { t: 'event', c: 'occurred_on' } };
    const decryptMock = vi.fn().mockResolvedValue('2023-01-01');
    const sdk: CipherstashSdk = {
      decrypt: decryptMock,
      bulkEncrypt: vi.fn(),
      bulkDecrypt: vi.fn(),
    };

    const envelope = EncryptedDate.fromInternal({
      ciphertext,
      table: 'event',
      column: 'occurred_on',
      sdk,
    });

    const result = await envelope.decrypt();
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe('2023-01-01T00:00:00.000Z');
    expect(decryptMock).toHaveBeenCalledTimes(1);
  });

  it('passes through a Date instance from the SDK unchanged', async () => {
    const sdkDate = new Date('2025-04-01');
    const sdk: CipherstashSdk = {
      decrypt: vi.fn().mockResolvedValue(sdkDate),
      bulkEncrypt: vi.fn(),
      bulkDecrypt: vi.fn(),
    };
    const envelope = EncryptedDate.fromInternal({
      ciphertext: 'wire',
      table: 'event',
      column: 'occurred_on',
      sdk,
    });
    await expect(envelope.decrypt()).resolves.toBe(sdkDate);
  });

  it('coerces an epoch-ms number from the SDK into a Date instance', async () => {
    const epochMs = 1_700_000_000_000;
    const sdk: CipherstashSdk = {
      decrypt: vi.fn().mockResolvedValue(epochMs),
      bulkEncrypt: vi.fn(),
      bulkDecrypt: vi.fn(),
    };
    const envelope = EncryptedDate.fromInternal({
      ciphertext: 'wire',
      table: 'event',
      column: 'occurred_on',
      sdk,
    });
    const result = await envelope.decrypt();
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(epochMs);
  });

  it('throws when the SDK returns an invalid Date shape', async () => {
    const sdk: CipherstashSdk = {
      decrypt: vi.fn().mockResolvedValue({ not: 'a date' }),
      bulkEncrypt: vi.fn(),
      bulkDecrypt: vi.fn(),
    };
    const envelope = EncryptedDate.fromInternal({
      ciphertext: 'wire',
      table: 'event',
      column: 'occurred_on',
      sdk,
    });
    await expect(envelope.decrypt()).rejects.toThrow(/EncryptedDate.parseDecryptedValue/);
  });

  it('throws when the SDK returns an unparseable date string', async () => {
    const sdk: CipherstashSdk = {
      decrypt: vi.fn().mockResolvedValue('not-a-real-date'),
      bulkEncrypt: vi.fn(),
      bulkDecrypt: vi.fn(),
    };
    const envelope = EncryptedDate.fromInternal({
      ciphertext: 'wire',
      table: 'event',
      column: 'occurred_on',
      sdk,
    });
    await expect(envelope.decrypt()).rejects.toThrow(/does not parse to a valid Date/);
  });
});

describe('EncryptedDate.from(plaintext) — input validation', () => {
  it('throws when plaintext is an Invalid Date (NaN time)', () => {
    expect(() => EncryptedDate.from(new Date('not-a-date'))).toThrow(
      /must be a valid Date instance/,
    );
  });
});

describe('EncryptedDate — accidental-exposure overrides', () => {
  it('toString() returns [REDACTED]', () => {
    expect(EncryptedDate.from(new Date('2024-01-01')).toString()).toBe('[REDACTED]');
  });

  it('valueOf() returns [REDACTED]', () => {
    expect(EncryptedDate.from(new Date('2024-01-01')).valueOf()).toBe('[REDACTED]');
  });

  it('Symbol.toPrimitive returns [REDACTED] for template-literal coercion', () => {
    const envelope = EncryptedDate.from(new Date('2024-01-01'));
    expect(`v=${envelope}`).toBe('v=[REDACTED]');
  });

  it('util.inspect returns [REDACTED]', () => {
    const envelope = EncryptedDate.from(new Date('2024-01-01'));
    const inspected = inspect(envelope, { depth: Number.POSITIVE_INFINITY, getters: true });
    expect(inspected).not.toContain('2024');
    expect(inspected).toContain('[REDACTED]');
  });

  it('JSON.stringify renders the per-type placeholder marker shape', () => {
    const envelope = EncryptedDate.from(new Date('2024-01-01'));
    expect(JSON.parse(JSON.stringify(envelope))).toEqual({ $encryptedDate: '<opaque>' });
  });

  it('JSON.stringify cannot leak plaintext', () => {
    const envelope = EncryptedDate.from(new Date('2024-06-15T12:34:56.789Z'));
    const json = JSON.stringify({ value: envelope });
    expect(json).not.toContain('2024');
    expect(json).not.toContain('06');
  });
});

describe('EncryptedDate — fromInternal preserves SDK references', () => {
  it('exposes the (table, column) routing context + SDK on the handle', () => {
    const sdk = emptySdk();
    const envelope = EncryptedDate.fromInternal({
      ciphertext: 'wire',
      table: 'event',
      column: 'occurred_on',
      sdk,
    });
    const handle = envelope.expose();
    expect(handle).toMatchObject({
      table: 'event',
      column: 'occurred_on',
      plaintext: undefined,
    });
    expect(handle.sdk).toBe(sdk);
  });
});
