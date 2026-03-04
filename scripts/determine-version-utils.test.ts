import { describe, expect, it } from 'vitest';
import { findNextPrBuildNumber, parsePrBuildNumber } from './determine-version-utils';

describe('parsePrBuildNumber', () => {
  it('extracts build number for matching PR number', () => {
    expect(parsePrBuildNumber('1.2.3-pr.42.7', '42')).toBe(7);
  });

  it('returns undefined for non-matching PR number', () => {
    expect(parsePrBuildNumber('1.2.3-pr.42.7', '43')).toBeUndefined();
  });
});

describe('findNextPrBuildNumber', () => {
  it('increments from latest matching build', () => {
    const versions = ['1.2.3-pr.42.1', '1.2.3-pr.42.2', '1.2.3-pr.11.9'];
    expect(findNextPrBuildNumber(versions, '42')).toBe(3);
  });

  it('returns 1 when no matching PR versions exist', () => {
    const versions = ['1.2.3-pr.10.2', '1.2.3-dev.4'];
    expect(findNextPrBuildNumber(versions, '42')).toBe(1);
  });

  it('throws when PR number is not numeric', () => {
    expect(() => findNextPrBuildNumber(['1.2.3-pr.42.1'], '42x')).toThrow(
      'PR number must be numeric',
    );
  });
});
