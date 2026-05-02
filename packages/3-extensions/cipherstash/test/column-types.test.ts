import { describe, expect, it } from 'vitest';
import { encryptedString } from '../src/exports/column-types';

describe('cipherstash column-types', () => {
  describe('encryptedString({...}) factory', () => {
    it('produces a ColumnTypeDescriptor with cipherstash/string@1 codec id', () => {
      const descriptor = encryptedString({});
      expect(descriptor).toMatchObject({
        codecId: 'cipherstash/string@1',
        nativeType: 'eql_v2_encrypted',
      });
    });

    it('applies false defaults when both flags are omitted', () => {
      expect(encryptedString({})).toMatchObject({
        typeParams: { equality: false, freeTextSearch: false },
      });
    });

    it('preserves equality flag when provided', () => {
      expect(encryptedString({ equality: true })).toMatchObject({
        typeParams: { equality: true, freeTextSearch: false },
      });
    });

    it('preserves both flags when provided', () => {
      expect(encryptedString({ equality: true, freeTextSearch: true })).toMatchObject({
        typeParams: { equality: true, freeTextSearch: true },
      });
    });

    it('returns a structurally equivalent descriptor to the PSL constructor lowering', () => {
      // The TS factory must produce the same shape the PSL interpreter's
      // type-constructor lowering produces, so the parity fixture (AC-PARITY1)
      // can compare PSL- and TS-emitted contract.json byte-for-byte.
      expect(encryptedString({ equality: true, freeTextSearch: true })).toEqual({
        codecId: 'cipherstash/string@1',
        nativeType: 'eql_v2_encrypted',
        typeParams: { equality: true, freeTextSearch: true },
      });
    });
  });
});
