import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import type { Adapter, LoweredStatement, SelectAst } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';

// Define CodecTypes type for contract mappings
type CodecTypes = Record<string, { readonly output: unknown }>;

// Define a fully-typed contract type with capabilities
type ContractWithCapabilities = SqlContract<
  {
    readonly tables: {
      readonly user: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            readonly nullable: false;
          };
          readonly email: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
            readonly nullable: false;
          };
        };
        readonly uniques: readonly [];
        readonly indexes: readonly [];
        readonly foreignKeys: readonly [];
      };
      readonly post: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            readonly nullable: false;
          };
          readonly userId: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            readonly nullable: false;
          };
          readonly title: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
            readonly nullable: false;
          };
          readonly createdAt: {
            readonly nativeType: 'timestamptz';
            readonly codecId: 'pg/timestamptz@1';
            readonly nullable: false;
          };
        };
        readonly uniques: readonly [];
        readonly indexes: readonly [];
        readonly foreignKeys: readonly [];
      };
    };
  },
  Record<string, never>,
  Record<string, never>,
  {
    readonly codecTypes: CodecTypes;
    readonly operationTypes: Record<string, Record<string, unknown>>;
  }
> & {
  readonly capabilities: {
    readonly postgres: {
      readonly lateral: true;
      readonly jsonAgg: true;
    };
  };
};

