import { describe, expect, it } from 'vitest';
import type { InsertAst } from '@prisma-next/sql-relational-core/ast';
import { Collection } from '../../src/collection';
import { withReturningCapability } from '../collection-fixtures';
import { createTestContract } from '../helpers';
import {
  createReturningUsersCollection,
  createUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './helpers';
import { seedUsers } from './runtime-helpers';

function isInsertAst(ast: unknown): ast is InsertAst {
  return typeof ast === 'object' && ast !== null && 'kind' in ast && ast.kind === 'insert';
}

describe('integration/upsert', () => {
  it(
    'upsert() uses primary key conflict fallback and returns updated row',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);

        const upserted = await users.upsert({
          create: { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
          update: { name: 'Alice Updated' },
        });

        expect(upserted).toEqual({
          id: 1,
          name: 'Alice Updated',
          email: 'alice@example.com',
          invitedById: null,
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'upsert() supports explicit conflict criteria',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 2, name: 'Bob', email: 'bob@example.com' }]);

        const upserted = await users.upsert({
          create: { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: null },
          update: { name: 'Bob Updated' },
          conflictOn: { id: 2 },
        });

        expect(upserted).toEqual({
          id: 2,
          name: 'Bob Updated',
          email: 'bob@example.com',
          invitedById: null,
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'upsert() rejects when returning capability is disabled',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await expect(
          users.upsert({
            create: { id: 3, name: 'NoReturn', email: 'noreturn@example.com', invitedById: null },
            update: { name: 'NoReturn Updated' },
          }),
        ).rejects.toThrow(/requires contract capability "returning"/);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'upsert() rejects when no conflict columns can be resolved',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const contract = withReturningCapability(createTestContract());
        delete (contract.storage.tables.users as { primaryKey?: unknown }).primaryKey;
        const users = new Collection({ contract, runtime }, 'User');

        await expect(
          users.upsert({
            create: { id: 4, name: 'NoPK', email: 'nopk@example.com', invitedById: null },
            update: { name: 'NoPK Updated' },
          }),
        ).rejects.toThrow(/requires conflict columns/);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'upsert() with empty update behaves as conditional create',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        runtime.resetExecutions();
        const inserted = await users.upsert({
          create: { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
          update: {},
        });

        expect(inserted).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          invitedById: null,
        });
        const insertPlanAst = runtime.executions[0]?.ast;
        expect(isInsertAst(insertPlanAst)).toBe(true);
        if (!isInsertAst(insertPlanAst)) {
          throw new Error('Expected first empty-update upsert execution to emit an insert AST');
        }
        expect(insertPlanAst.onConflict?.action).toEqual({ kind: 'doNothing' });

        runtime.resetExecutions();
        const existing = await users.upsert({
          create: { id: 1, name: 'Ignored', email: 'ignored@example.com', invitedById: null },
          update: {},
        });

        expect(existing).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          invitedById: null,
        });
        const conflictPlanAst = runtime.executions[0]?.ast;
        expect(isInsertAst(conflictPlanAst)).toBe(true);
        if (!isInsertAst(conflictPlanAst)) {
          throw new Error('Expected second empty-update upsert execution to emit an insert AST');
        }
        expect(conflictPlanAst.onConflict?.action).toEqual({ kind: 'doNothing' });

        expect(await users.first({ id: 1 })).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          invitedById: null,
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
