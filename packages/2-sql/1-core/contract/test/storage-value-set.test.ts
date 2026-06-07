import type { ValueSetRef } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { buildSqlNamespace } from '../src/ir/build-sql-namespace';
import { StorageColumn } from '../src/ir/storage-column';
import { StorageTable } from '../src/ir/storage-table';
import { StorageValueSet } from '../src/ir/storage-value-set';

const baseColumn = { codecId: 'pg/text@1', nativeType: 'text', nullable: false };

const baseTable = new StorageTable({
  columns: { role: baseColumn },
  primaryKey: { columns: ['role'] },
  uniques: [],
  indexes: [],
  foreignKeys: [],
});

describe('StorageValueSet', () => {
  it('constructs with ordered values', () => {
    const vs = new StorageValueSet({ kind: 'value-set', values: ['user', 'admin'] });
    expect(vs.kind).toBe('value-set');
    expect(vs.values).toEqual(['user', 'admin']);
  });

  it('preserves declaration order', () => {
    const vs = new StorageValueSet({
      kind: 'value-set',
      values: ['alpha', 'beta', 'gamma'],
    });
    expect([...vs.values]).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('is frozen', () => {
    const vs = new StorageValueSet({ kind: 'value-set', values: ['x', 'y'] });
    expect(Object.isFrozen(vs)).toBe(true);
  });
});

describe('SqlNamespace with valueSet entries', () => {
  it('accepts a namespace with a valueSet slot alongside the table slot', () => {
    const roleVs = new StorageValueSet({ kind: 'value-set', values: ['user', 'admin'] });

    const ns = buildSqlNamespace({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: { users: baseTable },
        valueSet: { Role: roleVs },
      },
    });

    expect(ns.entries.table['users']).toBeDefined();
    expect(ns.entries.valueSet?.['Role']).toBeDefined();
    expect(ns.entries.valueSet?.['Role']?.kind).toBe('value-set');
    expect(ns.entries.valueSet?.['Role']?.values).toEqual(['user', 'admin']);
  });

  it('leaves the valueSet slot absent when not provided', () => {
    const ns = buildSqlNamespace({
      id: UNBOUND_NAMESPACE_ID,
      entries: { table: { users: baseTable } },
    });
    expect(ns.entries.valueSet).toBeUndefined();
  });
});

describe('StorageColumn with valueSet restriction', () => {
  it('carries a valueSet ref when provided', () => {
    const ref: ValueSetRef = {
      kind: 'value-set',
      namespaceId: UNBOUND_NAMESPACE_ID,
      name: 'Role',
    };
    const col = new StorageColumn({ ...baseColumn, valueSet: ref });

    expect(col.valueSet).toEqual(ref);
    expect(col.valueSet?.kind).toBe('value-set');
    expect(col.valueSet?.namespaceId).toBe(UNBOUND_NAMESPACE_ID);
    expect(col.valueSet?.name).toBe('Role');
    expect(col.valueSet?.spaceId).toBeUndefined();
  });

  it('carries a cross-space valueSet ref when spaceId is provided', () => {
    const ref: ValueSetRef = {
      kind: 'value-set',
      namespaceId: UNBOUND_NAMESPACE_ID,
      name: 'Role',
      spaceId: 'other-space',
    };
    const col = new StorageColumn({ ...baseColumn, valueSet: ref });
    expect(col.valueSet?.spaceId).toBe('other-space');
  });

  it('leaves valueSet absent when not provided', () => {
    const col = new StorageColumn(baseColumn);
    expect(col.valueSet).toBeUndefined();
  });

  it('is frozen', () => {
    const col = new StorageColumn({
      ...baseColumn,
      valueSet: { kind: 'value-set', namespaceId: UNBOUND_NAMESPACE_ID, name: 'Role' },
    });
    expect(Object.isFrozen(col)).toBe(true);
  });
});
