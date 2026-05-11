import { describe, expect, it } from 'vitest';
import { APP_SPACE_ID, readContractMarker, writeContractMarker } from '../src/sql-marker';

describe('writeContractMarker', () => {
  describe('without invariants (sign-side)', () => {
    const sample = writeContractMarker({
      space: APP_SPACE_ID,
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

    it('binds the caller-supplied space as the first param of the upsert', () => {
      expect(sample.insert.sql).toMatch(/\(\s*space\b/);
      expect(sample.update.sql).toMatch(/where space = \$1/i);
      expect(sample.insert.params[0]).toBe(APP_SPACE_ID);
      expect(sample.update.params[0]).toBe(APP_SPACE_ID);
    });
  });

  describe('with explicit invariants (sign-side / explicit overwrite)', () => {
    const sample = writeContractMarker({
      space: APP_SPACE_ID,
      storageHash: 'sha256:hash',
      profileHash: 'sha256:profile',
      invariants: ['alpha', 'beta'],
    });

    it('includes invariants in the INSERT column list', () => {
      expect(sample.insert.sql).toMatch(/invariants/);
    });

    it('includes invariants in the UPDATE clause with a positional placeholder', () => {
      expect(sample.update.sql).toMatch(/invariants = \$\d+::text\[\]/);
    });

    it('binds the invariants array as a parameter', () => {
      expect(sample.insert.params).toContainEqual(['alpha', 'beta']);
      expect(sample.update.params).toContainEqual(['alpha', 'beta']);
    });
  });

  describe('with invariants: [] (explicit empty — clobber, not preserve)', () => {
    const sample = writeContractMarker({
      space: APP_SPACE_ID,
      storageHash: 'sha256:hash',
      profileHash: 'sha256:profile',
      invariants: [],
    });

    it('treats explicit [] as a write (distinct from undefined)', () => {
      expect(sample.update.sql).toMatch(/invariants = \$\d+::text\[\]/);
      expect(sample.update.params).toContainEqual([]);
    });
  });

  describe('with an extension space id (per-space callers)', () => {
    const sample = writeContractMarker({
      space: 'cipherstash',
      storageHash: 'sha256:hash',
      profileHash: 'sha256:profile',
      invariants: ['cipherstash:install-eql-v1'],
    });

    it('binds the caller-supplied space as the first param', () => {
      expect(sample.insert.params[0]).toBe('cipherstash');
      expect(sample.update.params[0]).toBe('cipherstash');
    });

    it('keys both INSERT and UPDATE by space, never by id', () => {
      expect(sample.insert.sql).not.toMatch(/\bid\b/);
      expect(sample.update.sql).toMatch(/where space = \$1/i);
    });
  });
});

describe('readContractMarker', () => {
  it('binds the caller-supplied space id as the parameter', () => {
    const stmt = readContractMarker('cipherstash');
    expect(stmt.sql).toMatch(/where space = \$1/i);
    expect(stmt.params).toEqual(['cipherstash']);
  });

  it('binds APP_SPACE_ID when callers ask for the app marker explicitly', () => {
    const stmt = readContractMarker(APP_SPACE_ID);
    expect(stmt.params).toEqual([APP_SPACE_ID]);
  });
});
