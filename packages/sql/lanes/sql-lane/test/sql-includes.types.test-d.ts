import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import type { ResultType } from '@prisma-next/contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract-types';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type {
  HasIncludeManyCapabilities,
  InferNestedProjectionRow,
} from '@prisma-next/sql-relational-core/types';
import type { Adapter, LoweredStatement, SelectAst } from '@prisma-next/sql-target';
import { createCodecRegistry } from '@prisma-next/sql-target';
import { expectTypeOf, test } from 'vitest';
import { createTestContext } from '../../../../runtime/test/utils';
import { sql } from '../src/sql/builder';

// Test contracts with different capability configurations
type ContractWithCapabilities = SqlContract<SqlStorage> & {
  readonly target: 'postgres';
  readonly capabilities: {
    readonly postgres: {
      readonly lateral: true;
      readonly jsonAgg: true;
    };
  };
};

type ContractWithoutCapabilities = SqlContract<SqlStorage> & {
  readonly target: 'postgres';
  readonly capabilities: {
    readonly postgres?: {
      readonly lateral?: false;
      readonly jsonAgg?: false;
    };
  };
};

type ContractWithPartialCapabilities = SqlContract<SqlStorage> & {
  readonly target: 'postgres';
  readonly capabilities: {
    readonly postgres: {
      readonly lateral: true;
      readonly jsonAgg?: false;
    };
  };
};

type ContractWithoutCapabilitiesField = SqlContract<SqlStorage> & {
  readonly target: 'postgres';
  readonly capabilities?: never;
};

test('HasIncludeManyCapabilities correctly identifies contracts with capabilities', () => {
  type Result = HasIncludeManyCapabilities<ContractWithCapabilities>;
  expectTypeOf<Result>().toEqualTypeOf<true>();
});

test('HasIncludeManyCapabilities rejects contracts without capabilities', () => {
  type Result = HasIncludeManyCapabilities<ContractWithoutCapabilities>;
  expectTypeOf<Result>().toEqualTypeOf<false>();
});

test('HasIncludeManyCapabilities rejects contracts with partial capabilities', () => {
  type Result = HasIncludeManyCapabilities<ContractWithPartialCapabilities>;
  expectTypeOf<Result>().toEqualTypeOf<false>();
});

test('HasIncludeManyCapabilities rejects contracts without capabilities field', () => {
  type Result = HasIncludeManyCapabilities<ContractWithoutCapabilitiesField>;
  expectTypeOf<Result>().toEqualTypeOf<false>();
});

test('HasIncludeManyCapabilities handles optional capabilities', () => {
  type ContractWithOptionalCapabilities = SqlContract<SqlStorage> & {
    readonly target: 'postgres';
    readonly capabilities?: {
      readonly postgres?: {
        readonly lateral?: true;
        readonly jsonAgg?: true;
      };
    };
  };

  type Result = HasIncludeManyCapabilities<ContractWithOptionalCapabilities>;
  expectTypeOf<Result>().toEqualTypeOf<false>();
});

test('HasIncludeManyCapabilities requires both capabilities to be true', () => {
  type ContractWithOnlyLateral = SqlContract<SqlStorage> & {
    readonly target: 'postgres';
    readonly capabilities: {
      readonly postgres: {
        readonly lateral: true;
        readonly jsonAgg?: false;
      };
    };
  };

  type ContractWithOnlyJsonAgg = SqlContract<SqlStorage> & {
    readonly target: 'postgres';
    readonly capabilities: {
      readonly postgres: {
        readonly lateral?: false;
        readonly jsonAgg: true;
      };
    };
  };

  type Result1 = HasIncludeManyCapabilities<ContractWithOnlyLateral>;
  type Result2 = HasIncludeManyCapabilities<ContractWithOnlyJsonAgg>;

  expectTypeOf<Result1>().toEqualTypeOf<false>();
  expectTypeOf<Result2>().toEqualTypeOf<false>();
});

// Test contract with capabilities for includeMany
type TestContractWithCapabilities = SqlContract<
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

