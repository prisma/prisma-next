import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { PostgresEntityRef } from '../src/core/entity-ref';
import { PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';

const boundNs = postgresCreateNamespace({ id: 'public', entries: { table: {} } });
const unboundNs = postgresCreateNamespace({ id: UNBOUND_NAMESPACE_ID, entries: { table: {} } });

describe('PostgresEntityRef (table)', () => {
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

  it('factory on PostgresSchema returns a PostgresEntityRef', () => {
    const ns = new PostgresSchema({ id: 'app', entries: { table: {} } });
    const ref = ns.tableRef('orders');
    expect(ref).toBeInstanceOf(PostgresEntityRef);
    expect(ref.namespace).toBe(ns);
    expect(ref.name).toBe('orders');
  });
});

describe('PostgresEntityRef (column via parent)', () => {
  it('qualified: bound table renders schema.table.column', () => {
    const tableRef = boundNs.tableRef('user');
    const ref = new PostgresEntityRef({ namespace: boundNs, name: 'email', parent: tableRef });
    expect(ref.qualified()).toBe('"public"."user"."email"');
  });

  it('qualified: unbound table renders table.column (no schema prefix)', () => {
    const tableRef = unboundNs.tableRef('user');
    const ref = new PostgresEntityRef({ namespace: unboundNs, name: 'email', parent: tableRef });
    expect(ref.qualified()).toBe('"user"."email"');
  });

  it('qualified: column name with embedded quote escapes correctly', () => {
    const tableRef = boundNs.tableRef('user');
    const ref = new PostgresEntityRef({ namespace: boundNs, name: 'my"col', parent: tableRef });
    expect(ref.qualified()).toBe('"public"."user"."my""col"');
  });

  it('name and parent are accessible', () => {
    const tableRef = boundNs.tableRef('user');
    const ref = new PostgresEntityRef({ namespace: boundNs, name: 'email', parent: tableRef });
    expect(ref.name).toBe('email');
    expect(ref.parent).toBe(tableRef);
    expect(tableRef.name).toBe('user');
  });

  it('is frozen', () => {
    const tableRef = boundNs.tableRef('user');
    const ref = new PostgresEntityRef({ namespace: boundNs, name: 'email', parent: tableRef });
    expect(Object.isFrozen(ref)).toBe(true);
  });
});
