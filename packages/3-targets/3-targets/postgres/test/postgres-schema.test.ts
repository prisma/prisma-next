import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { PostgresSchema, PostgresUnboundSchema } from '../src/core/postgres-schema';

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