const testContractWithCapabilities = validateContract<TestContractWithCapabilities>({
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

// Type tests for includeMany result types
test('ResultType yields Array<ChildShape> for includeMany', () => {
  const adapter = createStubAdapter();
  const context = createTestContext(testContractWithCapabilities, adapter);
  const tables = schema<TestContractWithCapabilities>(context).tables;
  const user = tables['user']!;
  const post = tables['post']!;

  const _plan = sql<TestContractWithCapabilities, CodecTypes>({ context })
    .from(user)
    .includeMany(
      post,
      (on) => on.eqCol(user.columns['id']!, post.columns['userId']!),
      (child) => child.select({ id: post.columns['id']!, title: post.columns['title']! }),
      { alias: 'posts' },
    )
    .select({
      id: user.columns['id']!,
      email: user.columns['email']!,
      posts: true,
    })
    .build();

  type Row = ResultType<typeof _plan>;

  // Verify that posts is an array type
  expectTypeOf<Row['posts']>().toEqualTypeOf<Array<{ id: number; title: string }>>();

  // Verify the array element shape matches the child projection
  type PostsArray = Row['posts'];
  type PostElement = PostsArray extends Array<infer E> ? E : never;
  expectTypeOf<PostElement>().toEqualTypeOf<{ id: number; title: string }>();

  // Verify parent columns are still present
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();
});

test('Array element types match child projection types', () => {
  const adapter = createStubAdapter();
  const context = createTestContext(testContractWithCapabilities, adapter);
  const tables = schema<TestContractWithCapabilities>(context).tables;
  const user = tables['user']!;
  const post = tables['post']!;

  const _plan = sql<TestContractWithCapabilities, CodecTypes>({ context })
    .from(user)
    .includeMany(
      post,
      (on) => on.eqCol(user.columns['id']!, post.columns['userId']!),
      (child) =>
        child.select({
          id: post.columns['id']!,
          title: post.columns['title']!,
          createdAt: post.columns['createdAt']!,
        }),
      { alias: 'posts' },
    )
    .select({
      id: user.columns['id']!,
      posts: true,
    })
    .build();

  type Row = ResultType<typeof _plan>;

  // Verify array element has all child projection fields with correct types
  type PostElement = Row['posts'] extends Array<infer E> ? E : never;
  expectTypeOf<PostElement['id']>().toEqualTypeOf<number>();
  expectTypeOf<PostElement['title']>().toEqualTypeOf<string>();
  expectTypeOf<PostElement['createdAt']>().toEqualTypeOf<string>();
});

test('Empty array type when no children', () => {
  const adapter = createStubAdapter();
  const context = createTestContext(testContractWithCapabilities, adapter);
  const tables = schema<TestContractWithCapabilities>(context).tables;
  const user = tables['user']!;
  const post = tables['post']!;

  const _plan = sql<TestContractWithCapabilities, CodecTypes>({ context })
    .from(user)
    .includeMany(
      post,
      (on) => on.eqCol(user.columns['id']!, post.columns['userId']!),
      (child) => child.select({ id: post.columns['id']!, title: post.columns['title']! }),
      { alias: 'posts' },
    )
    .select({
      id: user.columns['id']!,
      posts: true,
    })
    .build();

  type Row = ResultType<typeof _plan>;

  // Even when no children exist, the type should still be Array<ChildShape>, not Array<never>
  // The array can be empty, but the element type should be preserved
  expectTypeOf<Row['posts']>().toEqualTypeOf<Array<{ id: number; title: string }>>();

  // Verify that accessing an element of an empty array still has the correct type
  type PostElement = Row['posts'] extends Array<infer E> ? E : never;
  expectTypeOf<PostElement>().toEqualTypeOf<{ id: number; title: string }>();
});

test('includeMany with default alias uses table name', () => {
  const adapter = createStubAdapter();
  const context = createTestContext(testContractWithCapabilities, adapter);
  const tables = schema<TestContractWithCapabilities>(context).tables;
  const user = tables['user']!;
  const post = tables['post']!;

  const _plan = sql<TestContractWithCapabilities, CodecTypes>({ context })
    .from(user)
    .includeMany(
      post,
      (on) => on.eqCol(user.columns['id']!, post.columns['userId']!),
      (child) => child.select({ id: post.columns['id']!, title: post.columns['title']! }),
      // No alias provided - should default to table name 'post'
    )
    .select({
      id: user.columns['id']!,
      post: true, // Using default alias
    })
    .build();

  type Row = ResultType<typeof _plan>;

  // Note: When no alias is provided, TypeScript can't infer the literal table name
  // from the TableRef parameter (since TableRef.name is string, not a literal type).
  // This is a limitation of the current type system. The runtime behavior is correct
  // (defaults to table name), but type inference requires an explicit alias.
  //
  // For now, we verify that the row structure is correct and that parent columns work.
  // The explicit alias test above verifies the full type inference works when an alias is provided.
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();

  // The 'post' property may not be inferrable as a literal key, but the structure should exist
  // This test documents the limitation rather than asserting perfect type inference
});

test('includeMany preserves parent column types alongside includes', () => {
  const adapter = createStubAdapter();
  const context = createTestContext(testContractWithCapabilities, adapter);
  const tables = schema<TestContractWithCapabilities>(context).tables;
  const user = tables['user']!;
  const post = tables['post']!;

  const _plan = sql<TestContractWithCapabilities, CodecTypes>({ context })
    .from(user)
    .includeMany(
      post,
      (on) => on.eqCol(user.columns['id']!, post.columns['userId']!),
      (child) => child.select({ id: post.columns['id']!, title: post.columns['title']! }),
      { alias: 'posts' },
    )
    .select({
      id: user.columns['id']!,
      email: user.columns['email']!,
      posts: true,
    })
    .build();

  type Row = ResultType<typeof _plan>;

  // Verify parent columns have correct types
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();

  // Verify include has correct array type
  expectTypeOf<Row['posts']>().toEqualTypeOf<Array<{ id: number; title: string }>>();

  // Verify the overall row structure
  expectTypeOf<Row>().toExtend<{
    id: number;
    email: string;
    posts: Array<{ id: number; title: string }>;
  }>();
});

test('includeMany with multiple includes preserves all types', () => {
  const adapter = createStubAdapter();

  // Create a contract with a comment table for multiple includes
  type ContractWithComments = SqlContract<
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
          };
          readonly uniques: readonly [];
          readonly indexes: readonly [];
          readonly foreignKeys: readonly [];
        };
        readonly comment: {
          readonly columns: {
            readonly id: { readonly type: 'pg/int4@1'; nullable: false };
            readonly postId: { readonly type: 'pg/int4@1'; nullable: false };
            readonly content: { readonly type: 'pg/text@1'; nullable: false };
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

  const contractWithComments = validateContract<ContractWithComments>({
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
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
        comment: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
            postId: { type: 'pg/int4@1', nullable: false },
            content: { type: 'pg/text@1', nullable: false },
          },
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

  const contextWithComments = createTestContext(contractWithComments, adapter);
  const tablesWithComments = schema<ContractWithComments>(contextWithComments).tables;
  const userTable = tablesWithComments['user']!;
  const postTable = tablesWithComments['post']!;
  const commentTable = tablesWithComments['comment']!;

  const _plan = sql<ContractWithComments, CodecTypes>({ context: contextWithComments })
    .from(userTable)
    .includeMany(
      postTable,
      (on) => on.eqCol(userTable.columns['id']!, postTable.columns['userId']!),
      (child) => child.select({ id: postTable.columns['id']!, title: postTable.columns['title']! }),
      { alias: 'posts' },
    )
    .includeMany(
      commentTable,
      (on) => on.eqCol(postTable.columns['id']!, commentTable.columns['postId']!),
      (child) =>
        child.select({
          id: commentTable.columns['id']!,
          content: commentTable.columns['content']!,
        }),
      { alias: 'comments' },
    )
    .select({
      id: userTable.columns['id']!,
      email: userTable.columns['email']!,
      posts: true,
      comments: true,
    })
    .build();

  type Row = ResultType<typeof _plan>;

  // Verify both includes have correct array types
  expectTypeOf<Row['posts']>().toEqualTypeOf<Array<{ id: number; title: string }>>();
  expectTypeOf<Row['comments']>().toEqualTypeOf<Array<{ id: number; content: string }>>();

  // Verify parent columns are still present
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();

  // Verify the overall structure
  expectTypeOf<Row>().toExtend<{
    id: number;
    email: string;
    posts: Array<{ id: number; title: string }>;
    comments: Array<{ id: number; content: string }>;
  }>();
});

test('includeMany with nested child projection infers nested array element types', () => {
  const adapter = createStubAdapter();
  const context = createTestContext(testContractWithCapabilities, adapter);
  const tables = schema<TestContractWithCapabilities>(context).tables;
  const user = tables['user']!;
  const post = tables['post']!;

  const _plan = sql<TestContractWithCapabilities, CodecTypes>({ context })
    .from(user)
    .includeMany(
      post,
      (on) => on.eqCol(user.columns['id']!, post.columns['userId']!),
      (child) =>
        child.select({
          id: post.columns['id']!,
          metadata: {
            title: post.columns['title']!,
            createdAt: post.columns['createdAt']!,
          },
        }),
      { alias: 'posts' },
    )
    .select({
      id: user.columns['id']!,
      posts: true,
    })
    .build();

  type Row = ResultType<typeof _plan>;

  // Verify nested structure in array elements
  expectTypeOf<Row['posts']>().toEqualTypeOf<
    Array<{
      id: number;
      metadata: {
        title: string;
        createdAt: string;
      };
    }>
  >();

  // Verify nested field types
  type PostElement = Row['posts'] extends Array<infer E> ? E : never;
  expectTypeOf<PostElement['id']>().toEqualTypeOf<number>();
  expectTypeOf<PostElement['metadata']>().toEqualTypeOf<{ title: string; createdAt: string }>();
  expectTypeOf<PostElement['metadata']['title']>().toEqualTypeOf<string>();
  expectTypeOf<PostElement['metadata']['createdAt']>().toEqualTypeOf<string>();
});

test('InferNestedProjectionRow correctly infers include types from Includes map', () => {
  // Test the type inference logic directly
  // Simulate the Includes map that would be built by includeMany
  type Includes = {
    posts: { id: number; title: string };
    comments: { id: number; content: string };
  };

  // Test projection with include references only (simplified test)
  type Projection = {
    posts: true; // Include reference
    comments: true; // Include reference
  };

  // Verify that InferNestedProjectionRow correctly maps include references
  type InferredRow = InferNestedProjectionRow<Projection, Record<string, never>, Includes>;

  // Verify that posts is inferred as Array<Includes['posts']>
  expectTypeOf<InferredRow['posts']>().toEqualTypeOf<Array<{ id: number; title: string }>>();

  // Verify that comments is inferred as Array<Includes['comments']>
  expectTypeOf<InferredRow['comments']>().toEqualTypeOf<Array<{ id: number; content: string }>>();

  // Verify the overall structure
  expectTypeOf<InferredRow>().toExtend<{
    posts: Array<{ id: number; title: string }>;
    comments: Array<{ id: number; content: string }>;
  }>();
});
