import { describe, expect, it } from 'vitest';
import { writeContractMarker } from '../src/sql-marker';

describe('writeContractMarker', () => {
  describe('without invariants (sign-side)', () => {
    const sample = writeContractMarker({
      storageHash: 'sha256:hash',
      profileHash: 'sha256:profile',
    });

    it('omits invariants from the INSERT column list (column relies on default)', () => {
      expect(sample.insert.sql).not.toMatch(/invariants/);
    });

    it('omits invariants from the UPDATE clause (existing column preserved)', () => {
      expect(sample.update.sql).not.toMatch(/invariants/);
    });

    it('does not include the invariants param in baseParams', () => {
      expect(sample.insert.params).toHaveLength(7);
      expect(sample.update.params).toHaveLength(7);
    });
  });

  describe('with explicit invariants (runner-side / explicit overwrite)', () => {
    const sample = writeContractMarker({
      storageHash: 'sha256:hash',
      profileHash: 'sha256:profile',
      invariants: ['alpha', 'beta'],
    });

    it('includes invariants in the INSERT column list', () => {
      expect(sample.insert.sql).toMatch(/invariants/);
    });

    it('includes invariants in the UPDATE clause', () => {
      expect(sample.update.sql).toMatch(/invariants = \$8::text\[\]/);
    });

    it('passes the invariants array as the 8th param', () => {
      expect(sample.insert.params[7]).toEqual(['alpha', 'beta']);
      expect(sample.update.params[7]).toEqual(['alpha', 'beta']);
    });
  });

  describe('with invariants: [] (explicit empty — clobber, not preserve)', () => {
    const sample = writeContractMarker({
      storageHash: 'sha256:hash',
      profileHash: 'sha256:profile',
      invariants: [],
    });

    it('treats explicit [] as a write (distinct from undefined)', () => {
      expect(sample.update.sql).toMatch(/invariants = \$8::text\[\]/);
      expect(sample.update.params[7]).toEqual([]);
    });
  });
});