const contractWithCapabilities = validateContract<ContractWithCapabilities>({
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
          createdAt: { nativeType: 'timestamptz', codecId: 'pg/timestamptz@1', nullable: false },
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
    codecTypes: {} as CodecTypes,
    operationTypes: {},
  },
  capabilities: {
    postgres: {
      lateral: true,
      jsonAgg: true,
    },
  },
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

describe('SQL builder includeMany', () => {
  function setupIncludeTest() {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithCapabilities, adapter);
    const tables = schema<ContractWithCapabilities>(context).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;
    return { adapter, context, tables, userColumns, postColumns };
  }

  it('builds a plan with includeMany using default alias', () => {
    const { context, tables, userColumns, postColumns } = setupIncludeTest();

    const plan = sql<ContractWithCapabilities>({ context })
      .from(tables.user)
      .includeMany(
        tables.post,
        (on) => on.eqCol(userColumns.id, postColumns.userId),
        (child) => child.select({ id: postColumns.id, title: postColumns.title }),
      )
      .select({
        id: userColumns.id,
        email: userColumns.email,
        post: true,
      })
      .build();

    const ast = plan.ast as SelectAst;
    const includeJoin = ast.joins?.find(
      (join) => join.lateral && join.source.kind === 'derivedTable' && join.source.alias === 'post_lateral',
    );
    expect(includeJoin).toBeDefined();
    if (includeJoin?.source.kind === 'derivedTable') {
      const includeProjection = includeJoin.source.query.project[0];
      expect(includeProjection?.expr.kind).toBe('jsonArrayAgg');
      if (includeProjection?.expr.kind === 'jsonArrayAgg') {
        expect(includeProjection.expr.onEmpty).toBe('emptyArray');
        expect(includeProjection.expr.expr.kind).toBe('jsonObject');
      }
    }
    const postsProjection = ast.project.find((item) => item.alias === 'post');
    expect(postsProjection?.expr).toMatchObject({
      kind: 'col',
      table: 'post_lateral',
      column: 'post',
    });
  });

  it('builds a plan with includeMany using custom alias', () => {
    const { context, tables, userColumns, postColumns } = setupIncludeTest();

    const plan = sql<ContractWithCapabilities>({ context })
      .from(tables.user)
      .includeMany(
        tables.post,
        (on) => on.eqCol(userColumns.id, postColumns.userId),
        (child) => child.select({ id: postColumns.id, title: postColumns.title }),
        { alias: 'posts' },
      )
      .select({
        id: userColumns.id,
        email: userColumns.email,
        posts: true,
      })
      .build();

    const ast = plan.ast as SelectAst;
    const includeJoin = ast.joins?.find(
      (join) =>
        join.lateral && join.source.kind === 'derivedTable' && join.source.alias === 'posts_lateral',
    );
    expect(includeJoin).toBeDefined();
  });

  it('builds a plan with includeMany with child where clause', () => {
    const { context, tables, userColumns, postColumns } = setupIncludeTest();

    const plan = sql<ContractWithCapabilities>({ context })
      .from(tables.user)
      .includeMany(
        tables.post,
        (on) => on.eqCol(userColumns.id, postColumns.userId),
        (child) =>
          child
            .select({ id: postColumns.id, title: postColumns.title })
            .where(postColumns.title.eq(param('title'))),
        { alias: 'posts' },
      )
      .select({
        id: userColumns.id,
        posts: true,
      })
      .build({ params: { title: 'Test' } });

    const ast = plan.ast as SelectAst;
    const includeJoin = ast.joins?.find(
      (join) =>
        join.lateral && join.source.kind === 'derivedTable' && join.source.alias === 'posts_lateral',
    );
    expect(includeJoin?.source.kind).toBe('derivedTable');
    if (includeJoin?.source.kind === 'derivedTable') {
      const rowsQuery = includeJoin.source.query.from;
      expect(rowsQuery.kind).toBe('derivedTable');
      if (rowsQuery.kind === 'derivedTable') {
        expect(rowsQuery.query.where?.kind).toBe('and');
      }
    }
  });

  it('builds a plan with includeMany with child orderBy clause', () => {
    const { context, tables, userColumns, postColumns } = setupIncludeTest();

    const plan = sql<ContractWithCapabilities>({ context })
      .from(tables.user)
      .includeMany(
        tables.post,
        (on) => on.eqCol(userColumns.id, postColumns.userId),
        (child) =>
          child
            .select({ id: postColumns.id, title: postColumns.title })
            .orderBy(postColumns.createdAt.desc()),
        { alias: 'posts' },
      )
      .select({
        id: userColumns.id,
        posts: true,
      })
      .build();

    const ast = plan.ast as SelectAst;
    const includeJoin = ast.joins?.find(
      (join) =>
        join.lateral && join.source.kind === 'derivedTable' && join.source.alias === 'posts_lateral',
    );
    expect(includeJoin?.source.kind).toBe('derivedTable');
    if (includeJoin?.source.kind === 'derivedTable') {
      const includeProjection = includeJoin.source.query.project[0];
      expect(includeProjection?.expr.kind).toBe('jsonArrayAgg');
      if (includeProjection?.expr.kind === 'jsonArrayAgg') {
        expect(includeProjection.expr.orderBy).toEqual([
          {
            expr: { kind: 'col', table: 'posts__rows', column: 'posts__order_0' },
            dir: 'desc',
          },
        ]);
      }
      const rowsQuery = includeJoin.source.query.from;
      expect(rowsQuery.kind).toBe('derivedTable');
      if (rowsQuery.kind === 'derivedTable') {
        expect(rowsQuery.query.orderBy?.[0]?.dir).toBe('desc');
        expect(rowsQuery.query.project.map((item) => item.alias)).toContain('posts__order_0');
      }
    }
  });

  it('builds a plan with includeMany with child limit clause', () => {
    const { context, tables, userColumns, postColumns } = setupIncludeTest();

    const plan = sql<ContractWithCapabilities>({ context })
      .from(tables.user)
      .includeMany(
        tables.post,
        (on) => on.eqCol(userColumns.id, postColumns.userId),
        (child) => child.select({ id: postColumns.id, title: postColumns.title }).limit(10),
        { alias: 'posts' },
      )
      .select({
        id: userColumns.id,
        posts: true,
      })
      .build();

    const ast = plan.ast as SelectAst;
    const includeJoin = ast.joins?.find(
      (join) =>
        join.lateral && join.source.kind === 'derivedTable' && join.source.alias === 'posts_lateral',
    );
    expect(includeJoin?.source.kind).toBe('derivedTable');
    if (includeJoin?.source.kind === 'derivedTable') {
      const rowsQuery = includeJoin.source.query.from;
      expect(rowsQuery.kind).toBe('derivedTable');
      if (rowsQuery.kind === 'derivedTable') {
        expect(rowsQuery.query.limit).toBe(10);
      }
    }
  });

  it('builds a plan with includeMany with all optional fields (where, orderBy, limit)', () => {
    const { context, tables, userColumns, postColumns } = setupIncludeTest();

    const plan = sql<ContractWithCapabilities>({ context })
      .from(tables.user)
      .includeMany(
        tables.post,
        (on) => on.eqCol(userColumns.id, postColumns.userId),
        (child) =>
          child
            .select({ id: postColumns.id, title: postColumns.title })
            .where(postColumns.title.eq(param('title')))
            .orderBy(postColumns.createdAt.desc())
            .limit(5),
        { alias: 'posts' },
      )
      .select({
        id: userColumns.id,
        posts: true,
      })
      .build({ params: { title: 'Test' } });

    const ast = plan.ast as SelectAst;
    const includeJoin = ast.joins?.find(
      (join) =>
        join.lateral && join.source.kind === 'derivedTable' && join.source.alias === 'posts_lateral',
    );
    expect(includeJoin?.source.kind).toBe('derivedTable');
    if (includeJoin?.source.kind === 'derivedTable') {
      const includeProjection = includeJoin.source.query.project[0];
      expect(includeProjection?.expr.kind).toBe('jsonArrayAgg');
      if (includeProjection?.expr.kind === 'jsonArrayAgg') {
        expect(includeProjection.expr.orderBy).toEqual([
          {
            expr: { kind: 'col', table: 'posts__rows', column: 'posts__order_0' },
            dir: 'desc',
          },
        ]);
      }
      const rowsQuery = includeJoin.source.query.from;
      expect(rowsQuery.kind).toBe('derivedTable');
      if (rowsQuery.kind === 'derivedTable') {
        expect(rowsQuery.query.where?.kind).toBe('and');
        expect(rowsQuery.query.orderBy?.[0]?.dir).toBe('desc');
        expect(rowsQuery.query.limit).toBe(5);
        expect(rowsQuery.query.project.map((item) => item.alias)).toContain('posts__order_0');
      }
    }
  });
});
