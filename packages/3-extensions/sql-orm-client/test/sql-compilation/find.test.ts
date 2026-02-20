import { describe, expect, it } from 'vitest';
import { createCollection } from '../collection-fixtures';

describe('sql-compilation/find', () => {
  it('all() compiles and executes a SELECT query', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    const results = await collection.all().toArray();

    expect(results).toEqual([{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
    expect(runtime.executions).toHaveLength(1);
    expect(runtime.executions[0]!.plan.sql).toContain('select');
    expect(runtime.executions[0]!.plan.sql).toContain('"users"');
    expect(runtime.executions[0]!.plan.meta.lane).toBe('orm-client');
  });

  it('all() with where() produces WHERE clause', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    await collection
      .where((user) => user.name.eq('Alice'))
      .all()
      .toArray();

    const sqlText = runtime.executions[0]!.plan.sql;
    expect(sqlText).toContain('where');
    expect(sqlText).toContain('"name"');
  });

  it('find() adds limit 1', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    const result = await collection.find();

    expect(result).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
    expect(runtime.executions[0]!.plan.sql).toContain('limit');
  });

  it('find() accepts shorthand object filters', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[{ id: 42, name: 'Alice', email: 'alice@example.com' }]]);

    const result = await collection.find({ id: 42 });

    expect(result).toEqual({ id: 42, name: 'Alice', email: 'alice@example.com' });
    expect(runtime.executions[0]!.plan.sql).toContain('"id"');
    expect(runtime.executions[0]!.plan.sql).toContain('limit');
  });

  it('find() combines inline filters with pre-existing where() filters', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[{ id: 42, name: 'Alice', email: 'alice@example.com' }]]);

    await collection.where({ name: 'Alice' }).find((user) => user.id.eq(42));

    const sqlText = runtime.executions[0]!.plan.sql;
    expect(sqlText).toContain('"name"');
    expect(sqlText).toContain('"id"');
  });
});
