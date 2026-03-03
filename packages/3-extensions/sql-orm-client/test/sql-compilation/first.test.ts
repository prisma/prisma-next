import { describe, expect, it } from 'vitest';
import { createCollection } from '../collection-fixtures';
import { normalizeSql } from './helpers';

describe('sql-compilation/first', () => {
  it('all() compiles and executes a SELECT query', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    const results = await collection.all();

    expect(results).toEqual([{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
    expect(runtime.executions).toHaveLength(1);
    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe('select * from "users"');
    expect(runtime.executions[0]!.plan.meta.lane).toBe('orm-client');
  });

  it('all() with where() produces WHERE clause', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    await collection.where((user) => user.name.eq('Alice')).all();

    const sqlText = runtime.executions[0]!.plan.sql;
    expect(normalizeSql(sqlText)).toBe('select * from "users" where "users"."name" = $1');
  });

  it('first() adds limit 1', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    const result = await collection.first();

    expect(result).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe('select * from "users" limit $1');
  });

  it('first() accepts shorthand object filters', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[{ id: 42, name: 'Alice', email: 'alice@example.com' }]]);

    const result = await collection.first({ id: 42 });

    expect(result).toEqual({ id: 42, name: 'Alice', email: 'alice@example.com' });
    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe(
      'select * from "users" where "users"."id" = $1 limit $2',
    );
  });

  it('first() combines inline filters with pre-existing where() filters', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[{ id: 42, name: 'Alice', email: 'alice@example.com' }]]);

    await collection.where({ name: 'Alice' }).first((user) => user.id.eq(42));

    const sqlText = runtime.executions[0]!.plan.sql;
    expect(normalizeSql(sqlText)).toBe(
      'select * from "users" where ("users"."name" = $1 and "users"."id" = $2) limit $3',
    );
  });
});
