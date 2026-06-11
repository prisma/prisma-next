import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { buildSqlNamespace } from '../src/ir/build-sql-namespace';
import { SqlUnboundNamespace } from '../src/ir/sql-unbound-namespace';
import { StorageTable } from '../src/ir/storage-table';
import { StorageValueSet } from '../src/ir/storage-value-set';

const emptyTableInput = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

const tableWithColumn = {
  columns: {
    id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
  },
  primaryKey: { columns: ['id'] },
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

describe('SqlBoundNamespace — entries open dictionary', () => {
  it('exact-shape serialization: JSON.stringify emits only id and entries', () => {
    const ns = buildSqlNamespace({ id: 'app', entries: { table: { users: emptyTableInput } } });
    const parsed = JSON.parse(JSON.stringify(ns)) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['entries', 'id']);
  });

  it('kind is non-enumerable', () => {
    const ns = buildSqlNamespace({ id: 'app', entries: { table: {} } });
    expect(Object.keys(ns)).not.toContain('kind');
    expect(ns.kind).toBeDefined();
  });

  it('entries is frozen after construction', () => {
    const ns = buildSqlNamespace({ id: 'app', entries: { table: { users: emptyTableInput } } });
    expect(Object.isFrozen(ns.entries)).toBe(true);
  });

  it('inner table map is frozen', () => {
    const ns = buildSqlNamespace({ id: 'app', entries: { table: { users: emptyTableInput } } });
    expect(Object.isFrozen(ns.entries['table'])).toBe(true);
  });

  it('table getter returns the frozen name-keyed map from entries', () => {
    const ns = buildSqlNamespace({ id: 'app', entries: { table: { users: emptyTableInput } } });
    expect(ns.table).toBe(ns.entries['table']);
  });

  it('table getter is non-enumerable', () => {
    const ns = buildSqlNamespace({ id: 'app', entries: { table: {} } });
    expect(Object.keys(ns)).not.toContain('table');
  });

  it('table getter returns StorageTable instances', () => {
    const ns = buildSqlNamespace({ id: 'app', entries: { table: { users: emptyTableInput } } });
    expect(ns.table['users']).toBeInstanceOf(StorageTable);
  });

  it('valueSet getter returns the frozen name-keyed map when present', () => {
    const ns = buildSqlNamespace({
      id: 'app',
      entries: {
        table: {},
        valueSet: { Role: { kind: 'value-set', values: ['admin', 'user'] } },
      },
    });
    expect(ns.valueSet).toBe(ns.entries['valueSet']);
  });

  it('valueSet getter is non-enumerable', () => {
    const ns = buildSqlNamespace({ id: 'app', entries: { table: {} } });
    expect(Object.keys(ns)).not.toContain('valueSet');
  });

  it('valueSet getter returns undefined when absent (no valueSet in entries)', () => {
    const ns = buildSqlNamespace({ id: 'app', entries: { table: {} } });
    expect(ns.valueSet).toBeUndefined();
  });

  it('valueSet getter returns StorageValueSet instances', () => {
    const ns = buildSqlNamespace({
      id: 'app',
      entries: {
        table: {},
        valueSet: { Role: { kind: 'value-set', values: ['admin', 'user'] } },
      },
    });
    expect(ns.valueSet?.['Role']).toBeInstanceOf(StorageValueSet);
  });

  it('inner valueSet map is frozen when present', () => {
    const ns = buildSqlNamespace({
      id: 'app',
      entries: {
        table: {},
        valueSet: { Role: { kind: 'value-set', values: ['admin', 'user'] } },
      },
    });
    expect(Object.isFrozen(ns.entries['valueSet'])).toBe(true);
  });

  it('construction dispatches table entries by key', () => {
    const ns = buildSqlNamespace({
      id: 'app',
      entries: {
        table: { users: tableWithColumn },
      },
    });
    const tableEntry = ns.entries['table']?.['users'];
    expect(tableEntry).toBeInstanceOf(StorageTable);
  });

  it('construction dispatches valueSet entries by key', () => {
    const ns = buildSqlNamespace({
      id: 'app',
      entries: {
        table: {},
        valueSet: { Status: { kind: 'value-set', values: ['active', 'inactive'] } },
      },
    });
    const vsEntry = ns.entries['valueSet']?.['Status'];
    expect(vsEntry).toBeInstanceOf(StorageValueSet);
  });

  it('node itself is frozen', () => {
    const ns = buildSqlNamespace({ id: 'app', entries: { table: {} } });
    expect(Object.isFrozen(ns)).toBe(true);
  });

  it('construction throws naming the unknown kind when entries contains an unrecognised key', () => {
    expect(() =>
      buildSqlNamespace({
        id: 'app',
        entries: { table: {}, bogus: {} } as never,
      }),
    ).toThrow(/unknown entity kind/);
  });

  it('entries[kind][name] resolves the same as the getter[name]', () => {
    const ns = buildSqlNamespace({
      id: 'app',
      entries: { table: { users: emptyTableInput } },
    });
    expect(ns.entries['table']?.['users']).toBe(ns.table['users']);
  });
});

describe('SqlUnboundNamespace — entries open dictionary', () => {
  it('exact-shape serialization: JSON.stringify emits only id and entries', () => {
    const parsed = JSON.parse(JSON.stringify(SqlUnboundNamespace.instance)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed).sort()).toEqual(['entries', 'id']);
  });

  it('entries is frozen', () => {
    expect(Object.isFrozen(SqlUnboundNamespace.instance.entries)).toBe(true);
  });

  it('inner table map is frozen', () => {
    expect(Object.isFrozen(SqlUnboundNamespace.instance.entries['table'])).toBe(true);
  });

  it('table getter returns the frozen empty map', () => {
    expect(SqlUnboundNamespace.instance.table).toBe(SqlUnboundNamespace.instance.entries['table']);
    expect(SqlUnboundNamespace.instance.table).toEqual({});
  });

  it('table getter is non-enumerable', () => {
    expect(Object.keys(SqlUnboundNamespace.instance)).not.toContain('table');
  });

  it('id is the unbound sentinel', () => {
    expect(SqlUnboundNamespace.instance.id).toBe(UNBOUND_NAMESPACE_ID);
  });

  it('is the singleton returned for empty unbound input', () => {
    const ns = buildSqlNamespace({ id: UNBOUND_NAMESPACE_ID, entries: { table: {} } });
    expect(ns).toBe(SqlUnboundNamespace.instance);
  });
});
