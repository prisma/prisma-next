import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { StorageTable } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { PostgresRlsPolicy } from '../src/core/postgres-rls-policy';
import { PostgresRole } from '../src/core/postgres-role';
import { PostgresSchema } from '../src/core/postgres-schema';

const emptyTableInput = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

describe('PostgresRole', () => {
  it('constructs with required fields and defaults namespaceId to UNBOUND_NAMESPACE_ID', () => {
    const role = new PostgresRole({ name: 'authenticated' });
    expect(role.kind).toBe('postgres-role');
    expect(role.name).toBe('authenticated');
    expect(role.namespaceId).toBe(UNBOUND_NAMESPACE_ID);
  });

  it('accepts an explicit namespaceId', () => {
    const role = new PostgresRole({ name: 'anon', namespaceId: 'public' });
    expect(role.namespaceId).toBe('public');
  });

  it('is frozen — mutation throws in strict mode', () => {
    const role = new PostgresRole({ name: 'authenticated' });
    expect(Object.isFrozen(role)).toBe(true);
    expect(() => {
      (role as { name: string }).name = 'mutated';
    }).toThrow();
  });

  it('kind is enumerable and survives JSON round-trip', () => {
    const role = new PostgresRole({ name: 'authenticated' });
    const json = JSON.parse(JSON.stringify(role)) as Record<string, unknown>;
    expect(json['kind']).toBe('postgres-role');
    expect(json['name']).toBe('authenticated');
    expect(json['namespaceId']).toBe(UNBOUND_NAMESPACE_ID);
  });
});

describe('PostgresRlsPolicy', () => {
  const policyInput = {
    name: 'user_select_a1b2c3d4',
    prefix: 'user_select',
    tableName: 'user',
    operation: 'select' as const,
    roles: ['authenticated', 'anon'],
    using: 'auth.uid() = user_id',
    permissive: true,
  };

  it('constructs with all fields', () => {
    const policy = new PostgresRlsPolicy(policyInput);
    expect(policy.kind).toBe('postgres-rls-policy');
    expect(policy.name).toBe('user_select_a1b2c3d4');
    expect(policy.prefix).toBe('user_select');
    expect(policy.tableName).toBe('user');
    expect(policy.operation).toBe('select');
    expect(policy.roles).toEqual(['authenticated', 'anon']);
    expect(policy.using).toBe('auth.uid() = user_id');
    expect(policy.permissive).toBe(true);
  });

  it('omits withCheck when not provided', () => {
    const policy = new PostgresRlsPolicy(policyInput);
    expect(Object.hasOwn(policy, 'withCheck')).toBe(false);
    expect('withCheck' in JSON.parse(JSON.stringify(policy))).toBe(false);
  });

  it('omits using when not provided', () => {
    const policy = new PostgresRlsPolicy({
      name: 'user_insert_a1b2c3d4',
      prefix: 'user_insert',
      tableName: 'user',
      operation: 'insert',
      roles: ['authenticated'],
      withCheck: 'true',
      permissive: false,
    });
    expect(Object.hasOwn(policy, 'using')).toBe(false);
  });

  it('freezes the roles array', () => {
    const policy = new PostgresRlsPolicy(policyInput);
    expect(Object.isFrozen(policy.roles)).toBe(true);
  });

  it('is frozen — mutation throws in strict mode', () => {
    const policy = new PostgresRlsPolicy(policyInput);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(() => {
      (policy as { name: string }).name = 'mutated';
    }).toThrow();
  });

  it('kind is enumerable and survives JSON round-trip', () => {
    const policy = new PostgresRlsPolicy(policyInput);
    const json = JSON.parse(JSON.stringify(policy)) as Record<string, unknown>;
    expect(json['kind']).toBe('postgres-rls-policy');
    expect(json['name']).toBe('user_select_a1b2c3d4');
    expect(json['prefix']).toBe('user_select');
    expect(json['operation']).toBe('select');
    expect(json['permissive']).toBe(true);
  });

  it('does not share roles array reference with input', () => {
    const roles = ['authenticated', 'anon'];
    const policy = new PostgresRlsPolicy({ ...policyInput, roles });
    expect(policy.roles).not.toBe(roles);
  });
});

describe('StorageTable', () => {
  it('is frozen after construction', () => {
    const table = new StorageTable(emptyTableInput);
    expect(Object.isFrozen(table)).toBe(true);
  });
});

describe('PostgresSchema role and rlsPolicy slots', () => {
  it('exposes empty role and rlsPolicy maps when not provided', () => {
    const schema = new PostgresSchema({ id: 'public', entries: { table: {}, type: {} } });
    expect(schema.entries.role).toEqual({});
    expect(Object.isFrozen(schema.entries.role)).toBe(true);
    expect(schema.entries.rlsPolicy).toEqual({});
    expect(Object.isFrozen(schema.entries.rlsPolicy)).toBe(true);
  });

  it('normalises plain role input into PostgresRole instances', () => {
    const schema = new PostgresSchema({
      id: 'public',
      entries: {
        table: {},
        type: {},
        role: { authenticated: { name: 'authenticated' } },
      },
    });
    const role = schema.entries.role['authenticated'];
    expect(role).toBeInstanceOf(PostgresRole);
    expect(role?.name).toBe('authenticated');
  });

  it('normalises plain rlsPolicy input into PostgresRlsPolicy instances', () => {
    const schema = new PostgresSchema({
      id: 'public',
      entries: {
        table: {},
        type: {},
        rlsPolicy: {
          user_select_a1b2c3d4: {
            name: 'user_select_a1b2c3d4',
            prefix: 'user_select',
            tableName: 'user',
            operation: 'select',
            roles: ['authenticated'],
            permissive: true,
          },
        },
      },
    });
    const policy = schema.entries.rlsPolicy['user_select_a1b2c3d4'];
    expect(policy).toBeInstanceOf(PostgresRlsPolicy);
    expect(policy?.tableName).toBe('user');
  });

  it('passes through already-constructed instances', () => {
    const role = new PostgresRole({ name: 'authenticated' });
    const schema = new PostgresSchema({
      id: 'public',
      entries: { table: {}, type: {}, role: { authenticated: role } },
    });
    expect(schema.entries.role['authenticated']).toBe(role);
  });

  it('is frozen after construction', () => {
    const schema = new PostgresSchema({ id: 'public', entries: { table: {}, type: {} } });
    expect(Object.isFrozen(schema)).toBe(true);
    expect(Object.isFrozen(schema.entries)).toBe(true);
  });
});
