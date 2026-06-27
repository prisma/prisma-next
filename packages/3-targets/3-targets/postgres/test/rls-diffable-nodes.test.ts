import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import {
  assertPostgresRlsPolicy,
  isPostgresRlsPolicy,
  PostgresRlsPolicy,
} from '../src/core/postgres-rls-policy';
import { PostgresRole } from '../src/core/postgres-role';
import { PostgresSchemaIR } from '../src/core/postgres-schema-ir';
import {
  groupPoliciesIntoTableNodes,
  isPostgresTableNode,
  PostgresTableNode,
} from '../src/core/postgres-table-node';

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

  it('id returns the bare wire name', () => {
    const policy = new PostgresRlsPolicy(baseInput);
    expect(policy.id).toBe('read_own_profiles_a1b2c3d4');
  });

  it('id returns bare wire name regardless of namespaceId and tableName', () => {
    const policy = new PostgresRlsPolicy({
      ...baseInput,
      namespaceId: 'my_schema',
      tableName: 'orders',
    });
    expect(policy.id).toBe('read_own_profiles_a1b2c3d4');
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

  it('id and isEqualTo() are accessible on frozen instances (defined on prototype)', () => {
    const policy = new PostgresRlsPolicy(baseInput);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(typeof policy.id).toBe('string');
    expect(typeof policy.isEqualTo).toBe('function');
  });

  it('two policies on different tables with the same wire name have the same id (uniqueness is at table-node level)', () => {
    const policyOnProfiles = new PostgresRlsPolicy({ ...baseInput, tableName: 'profiles' });
    const policyOnOrders = new PostgresRlsPolicy({ ...baseInput, tableName: 'orders' });
    expect(policyOnProfiles.id).toBe(policyOnOrders.id);
    expect(policyOnProfiles.id).toBe('read_own_profiles_a1b2c3d4');
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

  it('id returns "<schemaName>/<tableName>"', () => {
    const node = new PostgresTableNode({
      schemaName: 'public',
      tableName: 'profiles',
      policies: [basePolicy],
    });
    expect(node.id).toBe('public/profiles');
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
  it('id returns the role name (roles are cluster-unique)', () => {
    const role = new PostgresRole({ name: 'app_user', namespaceId: 'public' });
    expect(role.id).toBe('app_user');
  });

  it('id propagates the role name from input', () => {
    const role = new PostgresRole({ name: 'anon', namespaceId: 'sentinel_namespace' });
    expect(role.id).toBe('anon');
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

  it('id and isEqualTo() are accessible on frozen instances', () => {
    const role = new PostgresRole({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
    expect(Object.isFrozen(role)).toBe(true);
    expect(typeof role.id).toBe('string');
    expect(typeof role.isEqualTo).toBe('function');
  });
});

describe('groupPoliciesIntoTableNodes', () => {
  const makeRlsPolicy = (name: string, tableName: string, namespaceId: string) =>
    new PostgresRlsPolicy({
      name,
      prefix: name.replace(/_[0-9a-f]{8}$/, ''),
      tableName,
      namespaceId,
      operation: 'select' as const,
      roles: ['authenticated'],
      using: '(true)',
      permissive: true,
    });

  it('groups policies by namespace+table into PostgresTableNodes', () => {
    const p1 = makeRlsPolicy('pol_a1b2c3d4', 'profiles', 'public');
    const p2 = makeRlsPolicy('pol_deadbeef', 'profiles', 'public');
    const nodes = groupPoliciesIntoTableNodes([p1, p2]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.schemaName).toBe('public');
    expect(nodes[0]?.tableName).toBe('profiles');
    expect(nodes[0]?.policies).toEqual([p1, p2]);
  });

  it('creates distinct nodes for different tables', () => {
    const p1 = makeRlsPolicy('pol_a1b2c3d4', 'profiles', 'public');
    const p2 = makeRlsPolicy('pol_deadbeef', 'orders', 'public');
    const nodes = groupPoliciesIntoTableNodes([p1, p2]);
    expect(nodes).toHaveLength(2);
    const tableNames = nodes.map((n) => n.tableName).sort();
    expect(tableNames).toEqual(['orders', 'profiles']);
  });

  it('creates distinct nodes for different schemas', () => {
    const p1 = makeRlsPolicy('pol_a1b2c3d4', 'users', 'public');
    const p2 = makeRlsPolicy('pol_deadbeef', 'users', 'auth');
    const nodes = groupPoliciesIntoTableNodes([p1, p2]);
    expect(nodes).toHaveLength(2);
  });

  it('preserves first-seen order', () => {
    const p1 = makeRlsPolicy('pol_a1b2c3d4', 'alpha', 'public');
    const p2 = makeRlsPolicy('pol_deadbeef', 'beta', 'public');
    const nodes = groupPoliciesIntoTableNodes([p1, p2]);
    expect(nodes[0]?.tableName).toBe('alpha');
    expect(nodes[1]?.tableName).toBe('beta');
  });

  it('returns empty array for empty input', () => {
    expect(groupPoliciesIntoTableNodes([])).toEqual([]);
  });
});

describe('PostgresSchemaIR tableNodes and rlsPolicies', () => {
  const makeRlsPolicy = (name: string, tableName: string, namespaceId: string) =>
    new PostgresRlsPolicy({
      name,
      prefix: name.replace(/_[0-9a-f]{8}$/, ''),
      tableName,
      namespaceId,
      operation: 'select' as const,
      roles: ['authenticated'],
      using: '(true)',
      permissive: true,
    });

  it('id is the pgSchemaName (property, not method)', () => {
    const ir = new PostgresSchemaIR({
      tables: {},
      pgSchemaName: 'myschema',
      pgVersion: 'unknown',
      tableNodes: [],
      roles: [],
      existingSchemas: [],
      nativeEnumTypeNames: [],
    });
    expect(typeof ir.id).toBe('string');
    expect(ir.id).toBe('myschema');
  });

  it('children() returns stored tableNodes', () => {
    const p1 = makeRlsPolicy('pol_a1b2c3d4', 'profiles', 'public');
    const node = new PostgresTableNode({
      schemaName: 'public',
      tableName: 'profiles',
      policies: [p1],
    });
    const ir = new PostgresSchemaIR({
      tables: {},
      pgSchemaName: 'public',
      pgVersion: 'unknown',
      tableNodes: [node],
      roles: [],
      existingSchemas: [],
      nativeEnumTypeNames: [],
    });
    expect(ir.children()).toEqual([node]);
  });

  it('rlsPolicies getter returns all policies from all tableNodes', () => {
    const p1 = makeRlsPolicy('pol_a1b2c3d4', 'profiles', 'public');
    const p2 = makeRlsPolicy('pol_deadbeef', 'orders', 'public');
    const node1 = new PostgresTableNode({
      schemaName: 'public',
      tableName: 'profiles',
      policies: [p1],
    });
    const node2 = new PostgresTableNode({
      schemaName: 'public',
      tableName: 'orders',
      policies: [p2],
    });
    const ir = new PostgresSchemaIR({
      tables: {},
      pgSchemaName: 'public',
      pgVersion: 'unknown',
      tableNodes: [node1, node2],
      roles: [],
      existingSchemas: [],
      nativeEnumTypeNames: [],
    });
    expect(ir.rlsPolicies).toEqual([p1, p2]);
  });
});
