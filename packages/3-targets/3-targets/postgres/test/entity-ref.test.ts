import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { PostgresColumnRef, PostgresTableRef } from '../src/core/entity-ref';
import { PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';

const boundNs = postgresCreateNamespace({ id: 'public', entries: { table: {} } });
const unboundNs = postgresCreateNamespace({ id: UNBOUND_NAMESPACE_ID, entries: { table: {} } });

describe('PostgresTableRef', () => {
  it('qualified: bound namespace renders schema-prefixed identifier', () => {
    const ref = boundNs.tableRef('user');
    expect(ref.qualified()).toBe('"public"."user"');
  });

  it('qualified: unbound namespace renders unqualified identifier (no schema prefix)', () => {
    const ref = unboundNs.tableRef('user');
    expect(ref.qualified()).toBe('"user"');
  });

  it('qualified: bound namespace with embedded-quote in table name escapes correctly', () => {
    const ref = boundNs.tableRef('my"table');
    expect(ref.qualified()).toBe('"public"."my""table"');
  });

  it('qualified: bound namespace byte-parity with legacy renderer composition', () => {
    const ns = postgresCreateNamespace({ id: 'auth', entries: { table: {} } });
    const ref = ns.tableRef('sessions');
    expect(ref.qualified()).toBe('"auth"."sessions"');
  });

  it('qualified: unbound byte-parity — same as legacy renderer unqualified path', () => {
    const ref = unboundNs.tableRef('sessions');
    expect(ref.qualified()).toBe('"sessions"');
  });

  it('name and namespace are accessible', () => {
    const ref = boundNs.tableRef('user');
    expect(ref.name).toBe('user');
    expect(ref.namespace).toBe(boundNs);
  });

  it('is frozen', () => {
    const ref = boundNs.tableRef('user');
    expect(Object.isFrozen(ref)).toBe(true);
  });

  it('accept dispatches to visitor.tableRef', () => {
    const ref = boundNs.tableRef('user');
    const result = ref.accept({
      tableRef: (r) => `table:${r.name}`,
      columnRef: () => 'column',
    });
    expect(result).toBe('table:user');
  });

  it('factory on PostgresSchema returns a PostgresTableRef', () => {
    const ns = new PostgresSchema({ id: 'app', entries: { table: {} } });
    const ref = ns.tableRef('orders');
    expect(ref).toBeInstanceOf(PostgresTableRef);
    expect(ref.namespace).toBe(ns);
    expect(ref.name).toBe('orders');
  });
});

describe('PostgresColumnRef', () => {
  it('qualified: bound table renders schema.table.column', () => {
    const ref = boundNs.columnRef('user', 'email');
    expect(ref.qualified()).toBe('"public"."user"."email"');
  });

  it('qualified: unbound table renders table.column (no schema prefix)', () => {
    const ref = unboundNs.columnRef('user', 'email');
    expect(ref.qualified()).toBe('"user"."email"');
  });

  it('qualified: column name with embedded quote escapes correctly', () => {
    const ref = boundNs.columnRef('user', 'my"col');
    expect(ref.qualified()).toBe('"public"."user"."my""col"');
  });

  it('table and column are accessible', () => {
    const ref = boundNs.columnRef('user', 'email');
    expect(ref.column).toBe('email');
    expect(ref.table.name).toBe('user');
  });

  it('is frozen', () => {
    const ref = boundNs.columnRef('user', 'email');
    expect(Object.isFrozen(ref)).toBe(true);
  });

  it('accept dispatches to visitor.columnRef', () => {
    const ref = boundNs.columnRef('user', 'email');
    const result = ref.accept({
      tableRef: () => 'table',
      columnRef: (r) => `column:${r.column}`,
    });
    expect(result).toBe('column:email');
  });

  it('factory on PostgresSchema returns a PostgresColumnRef', () => {
    const ns = new PostgresSchema({ id: 'app', entries: { table: {} } });
    const ref = ns.columnRef('orders', 'total');
    expect(ref).toBeInstanceOf(PostgresColumnRef);
    expect(ref.column).toBe('total');
    expect(ref.table.name).toBe('orders');
  });
});
