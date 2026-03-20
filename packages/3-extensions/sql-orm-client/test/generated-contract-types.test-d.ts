import type {
  ContractWithTypeMaps,
  SqlContract,
  SqlStorage,
  TypeMaps,
} from '@prisma-next/sql-contract/types';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { Collection } from '../src/collection';

import { createMockRuntime } from './helpers';

type GeneratedLikeCodecTypes = {
  'pg/text@1': {
    output: string;
    traits: 'equality' | 'order' | 'textual';
  };
  'pg/bool@1': {
    output: boolean;
    traits: 'equality' | 'boolean';
  };
  'pg/jsonb@1': {
    output: unknown;
    traits: 'equality';
  };
};

type GeneratedLikeTypeMaps = TypeMaps<GeneratedLikeCodecTypes>;

type GeneratedLikeContractBase = SqlContract<
  {
    tables: {
      user: {
        columns: {
          id: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
          name: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
          email: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
          active: { nativeType: 'bool'; codecId: 'pg/bool@1'; nullable: false };
          metadata: { nativeType: 'jsonb'; codecId: 'pg/jsonb@1'; nullable: false };
        };
        primaryKey: { columns: ['id'] };
        uniques: [];
        indexes: [];
        foreignKeys: [];
      };
      post: {
        columns: {
          id: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
          userId: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
          title: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
        };
        primaryKey: { columns: ['id'] };
        uniques: [];
        indexes: [];
        foreignKeys: [];
      };
    };
  },
  {
    User: {
      storage: { table: 'user' };
      fields: {
        id: string;
        name: string;
        email: string;
        active: boolean;
        metadata: unknown;
      };
    };
    Post: {
      storage: { table: 'post' };
      fields: {
        id: string;
        userId: string;
        title: string;
      };
    };
  },
  {
    user: {
      posts: {
        to: 'Post';
        cardinality: '1:N';
        on: {
          parentCols: ['id'];
          childCols: ['userId'];
        };
      };
    };
    post: Record<string, never>;
  },
  {
    modelToTable: {
      User: 'user';
      Post: 'post';
    };
    tableToModel: {
      user: 'User';
      post: 'Post';
    };
    fieldToColumn: {
      User: {
        id: 'id';
        name: 'name';
        email: 'email';
        active: 'active';
        metadata: 'metadata';
      };
      Post: {
        id: 'id';
        userId: 'userId';
        title: 'title';
      };
    };
    columnToField: {
      user: {
        id: 'id';
        name: 'name';
        email: 'email';
        active: 'active';
        metadata: 'metadata';
      };
      post: {
        id: 'id';
        userId: 'userId';
        title: 'title';
      };
    };
    codecTypes: {
      'pg/text@1': { output: string; traits: 'equality' | 'order' | 'textual' };
      'pg/bool@1': { output: boolean; traits: 'equality' | 'boolean' };
      'pg/jsonb@1': { output: unknown; traits: 'equality' };
    };
    operationTypes: Record<string, never>;
  }
>;

type GeneratedLikeContract = ContractWithTypeMaps<GeneratedLikeContractBase, GeneratedLikeTypeMaps>;

class PostCollection extends Collection<GeneratedLikeContract, 'Post'> {
  forUser(userId: string) {
    return this.where((post) => post.userId.eq(userId));
  }
}

type RowOf<TCollection> =
  TCollection extends Collection<
    infer _Contract extends SqlContract<SqlStorage>,
    infer _ModelName extends string,
    infer Row,
    infer _State
  >
    ? Row
    : never;

type StateOf<TCollection> =
  TCollection extends Collection<
    infer _Contract extends SqlContract<SqlStorage>,
    infer _ModelName extends string,
    infer _Row,
    infer State
  >
    ? State
    : never;

const runtime = createMockRuntime();
const context = {} as ExecutionContext<GeneratedLikeContract>;
const collection = new PostCollection({ runtime, context }, 'Post');
collection.forUser('user_001');

const userCollection = new Collection({ runtime, context }, 'User');
const postCollection = new Collection({ runtime, context }, 'Post');

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Assert<T extends true> = T;

