import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import {
  assertPostgresRlsPolicy,
  isPostgresRlsPolicy,
  PostgresRlsPolicy,
} from '../src/core/postgres-rls-policy';
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

  it('localKey() includes namespace, table, and wire name', () => {
    const policy = new PostgresRlsPolicy(baseInput);
    expect(policy.localKey()).toBe('public/profiles/read_own_profiles_a1b2c3d4');
  });

  it('localKey() propagates namespaceId and tableName from input', () => {
    const policy = new PostgresRlsPolicy({
      ...baseInput,
      namespaceId: 'my_schema',
      tableName: 'orders',
    });
    expect(policy.localKey()).toBe('my_schema/orders/read_own_profiles_a1b2c3d4');
  });

  it('children() returns an empty list (leaf node)', () => {
    const policy = new PostgresRlsPolicy(baseInput);
    expect(policy.children()).toEqual([]);
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

  it('localKey() and isEqualTo() are accessible on frozen instances (defined on prototype)', () => {
    const policy = new PostgresRlsPolicy(baseInput);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(typeof policy.localKey).toBe('function');
    expect(typeof policy.isEqualTo).toBe('function');
  });

  it('two policies on different tables with the same wire name have distinct local keys', () => {
    const policyOnProfiles = new PostgresRlsPolicy({ ...baseInput, tableName: 'profiles' });
    const policyOnOrders = new PostgresRlsPolicy({ ...baseInput, tableName: 'orders' });
    expect(policyOnProfiles.localKey()).not.toBe(policyOnOrders.localKey());
  });

  describe('isPostgresRlsPolicy guard', () => {
    it('returns true for a real PostgresRlsPolicy', () => {
      expect(isPostgresRlsPolicy(new PostgresRlsPolicy(baseInput))).toBe(true);
    });

    it('returns false for a node with a different kind', () => {
      const role = new PostgresRole({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
      expect(isPostgresRlsPolicy(role)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isPostgresRlsPolicy(undefined)).toBe(false);
    });
  });

  describe('assertPostgresRlsPolicy guard', () => {
    it('does not throw for a real PostgresRlsPolicy', () => {
      expect(() => assertPostgresRlsPolicy(new PostgresRlsPolicy(baseInput))).not.toThrow();
    });

    it('throws with a descriptive message when given a non-policy node', () => {
      const role = new PostgresRole({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
      expect(() => assertPostgresRlsPolicy(role)).toThrow(
        /planPostgresSchemaDiff: expected a PostgresRlsPolicy/,
      );
    });

    it('throws mentioning the actual kind when given a non-policy node', () => {
      const role = new PostgresRole({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
      expect(() => assertPostgresRlsPolicy(role)).toThrow(/role/);
    });
  });

  describe('content-addressed equality invariant', () => {
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
  it('localKey() returns the role name (roles are cluster-unique)', () => {
    const role = new PostgresRole({ name: 'app_user', namespaceId: 'public' });
    expect(role.localKey()).toBe('app_user');
  });

  it('localKey() propagates the role name from input', () => {
    const role = new PostgresRole({ name: 'anon', namespaceId: 'sentinel_namespace' });
    expect(role.localKey()).toBe('anon');
  });

  it('children() returns an empty list (leaf node)', () => {
    const role = new PostgresRole({ name: 'app_user', namespaceId: 'public' });
    expect(role.children()).toEqual([]);
  });

  it('isEqualTo() returns true for two roles with the same name', () => {
    const a = new PostgresRole({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
    const b = new PostgresRole({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
    expect(a.isEqualTo(b)).toBe(true);
  });

  it('isEqualTo() returns false for roles with different names', () => {
    const a = new PostgresRole({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
    const b = new PostgresRole({ name: 'anon', namespaceId: UNBOUND_NAMESPACE_ID });
    expect(a.isEqualTo(b)).toBe(false);
  });

  it('isEqualTo() throws when other is not a PostgresRole', () => {
    const role = new PostgresRole({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
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

  it('localKey() and isEqualTo() are accessible on frozen instances', () => {
    const role = new PostgresRole({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
    expect(Object.isFrozen(role)).toBe(true);
    expect(typeof role.localKey).toBe('function');
    expect(typeof role.isEqualTo).toBe('function');
  });
});
