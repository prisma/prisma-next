import type { SqlContract } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { createJoinOnBuilder } from '../src/sql/builder';

// Define a fully-typed contract type for this test
type ContractWithPosts = SqlContract<
  {
    readonly tables: {
      readonly user: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            nullable: false;
          };
          readonly email: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
            nullable: false;
          };
        };
        readonly primaryKey: { readonly columns: readonly ['id'] };
        readonly uniques: readonly [];
        readonly indexes: readonly [];
        readonly foreignKeys: readonly [];
      };
      readonly post: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            nullable: false;
          };
          readonly userId: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            nullable: false;
          };
          readonly title: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
            nullable: false;
          };
        };
        readonly primaryKey: { readonly columns: readonly ['id'] };
        readonly uniques: readonly [];
        readonly indexes: readonly [];
        readonly foreignKeys: readonly [];
      };
    };
  },
  Record<string, never>,
  Record<string, never>,
  {
    readonly codecTypes: Record<string, never>;
    readonly operationTypes: Record<string, Record<string, unknown>>;
  }
>;

const contractWithPosts = validateContract<ContractWithPosts>({
  target: 'postgres',
  targetFamily: 'sql' as const,
  coreHash: 'sha256:test-core',
  profileHash: 'sha256:test-profile',
  storage: {
    tables: {
      user: {
        columns: {
          id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
      post: {
        columns: {
          id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    },
  },
  models: {},
  relations: {},
  mappings: {
    codecTypes: {},
    operationTypes: {},
  },
});

describe('JoinOnBuilder', () => {
  it('creates a join ON predicate from two columns', () => {
    const on = createJoinOnBuilder();
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithPosts, adapter);
    const tables = schema<ContractWithPosts>(context).tables;
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
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithPosts, adapter);
    const tables = schema<ContractWithPosts>(context).tables;
    const postColumns = tables.post.columns;

    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    expect(() => on.eqCol(null as any, postColumns.userId)).toThrowError(
      /Join ON left operand must be a column/,
    );

    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    expect(() => on.eqCol({} as any, postColumns.userId)).toThrowError(
      /Join ON left operand must be a column/,
    );
  });

  it('throws PLAN.INVALID when right operand is not a column', () => {
    const on = createJoinOnBuilder();
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithPosts, adapter);
    const tables = schema<ContractWithPosts>(context).tables;
    const userColumns = tables.user.columns;

    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    expect(() => on.eqCol(userColumns.id, null as any)).toThrowError(
      /Join ON right operand must be a column/,
    );

    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    expect(() => on.eqCol(userColumns.id, {} as any)).toThrowError(
      /Join ON right operand must be a column/,
    );
  });

  it('throws PLAN.INVALID when both columns are from the same table (self-join)', () => {
    const on = createJoinOnBuilder();
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithPosts, adapter);
    const tables = schema<ContractWithPosts>(context).tables;
    const userColumns = tables.user.columns;

    expect(() => on.eqCol(userColumns.id, userColumns.id)).toThrowError(
      /Self-joins are not supported in MVP/,
    );
  });
});