const selectedUsers = userCollection.select('name', 'email');
const selectedUsersWithPosts = userCollection.select('name').include('posts');
const usersWithPostCount = userCollection.include('posts', (posts) => posts.count());
const usersWithPostSummary = userCollection.include('posts', (posts) =>
  posts.combine({
    allPosts: posts.orderBy((post) => post.id.asc()),
    totalCount: posts.count(),
  }),
);
const filteredUsers = userCollection.where({ email: 'alice@example.com' });
const orderedUsers = userCollection.orderBy((user) => user.id.asc());
const cursorPagedUsers = orderedUsers.cursor({ id: 'user_001' });
const distinctUsers = userCollection.distinct('email');
const distinctOnUsers = orderedUsers.distinctOn('email');
const groupedUsers = userCollection.groupBy('email');
const groupedUserStats = groupedUsers.aggregate((aggregate) => ({
  count: aggregate.count(),
}));
groupedUsers.having((having) => having.count().gt(1));
// @ts-expect-error GroupedCollection does not expose all()
groupedUsers.all();
// @ts-expect-error GroupedCollection does not expose include()
groupedUsers.include('posts');
userCollection.include('posts', (posts) => {
  // @ts-expect-error include refinement collection does not expose create()
  posts.create({} as never);
  return posts;
});
const userAggregate = userCollection.aggregate((aggregate) => ({
  count: aggregate.count(),
}));
postCollection.aggregate((aggregate) => ({
  // @ts-expect-error sum() is restricted to numeric fields only
  total: aggregate.sum('title'),
}));
userCollection.create({
  id: 'user_001',
  name: 'Alice',
  email: 'alice@example.com',
  active: true,
  metadata: {},
  posts: (posts) =>
    posts.create([
      {
        id: 'post_001',
        title: 'Nested',
      },
    ]),
});
// @ts-expect-error missing required create fields without relation mutations
userCollection.create({ id: 'user_only_id' });
// @ts-expect-error Post has no relation callbacks to satisfy required userId in create()
postCollection.create({ id: 'post_missing_user', title: 'Missing owner' });
userCollection.upsert({
  create: { id: 'user_001', name: 'Alice', email: 'alice@example.com', active: true, metadata: {} },
  update: { name: 'Alice Updated' },
  conflictOn: { id: 'user_001' },
});
userCollection.upsert({
  create: { id: 'user_001', name: 'Alice', email: 'alice@example.com', active: true, metadata: {} },
  update: { name: 'Alice Updated' },
});
userCollection.upsert({
  create: { id: 'user_001', name: 'Alice', email: 'alice@example.com', active: true, metadata: {} },
  update: { name: 'Alice Updated' },
  // @ts-expect-error invalid conflict key for upsert()
  conflictOn: { unknown: 'value' },
});
const updatableUsers = userCollection.where({ email: 'alice@example.com' });
updatableUsers.update({ name: 'Alice' });
updatableUsers.updateAll({ name: 'Alice' });
updatableUsers.updateCount({ name: 'Alice' });
const deletableUsers = userCollection.where({ email: 'alice@example.com' });
deletableUsers.delete();
deletableUsers.deleteAll();
deletableUsers.deleteCount();
// @ts-expect-error cursor() requires orderBy() first
userCollection.cursor({ id: 'user_001' });
// @ts-expect-error distinctOn() requires orderBy() first
userCollection.distinctOn('email');
// @ts-expect-error update() requires where() first
userCollection.update({ name: 'Alice' });
// @ts-expect-error updateAll() requires where() first
userCollection.updateAll({ name: 'Alice' });
// @ts-expect-error updateCount() requires where() first
userCollection.updateCount({ name: 'Alice' });
// @ts-expect-error delete() requires where() first
userCollection.delete();
// @ts-expect-error deleteAll() requires where() first
userCollection.deleteAll();
// @ts-expect-error deleteCount() requires where() first
userCollection.deleteCount();

type SelectedUserRow = RowOf<typeof selectedUsers>;
type SelectedUserWithPostsRow = RowOf<typeof selectedUsersWithPosts>;
type UsersWithPostCountRow = RowOf<typeof usersWithPostCount>;
type UsersWithPostSummaryRow = RowOf<typeof usersWithPostSummary>;
type FilteredUsersState = StateOf<typeof filteredUsers>;
type OrderedUsersState = StateOf<typeof orderedUsers>;
type CursorPagedUsersState = StateOf<typeof cursorPagedUsers>;
type DistinctUsersState = StateOf<typeof distinctUsers>;
type DistinctOnUsersState = StateOf<typeof distinctOnUsers>;
type UserAggregateResult = Awaited<typeof userAggregate>;
type GroupedUserStatsResult = Awaited<typeof groupedUserStats>;
type GroupedUserStatsRow = GroupedUserStatsResult[number];

