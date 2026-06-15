import { coreHash } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
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
    const schema = new PostgresSchema({ id: 'auth', entries: { table: {}, type: {} } });
    expect(schema.id).toBe('auth');
    expect(schema.qualifier()).toBe('"auth"');
  });

  it('qualifies a table name with the schema prefix', () => {
    const schema = new PostgresSchema({ id: 'auth', entries: { table: {}, type: {} } });
    expect(schema.qualifyTable('users')).toBe('"auth"."users"');
  });

  it('quotes the schema name even when it would otherwise collide with a Postgres keyword', () => {
    const schema = new PostgresSchema({ id: 'public', entries: { table: {}, type: {} } });
    expect(schema.qualifier()).toBe('"public"');
    expect(schema.qualifyTable('users')).toBe('"public"."users"');
  });

  it('normalises plain table inputs into StorageTable instances', () => {
    const schema = new PostgresSchema({
      id: 'app',
      entries: { table: { users: emptyTableInput }, type: {} },
    });
    expect(schema.table['users']).toBeInstanceOf(StorageTable);
  });

  it('normalises plain enum inputs into PostgresEnumType instances', () => {
    const schema = new PostgresSchema({
      id: 'app',
      entries: {
        table: {},
        type: {
          role: { name: 'Role', values: ['admin', 'member'] },
        },
      },
    });
    expect(schema.type['role']).toBeInstanceOf(PostgresEnumType);
  });
});

