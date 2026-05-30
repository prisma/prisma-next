import { coreHash } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { buildSqlStorageInput, SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { PostgresEnumType } from '../src/core/postgres-enum-type';
import {
  PostgresSchema,
  PostgresUnboundSchema,
  postgresCreateNamespace,
} from '../src/core/postgres-schema';

const emptyTableInput = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

describe('PostgresSchema', () => {
  it('exposes its id and renders a quoted-identifier qualifier', () => {
    const schema = new PostgresSchema({ id: 'auth' });
    expect(schema.id).toBe('auth');
    expect(schema.qualifier()).toBe('"auth"');
  });

  it('qualifies a table name with the schema prefix', () => {
    const schema = new PostgresSchema({ id: 'auth' });
    expect(schema.qualifyTable('users')).toBe('"auth"."users"');
  });

  it('quotes the schema name even when it would otherwise collide with a Postgres keyword', () => {
    const schema = new PostgresSchema({ id: 'public' });
    expect(schema.qualifier()).toBe('"public"');
    expect(schema.qualifyTable('users')).toBe('"public"."users"');
  });

  it('normalises plain table inputs into StorageTable instances', () => {
    const schema = new PostgresSchema({
      id: 'app',
      tables: { users: emptyTableInput },
    });
    expect(schema.tables['users']).toBeInstanceOf(StorageTable);
  });

  it('normalises plain enum inputs into PostgresEnumType instances', () => {
    const schema = new PostgresSchema({
      id: 'app',
      enum: {
        role: { name: 'Role', values: ['admin', 'member'] },
      },
    });
    expect(schema.enum['role']).toBeInstanceOf(PostgresEnumType);
  });
});

describe('PostgresUnboundSchema', () => {
  it('exposes the framework-reserved unbound id as its singleton id', () => {
    expect(PostgresSchema.unbound).toBeInstanceOf(PostgresUnboundSchema);
    expect(PostgresSchema.unbound.id).toBe(UNBOUND_NAMESPACE_ID);
  });

  it('carries empty frozen tables and enum maps on the unbound singleton', () => {
    expect(PostgresSchema.unbound.tables).toEqual({});
    expect(Object.isFrozen(PostgresSchema.unbound.tables)).toBe(true);
    expect(PostgresSchema.unbound.enum).toEqual({});
    expect(Object.isFrozen(PostgresSchema.unbound.enum)).toBe(true);
  });

  it('elides the schema qualifier so emission paths render unqualified output', () => {
    expect(PostgresSchema.unbound.qualifier()).toBe('');
    expect(PostgresSchema.unbound.qualifyTable('users')).toBe('"users"');
  });

  it('is a stable singleton — repeated access returns the same instance', () => {
    expect(PostgresSchema.unbound).toBe(PostgresSchema.unbound);
  });
});

describe('ddlSchemaName', () => {
  const storageWithPublic = new SqlStorage(
    buildSqlStorageInput({
      storageHash: coreHash('sha256:test-with-public'),
      namespaces: {
        public: new PostgresSchema({ id: 'public' }),
        [UNBOUND_NAMESPACE_ID]: PostgresUnboundSchema.instance,
      },
    }),
  );

  const storageWithoutPublic = new SqlStorage(
    buildSqlStorageInput({
      storageHash: coreHash('sha256:test-without-public'),
      namespaces: {
        auth: new PostgresSchema({ id: 'auth' }),
        [UNBOUND_NAMESPACE_ID]: PostgresUnboundSchema.instance,
      },
    }),
  );

  it('returns its own id for a named public schema', () => {
    const schema = new PostgresSchema({ id: 'public' });
    expect(schema.ddlSchemaName(storageWithPublic)).toBe('public');
  });

  it('returns its own id for a named non-public schema', () => {
    const schema = new PostgresSchema({ id: 'auth' });
    expect(schema.ddlSchemaName(storageWithoutPublic)).toBe('auth');
  });

  it('projects the unbound singleton to "public" when a sibling public namespace exists', () => {
    expect(PostgresUnboundSchema.instance.ddlSchemaName(storageWithPublic)).toBe('public');
  });

  it('projects the unbound singleton to the framework sentinel when no public sibling exists', () => {
    expect(PostgresUnboundSchema.instance.ddlSchemaName(storageWithoutPublic)).toBe(
      UNBOUND_NAMESPACE_ID,
    );
  });
});

describe('postgresCreateNamespace factory', () => {
  it('returns a PostgresUnboundSchema for the framework-reserved sentinel', () => {
    const namespace = postgresCreateNamespace({ id: UNBOUND_NAMESPACE_ID });
    expect(namespace).toBeInstanceOf(PostgresUnboundSchema);
    expect(namespace.qualifyTable('users')).toBe('"users"');
  });

  it('materialises a fresh PostgresSchema instance for any named coordinate', () => {
    const auth = postgresCreateNamespace({ id: 'auth' });
    expect(auth).toBeInstanceOf(PostgresSchema);
    expect(auth.id).toBe('auth');
    expect(auth.qualifyTable('users')).toBe('"auth"."users"');
  });

  it('returns distinct PostgresSchema instances for distinct named coordinates', () => {
    const auth = postgresCreateNamespace({ id: 'auth' });
    const billing = postgresCreateNamespace({ id: 'billing' });
    expect(auth).not.toBe(billing);
    expect(auth.id).toBe('auth');
    expect(billing.id).toBe('billing');
  });
});