export type GeneratedContractTypeAssertions = [
  Assert<Equal<keyof SelectedUserRow, 'name' | 'email'>>,
  Assert<Equal<SelectedUserRow['name'], string>>,
  Assert<Equal<SelectedUserRow['email'], string>>,
  Assert<Equal<keyof SelectedUserWithPostsRow, 'name' | 'posts'>>,
  Assert<Equal<SelectedUserWithPostsRow['name'], string>>,
  Assert<Equal<keyof SelectedUserWithPostsRow['posts'][number], 'id' | 'userId' | 'title'>>,
  Assert<Equal<SelectedUserWithPostsRow['posts'][number]['id'], string>>,
  Assert<Equal<SelectedUserWithPostsRow['posts'][number]['userId'], string>>,
  Assert<Equal<SelectedUserWithPostsRow['posts'][number]['title'], string>>,
  Assert<Equal<UsersWithPostCountRow['posts'], number>>,
  Assert<Equal<keyof UsersWithPostSummaryRow['posts'], 'allPosts' | 'totalCount'>>,
  Assert<Equal<UsersWithPostSummaryRow['posts']['totalCount'], number>>,
  Assert<
    Equal<keyof UsersWithPostSummaryRow['posts']['allPosts'][number], 'id' | 'userId' | 'title'>
  >,
  Assert<Equal<FilteredUsersState['hasWhere'], true>>,
  Assert<Equal<OrderedUsersState['hasOrderBy'], true>>,
  Assert<Equal<CursorPagedUsersState['hasOrderBy'], true>>,
  Assert<Equal<DistinctUsersState['hasOrderBy'], false>>,
  Assert<Equal<DistinctOnUsersState['hasOrderBy'], true>>,
  Assert<Equal<UserAggregateResult, { count: number }>>,
  Assert<Equal<keyof GroupedUserStatsRow, 'email' | 'count'>>,
  Assert<Equal<GroupedUserStatsRow['email'], string>>,
  Assert<Equal<GroupedUserStatsRow['count'], number>>,
];

// ---------------------------------------------------------------------------
// Trait-gating: negative type tests
// ---------------------------------------------------------------------------
// text (equality + order + textual): eq, gt, like, asc all work
userCollection.where((u) => u.name.eq('x'));
userCollection.where((u) => u.name.gt('a'));
userCollection.where((u) => u.name.like('%x'));
userCollection.orderBy((u) => u.name.asc());
userCollection.where((u) => u.name.isNull());

// bool (equality + boolean): eq works, gt/like/asc do not
userCollection.where((u) => u.active.eq(true));
userCollection.where((u) => u.active.neq(false));
userCollection.where((u) => u.active.isNull());
// @ts-expect-error bool has no order trait → gt not available
userCollection.where((u) => u.active.gt(true));
// @ts-expect-error bool has no order trait → lt not available
userCollection.where((u) => u.active.lt(false));
// @ts-expect-error bool has no textual trait → like not available
userCollection.where((u) => u.active.like('%'));
// @ts-expect-error bool has no order trait → asc not available
userCollection.orderBy((u) => u.active.asc());
// @ts-expect-error bool has no order trait → desc not available
userCollection.orderBy((u) => u.active.desc());

// jsonb (equality only): eq works, gt/like/asc do not
userCollection.where((u) => u.metadata.eq({} as unknown));
userCollection.where((u) => u.metadata.in([{} as unknown]));
userCollection.where((u) => u.metadata.isNotNull());
// @ts-expect-error jsonb has no order trait → gt not available
userCollection.where((u) => u.metadata.gt(1));
// @ts-expect-error jsonb has no order trait → gte not available
userCollection.where((u) => u.metadata.gte(1));
// @ts-expect-error jsonb has no textual trait → like not available
userCollection.where((u) => u.metadata.like('%'));
// @ts-expect-error jsonb has no textual trait → ilike not available
userCollection.where((u) => u.metadata.ilike('%'));
// @ts-expect-error jsonb has no order trait → asc not available
userCollection.orderBy((u) => u.metadata.asc());
