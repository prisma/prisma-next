import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import {
  PostgresSchema,
  PostgresUnboundSchema,
  postgresCreateNamespace,
} from '../src/core/postgres-schema';

describe('PostgresSchema', () => {
  it('exposes its id and renders a quoted-identifier qualifier', () => {
    const schema = new PostgresSchema('auth');
    expect(schema.id).toBe('auth');
    expect(schema.qualifier()).toBe('"auth"');
  });

  it('qualifies a table name with the schema prefix', () => {
    const schema = new PostgresSchema('auth');
    expect(schema.qualifyTable('users')).toBe('"auth"."users"');
  });

  it('quotes the schema name even when it would otherwise collide with a Postgres keyword', () => {
    const schema = new PostgresSchema('public');
    expect(schema.qualifier()).toBe('"public"');
    expect(schema.qualifyTable('users')).toBe('"public"."users"');
  });
});

describe('PostgresUnboundSchema', () => {
  it('exposes the framework-reserved unbound id as its singleton id', () => {
    expect(PostgresSchema.unbound).toBeInstanceOf(PostgresUnboundSchema);
    expect(PostgresSchema.unbound.id).toBe(UNBOUND_NAMESPACE_ID);
  });

  it('elides the schema qualifier so emission paths render unqualified output', () => {
    expect(PostgresSchema.unbound.qualifier()).toBe('');
    expect(PostgresSchema.unbound.qualifyTable('users')).toBe('"users"');
  });

  it('is a stable singleton — repeated access returns the same instance', () => {
    expect(PostgresSchema.unbound).toBe(PostgresSchema.unbound);
  });
});

describe('postgresCreateNamespace factory', () => {
  it('returns the unbound singleton for the framework-reserved sentinel', () => {
    const namespace = postgresCreateNamespace(UNBOUND_NAMESPACE_ID);
    expect(namespace).toBe(PostgresSchema.unbound);
    expect(namespace).toBeInstanceOf(PostgresUnboundSchema);
    expect(namespace.qualifyTable('users')).toBe('"users"');
  });

  it('materialises a fresh PostgresSchema instance for any named coordinate', () => {
    const auth = postgresCreateNamespace('auth');
    expect(auth).toBeInstanceOf(PostgresSchema);
    expect(auth.id).toBe('auth');
    expect(auth.qualifyTable('users')).toBe('"auth"."users"');
  });

  it('returns distinct PostgresSchema instances for distinct named coordinates', () => {
    const auth = postgresCreateNamespace('auth');
    const billing = postgresCreateNamespace('billing');
    expect(auth).not.toBe(billing);
    expect(auth.id).toBe('auth');
    expect(billing.id).toBe('billing');
  });
});
