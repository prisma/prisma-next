import { describe, expect, it } from 'vitest';
import { createCollection } from '../collection-fixtures';
import { serializePlans } from './helpers';

describe('sql-compilation/pagination', () => {
  it('all() with take/skip adds LIMIT/OFFSET', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.take(10).skip(5).all();

    const sqlText = runtime.executions[0]!.plan.sql;
    expect(sqlText).toContain('limit');
    expect(sqlText).toContain('offset');
  });

  it('all() with cursor() applies a single-column cursor boundary', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection
      .orderBy((user) => user.id.asc())
      .cursor({ id: 42 })
      .take(10)
      .all();

    const sqlText = runtime.executions[0]!.plan.sql.toLowerCase();
    expect(sqlText).toContain('"users"."id" >');
  });

  it('all() with compound cursor() compiles tuple comparison', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection
      .orderBy([(user) => user.name.asc(), (user) => user.email.asc()])
      .cursor({ name: 'Alice', email: 'alice@example.com' })
      .all();

    const sqlText = runtime.executions[0]!.plan.sql.toLowerCase();
    expect(sqlText).toContain('("users"."name", "users"."email") >');
  });

  it('all() with distinct() compiles SELECT DISTINCT', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.distinct('email').all();

    const sqlText = runtime.executions[0]!.plan.sql.toLowerCase();
    expect(sqlText).toContain('select distinct');
  });

  it('all() with distinctOn() compiles DISTINCT ON', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection
      .orderBy((user) => user.email.asc())
      .distinctOn('email')
      .all();

    const sqlText = runtime.executions[0]!.plan.sql.toLowerCase();
    expect(sqlText).toContain('distinct on');
    expect(sqlText).toContain('("users"."email")');
  });

  it('select() compiles to explicit projection instead of selectAll()', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.select('name', 'email').all();

    const sqlText = runtime.executions[0]!.plan.sql.toLowerCase();
    expect(sqlText).toContain('"users"."name"');
    expect(sqlText).toContain('"users"."email"');
    expect(sqlText).not.toContain('*');
  });

  it('mixed-direction cursor compiles lexicographic pagination branches', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection
      .orderBy([(user) => user.name.asc(), (user) => user.email.desc()])
      .cursor({ name: 'Alice', email: 'z@example.com' })
      .all();

    expect(serializePlans(runtime)).toMatchInlineSnapshot(`
      [
        {
          "lane": "orm-client",
          "params": [
            "Alice",
            "Alice",
            "z@example.com",
          ],
          "sql": "select * from "users" where "users"."name" > $1 or ("users"."name" = $2 and "users"."email" < $3) order by "name" asc, "email" desc",
        },
      ]
    `);
  });

  it('cursor() throws when an orderBy column value is missing', () => {
    const { collection } = createCollection();

    expect(() =>
      collection
        .orderBy([(user) => user.name.asc(), (user) => user.email.asc()])
        .cursor({ name: 'Alice' })
        .all()
        ,
    ).toThrow(/Missing cursor value for orderBy column "email"/);
  });
});
