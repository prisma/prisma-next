import { describe, expect, it } from 'vitest';
import { createCollection } from '../collection-fixtures';
import { normalizeSql, serializePlans } from './helpers';

describe('sql-compilation/pagination', () => {
  it('all() with take/skip adds LIMIT/OFFSET', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.take(10).skip(5).all();

    const sqlText = runtime.executions[0]!.plan.sql;
    expect(normalizeSql(sqlText)).toBe('select * from "users" limit $1 offset $2');
  });

  it('all() with cursor() applies a single-column cursor boundary', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection
      .orderBy((user) => user.id.asc())
      .cursor({ id: 42 })
      .take(10)
      .all();

    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe(
      'select * from "users" where "users"."id" > $1 order by "id" asc limit $2',
    );
  });

  it('all() with compound cursor() compiles tuple comparison', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection
      .orderBy([(user) => user.name.asc(), (user) => user.email.asc()])
      .cursor({ name: 'Alice', email: 'alice@example.com' })
      .all();

    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe(
      'select * from "users" where ("users"."name", "users"."email") > ($1, $2) order by "name" asc, "email" asc',
    );
  });

  it('all() with distinct() compiles SELECT DISTINCT', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.distinct('email').all();

    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe('select distinct * from "users"');
  });

  it('all() with distinctOn() compiles DISTINCT ON', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection
      .orderBy((user) => user.email.asc())
      .distinctOn('email')
      .all();

    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe(
      'select distinct on ("users"."email") * from "users" order by "email" asc',
    );
  });

  it('select() compiles to explicit projection instead of selectAll()', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.select('name', 'email').all();

    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe(
      'select "users"."name", "users"."email" from "users"',
    );
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
        .all(),
    ).toThrow(/Missing cursor value for orderBy column "email"/);
  });
});
