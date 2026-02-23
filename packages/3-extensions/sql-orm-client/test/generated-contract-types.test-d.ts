import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { Collection } from '../src/collection';
import type { RelationMutator } from '../src/types';
import { createMockRuntime } from './helpers';

type GeneratedLikeContract = SqlContract<
  {
    tables: {
      user: {
        columns: {
          id: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
          name: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
          email: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
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
      };
      post: {
        id: 'id';
        userId: 'userId';
        title: 'title';
      };
    };
    codecTypes: {
      'pg/text@1': { output: string };
    };
    operationTypes: Record<string, never>;
  }
>;

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
const contract = {} as GeneratedLikeContract;
const collection = new PostCollection({ contract, runtime }, 'Post');
collection.forUser('user_001');

const userCollection = new Collection({ contract, runtime }, 'User');
const postCollection = new Collection({ contract, runtime }, 'Post');

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Assert<T extends true> = T;

const selectedUsers = userCollection.select('name', 'email');
const selectedUsersWithPosts = userCollection.select('name').include('posts');
const filteredUsers = userCollection.where({ email: 'alice@example.com' });
const orderedUsers = userCollection.orderBy((user) => user.id.asc());
const cursorPagedUsers = orderedUsers.cursor({ id: 'user_001' });
const distinctUsers = userCollection.distinct('email');
const distinctOnUsers = orderedUsers.distinctOn('email');
userCollection.create({
  id: 'user_001',
  name: 'Alice',
  email: 'alice@example.com',
  posts: (posts: RelationMutator<GeneratedLikeContract, 'Post'>) =>
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
  create: { id: 'user_001', name: 'Alice', email: 'alice@example.com' },
  update: { name: 'Alice Updated' },
  conflictOn: { id: 'user_001' },
});
userCollection.upsert({
  create: { id: 'user_001', name: 'Alice', email: 'alice@example.com' },
  update: { name: 'Alice Updated' },
});
userCollection.upsert({
  create: { id: 'user_001', name: 'Alice', email: 'alice@example.com' },
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
type FilteredUsersState = StateOf<typeof filteredUsers>;
type OrderedUsersState = StateOf<typeof orderedUsers>;
type CursorPagedUsersState = StateOf<typeof cursorPagedUsers>;
type DistinctUsersState = StateOf<typeof distinctUsers>;
type DistinctOnUsersState = StateOf<typeof distinctOnUsers>;

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
  Assert<Equal<FilteredUsersState['hasWhere'], true>>,
  Assert<Equal<OrderedUsersState['hasOrderBy'], true>>,
  Assert<Equal<CursorPagedUsersState['hasOrderBy'], true>>,
  Assert<Equal<DistinctUsersState['hasOrderBy'], false>>,
  Assert<Equal<DistinctOnUsersState['hasOrderBy'], true>>,
];
