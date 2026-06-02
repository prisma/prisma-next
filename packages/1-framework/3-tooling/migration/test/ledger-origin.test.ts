import { describe, expect, it } from 'vitest';
import { ledgerOriginFromStored } from '../src/ledger-origin';

describe('ledgerOriginFromStored', () => {
  it('maps empty origin sentinels to null', () => {
    expect(ledgerOriginFromStored(null)).toBeNull();
    expect(ledgerOriginFromStored('')).toBeNull();
    expect(ledgerOriginFromStored('sha256:empty')).toBeNull();
  });

  it('preserves a non-empty origin hash', () => {
    expect(ledgerOriginFromStored('sha256:abc')).toBe('sha256:abc');
  });
});
