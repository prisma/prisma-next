import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { param } from '../src/param';
import { schema } from '../src/schema';
import { sql } from '../src/sql';
import { validateContract } from '../src/contract';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import type { ParamDescriptor, Adapter, LoweredStatement, SelectAst } from '../src/types';
import { createCodecRegistry } from '@prisma-next/sql-target';
import type { CodecTypes } from './fixtures/contract.d';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string) {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<SqlContract<SqlStorage>>(contractJson);
}

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
      comment: {
        columns: {
          id: { type: 'pg/int4@1', nullable: false },
          postId: { type: 'pg/int4@1', nullable: false },
          content: { type: 'pg/text@1', nullable: false },
        },
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
  const adapter = createStubAdapter();

  it('builds a plan with a single inner join', () => {
    const tables = schema<typeof contractWithPosts, CodecTypes>(contractWithPosts).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    const plan = sql<typeof contractWithPosts, CodecTypes>({ contract: contractWithPosts, adapter })
      .from(tables.user)
      .innerJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
      .select({
        userId: userColumns.id,
        email: userColumns.email,
        postId: postColumns.id,
        title: postColumns.title,
      })
      .build();

    expect(plan.ast?.joins).toBeDefined();
    expect(plan.ast?.joins?.length).toBe(1);
    expect(plan.ast?.joins?.[0]?.joinType).toBe('inner');
    expect(plan.ast?.joins?.[0]?.table.name).toBe('post');
    expect(plan.ast?.joins?.[0]?.on.kind).toBe('eqCol');
    expect(plan.ast?.joins?.[0]?.on.left.table).toBe('user');
    expect(plan.ast?.joins?.[0]?.on.left.column).toBe('id');
    expect(plan.ast?.joins?.[0]?.on.right.table).toBe('post');
    expect(plan.ast?.joins?.[0]?.on.right.column).toBe('userId');
  });

  it('builds a plan with chained joins', () => {
    const tables = schema<typeof contractWithPosts, CodecTypes>(contractWithPosts).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;
    const commentColumns = tables.comment.columns;

    const plan = sql<typeof contractWithPosts, CodecTypes>({ contract: contractWithPosts, adapter })
      .from(tables.user)
      .innerJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
      .leftJoin(tables.comment, (on) => on.eqCol(postColumns.id, commentColumns.postId))
      .select({
        userId: userColumns.id,
        postId: postColumns.id,
        commentId: commentColumns.id,
      })
      .build();

    expect(plan.ast?.joins).toBeDefined();
    expect(plan.ast?.joins?.length).toBe(2);
    expect(plan.ast?.joins?.[0]?.joinType).toBe('inner');
    expect(plan.ast?.joins?.[0]?.table.name).toBe('post');
    expect(plan.ast?.joins?.[1]?.joinType).toBe('left');
    expect(plan.ast?.joins?.[1]?.table.name).toBe('comment');
  });

  it('preserves join order across multiple chained joins', () => {
    const tables = schema<typeof contractWithPosts, CodecTypes>(contractWithPosts).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;
    const commentColumns = tables.comment.columns;

    const plan = sql<typeof contractWithPosts, CodecTypes>({ contract: contractWithPosts, adapter })
      .from(tables.user)
      .innerJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
      .leftJoin(tables.comment, (on) => on.eqCol(postColumns.id, commentColumns.postId))
      .rightJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
      .fullJoin(tables.comment, (on) => on.eqCol(postColumns.id, commentColumns.postId))
      .select({
        userId: userColumns.id,
      })
      .build();

    expect(plan.ast?.joins?.length).toBe(4);
    expect(plan.ast?.joins?.[0]?.joinType).toBe('inner');
    expect(plan.ast?.joins?.[1]?.joinType).toBe('left');
    expect(plan.ast?.joins?.[2]?.joinType).toBe('right');
    expect(plan.ast?.joins?.[3]?.joinType).toBe('full');
  });

  it('works with where clause alongside joins', () => {
    const tables = schema<typeof contractWithPosts, CodecTypes>(contractWithPosts).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    const plan = sql<typeof contractWithPosts, CodecTypes>({ contract: contractWithPosts, adapter })
      .from(tables.user)
      .innerJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
      .where(userColumns.id.eq(param('userId')))
      .select({
        userId: userColumns.id,
        postId: postColumns.id,
      })
      .build({ params: { userId: 42 } });

    expect(plan.ast?.joins).toBeDefined();
    expect(plan.ast?.joins?.length).toBe(1);
    expect(plan.ast?.where).toBeDefined();
    expect(plan.params).toEqual([42]);
  });

  it('throws PLAN.INVALID when joining unknown table', () => {
    const tables = schema<typeof contractWithPosts, CodecTypes>(contractWithPosts).tables;
    const userColumns = tables.user.columns;

    const builder = sql<typeof contractWithPosts, CodecTypes>({
      contract: contractWithPosts,
      adapter,
    }).from(tables.user);

    expect(() =>
      builder.innerJoin({ kind: 'table', name: 'unknown' }, (on) =>
        on.eqCol(userColumns.id, userColumns.id),
      ),
    ).toThrowError(/Unknown table unknown/);
  });

  it('throws PLAN.INVALID when attempting self-join', () => {
    const tables = schema<typeof contractWithPosts, CodecTypes>(contractWithPosts).tables;
    const userColumns = tables.user.columns;

    const builder = sql<typeof contractWithPosts, CodecTypes>({
      contract: contractWithPosts,
      adapter,
    }).from(tables.user);

    expect(() =>
      builder.innerJoin(tables.user, (on) => on.eqCol(userColumns.id, userColumns.id)),
    ).toThrowError(/Self-joins are not supported in MVP/);
  });

  it('supports all join types', () => {
    const tables = schema<typeof contractWithPosts, CodecTypes>(contractWithPosts).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    const joinTypes = ['inner', 'left', 'right', 'full'] as const;

    for (const joinType of joinTypes) {
      const builder = sql<typeof contractWithPosts, CodecTypes>({
        contract: contractWithPosts,
        adapter,
      }).from(tables.user);

      const plan =
        joinType === 'inner'
          ? builder.innerJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
          : joinType === 'left'
            ? builder.leftJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
            : joinType === 'right'
              ? builder.rightJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId))
              : builder.fullJoin(tables.post, (on) => on.eqCol(userColumns.id, postColumns.userId));

      const builtPlan = plan.select({ userId: userColumns.id }).build();

      expect(builtPlan.ast?.joins?.[0]?.joinType).toBe(joinType);
    }
  });

  it('includes joined tables in meta refs', () => {
    const tables = schema<typeof contractWithPosts, CodecTypes>(contractWithPosts).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    const plan = sql<typeof contractWithPosts, CodecTypes>({ contract: contractWithPosts, adapter })
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
    const tables = schema<typeof contractWithPosts, CodecTypes>(contractWithPosts).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    const plan = sql<typeof contractWithPosts, CodecTypes>({ contract: contractWithPosts, adapter })
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
    const tables = schema<typeof contractWithPosts, CodecTypes>(contractWithPosts).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    const plan = sql<typeof contractWithPosts, CodecTypes>({ contract: contractWithPosts, adapter })
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
});
