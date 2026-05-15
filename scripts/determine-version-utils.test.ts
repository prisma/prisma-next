import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertCanonicalBase, computeNextMinor, parseVersion } from './determine-version-utils.ts';

describe('parseVersion', () => {
  it('parses a clean release', () => {
    assert.deepEqual(parseVersion('0.7.0'), { major: 0, minor: 7, patch: 0 });
  });

  it('parses a multi-digit version', () => {
    assert.deepEqual(parseVersion('12.34.567'), { major: 12, minor: 34, patch: 567 });
  });

  it('tolerates a pre-release suffix', () => {
    assert.deepEqual(parseVersion('0.7.0-dev.5'), { major: 0, minor: 7, patch: 0 });
    assert.deepEqual(parseVersion('1.2.3-foo'), { major: 1, minor: 2, patch: 3 });
  });
});

describe('computeNextMinor', () => {
  it('advances 0.7.0 to 0.8.0', () => {
    assert.equal(computeNextMinor('0.7.0'), '0.8.0');
  });

  it('zeros the patch component', () => {
    assert.equal(computeNextMinor('1.2.5'), '1.3.0');
  });

  it('ignores pre-release suffixes on the input', () => {
    assert.equal(computeNextMinor('0.7.0-dev.5'), '0.8.0');
  });
});

describe('assertCanonicalBase', () => {
  it('accepts a clean release', () => {
    assert.doesNotThrow(() => assertCanonicalBase('0.7.0'));
    assert.doesNotThrow(() => assertCanonicalBase('1.2.3'));
  });

  it('rejects a pre-release suffix', () => {
    assert.throws(() => assertCanonicalBase('0.7.0-dev.1'), /not canonical/);
  });

  it('rejects a missing component', () => {
    assert.throws(() => assertCanonicalBase('0.7'), /not canonical/);
  });

  it('rejects an empty string', () => {
    assert.throws(() => assertCanonicalBase(''), /not canonical/);
  });

  it('rejects components with leading zeros', () => {
    assert.throws(() => assertCanonicalBase('01.2.3'), /not canonical/);
    assert.throws(() => assertCanonicalBase('1.02.3'), /not canonical/);
    assert.throws(() => assertCanonicalBase('1.2.03'), /not canonical/);
  });
});
