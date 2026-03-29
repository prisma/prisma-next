import { FindCommand, type InferModelRow } from '@prisma-next/mongo-core';
import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/contract';
import { withMongod } from './setup';

type UserRow = InferModelRow<Contract, 'User'>;

describe('contract-driven execution', () => {
  it('executes a find plan with row type inferred from contract', async () => {
    await withMongod(async (ctx) => {
      const userId = new ObjectId();
      await ctx.client
        .db(ctx.dbName)
        .collection('users')
        .insertOne({
          _id: userId,
          name: 'Alice',
          email: 'alice@example.com',
          bio: null,
          createdAt: new Date('2024-01-15T10:00:00Z'),
        });

      const findCommand = new FindCommand('users', {});
      const plan = ctx.makePlan<UserRow>(findCommand);

      const result = ctx.runtime.execute(plan);
      const rows: UserRow[] = [];
      for await (const row of result) {
        rows.push(row);
      }

      expect(rows).toHaveLength(1);
      const user = rows[0]!;
      expect(user.name).toBe('Alice');
      expect(user.email).toBe('alice@example.com');
      expect(user.bio).toBeNull();
      expect(user.createdAt).toEqual(new Date('2024-01-15T10:00:00Z'));
    });
  });
});
