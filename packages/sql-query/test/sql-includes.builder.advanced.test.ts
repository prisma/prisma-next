import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { createCodecRegistry } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { validateContract } from '../src/contract';
import { schema } from '../src/schema';
import { sql } from '../src/sql';
import type { Adapter, LoweredStatement, SelectAst } from '@prisma-next/sql-target';
import type { CodecTypes } from './fixtures/contract.d';
import { createTestContext } from '../../runtime/test/utils';

// Define a fully-typed contract type with capabilities
type ContractWithCapabilities = SqlContract<
  {
    readonly tables: {
      readonly user: {
        readonly columns: {
          readonly id: { readonly type: 'pg/int4@1'; nullable: false };
          readonly email: { readonly type: 'pg/text@1'; nullable: false };
        };
      };
      readonly post: {
        readonly columns: {
          readonly id: { readonly type: 'pg/int4@1'; nullable: false };
          readonly userId: { readonly type: 'pg/int4@1'; nullable: false };
          readonly title: { readonly type: 'pg/text@1'; nullable: false };
          readonly createdAt: { readonly type: 'pg/timestamptz@1'; nullable: false };
        };
      };
    };
  },
  Record<string, never>,
  Record<string, never>,
  Record<string, never>
> & {
  readonly capabilities: {
    readonly postgres: {
      readonly lateral: true;
      readonly jsonAgg: true;
    };
  };
};

// Define a contract without capabilities
type ContractWithoutCapabilities = SqlContract<
  {
    readonly tables: {
      readonly user: {
        readonly columns: {
          readonly id: { readonly type: 'pg/int4@1'; nullable: false };
          readonly email: { readonly type: 'pg/text@1'; nullable: false };
        };
      };
      readonly post: {
        readonly columns: {
          readonly id: { readonly type: 'pg/int4@1'; nullable: false };
          readonly userId: { readonly type: 'pg/int4@1'; nullable: false };
          readonly title: { readonly type: 'pg/text@1'; nullable: false };
        };
      };
    };
  },
  Record<string, never>,
  Record<string, never>,
  Record<string, never>
> & {
  readonly capabilities?: {
    readonly postgres?: {
      readonly lateral?: false;
      readonly jsonAgg?: false;
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
  mappings: {},
  capabilities: {
    postgres: {
      lateral: true,
      jsonAgg: true,
    },
  },
});

const contractWithoutCapabilities = validateContract<ContractWithoutCapabilities>({
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
  capabilities: {},
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
  const adapter = createStubAdapter();

  it('throws error when child projection is empty', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithCapabilities, adapter);
    const tables = schema<ContractWithCapabilities, CodecTypes>(context).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    expect(() => {
      sql<ContractWithCapabilities, CodecTypes>({ context })
        .from(tables.user)
        .includeMany(
          tables.post,
          (on) => on.eqCol(userColumns.id, postColumns.userId),
          (child) => child.select({}),
          { alias: 'posts' },
        )
        .select({
          id: userColumns.id,
          posts: true,
        })
        .build();
    }).toThrow();
  });

  it('throws error on alias collision', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithCapabilities, adapter);
    const tables = schema<ContractWithCapabilities, CodecTypes>(context).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    expect(() => {
      sql<ContractWithCapabilities, CodecTypes>({ context })
        .from(tables.user)
        .includeMany(
          tables.post,
          (on) => on.eqCol(userColumns.id, postColumns.userId),
          (child) => child.select({ id: postColumns.id }),
          { alias: 'id' },
        )
        .select({
          id: userColumns.id,
          posts: true,
        })
        .build();
    }).toThrow();
  });

  it('throws error when ON condition uses same table', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithCapabilities, adapter);
    const tables = schema<ContractWithCapabilities, CodecTypes>(context).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    expect(() => {
      sql<ContractWithCapabilities, CodecTypes>({ context })
        .from(tables.user)
        .includeMany(
          tables.post,
          (on) => on.eqCol(userColumns.id, userColumns.id),
          (child) => child.select({ id: postColumns.id }),
          { alias: 'posts' },
        )
        .select({
          id: userColumns.id,
          posts: true,
        })
        .build();
    }).toThrow();
  });

  it('throws error when capabilities are missing at runtime', () => {
    const adapterWithoutCaps = createStubAdapter();
    const contextWithoutCaps = createTestContext(contractWithoutCapabilities, adapterWithoutCaps);
    const tables = schema<ContractWithoutCapabilities, CodecTypes>(contextWithoutCaps).tables;
    const userColumns = tables.user.columns;
    const postColumns = tables.post.columns;

    expect(() => {
      sql<ContractWithoutCapabilities, CodecTypes>({ context: contextWithoutCaps })
        .from(tables.user)
        .includeMany(
          tables.post,
          (on) => on.eqCol(userColumns.id, postColumns.userId),
          (child) => child.select({ id: postColumns.id }),
          { alias: 'posts' },
        )
        .select({
          id: userColumns.id,
          posts: true,
        })
        .build();
    }).toThrow();
  });

  it('includes child table in meta.refs.tables', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithCapabilities, adapter);
    const tables = schema<ContractWithCapabilities, CodecTypes>(context).tables;
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
        posts: true,
      })
      .build();

    expect(plan.meta.refs?.tables).toContain('user');
    expect(plan.meta.refs?.tables).toContain('post');
  });

  it('includes child columns in meta.refs.columns', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithCapabilities, adapter);
    const tables = schema<ContractWithCapabilities, CodecTypes>(context).tables;
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
        posts: true,
      })
      .build();

    const refsColumns = plan.meta.refs?.columns ?? [];
    const postIdRef = refsColumns.find((ref) => ref.table === 'post' && ref.column === 'id');
    const postTitleRef = refsColumns.find((ref) => ref.table === 'post' && ref.column === 'title');
    expect(postIdRef).toBeDefined();
    expect(postTitleRef).toBeDefined();
  });

  it('marks include alias in meta.projection with special marker', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithCapabilities, adapter);
    const tables = schema<ContractWithCapabilities, CodecTypes>(context).tables;
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
        posts: true,
      })
      .build();

    const projection = plan.meta.projection;
    if (projection && typeof projection === 'object' && !Array.isArray(projection)) {
      expect((projection as Record<string, string>)['posts']).toBe('include:posts');
    }
  });

  it('does not add codec entries for includes in meta.annotations.codecs', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contractWithCapabilities, adapter);
    const tables = schema<ContractWithCapabilities, CodecTypes>(context).tables;
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
        posts: true,
      })
      .build();

    const codecs = plan.meta.annotations?.codecs;
    if (codecs) {
      expect(codecs['posts']).toBeUndefined();
      expect(codecs['id']).toBeDefined();
    }
  });
});
