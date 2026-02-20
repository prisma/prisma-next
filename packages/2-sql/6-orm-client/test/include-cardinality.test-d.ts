import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { Collection } from '../src/collection';
import { createMockRuntime, type TestContract } from './helpers';

type RowOf<TCollection> =
  TCollection extends Collection<
    infer _Contract extends SqlContract<SqlStorage>,
    infer _ModelName extends string,
    infer Row,
    infer _State
  >
    ? Row
    : never;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Assert<T extends true> = T;

const contract = {} as TestContract;
const runtime = createMockRuntime();

const userCollection = new Collection({ contract, runtime }, 'User');
const postCollection = new Collection({ contract, runtime }, 'Post');

const usersWithPosts = userCollection.include('posts');
const usersWithProfile = userCollection.include('profile');
const postsWithAuthor = postCollection.include('author');

type UsersWithPostsRow = RowOf<typeof usersWithPosts>;
type UsersWithProfileRow = RowOf<typeof usersWithProfile>;
type PostsWithAuthorRow = RowOf<typeof postsWithAuthor>;

export type IncludeCardinalityTypeAssertions = [
  Assert<Equal<UsersWithPostsRow['posts'], Array<RowOf<Collection<TestContract, 'Post'>>>>>,
  Assert<Equal<Extract<UsersWithProfileRow['profile'], null>, null>>,
  Assert<
    Equal<
      Exclude<UsersWithProfileRow['profile'], null> extends readonly unknown[] ? true : false,
      false
    >
  >,
  Assert<Equal<keyof NonNullable<UsersWithProfileRow['profile']>, 'id' | 'userId' | 'bio'>>,
  Assert<Equal<Extract<PostsWithAuthorRow['author'], null>, null>>,
  Assert<
    Equal<
      Exclude<PostsWithAuthorRow['author'], null> extends readonly unknown[] ? true : false,
      false
    >
  >,
  Assert<Equal<keyof NonNullable<PostsWithAuthorRow['author']>, 'id' | 'name' | 'email'>>,
];
