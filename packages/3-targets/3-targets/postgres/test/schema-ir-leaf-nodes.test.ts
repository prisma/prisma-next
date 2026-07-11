import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { PostgresPolicySchemaNode } from '../src/core/schema-ir/postgres-policy-schema-node';
import { PostgresRoleSchemaNode } from '../src/core/schema-ir/postgres-role-schema-node';

const basePolicyInput = {
  name: 'read_own_profiles_a1b2c3d4',
  prefix: 'read_own_profiles',
  tableName: 'profiles',
  namespaceId: 'public',
  operation: 'select' as const,
  roles: ['app_user'],
  using: "owner_id = current_setting('app.uid')::int",
  permissive: true,
};

describe('PostgresPolicySchemaNode', () => {
  it('id returns the wire name', () => {
    const node = new PostgresPolicySchemaNode(basePolicyInput);
    expect(node.id).toBe('read_own_profiles_a1b2c3d4');
  });

  it('children() returns empty array (leaf)', () => {
    const node = new PostgresPolicySchemaNode(basePolicyInput);
    expect(node.children()).toEqual([]);
  });

  it('isEqualTo returns true for same wire name', () => {
    const a = new PostgresPolicySchemaNode(basePolicyInput);
    const b = new PostgresPolicySchemaNode({ ...basePolicyInput });
    expect(a.isEqualTo(b)).toBe(true);
  });

  it('isEqualTo returns false for different wire name', () => {
    const a = new PostgresPolicySchemaNode(basePolicyInput);
    const b = new PostgresPolicySchemaNode({
      ...basePolicyInput,
      name: 'read_own_profiles_deadbeef',
    });
    expect(a.isEqualTo(b)).toBe(false);
  });

  it('isEqualTo throws when other is not a PostgresPolicySchemaNode', () => {
    const a = new PostgresPolicySchemaNode(basePolicyInput);
    const b = new PostgresRoleSchemaNode({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
    expect(() => a.isEqualTo(b)).toThrow();
  });

  it('carries all fields from input', () => {
    const node = new PostgresPolicySchemaNode(basePolicyInput);
    expect(node.name).toBe(basePolicyInput.name);
    expect(node.prefix).toBe(basePolicyInput.prefix);
    expect(node.tableName).toBe(basePolicyInput.tableName);
    expect(node.namespaceId).toBe(basePolicyInput.namespaceId);
    expect(node.operation).toBe(basePolicyInput.operation);
    expect(node.roles).toEqual(basePolicyInput.roles);
    expect(node.using).toBe(basePolicyInput.using);
    expect(node.permissive).toBe(basePolicyInput.permissive);
  });

  it('withCheck is absent when not provided', () => {
    const node = new PostgresPolicySchemaNode(basePolicyInput);
    expect(Object.hasOwn(node, 'withCheck')).toBe(false);
  });

  it('using is absent when not provided', () => {
    const { using: _dropped, ...rest } = basePolicyInput;
    const node = new PostgresPolicySchemaNode({
      ...rest,
      withCheck: 'true',
    });
    expect(Object.hasOwn(node, 'using')).toBe(false);
  });

  it('instance is frozen', () => {
    const node = new PostgresPolicySchemaNode(basePolicyInput);
    expect(Object.isFrozen(node)).toBe(true);
  });

  describe('PostgresPolicySchemaNode.is', () => {
    it('returns true for a PostgresPolicySchemaNode', () => {
      const node = new PostgresPolicySchemaNode(basePolicyInput);
      expect(PostgresPolicySchemaNode.is(node)).toBe(true);
    });

    it('returns false for a PostgresRoleSchemaNode', () => {
      const role = new PostgresRoleSchemaNode({
        name: 'app_user',
        namespaceId: UNBOUND_NAMESPACE_ID,
      });
      expect(PostgresPolicySchemaNode.is(role)).toBe(false);
    });
  });
});

describe('PostgresRoleSchemaNode', () => {
  it('id returns the role name under a collision-safe "role:" sigil', () => {
    const node = new PostgresRoleSchemaNode({
      name: 'app_user',
      namespaceId: UNBOUND_NAMESPACE_ID,
    });
    // Sigil-prefixed so a role never collides with a same-named schema in the
    // differ's flat sibling id map; the bare name stays on `.name`.
    expect(node.id).toBe('role:app_user');
    expect(node.name).toBe('app_user');
  });

  it('children() returns empty array (leaf)', () => {
    const node = new PostgresRoleSchemaNode({
      name: 'app_user',
      namespaceId: UNBOUND_NAMESPACE_ID,
    });
    expect(node.children()).toEqual([]);
  });

  it('isEqualTo returns true for same name', () => {
    const a = new PostgresRoleSchemaNode({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
    const b = new PostgresRoleSchemaNode({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
    expect(a.isEqualTo(b)).toBe(true);
  });

  it('isEqualTo returns false for different name', () => {
    const a = new PostgresRoleSchemaNode({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
    const b = new PostgresRoleSchemaNode({ name: 'anon', namespaceId: UNBOUND_NAMESPACE_ID });
    expect(a.isEqualTo(b)).toBe(false);
  });

  it('isEqualTo throws when other is not a PostgresRoleSchemaNode', () => {
    const a = new PostgresRoleSchemaNode({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
    const b = new PostgresPolicySchemaNode(basePolicyInput);
    expect(() => a.isEqualTo(b)).toThrow();
  });

  it('carries all fields from input', () => {
    const node = new PostgresRoleSchemaNode({ name: 'app_user', namespaceId: 'public' });
    expect(node.name).toBe('app_user');
    expect(node.namespaceId).toBe('public');
  });

  it('instance is frozen', () => {
    const node = new PostgresRoleSchemaNode({
      name: 'app_user',
      namespaceId: UNBOUND_NAMESPACE_ID,
    });
    expect(Object.isFrozen(node)).toBe(true);
  });

  describe('PostgresRoleSchemaNode.is', () => {
    it('returns true for a PostgresRoleSchemaNode', () => {
      const node = new PostgresRoleSchemaNode({
        name: 'app_user',
        namespaceId: UNBOUND_NAMESPACE_ID,
      });
      expect(PostgresRoleSchemaNode.is(node)).toBe(true);
    });

    it('returns false for a PostgresPolicySchemaNode', () => {
      const policy = new PostgresPolicySchemaNode(basePolicyInput);
      expect(PostgresRoleSchemaNode.is(policy)).toBe(false);
    });
  });
});
