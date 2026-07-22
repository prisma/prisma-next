import { describe, expect, it } from 'vitest';
import {
  contractSnapshotJsonSpecifier,
  contractSnapshotTypesSpecifier,
  storageHashHex,
} from '../src/control/contract-snapshot-layout';

const VALID_HASH = `sha256:${'a'.repeat(64)}`;

describe('storageHashHex', () => {
  it('strips the sha256: prefix from a valid hash', () => {
    expect(storageHashHex(VALID_HASH)).toBe('a'.repeat(64));
  });

  it('throws on a missing prefix', () => {
    expect(() => storageHashHex('a'.repeat(64))).toThrow();
  });

  it('throws on the wrong prefix', () => {
    expect(() => storageHashHex(`md5:${'a'.repeat(64)}`)).toThrow();
  });

  it('throws when the hex portion is too short', () => {
    expect(() => storageHashHex(`sha256:${'a'.repeat(63)}`)).toThrow();
  });

  it('throws when the hex portion is too long', () => {
    expect(() => storageHashHex(`sha256:${'a'.repeat(65)}`)).toThrow();
  });

  it('throws on uppercase hex characters', () => {
    expect(() => storageHashHex(`sha256:${'A'.repeat(64)}`)).toThrow();
  });

  it('throws on non-hex characters', () => {
    expect(() => storageHashHex(`sha256:${'g'.repeat(64)}`)).toThrow();
  });

  it('throws on an empty string', () => {
    expect(() => storageHashHex('')).toThrow();
  });

  it('names the offending value in the error message', () => {
    expect(() => storageHashHex('bogus')).toThrow('bogus');
  });
});

describe('contractSnapshotJsonSpecifier', () => {
  it('builds the contract.json specifier', () => {
    expect(contractSnapshotJsonSpecifier('../../snapshots', VALID_HASH)).toBe(
      `../../snapshots/${'a'.repeat(64)}/contract.json`,
    );
  });

  it('throws on a malformed storage hash', () => {
    expect(() => contractSnapshotJsonSpecifier('../../snapshots', 'not-a-hash')).toThrow();
  });
});

describe('contractSnapshotTypesSpecifier', () => {
  it('builds the extension-less contract type specifier', () => {
    expect(contractSnapshotTypesSpecifier('../snapshots', VALID_HASH)).toBe(
      `../snapshots/${'a'.repeat(64)}/contract`,
    );
  });

  it('throws on a malformed storage hash', () => {
    expect(() => contractSnapshotTypesSpecifier('../snapshots', 'not-a-hash')).toThrow();
  });
});
