import type { ExecutionPlan } from '@prisma-next/contract/types';
import type { TargetPackRef } from '@prisma-next/contract/framework-components';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { SqlContract, StorageTable } from '@prisma-next/sql-contract/types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import type { RuntimeQueryable } from '../src/types';

// ---- helpers to build a minimal contract for tests ----

type TestCodecTypes = {
  'pg/int4@1': { output: number };
  'pg/text@1': { output: string };
};

const int4Column = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;
const textColumn = { codecId: 'pg/text@1', nativeType: 'text' } as const;

const postgresTarget: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

// Explicit type alias required: the builder produces a structurally equivalent type,
// but TypeScript's conditional type evaluation in the ORM's deep type machinery
// (e.g. `ModelTableFromMappings`, `RelationsOf`, `ScalarModelAccessor`) does not
// fully reduce the builder's intersection-heavy return type. Keeping the explicit
// `SqlContract<...>` instantiation ensures the ORM's type-level tests pass.
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
        invitedById: { column: 'invited_by_id' };
      };
      relations: {
        invitedBy: Record<string, never>;
        invitedUsers: Record<string, never>;
      };
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
      invitedUsers: {
        to: 'User';
        cardinality: '1:N';
        on: {
          parentCols: ['id'];
          childCols: ['invited_by_id'];
        };
      };
      invitedBy: {
        to: 'User';
        cardinality: 'N:1';
        on: {
          parentCols: ['invited_by_id'];
          childCols: ['id'];
        };
      };
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

function buildTestContract() {
  return defineContract<TestCodecTypes>()
    .target(postgresTarget)
    .storageHash('sha256:test')
    .table('users', (t) =>
      t
        .column('id', { type: int4Column })
        .column('name', { type: textColumn })
        .column('email', { type: textColumn })
        .column('invited_by_id', { type: int4Column, nullable: true })
        .primaryKey(['id']),
    )
    .table('posts', (t) =>
      t
        .column('id', { type: int4Column })
        .column('title', { type: textColumn })
        .column('user_id', { type: int4Column })
        .column('views', { type: int4Column })
        .primaryKey(['id']),
    )
    .table('comments', (t) =>
      t
        .column('id', { type: int4Column })
        .column('body', { type: textColumn })
        .column('post_id', { type: int4Column })
        .primaryKey(['id']),
    )
    .table('profiles', (t) =>
      t
        .column('id', { type: int4Column })
        .column('user_id', { type: int4Column })
        .column('bio', { type: textColumn })
        .primaryKey(['id']),
    )
    .model('User', 'users', (m) =>
      m
        .field('id', 'id')
        .field('name', 'name')
        .field('email', 'email')
        .field('invitedById', 'invited_by_id')
        .relation('invitedUsers', {
          toModel: 'User',
          toTable: 'users',
          cardinality: '1:N',
          on: {
            parentTable: 'users',
            parentColumns: ['id'],
            childTable: 'users',
            childColumns: ['invited_by_id'],
          },
        })
        .relation('invitedBy', {
          toModel: 'User',
          toTable: 'users',
          cardinality: 'N:1',
          on: {
            parentTable: 'users',
            parentColumns: ['invited_by_id'],
            childTable: 'users',
            childColumns: ['id'],
          },
        })
        .relation('posts', {
          toModel: 'Post',
          toTable: 'posts',
          cardinality: '1:N',
          on: {
            parentTable: 'users',
            parentColumns: ['id'],
            childTable: 'posts',
            childColumns: ['user_id'],
          },
        })
        .relation('profile', {
          toModel: 'Profile',
          toTable: 'profiles',
          cardinality: '1:1',
          on: {
            parentTable: 'users',
            parentColumns: ['id'],
            childTable: 'profiles',
            childColumns: ['user_id'],
          },
        }),
    )
    .model('Post', 'posts', (m) =>
      m
        .field('id', 'id')
        .field('title', 'title')
        .field('userId', 'user_id')
        .field('views', 'views')
        .relation('comments', {
          toModel: 'Comment',
          toTable: 'comments',
          cardinality: '1:N',
          on: {
            parentTable: 'posts',
            parentColumns: ['id'],
            childTable: 'comments',
            childColumns: ['post_id'],
          },
        })
        .relation('author', {
          toModel: 'User',
          toTable: 'users',
          cardinality: 'N:1',
          on: {
            parentTable: 'posts',
            parentColumns: ['user_id'],
            childTable: 'users',
            childColumns: ['id'],
          },
        }),
    )
    .model('Comment', 'comments', (m) =>
      m.field('id', 'id').field('body', 'body').field('postId', 'post_id'),
    )
    .model('Profile', 'profiles', (m) =>
      m.field('id', 'id').field('userId', 'user_id').field('bio', 'bio'),
    )
    .build();
}

export function createTestContract(): TestContract {
  return buildTestContract() as unknown as TestContract;
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
