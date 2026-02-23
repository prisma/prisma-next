import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import type { Adapter, LoweredStatement, SelectAst } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry, createColumnRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';
import type { CodecTypes } from './fixtures/contract.d';

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
      readonly comment: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            nullable: false;
          };
          readonly postId: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            nullable: false;
          };
          readonly content: {
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
  Record<string, never>
> & {
  readonly '__@prisma-next/sql-contract/codecTypes@__': CodecTypes;
  readonly '__@prisma-next/sql-contract/operationTypes@__': Record<string, Record<string, unknown>>;
};

const contractWithPosts = validateContract<ContractWithPosts>({
  target: 'postgres',
  targetFamily: 'sql' as const,
  storageHash: 'sha256:test-core',
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
      comment: {
        columns: {
          id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          postId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          content: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
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
  mappings: {},
});

function createStubAdapter(): Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement> {
  return {
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return createCodecRegistry();
      },
    },
    lower(ast: SelectAst, ctx: { contract: SqlContract<SqlStorage>; params?: readonly unknown[] }) {
      const sqlText = JSON.stringify(ast);
      return {
        profileId: this.profile.id,
        body: Object.freeze({ sql: sqlText, params: ctx.params ? [...ctx.params] : [] }),
      };
    },
  };
}

describe('SQL builder joins', () => {
  it('builds a plan with a single inner join', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithPosts, adapter);
    const tables = schema<ContractWithPosts>(context).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    const plan = sql<ContractWithPosts, CodecTypes>({ context })
      .from(tables.user)
      .innerJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
      .select({
        userId: userColumns.id,
        email: userColumns.email,
        postId: postColumns.id,
        title: postColumns.title,
      })
      .build();

    expect((plan.ast as SelectAst | undefined)?.joins).toEqual([
      {
        kind: 'join',
        joinType: 'inner',
        table: { kind: 'table', name: 'post' },
        on: {
          kind: 'eqCol',
          left: createColumnRef('user', 'id'),
          right: createColumnRef('post', 'userId'),
        },
      },
    ]);
  });

  it('builds a plan with chained joins', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithPosts, adapter);
    const tables = schema<ContractWithPosts>(context).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;
    const commentColumns = tables.comment.columns;

    const plan = sql<ContractWithPosts, CodecTypes>({ context })
      .from(tables.user)
      .innerJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
      .leftJoin(tables.comment, (on) => on.eqCol(postColumns.id, commentColumns.postId))
      .select({
        userId: userColumns.id,
        postId: postColumns.id,
        commentId: commentColumns.id,
      })
      .build();

    expect((plan.ast as SelectAst | undefined)?.joins).toBeDefined();
    expect((plan.ast as SelectAst | undefined)?.joins).toEqual([
      {
        kind: 'join',
        joinType: 'inner',
        table: { kind: 'table', name: 'post' },
        on: {
          kind: 'eqCol',
          left: createColumnRef('user', 'id'),
          right: createColumnRef('post', 'userId'),
        },
      },
      {
        kind: 'join',
        joinType: 'left',
        table: { kind: 'table', name: 'comment' },
        on: {
          kind: 'eqCol',
          left: createColumnRef('post', 'id'),
          right: createColumnRef('comment', 'postId'),
        },
      },
    ]);
  });

  it('preserves join order across multiple chained joins', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithPosts, adapter);
    const tables = schema<ContractWithPosts>(context).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;
    const commentColumns = tables.comment.columns;

    const plan = sql<ContractWithPosts, CodecTypes>({ context })
      .from(tables.user)
      .innerJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
      .leftJoin(tables.comment, (on) => on.eqCol(postColumns.id, commentColumns.postId))
      .rightJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
      .fullJoin(tables.comment, (on) => on.eqCol(postColumns.id, commentColumns.postId))
      .select({
        userId: userColumns.id,
      })
      .build();

    expect(
      (plan.ast as SelectAst | undefined)?.joins?.map((j) => ({
        kind: j.kind,
        joinType: j.joinType,
      })),
    ).toEqual([
      { kind: 'join', joinType: 'inner' },
      { kind: 'join', joinType: 'left' },
      { kind: 'join', joinType: 'right' },
      { kind: 'join', joinType: 'full' },
    ]);
  });

  it('works with where clause alongside joins', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithPosts, adapter);
    const tables = schema<ContractWithPosts>(context).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    const plan = sql<ContractWithPosts, CodecTypes>({ context })
      .from(tables.user)
      .innerJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
      .where(userColumns.id.eq(param('userId')))
      .select({
        userId: userColumns.id,
        postId: postColumns.id,
      })
      .build({ params: { userId: 42 } });

    expect((plan.ast as SelectAst | undefined)?.joins).toBeDefined();
    expect((plan.ast as SelectAst | undefined)?.joins).toHaveLength(1);
    const ast = plan.ast as SelectAst;
    expect(ast?.where).toBeDefined();
    expect(plan.params).toEqual([42]);
  });

  it('throws PLAN.INVALID when joining unknown table', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithPosts, adapter);
    const tables = schema<ContractWithPosts>(context).tables;
    const userColumns = tables.user.columns;

    const builder = sql<ContractWithPosts, CodecTypes>({ context }).from(tables.user);

    expect(() =>
      builder.innerJoin({ kind: 'table', name: 'unknown' }, (on) =>
        on.eqCol(userColumns.id, userColumns.id),
      ),
    ).toThrowError(/Unknown table unknown/);
  });

  it('throws PLAN.INVALID when attempting self-join', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithPosts, adapter);
    const tables = schema<ContractWithPosts>(context).tables;
    const userColumns = tables.user.columns;

    const builder = sql<ContractWithPosts, CodecTypes>({ context }).from(tables.user);

    expect(() =>
      builder.innerJoin(tables.user, (on) => on.eqCol(userColumns.id, userColumns.id)),
    ).toThrowError(/Self-joins are not supported in MVP/);
  });

  it('supports all join types', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithPosts, adapter);
    const tables = schema<ContractWithPosts>(context).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    const joinTypes = ['inner', 'left', 'right', 'full'] as const;

    for (const joinType of joinTypes) {
      const builder = sql<ContractWithPosts, CodecTypes>({ context }).from(tables.user);

      const plan =
        joinType === 'inner'
          ? builder.innerJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
          : joinType === 'left'
            ? builder.leftJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
            : joinType === 'right'
              ? builder.rightJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
              : builder.fullJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId));

      const builtPlan = plan.select({ userId: userColumns.id }).build();

      expect((builtPlan.ast as SelectAst | undefined)?.joins?.[0]?.joinType).toBe(joinType);
    }
  });

  it('includes joined tables in meta refs', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithPosts, adapter);
    const tables = schema<ContractWithPosts>(context).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    const plan = sql<ContractWithPosts, CodecTypes>({ context })
      .from(tables.user)
      .innerJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
      .select({
        userId: userColumns.id,
        postId: postColumns.id,
      })
      .build();

    expect(plan.meta.refs?.tables).toContain('user');
    expect(plan.meta.refs?.tables).toContain('post');
    expect(plan.meta.refs?.tables?.length).toBe(2);
  });

  it('includes ON columns in meta refs', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithPosts, adapter);
    const tables = schema<ContractWithPosts>(context).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    const plan = sql<ContractWithPosts, CodecTypes>({ context })
      .from(tables.user)
      .innerJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
      .select({
        userId: userColumns.id,
      })
      .build();

    expect(plan.meta.refs?.columns).toEqual(
      expect.arrayContaining([
        { table: 'user', column: 'id' },
        { table: 'post', column: 'userId' },
      ]),
    );
  });

  it('includes all referenced columns in meta refs (projection, where, orderBy, joins)', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithPosts, adapter);
    const tables = schema<ContractWithPosts>(context).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    const plan = sql<ContractWithPosts, CodecTypes>({ context })
      .from(tables.user)
      .innerJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
      .where(userColumns.email.eq(param('email')))
      .orderBy(postColumns.id.asc())
      .select({
        userId: userColumns.id,
        postId: postColumns.id,
      })
      .build({ params: { email: 'test@example.com' } });

    expect(plan.meta.refs?.columns).toEqual(
      expect.arrayContaining([
        { table: 'user', column: 'id' },
        { table: 'post', column: 'id' },
        { table: 'user', column: 'email' },
        { table: 'post', column: 'userId' },
      ]),
    );
  });

  describe('nested projections with joins', () => {
    it('flattens nested projection over joined columns', () => {
      const adapter = createStubAdapter();
      const context = createTestContext(contractWithPosts, adapter);
      const tables = schema<ContractWithPosts>(context).tables;
      const userColumns = tables.user.columns;
      const postColumns = tables.post.columns;

      const plan = sql<ContractWithPosts, CodecTypes>({ context })
        .from(tables.user)
        .innerJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
        .select({
          name: userColumns.email,
          post: {
            title: postColumns.title,
            id: postColumns.id,
          },
        })
        .build();

      const selectAst = plan.ast as
        | import('@prisma-next/sql-relational-core/ast').SelectAst
        | undefined;
      expect(selectAst?.joins).toBeDefined();
      expect(selectAst?.joins?.length).toBe(1);
      expect((plan.ast as SelectAst | undefined)?.project).toEqual([
        { alias: 'name', expr: createColumnRef('user', 'email') },
        { alias: 'post_title', expr: createColumnRef('post', 'title') },
        { alias: 'post_id', expr: createColumnRef('post', 'id') },
      ]);

      expect(plan.meta.projection).toEqual({
        name: 'user.email',
        post_title: 'post.title',
        post_id: 'post.id',
      });
    });

    it('includes all referenced columns in meta refs for nested projections with joins', () => {
      const adapter = createStubAdapter();
      const context = createTestContext(contractWithPosts, adapter);
      const tables = schema<ContractWithPosts>(context).tables;
      const userColumns = tables.user.columns;
      const postColumns = tables.post.columns;

      const plan = sql<ContractWithPosts, CodecTypes>({ context })
        .from(tables.user)
        .innerJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
        .select({
          userId: userColumns.id,
          post: {
            title: postColumns.title,
            id: postColumns.id,
          },
        })
        .build();

      expect(plan.meta.refs?.tables).toContain('user');
      expect(plan.meta.refs?.tables).toContain('post');
      expect(plan.meta.refs?.columns).toEqual(
        expect.arrayContaining([
          { table: 'user', column: 'id' },
          { table: 'post', column: 'title' },
          { table: 'post', column: 'id' },
          { table: 'post', column: 'userId' },
        ]),
      );
    });

    it('handles multi-level nested projection with joins', () => {
      const adapter = createStubAdapter();
      const context = createTestContext(contractWithPosts, adapter);
      const tables = schema<ContractWithPosts>(context).tables;
      const userColumns = tables.user.columns;
      const postColumns = tables.post.columns;

      const plan = sql<ContractWithPosts, CodecTypes>({ context })
        .from(tables.user)
        .innerJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
        .select({
          user: {
            id: userColumns.id,
            email: userColumns.email,
          },
          post: {
            info: {
              title: postColumns.title,
              id: postColumns.id,
            },
          },
        })
        .build();

      expect((plan.ast as SelectAst | undefined)?.project).toEqual([
        { alias: 'user_id', expr: createColumnRef('user', 'id') },
        { alias: 'user_email', expr: createColumnRef('user', 'email') },
        { alias: 'post_info_title', expr: createColumnRef('post', 'title') },
        { alias: 'post_info_id', expr: createColumnRef('post', 'id') },
      ]);

      expect(plan.meta.projection).toEqual({
        user_id: 'user.id',
        user_email: 'user.email',
        post_info_title: 'post.title',
        post_info_id: 'post.id',
      });
    });
  });
});