describe('PostgresUnboundSchema', () => {
  it('exposes the framework-reserved unbound id as its singleton id', () => {
    expect(PostgresSchema.unbound).toBeInstanceOf(PostgresUnboundSchema);
    expect(PostgresSchema.unbound.id).toBe(UNBOUND_NAMESPACE_ID);
  });

  it('carries empty frozen tables and enum maps on the unbound singleton', () => {
    expect(PostgresSchema.unbound.table).toEqual({});
    expect(Object.isFrozen(PostgresSchema.unbound.entries['table'])).toBe(true);
    expect(PostgresSchema.unbound.type).toEqual({});
    expect(Object.isFrozen(PostgresSchema.unbound.entries['type'])).toBe(true);
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
  const storageWithPublic = new SqlStorage({
    storageHash: coreHash('sha256:test-with-public'),
    namespaces: {
      public: new PostgresSchema({ id: 'public', entries: { table: {}, type: {} } }),
      [UNBOUND_NAMESPACE_ID]: PostgresUnboundSchema.instance,
    },
  });

  const storageWithoutPublic = new SqlStorage({
    storageHash: coreHash('sha256:test-without-public'),
    namespaces: {
      auth: new PostgresSchema({ id: 'auth', entries: { table: {}, type: {} } }),
      [UNBOUND_NAMESPACE_ID]: PostgresUnboundSchema.instance,
    },
  });

  it('returns its own id for a named public schema', () => {
    const schema = new PostgresSchema({ id: 'public', entries: { table: {}, type: {} } });
    expect(schema.ddlSchemaName(storageWithPublic)).toBe('public');
  });

  it('returns its own id for a named non-public schema', () => {
    const schema = new PostgresSchema({ id: 'auth', entries: { table: {}, type: {} } });
    expect(schema.ddlSchemaName(storageWithoutPublic)).toBe('auth');
  });

  it('returns the sentinel for the unbound singleton regardless of sibling namespaces', () => {
    expect(PostgresUnboundSchema.instance.ddlSchemaName(storageWithPublic)).toBe(
      UNBOUND_NAMESPACE_ID,
    );
    expect(PostgresUnboundSchema.instance.ddlSchemaName(storageWithoutPublic)).toBe(
      UNBOUND_NAMESPACE_ID,
    );
  });
});

describe('postgresCreateNamespace factory', () => {
  it('returns a PostgresUnboundSchema for the framework-reserved sentinel', () => {
    const namespace = postgresCreateNamespace({ id: UNBOUND_NAMESPACE_ID, entries: { table: {} } });
    expect(namespace).toBeInstanceOf(PostgresUnboundSchema);
    expect(namespace.qualifyTable('users')).toBe('"users"');
  });

  it('materialises a fresh PostgresSchema instance for any named coordinate', () => {
    const auth = postgresCreateNamespace({ id: 'auth', entries: { table: {} } });
    expect(auth).toBeInstanceOf(PostgresSchema);
    expect(auth.id).toBe('auth');
    expect(auth.qualifyTable('users')).toBe('"auth"."users"');
  });

  it('returns distinct PostgresSchema instances for distinct named coordinates', () => {
    const auth = postgresCreateNamespace({ id: 'auth', entries: { table: {} } });
    const billing = postgresCreateNamespace({ id: 'billing', entries: { table: {} } });
    expect(auth).not.toBe(billing);
    expect(auth.id).toBe('auth');
    expect(billing.id).toBe('billing');
  });
});

describe('PostgresSchema — entries open dictionary', () => {
  it('exact-shape serialization: JSON.stringify emits only id and entries', () => {
    const schema = new PostgresSchema({
      id: 'public',
      entries: {
        table: { users: emptyTableInput },
        type: { role: { name: 'Role', values: ['admin', 'member'] } },
      },
    });
    const parsed = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['entries', 'id']);
  });

  it('kind is non-enumerable', () => {
    const schema = new PostgresSchema({ id: 'app', entries: { table: {}, type: {} } });
    expect(Object.keys(schema)).not.toContain('kind');
    expect(schema.kind).toBe('schema');
  });

  it('entries is frozen after construction', () => {
    const schema = new PostgresSchema({ id: 'app', entries: { table: {}, type: {} } });
    expect(Object.isFrozen(schema.entries)).toBe(true);
  });

  it('inner table map is frozen', () => {
    const schema = new PostgresSchema({
      id: 'app',
      entries: { table: { users: emptyTableInput }, type: {} },
    });
    expect(Object.isFrozen(schema.entries['table'])).toBe(true);
  });

  it('inner type map is frozen', () => {
    const schema = new PostgresSchema({
      id: 'app',
      entries: {
        table: {},
        type: { role: { name: 'Role', values: ['admin', 'member'] } },
      },
    });
    expect(Object.isFrozen(schema.entries['type'])).toBe(true);
  });

  it('table getter returns the frozen name-keyed map from entries', () => {
    const schema = new PostgresSchema({
      id: 'app',
      entries: { table: { users: emptyTableInput }, type: {} },
    });
    expect(schema.table).toBe(schema.entries['table']);
  });

  it('table getter is non-enumerable', () => {
    const schema = new PostgresSchema({ id: 'app', entries: { table: {}, type: {} } });
    expect(Object.keys(schema)).not.toContain('table');
  });

  it('type getter returns the frozen name-keyed map from entries', () => {
    const schema = new PostgresSchema({
      id: 'app',
      entries: {
        table: {},
        type: { role: { name: 'Role', values: ['admin', 'member'] } },
      },
    });
    expect(schema.type).toBe(schema.entries['type']);
  });

  it('type getter is non-enumerable', () => {
    const schema = new PostgresSchema({ id: 'app', entries: { table: {}, type: {} } });
    expect(Object.keys(schema)).not.toContain('type');
  });

  it('type getter returns PostgresEnumType instances', () => {
    const schema = new PostgresSchema({
      id: 'app',
      entries: {
        table: {},
        type: { role: { name: 'Role', values: ['admin', 'member'] } },
      },
    });
    expect(schema.type['role']).toBeInstanceOf(PostgresEnumType);
  });

  it('valueSet getter returns the frozen name-keyed map when present', () => {
    const schema = new PostgresSchema({
      id: 'app',
      entries: {
        table: {},
        type: {},
        valueSet: { Status: { kind: 'value-set', values: ['active'] } },
      },
    });
    expect(schema.valueSet).toBe(schema.entries['valueSet']);
  });

  it('valueSet getter is non-enumerable', () => {
    const schema = new PostgresSchema({ id: 'app', entries: { table: {}, type: {} } });
    expect(Object.keys(schema)).not.toContain('valueSet');
  });

  it('valueSet is absent from entries when empty', () => {
    const schema = new PostgresSchema({ id: 'app', entries: { table: {}, type: {} } });
    expect(schema.entries['valueSet']).toBeUndefined();
  });

  it('valueSet is present in entries when non-empty', () => {
    const schema = new PostgresSchema({
      id: 'app',
      entries: {
        table: {},
        type: {},
        valueSet: { Status: { kind: 'value-set', values: ['active'] } },
      },
    });
    expect(schema.entries['valueSet']).toBeDefined();
  });

  it('table and type are always present in entries even when empty', () => {
    const schema = new PostgresSchema({ id: 'app', entries: { table: {}, type: {} } });
    expect(schema.entries['table']).toBeDefined();
    expect(schema.entries['type']).toBeDefined();
  });

  it('entries[kind][name] resolves the same as getter[name] for tables', () => {
    const schema = new PostgresSchema({
      id: 'app',
      entries: { table: { users: emptyTableInput }, type: {} },
    });
    expect(schema.entries['table']?.['users']).toBe(schema.table['users']);
  });

  it('entries[kind][name] resolves the same as getter[name] for types', () => {
    const schema = new PostgresSchema({
      id: 'app',
      entries: {
        table: {},
        type: { role: { name: 'Role', values: ['admin'] } },
      },
    });
    expect(schema.entries['type']?.['role']).toBe(schema.type['role']);
  });
});

describe('PostgresUnboundSchema — entries open dictionary', () => {
  it('exact-shape serialization: JSON.stringify emits only id and entries', () => {
    const parsed = JSON.parse(JSON.stringify(PostgresUnboundSchema.instance)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed).sort()).toEqual(['entries', 'id']);
  });

  it('table and type are always present in entries even on unbound singleton', () => {
    expect(PostgresSchema.unbound.entries['table']).toBeDefined();
    expect(PostgresSchema.unbound.entries['type']).toBeDefined();
  });
});

describe('PostgresSchema — unknown entity kind', () => {
  it('carries an unknown kind through frozen as-is (permissive-carry)', () => {
    const bogusMap = Object.freeze({ foo: { x: 1 } });
    const schema = new PostgresSchema({
      id: 'app',
      entries: { table: {}, type: {}, bogus: bogusMap } as never,
    });
    expect(schema.entries['bogus']).toEqual(bogusMap);
    expect(Object.isFrozen(schema.entries['bogus'])).toBe(true);
  });

  it('unknown kind survives JSON.stringify round-trip', () => {
    const schema = new PostgresSchema({
      id: 'app',
      entries: { table: {}, type: {}, bogus: { item: { value: 42 } } } as never,
    });
    const parsed = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
    expect((parsed['entries'] as Record<string, unknown>)['bogus']).toEqual({
      item: { value: 42 },
    });
  });

  it('forwards an unknown entries kind to the constructor, which carries it (permissive-carry)', () => {
    const schema = postgresCreateNamespace({
      id: 'auth',
      entries: { table: {}, bogus: { item: {} } } as never,
    });
    expect(schema.entries['bogus']).toBeDefined();
  });
});
