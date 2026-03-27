import { DefaultValueExpr, type InsertAst, ParamRef } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  createReturningUsersCollection,
  createUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './helpers';

function isInsertAst(ast: unknown): ast is InsertAst {
  return typeof ast === 'object' && ast !== null && 'kind' in ast && ast.kind === 'insert';
}

function expectInsertBatchAst(ast: unknown): asserts ast is InsertAst {
  expect(isInsertAst(ast)).toBe(true);

  expect((ast as InsertAst).rows).toEqual([
    {
      id: ParamRef.of(1, 'id'),
      name: ParamRef.of(2, 'name'),
      email: ParamRef.of(3, 'email'),
      invited_by_id: ParamRef.of(4, 'invited_by_id'),
    },
    {
      id: ParamRef.of(5, 'id'),
      name: ParamRef.of(6, 'name'),
      email: ParamRef.of(7, 'email'),
      invited_by_id: new DefaultValueExpr(),
    },
  ]);
}

describe('integration/create', () => {
  it(
    'create() returns inserted row when returning capability is enabled',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        const created = await users.create({
          id: 9,
          name: 'Neo',
          email: 'neo@example.com',
          invitedById: null,
        });
        expect(created).toEqual({
          id: 9,
          name: 'Neo',
          email: 'neo@example.com',
          invitedById: null,
        });

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users where id = $1',
          [9],
        );
        expect(rows).toEqual([{ id: 9, name: 'Neo' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'createAll() inserts multiple rows and returns inserted rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        runtime.resetExecutions();
        const created = await users.createAll([
          { id: 10, name: 'Alice', email: 'alice@example.com', invitedById: null },
          { id: 11, name: 'Bob', email: 'bob@example.com' },
        ]);

        expect(created).toEqual([
          { id: 10, name: 'Alice', email: 'alice@example.com', invitedById: null },
          { id: 11, name: 'Bob', email: 'bob@example.com', invitedById: null },
        ]);
        expect(runtime.executions).toHaveLength(1);
        expectInsertBatchAst(runtime.executions[0]?.ast);

        const rows = await runtime.query<{ id: number; name: string; email: string }>(
          'select id, name, email from users order by id',
        );
        expect(rows).toEqual([
          { id: 10, name: 'Alice', email: 'alice@example.com' },
          { id: 11, name: 'Bob', email: 'bob@example.com' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'createCount() inserts multiple rows and returns inserted count',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        runtime.resetExecutions();
        const count = await users.createCount([
          { id: 20, name: 'Cara', email: 'cara@example.com', invitedById: null },
          { id: 21, name: 'Dan', email: 'dan@example.com' },
        ]);
        expect(count).toBe(2);
        expect(runtime.executions).toHaveLength(1);
        expectInsertBatchAst(runtime.executions[0]?.ast);

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        expect(rows).toEqual([
          { id: 20, name: 'Cara' },
          { id: 21, name: 'Dan' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create() and createAll() reject when returning capability is disabled',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await expect(
          users.create({
            id: 30,
            name: 'NoReturn',
            email: 'noreturn@example.com',
            invitedById: null,
          }),
        ).rejects.toThrow(/requires contract capability "returning"/);

        expect(() =>
          users.createAll([
            {
              id: 31,
              name: 'NoReturn2',
              email: 'noreturn2@example.com',
              invitedById: null,
            },
          ]),
        ).toThrow(/requires contract capability "returning"/);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'createAll([]) is a no-op and executes nothing',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        runtime.resetExecutions();
        const rows = await users.createAll([]);

        expect(rows).toEqual([]);
        expect(runtime.executions).toHaveLength(0);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
