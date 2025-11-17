import { describe, expect, it } from 'vitest';
import { parseContractMarkerRow } from '../src/marker';

describe('marker parser', () => {
  it('parses valid marker row with all fields', () => {
    const row = {
      core_hash: 'sha256:abc123',
      profile_hash: 'sha256:def456',
      contract_json: { target: 'postgres' },
      canonical_version: 1,
      updated_at: new Date('2024-01-01T00:00:00Z'),
      app_tag: 'my-app',
      meta: { key: 'value' },
    };

    const result = parseContractMarkerRow(row);

    expect(result).toEqual({
      coreHash: 'sha256:abc123',
      profileHash: 'sha256:def456',
      contractJson: { target: 'postgres' },
      canonicalVersion: 1,
      updatedAt: new Date('2024-01-01T00:00:00Z'),
      appTag: 'my-app',
      meta: { key: 'value' },
    });
  });

  it('parses marker row with minimal fields', () => {
    const row = {
      core_hash: 'sha256:abc123',
      profile_hash: 'sha256:def456',
    };

    const result = parseContractMarkerRow(row);

    expect(result).toEqual({
      coreHash: 'sha256:abc123',
      profileHash: 'sha256:def456',
      contractJson: null,
      canonicalVersion: null,
      updatedAt: expect.any(Date),
      appTag: null,
      meta: {},
    });
  });

  it('parses updated_at as string', () => {
    const row = {
      core_hash: 'sha256:abc123',
      profile_hash: 'sha256:def456',
      updated_at: '2024-01-01T00:00:00Z',
    };

    const result = parseContractMarkerRow(row);

    expect(result.updatedAt).toEqual(new Date('2024-01-01T00:00:00Z'));
  });

  it('parses meta as JSON string', () => {
    const row = {
      core_hash: 'sha256:abc123',
      profile_hash: 'sha256:def456',
      meta: '{"key":"value"}',
    };

    const result = parseContractMarkerRow(row);

    expect(result.meta).toEqual({ key: 'value' });
  });

  it('parses meta as object', () => {
    const row = {
      core_hash: 'sha256:abc123',
      profile_hash: 'sha256:def456',
      meta: { key: 'value' },
    };

    const result = parseContractMarkerRow(row);

    expect(result.meta).toEqual({ key: 'value' });
  });

  it('handles null meta', () => {
    const row = {
      core_hash: 'sha256:abc123',
      profile_hash: 'sha256:def456',
      meta: null,
    };

    const result = parseContractMarkerRow(row);

    expect(result.meta).toEqual({});
  });

  it('handles undefined meta', () => {
    const row = {
      core_hash: 'sha256:abc123',
      profile_hash: 'sha256:def456',
    };

    const result = parseContractMarkerRow(row);

    expect(result.meta).toEqual({});
  });

  it('handles invalid JSON string in meta', () => {
    const row = {
      core_hash: 'sha256:abc123',
      profile_hash: 'sha256:def456',
      meta: 'invalid json',
    };

    const result = parseContractMarkerRow(row);

    expect(result.meta).toEqual({});
  });

  it('handles invalid meta object structure', () => {
    const row = {
      core_hash: 'sha256:abc123',
      profile_hash: 'sha256:def456',
      meta: 'not an object',
    };

    const result = parseContractMarkerRow(row);

    expect(result.meta).toEqual({});
  });

  it('handles meta that fails Arktype validation', () => {
    // Provide a number as meta (after JSON parsing), which should fail MetaSchema validation
    // MetaSchema expects an object with string keys, not a primitive
    const row = {
      core_hash: 'sha256:abc123',
      profile_hash: 'sha256:def456',
      meta: '123', // JSON string that parses to a number
    };

    // This tests the branch where MetaSchema validation fails (line 33)
    // The number will be parsed from JSON, but MetaSchema expects an object
    const result = parseContractMarkerRow(row);

    // Validation should fail and return empty object
    expect(result.meta).toEqual({});
  });

  it('throws error for invalid row structure', () => {
    const row = {
      core_hash: 123, // Invalid type
      profile_hash: 'sha256:def456',
    };

    expect(() => parseContractMarkerRow(row)).toThrow('Invalid contract marker row');
  });

  it('throws error for missing required fields', () => {
    const row = {
      profile_hash: 'sha256:def456',
      // Missing core_hash
    };

    expect(() => parseContractMarkerRow(row)).toThrow('Invalid contract marker row');
  });
});
