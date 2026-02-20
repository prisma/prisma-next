import type { ExecutionPlan } from '@prisma-next/contract/types';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { SqlContract, StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
import type { RuntimeQueryable } from '../src/types';

// ---- helpers to build a minimal contract for tests ----

function col(nativeType: string, codecId: string, nullable = false): StorageColumn {
  return { nativeType, codecId, nullable };
}

function table(columns: Record<string, StorageColumn>, pk?: string[]): StorageTable {
  const base = {
    columns,
    uniques: [] as const,
    indexes: [] as const,
    foreignKeys: [] as const,
  };
  if (pk) {
    return { ...base, primaryKey: { columns: pk } };
  }
  return base;
}

export type TestContract = SqlContract<
  {
    tables: {
      users: StorageTable;
      posts: StorageTable;
      comments: StorageTable;
      profiles: StorageTable;
    };
  },
  {
    User: {
      storage: { table: 'users' };
      fields: {
        id: { column: 'id' };
        name: { column: 'name' };
        email: { column: 'email' };
      };
      relations: Record<string, never>;
    };
    Post: {
      storage: { table: 'posts' };
      fields: {
        id: { column: 'id' };
        title: { column: 'title' };
        userId: { column: 'user_id' };
        views: { column: 'views' };
      };
      relations: Record<string, never>;
    };
    Comment: {
      storage: { table: 'comments' };
      fields: {
        id: { column: 'id' };
        body: { column: 'body' };
        postId: { column: 'post_id' };
      };
      relations: Record<string, never>;
    };
    Profile: {
      storage: { table: 'profiles' };
      fields: {
        id: { column: 'id' };
        userId: { column: 'user_id' };
        bio: { column: 'bio' };
      };
      relations: Record<string, never>;
    };
  },
  {
    users: {
      posts: {
        to: 'Post';
        cardinality: '1:N';
        on: {
          parentCols: ['id'];
          childCols: ['user_id'];
        };
      };
      profile: {
        to: 'Profile';
        cardinality: '1:1';
        on: {
          parentCols: ['id'];
          childCols: ['user_id'];
        };
      };
    };
    posts: {
      comments: {
        to: 'Comment';
        cardinality: '1:N';
        on: {
          parentCols: ['id'];
          childCols: ['post_id'];
        };
      };
      author: {
        to: 'User';
        cardinality: 'N:1';
        on: {
          parentCols: ['user_id'];
          childCols: ['id'];
        };
      };
    };
    comments: Record<string, never>;
    profiles: Record<string, never>;
  }
>;

export function createTestContract(): TestContract {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: 'sha256:test',
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
    storage: {
      tables: {
        users: table(
          {
            id: col('int4', 'pg/int4@1'),
            name: col('text', 'pg/text@1'),
            email: col('text', 'pg/text@1'),
          },
          ['id'],
        ),
        posts: table(
          {
            id: col('int4', 'pg/int4@1'),
            title: col('text', 'pg/text@1'),
            user_id: col('int4', 'pg/int4@1'),
            views: col('int4', 'pg/int4@1'),
          },
          ['id'],
        ),
        comments: table(
          {
            id: col('int4', 'pg/int4@1'),
            body: col('text', 'pg/text@1'),
            post_id: col('int4', 'pg/int4@1'),
          },
          ['id'],
        ),
        profiles: table(
          {
            id: col('int4', 'pg/int4@1'),
            user_id: col('int4', 'pg/int4@1'),
            bio: col('text', 'pg/text@1'),
          },
          ['id'],
        ),
      },
    },
    models: {
      User: {
        storage: { table: 'users' },
        fields: {
          id: { column: 'id' },
          name: { column: 'name' },
          email: { column: 'email' },
        },
        relations: {},
      },
      Post: {
        storage: { table: 'posts' },
        fields: {
          id: { column: 'id' },
          title: { column: 'title' },
          userId: { column: 'user_id' },
          views: { column: 'views' },
        },
        relations: {},
      },
      Comment: {
        storage: { table: 'comments' },
        fields: {
          id: { column: 'id' },
          body: { column: 'body' },
          postId: { column: 'post_id' },
        },
        relations: {},
      },
      Profile: {
        storage: { table: 'profiles' },
        fields: {
          id: { column: 'id' },
          userId: { column: 'user_id' },
          bio: { column: 'bio' },
        },
        relations: {},
      },
    },
    relations: {
      users: {
        posts: {
          to: 'Post',
          cardinality: '1:N',
          on: {
            parentCols: ['id'],
            childCols: ['user_id'],
          },
        },
        profile: {
          to: 'Profile',
          cardinality: '1:1',
          on: {
            parentCols: ['id'],
            childCols: ['user_id'],
          },
        },
      },
      posts: {
        comments: {
          to: 'Comment',
          cardinality: '1:N',
          on: {
            parentCols: ['id'],
            childCols: ['post_id'],
          },
        },
        author: {
          to: 'User',
          cardinality: 'N:1',
          on: {
            parentCols: ['user_id'],
            childCols: ['id'],
          },
        },
      },
      comments: {},
      profiles: {},
    },
    mappings: {
      modelToTable: { User: 'users', Post: 'posts', Comment: 'comments', Profile: 'profiles' },
      tableToModel: { users: 'User', posts: 'Post', comments: 'Comment', profiles: 'Profile' },
      fieldToColumn: {
        User: { id: 'id', name: 'name', email: 'email' },
        Post: { id: 'id', title: 'title', userId: 'user_id', views: 'views' },
        Comment: { id: 'id', body: 'body', postId: 'post_id' },
        Profile: { id: 'id', userId: 'user_id', bio: 'bio' },
      },
      columnToField: {
        users: { id: 'id', name: 'name', email: 'email' },
        posts: { id: 'id', title: 'title', user_id: 'userId', views: 'views' },
        comments: { id: 'id', body: 'body', post_id: 'postId' },
        profiles: { id: 'id', user_id: 'userId', bio: 'bio' },
      },
      codecTypes: {
        'pg/int4@1': { output: 0 as number },
        'pg/text@1': { output: '' as string },
      },
      operationTypes: {},
    },
  } as unknown as TestContract;
}

export interface MockExecution {
  plan: ExecutionPlan;
  rows: Record<string, unknown>[];
}

export interface MockRuntime extends RuntimeQueryable {
  readonly executions: MockExecution[];
  setNextResults(results: Record<string, unknown>[][]): void;
}

export function createMockRuntime(): MockRuntime {
  const executions: MockExecution[] = [];
  let nextResult: Record<string, unknown>[][] = [];

  const runtime: MockRuntime = {
    executions,
    setNextResults(results: Record<string, unknown>[][]) {
      nextResult = [...results];
    },
    execute<Row>(plan: ExecutionPlan<Row>): AsyncIterableResult<Row> {
      const rows = (nextResult.shift() ?? []) as Row[];
      executions.push({ plan: plan as ExecutionPlan, rows: rows as Record<string, unknown>[] });
      const gen = async function* (): AsyncGenerator<Row, void, unknown> {
        for (const row of rows) {
          yield row;
        }
      };
      return new AsyncIterableResult(gen());
    },
  };

  return runtime;
}
