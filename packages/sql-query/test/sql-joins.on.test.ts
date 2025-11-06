import { describe, expect, it } from 'vitest';
import { createJoinOnBuilder } from '../src/sql';
import { schema } from '../src/schema';
import { validateContract } from '../src/contract';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import type { CodecTypes } from './fixtures/contract.d';

const contractWithPosts = validateContract<SqlContract<SqlStorage>>({
  target: 'postgres',
  targetFamily: 'sql' as const,
  coreHash: 'sha256:test-core',
  profileHash: 'sha256:test-profile',
  storage: {
    tables: {
      user: {
        columns: {
          id: { type: 'pg/int4@1', nullable: false },
          email: { type: 'pg/text@1', nullable: false },
        },
      },
      post: {
        columns: {
          id: { type: 'pg/int4@1', nullable: false },
          userId: { type: 'pg/int4@1', nullable: false },
          title: { type: 'pg/text@1', nullable: false },
        },
      },
    },
  },
  models: {},
  relations: {},
  mappings: {},
});

describe('JoinOnBuilder', () => {
  it('creates a join ON predicate from two columns', () => {
    const on = createJoinOnBuilder();
    const tables = schema<typeof contractWithPosts, CodecTypes>(contractWithPosts).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    const predicate = on.eqCol(userColumns.id, postColumns.userId);

    expect(predicate.kind).toBe('join-on');
    expect(predicate.left.table).toBe('user');
    expect(predicate.left.column).toBe('id');
    expect(predicate.right.table).toBe('post');
    expect(predicate.right.column).toBe('userId');
  });

  it('throws PLAN.INVALID when left operand is not a column', () => {
    const on = createJoinOnBuilder();
    const tables = schema<typeof contractWithPosts, CodecTypes>(contractWithPosts).tables;
    const postColumns = tables.post.columns;

    expect(() => on.eqCol(null as any, postColumns.userId)).toThrowError(
      /Join ON left operand must be a column/,
    );

    expect(() => on.eqCol({} as any, postColumns.userId)).toThrowError(
      /Join ON left operand must be a column/,
    );
  });

  it('throws PLAN.INVALID when right operand is not a column', () => {
    const on = createJoinOnBuilder();
    const tables = schema<typeof contractWithPosts, CodecTypes>(contractWithPosts).tables;
    const userColumns = tables.user.columns;

    expect(() => on.eqCol(userColumns.id, null as any)).toThrowError(
      /Join ON right operand must be a column/,
    );

    expect(() => on.eqCol(userColumns.id, {} as any)).toThrowError(
      /Join ON right operand must be a column/,
    );
  });

  it('throws PLAN.INVALID when both columns are from the same table (self-join)', () => {
    const on = createJoinOnBuilder();
    const tables = schema<typeof contractWithPosts, CodecTypes>(contractWithPosts).tables;
    const userColumns = tables.user.columns;

    expect(() => on.eqCol(userColumns.id, userColumns.id)).toThrowError(
      /Self-joins are not supported in MVP/,
    );
  });
});
