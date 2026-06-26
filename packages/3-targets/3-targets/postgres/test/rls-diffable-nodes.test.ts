import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import {
  assertPostgresRlsPolicy,
  isPostgresRlsPolicy,
  PostgresRlsPolicy,
} from '../src/core/postgres-rls-policy';
import { PostgresRole } from '../src/core/postgres-role';
import { isPostgresTableNode, PostgresTableNode } from '../src/core/postgres-table-node';

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

  it('id() returns the bare wire name', () => {
    const policy = new PostgresRlsPolicy(baseInput);
    expect(policy.id()).toBe('read_own_profiles_a1b2c3d4');
  });

  it('id() returns bare wire name regardless of namespaceId and tableName', () => {
    const policy = new PostgresRlsPolicy({
      ...baseInput,
      namespaceId: 'my_schema',
      tableName: 'orders',
    });
    expect(policy.id()).toBe('read_own_profiles_a1b2c3d4');
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

  it('id() and isEqualTo() are accessible on frozen instances (defined on prototype)', () => {
    const policy = new PostgresRlsPolicy(baseInput);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(typeof policy.id).toBe('function');
    expect(typeof policy.isEqualTo).toBe('function');
  });

  it('two policies on different tables with the same wire name have the same id (uniqueness is at table-node level)', () => {
    const policyOnProfiles = new PostgresRlsPolicy({ ...baseInput, tableName: 'profiles' });
    const policyOnOrders = new PostgresRlsPolicy({ ...baseInput, tableName: 'orders' });
    expect(policyOnProfiles.id()).toBe(policyOnOrders.id());
    expect(policyOnProfiles.id()).toBe('read_own_profiles_a1b2c3d4');
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

describe('PostgresTableNode', () => {
  const basePolicy = new PostgresRlsPolicy({
    name: 'read_own_a1b2c3d4',
    prefix: 'read_own',
    tableName: 'profiles',
    namespaceId: 'public',
    operation: 'select' as const,
    roles: ['authenticated'],
    using: '(auth.uid() = user_id)',
    permissive: true,
  });

  it('id() returns "<schemaName>/<tableName>"', () => {
    const node = new PostgresTableNode({
      schemaName: 'public',
      tableName: 'profiles',
      policies: [basePolicy],
    });
    expect(node.id()).toBe('public/profiles');
  });

  it('isEqualTo() always returns true', () => {
    const a = new PostgresTableNode({
      schemaName: 'public',
      tableName: 'profiles',
      policies: [basePolicy],
    });
    const b = new PostgresTableNode({ schemaName: 'public', tableName: 'profiles', policies: [] });
    expect(a.isEqualTo(b)).toBe(true);
  });

  it('children() returns the policy nodes', () => {
    const node = new PostgresTableNode({
      schemaName: 'public',
      tableName: 'profiles',
      policies: [basePolicy],
    });
    expect(node.children()).toEqual([basePolicy]);
  });

  it('kind is "table-node"', () => {
    const node = new PostgresTableNode({
      schemaName: 'public',
      tableName: 'profiles',
      policies: [],
    });
    expect(node.kind).toBe('table-node');
  });

  it('instance is frozen', () => {
    const node = new PostgresTableNode({
      schemaName: 'public',
      tableName: 'profiles',
      policies: [],
    });
    expect(Object.isFrozen(node)).toBe(true);
  });

  describe('isPostgresTableNode guard', () => {
    it('returns true for a PostgresTableNode', () => {
      const node = new PostgresTableNode({
        schemaName: 'public',
        tableName: 'profiles',
        policies: [],
      });
      expect(isPostgresTableNode(node)).toBe(true);
    });

    it('returns false for a PostgresRlsPolicy', () => {
      expect(isPostgresTableNode(basePolicy)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isPostgresTableNode(undefined)).toBe(false);
    });
  });
});

describe('PostgresRole DiffableNode', () => {
  it('id() returns the role name (roles are cluster-unique)', () => {
    const role = new PostgresRole({ name: 'app_user', namespaceId: 'public' });
    expect(role.id()).toBe('app_user');
  });

  it('id() propagates the role name from input', () => {
    const role = new PostgresRole({ name: 'anon', namespaceId: 'sentinel_namespace' });
    expect(role.id()).toBe('anon');
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

  it('id() and isEqualTo() are accessible on frozen instances', () => {
    const role = new PostgresRole({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
    expect(Object.isFrozen(role)).toBe(true);
    expect(typeof role.id).toBe('function');
    expect(typeof role.isEqualTo).toBe('function');
  });
});
