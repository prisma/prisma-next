/**
 * TS contract factory for cipherstash-encrypted string columns.
 *
 * The factory must produce a `ColumnTypeDescriptor` byte-identical to
 * the lowering output of the PSL constructor `cipherstash.EncryptedString`
 * registered in `src/contract-authoring.ts`. The full byte-equality is verified
 * by the integration parity fixture; these unit tests pin the shape
 * locally so a regression is caught in the package suite first.
 */

import { describe, expect, it } from 'vitest';
import { encryptedBigInt, encryptedDouble, encryptedString } from '../src/exports/column-types';

describe('cipherstash column-types', () => {
  describe('encryptedString({...}) factory', () => {
    it('produces a ColumnTypeDescriptor with cipherstash/string@1 codec id', () => {
      const descriptor = encryptedString();
      expect(descriptor).toMatchObject({
        codecId: 'cipherstash/string@1',
        nativeType: 'eql_v2_encrypted',
      });
    });

    it('defaults both flags to true when called with no arguments', () => {
      expect(encryptedString()).toMatchObject({
        typeParams: { equality: true, freeTextSearch: true },
      });
    });

    it('defaults both flags to true for an empty options object', () => {
      expect(encryptedString({})).toMatchObject({
        typeParams: { equality: true, freeTextSearch: true },
      });
    });

    it('lets equality be explicitly disabled', () => {
      expect(encryptedString({ equality: false })).toMatchObject({
        typeParams: { equality: false, freeTextSearch: true },
      });
    });

    it('lets freeTextSearch be explicitly disabled', () => {
      expect(encryptedString({ freeTextSearch: false })).toMatchObject({
        typeParams: { equality: true, freeTextSearch: false },
      });
    });

    it('lets both flags be explicitly disabled (storage-only encryption)', () => {
      expect(encryptedString({ equality: false, freeTextSearch: false })).toMatchObject({
        typeParams: { equality: false, freeTextSearch: false },
      });
    });

    it('preserves both flags when explicitly enabled', () => {
      expect(encryptedString({ equality: true, freeTextSearch: true })).toMatchObject({
        typeParams: { equality: true, freeTextSearch: true },
      });
    });

    it('returns a structurally equivalent descriptor to the PSL constructor lowering', () => {
      expect(encryptedString({ equality: true, freeTextSearch: true })).toEqual({
        codecId: 'cipherstash/string@1',
        nativeType: 'eql_v2_encrypted',
        typeParams: { equality: true, freeTextSearch: true },
      });
    });
  });

  describe('encryptedDouble({...}) factory', () => {
    it('produces a ColumnTypeDescriptor with cipherstash/double@1 codec id', () => {
      expect(encryptedDouble()).toMatchObject({
        codecId: 'cipherstash/double@1',
        nativeType: 'eql_v2_encrypted',
      });
    });

    it('defaults both flags to true when called with no arguments', () => {
      expect(encryptedDouble()).toMatchObject({
        typeParams: { equality: true, orderAndRange: true },
      });
    });

    it('defaults both flags to true for an empty options object', () => {
      expect(encryptedDouble({})).toMatchObject({
        typeParams: { equality: true, orderAndRange: true },
      });
    });

    it('lets equality be explicitly disabled', () => {
      expect(encryptedDouble({ equality: false })).toMatchObject({
        typeParams: { equality: false, orderAndRange: true },
      });
    });

    it('lets orderAndRange be explicitly disabled', () => {
      expect(encryptedDouble({ orderAndRange: false })).toMatchObject({
        typeParams: { equality: true, orderAndRange: false },
      });
    });

    it('lets both flags be explicitly disabled (storage-only encryption)', () => {
      expect(encryptedDouble({ equality: false, orderAndRange: false })).toEqual({
        codecId: 'cipherstash/double@1',
        nativeType: 'eql_v2_encrypted',
        typeParams: { equality: false, orderAndRange: false },
      });
    });
  });

  describe('encryptedBigInt({...}) factory', () => {
    it('produces a ColumnTypeDescriptor with cipherstash/bigint@1 codec id', () => {
      expect(encryptedBigInt()).toMatchObject({
        codecId: 'cipherstash/bigint@1',
        nativeType: 'eql_v2_encrypted',
      });
    });

    it('defaults both flags to true when called with no arguments', () => {
      expect(encryptedBigInt()).toMatchObject({
        typeParams: { equality: true, orderAndRange: true },
      });
    });

    it('lets both flags be explicitly disabled (storage-only encryption)', () => {
      expect(encryptedBigInt({ equality: false, orderAndRange: false })).toEqual({
        codecId: 'cipherstash/bigint@1',
        nativeType: 'eql_v2_encrypted',
        typeParams: { equality: false, orderAndRange: false },
      });
    });
  });
});
