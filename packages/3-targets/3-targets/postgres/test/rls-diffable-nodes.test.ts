/**
 * Asserts that PostgresRlsPolicy and PostgresRole are Contract-IR entities only —
 * they do not implement DiffableNode (no `id`, `children`, or `isEqualTo`).
 * The DiffableNode role belongs to PostgresPolicySchemaNode / PostgresRoleSchemaNode.
 */
import { describe, expect, it } from 'vitest';
import {
  assertPostgresRlsPolicy,
  isPostgresRlsPolicy,
  PostgresRlsPolicy,
} from '../src/core/postgres-rls-policy';
import { PostgresRole } from '../src/core/postgres-role';

describe('PostgresRlsPolicy — Contract-IR entity, not a DiffableNode', () => {
  const policy = new PostgresRlsPolicy({
    name: 'read_own_profiles_a1b2c3d4',
    prefix: 'read_own_profiles',
    tableName: 'profiles',
    namespaceId: 'public',
    operation: 'select',
    roles: ['app_user'],
    using: "owner_id = current_setting('app.uid')::int",
    permissive: true,
  });

  it('has no id property', () => {
    expect('id' in policy).toBe(false);
  });

  it('has no children method', () => {
    expect('children' in policy).toBe(false);
  });

  it('has no isEqualTo method', () => {
    expect('isEqualTo' in policy).toBe(false);
  });

  it('retains kind, name, and all data fields', () => {
    expect(policy.kind).toBe('policy');
    expect(policy.name).toBe('read_own_profiles_a1b2c3d4');
    expect(policy.prefix).toBe('read_own_profiles');
    expect(policy.tableName).toBe('profiles');
    expect(policy.namespaceId).toBe('public');
    expect(policy.operation).toBe('select');
    expect(policy.roles).toEqual(['app_user']);
    expect(policy.permissive).toBe(true);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it('kind survives JSON round-trip', () => {
    const json = JSON.parse(JSON.stringify(policy)) as Record<string, unknown>;
    expect(json['kind']).toBe('policy');
  });
});

describe('PostgresRole — Contract-IR entity, not a DiffableNode', () => {
  const role = new PostgresRole({ name: 'app_user', namespaceId: 'public' });

  it('has no id property', () => {
    expect('id' in role).toBe(false);
  });

  it('has no children method', () => {
    expect('children' in role).toBe(false);
  });

  it('has no isEqualTo method', () => {
    expect('isEqualTo' in role).toBe(false);
  });

  it('retains kind, name, and namespaceId', () => {
    expect(role.kind).toBe('role');
    expect(role.name).toBe('app_user');
    expect(role.namespaceId).toBe('public');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(role)).toBe(true);
  });

  it('kind survives JSON round-trip', () => {
    const json = JSON.parse(JSON.stringify(role)) as Record<string, unknown>;
    expect(json['kind']).toBe('role');
  });
});

describe('isPostgresRlsPolicy guard', () => {
  it('returns true for a PostgresRlsPolicy', () => {
    const policy = new PostgresRlsPolicy({
      name: 'p_a1b2c3d4',
      prefix: 'p',
      tableName: 'users',
      namespaceId: 'public',
      operation: 'select',
      roles: [],
      permissive: true,
    });
    expect(isPostgresRlsPolicy(policy)).toBe(true);
  });

  it('returns false for a PostgresRole', () => {
    const role = new PostgresRole({ name: 'anon', namespaceId: 'public' });
    expect(isPostgresRlsPolicy(role)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isPostgresRlsPolicy(undefined)).toBe(false);
  });
});

describe('assertPostgresRlsPolicy guard', () => {
  it('does not throw for a PostgresRlsPolicy', () => {
    const policy = new PostgresRlsPolicy({
      name: 'p_a1b2c3d4',
      prefix: 'p',
      tableName: 'users',
      namespaceId: 'public',
      operation: 'select',
      roles: [],
      permissive: true,
    });
    expect(() => assertPostgresRlsPolicy(policy)).not.toThrow();
  });

  it('throws with a descriptive message for a non-policy value', () => {
    const role = new PostgresRole({ name: 'anon', namespaceId: 'public' });
    expect(() => assertPostgresRlsPolicy(role)).toThrow(/planPostgresSchemaDiff/);
  });
});
