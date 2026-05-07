import { describe, expect, it } from 'vitest';
import { detectSpaceContractDrift } from '../src/detect-space-contract-drift';

const HASH_A = 'sha256:0000000000000000000000000000000000000000000000000000000000000aaa';
const HASH_B = 'sha256:0000000000000000000000000000000000000000000000000000000000000bbb';

describe('detectSpaceContractDrift', () => {
  it("returns 'noDrift' when descriptor hash equals pinned hash", () => {
    const result = detectSpaceContractDrift('cipherstash', {
      descriptorHash: HASH_A,
      pinnedHash: HASH_A,
    });

    expect(result).toEqual({
      kind: 'noDrift',
      spaceId: 'cipherstash',
      descriptorHash: HASH_A,
      pinnedHash: HASH_A,
    });
  });

  it("returns 'firstEmit' when there is no pinned file yet (pinnedHash null)", () => {
    const result = detectSpaceContractDrift('cipherstash', {
      descriptorHash: HASH_A,
      pinnedHash: null,
    });

    expect(result).toEqual({
      kind: 'firstEmit',
      spaceId: 'cipherstash',
      descriptorHash: HASH_A,
      pinnedHash: null,
    });
  });

  it("returns 'drift' when descriptor hash differs from pinned hash", () => {
    const result = detectSpaceContractDrift('cipherstash', {
      descriptorHash: HASH_B,
      pinnedHash: HASH_A,
    });

    expect(result).toEqual({
      kind: 'drift',
      spaceId: 'cipherstash',
      descriptorHash: HASH_B,
      pinnedHash: HASH_A,
    });
  });

  it('preserves the supplied spaceId verbatim in the result', () => {
    const result = detectSpaceContractDrift('audit-trail-v2', {
      descriptorHash: HASH_A,
      pinnedHash: HASH_B,
    });
    expect(result.spaceId).toBe('audit-trail-v2');
  });

  it('does not mutate the inputs object', () => {
    const inputs = { descriptorHash: HASH_A, pinnedHash: HASH_B };
    const snapshot = { ...inputs };
    detectSpaceContractDrift('cipherstash', inputs);
    expect(inputs).toEqual(snapshot);
  });

  it('treats two visually-equal-but-distinct strings byte-for-byte (no normalisation)', () => {
    const result = detectSpaceContractDrift('cipherstash', {
      descriptorHash: 'sha256:abc',
      pinnedHash: 'sha256:ABC',
    });
    expect(result.kind).toBe('drift');
  });

  it("does not validate the spaceId pattern (caller's responsibility)", () => {
    // Pure function that only inspects the hashes; AM7's "warning names
    // the extension" comes from the result.spaceId being threaded
    // through verbatim for the caller to format.
    const result = detectSpaceContractDrift('Whatever You Like', {
      descriptorHash: HASH_A,
      pinnedHash: HASH_A,
    });
    expect(result.spaceId).toBe('Whatever You Like');
  });
});
