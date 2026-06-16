import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { PostgresRlsPolicy } from '../src/core/postgres-rls-policy';
import { PostgresRole } from '../src/core/postgres-role';

describe('PostgresRlsPolicy DiffableNode', () => {
  const baseInput = {
    name: 'read_own_profiles_a1b2c3d4',
    prefix: 'read_own_profiles',
    tableName: 'profiles',
    namespaceId: 'public',
    operation: 'select' as const,
    roles: ['app_user'],
    using: "owner_id = current_setting('app.uid')::int",
    permissive: true,
  };

  it('identity() returns a storage coordinate with policy entityKind and the wire name', () => {
    const policy = new PostgresRlsPolicy(baseInput);
    expect(policy.identity()).toEqual({
      plane: 'storage',
      namespaceId: 'public',
      entityKind: 'policy',
      entityName: 'read_own_profiles_a1b2c3d4',
    });
  });

  it('identity() defaults namespaceId to UNBOUND_NAMESPACE_ID when not provided', () => {
    const { namespaceId: _omit, ...rest } = baseInput;
    const policy = new PostgresRlsPolicy(rest);
    expect(policy.identity().namespaceId).toBe(UNBOUND_NAMESPACE_ID);
  });

  it('isEqualTo() returns true for two policies with the same wire name', () => {
    const a = new PostgresRlsPolicy(baseInput);
    const b = new PostgresRlsPolicy({ ...baseInput });
    expect(a.isEqualTo(b)).toBe(true);
  });

  it('isEqualTo() returns false for policies with different wire names', () => {
    const a = new PostgresRlsPolicy(baseInput);
    const b = new PostgresRlsPolicy({ ...baseInput, name: 'read_own_profiles_deadbeef' });
    expect(a.isEqualTo(b)).toBe(false);
  });

  it('isEqualTo() throws when other is not a PostgresRlsPolicy', () => {
    const policy = new PostgresRlsPolicy(baseInput);
    const notAPolicy = new PostgresRole({ name: 'app_user', namespaceId: 'public' });
    expect(() => policy.isEqualTo(notAPolicy)).toThrow();
  });

  it('identity() and isEqualTo() are accessible on frozen instances (defined on prototype)', () => {
    const policy = new PostgresRlsPolicy(baseInput);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(typeof policy.identity).toBe('function');
    expect(typeof policy.isEqualTo).toBe('function');
  });

  describe('content-addressed equality invariant', () => {
    // Wire name == prefix + '_' + hash(body). Same prefix + different body
    // produces different hashes, so the wire names differ and isEqualTo is
    // false. Same body produces the same hash, so isEqualTo is true.
    // We deliberately do NOT compare bodies directly — Postgres reprints
    // predicate expressions, so a byte-compare would produce false mismatches
    // on a clean re-verify.
    it('same prefix + different body → different wire names → isEqualTo false (no collision)', () => {
      const bodyV1 = new PostgresRlsPolicy({
        ...baseInput,
        name: 'read_own_profiles_a1b2c3d4',
        using: "(owner_id = current_setting('app.uid')::int)",
      });
      const bodyV2 = new PostgresRlsPolicy({
        ...baseInput,
        name: 'read_own_profiles_deadbeef',
        using: '(owner_id = auth.uid())',
      });
      expect(bodyV1.isEqualTo(bodyV2)).toBe(false);
      expect(bodyV2.isEqualTo(bodyV1)).toBe(false);
      expect(bodyV1.name).not.toBe(bodyV2.name);
    });

    it('same body → same wire name → isEqualTo true', () => {
      const authored = new PostgresRlsPolicy({
        ...baseInput,
        name: 'read_own_profiles_a1b2c3d4',
        using: "(owner_id = current_setting('app.uid')::int)",
      });
      const introspected = new PostgresRlsPolicy({
        ...baseInput,
        name: 'read_own_profiles_a1b2c3d4',
        using: "(owner_id = current_setting('app.uid')::int)",
      });
      expect(authored.isEqualTo(introspected)).toBe(true);
    });
  });
});

describe('PostgresRole DiffableNode', () => {
  it('identity() returns a storage coordinate with role entityKind and the role name', () => {
    const role = new PostgresRole({ name: 'app_user', namespaceId: 'public' });
    expect(role.identity()).toEqual({
      plane: 'storage',
      namespaceId: 'public',
      entityKind: 'role',
      entityName: 'app_user',
    });
  });

  it('identity() uses UNBOUND_NAMESPACE_ID when namespaceId is omitted', () => {
    const role = new PostgresRole({ name: 'app_user' });
    expect(role.identity().namespaceId).toBe(UNBOUND_NAMESPACE_ID);
  });

  it('isEqualTo() returns true for two roles with the same name', () => {
    const a = new PostgresRole({ name: 'app_user' });
    const b = new PostgresRole({ name: 'app_user' });
    expect(a.isEqualTo(b)).toBe(true);
  });

  it('isEqualTo() returns false for roles with different names', () => {
    const a = new PostgresRole({ name: 'app_user' });
    const b = new PostgresRole({ name: 'anon' });
    expect(a.isEqualTo(b)).toBe(false);
  });

  it('isEqualTo() throws when other is not a PostgresRole', () => {
    const role = new PostgresRole({ name: 'app_user' });
    const notARole = new PostgresRlsPolicy({
      name: 'read_own_a1b2c3d4',
      prefix: 'read_own',
      tableName: 'profiles',
      namespaceId: 'public',
      operation: 'select',
      roles: [],
      permissive: true,
    });
    expect(() => role.isEqualTo(notARole)).toThrow();
  });

  it('identity() and isEqualTo() are accessible on frozen instances', () => {
    const role = new PostgresRole({ name: 'app_user' });
    expect(Object.isFrozen(role)).toBe(true);
    expect(typeof role.identity).toBe('function');
    expect(typeof role.isEqualTo).toBe('function');
  });
});
