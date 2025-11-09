import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type {
  Adapter,
  LoweredStatement,
  SelectAst,
  SqlContract,
  SqlStorage,
} from '@prisma-next/sql-target';
import { createCodecRegistry } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { createTestContext } from '../../runtime/test/utils';
import { param } from '../src/param';
import { schema } from '../src/schema';
import { sql } from '../src/sql';
import type { CodecTypes } from './fixtures/contract.d';

// Define a fully-typed contract type with capabilities
type ContractWithCapabilities = SqlContract<
  {
    readonly tables: {
      readonly user: {
        readonly columns: {
          readonly id: { readonly type: 'pg/int4@1'; nullable: false };
          readonly email: { readonly type: 'pg/text@1'; nullable: false };
        };
        readonly uniques: readonly [];
        readonly indexes: readonly [];
        readonly foreignKeys: readonly [];
      };
      readonly post: {
        readonly columns: {
          readonly id: { readonly type: 'pg/int4@1'; nullable: false };
          readonly userId: { readonly type: 'pg/int4@1'; nullable: false };
          readonly title: { readonly type: 'pg/text@1'; nullable: false };
          readonly createdAt: { readonly type: 'pg/timestamptz@1'; nullable: false };
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
  coreHash: 'sha256:test-core',
  profileHash: 'sha256:test-profile',
  storage: {
    tables: {
      user: {
        columns: {
          id: { type: 'pg/int4@1', nullable: false },
          email: { type: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
      post: {
        columns: {
          id: { type: 'pg/int4@1', nullable: false },
          userId: { type: 'pg/int4@1', nullable: false },
          title: { type: 'pg/text@1', nullable: false },
          createdAt: { type: 'pg/timestamptz@1', nullable: false },
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
  it('builds a plan with includeMany using default alias', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithCapabilities, adapter);
    const tables = schema<ContractWithCapabilities>(context).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    const plan = sql<ContractWithCapabilities, CodecTypes>({ context })
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
    expect(ast?.includes).toBeDefined();
    expect(ast?.includes?.length).toBe(1);
    expect(ast?.includes?.[0]?.kind).toBe('includeMany');
    expect(ast?.includes?.[0]?.alias).toBe('post');
    expect(ast?.includes?.[0]?.child.table.name).toBe('post');
    expect(ast?.includes?.[0]?.child.project.length).toBe(2);
  });

  it('builds a plan with includeMany using custom alias', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithCapabilities, adapter);
    const tables = schema<ContractWithCapabilities>(context).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    const plan = sql<ContractWithCapabilities, CodecTypes>({ context })
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
    expect(ast?.includes).toBeDefined();
    expect(ast?.includes?.length).toBe(1);
    expect(ast?.includes?.[0]?.alias).toBe('posts');
  });

  it('builds a plan with includeMany with child where clause', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithCapabilities, adapter);
    const tables = schema<ContractWithCapabilities>(context).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    const plan = sql<ContractWithCapabilities, CodecTypes>({ context })
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
    expect(ast?.includes?.[0]?.child.where).toBeDefined();
    expect(ast?.includes?.[0]?.child.where?.kind).toBe('bin');
  });

  it('builds a plan with includeMany with child orderBy clause', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithCapabilities, adapter);
    const tables = schema<ContractWithCapabilities>(context).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    const plan = sql<ContractWithCapabilities, CodecTypes>({ context })
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
    expect(ast?.includes?.[0]?.child.orderBy).toBeDefined();
    expect(ast?.includes?.[0]?.child.orderBy?.length).toBe(1);
    expect(ast?.includes?.[0]?.child.orderBy?.[0]?.dir).toBe('desc');
  });

  it('builds a plan with includeMany with child limit clause', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithCapabilities, adapter);
    const tables = schema<ContractWithCapabilities>(context).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    const plan = sql<ContractWithCapabilities, CodecTypes>({ context })
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
    expect(ast?.includes?.[0]?.child.limit).toBe(10);
  });
});
