import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { qualifyTypeName } from '../src/qualify-type-name';

describe('qualifyTypeName', () => {
  it('stays bare for the default namespace', () => {
    expect(qualifyTypeName('aal_level', 'public', 'public')).toBe('aal_level');
  });

  it('stays bare when namespaceId is undefined', () => {
    expect(qualifyTypeName('aal_level', undefined, 'public')).toBe('aal_level');
  });

  it('stays bare for the unbound namespace', () => {
    expect(qualifyTypeName('aal_level', UNBOUND_NAMESPACE_ID, 'public')).toBe('aal_level');
  });

  it('qualifies for a named non-default schema', () => {
    expect(qualifyTypeName('aal_level', 'auth', 'public')).toBe('auth.aal_level');
  });
});
