import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type { SimplifyDeep } from '../src/types';
import { createMockRuntime, getTestContext } from './helpers';

describe('SimplifyDeep', () => {
  test('primitives pass through', () => {
    expectTypeOf<SimplifyDeep<string>>().toEqualTypeOf<string>();
    expectTypeOf<SimplifyDeep<number>>().toEqualTypeOf<number>();
    expectTypeOf<SimplifyDeep<boolean>>().toEqualTypeOf<boolean>();
    expectTypeOf<SimplifyDeep<bigint>>().toEqualTypeOf<bigint>();
    expectTypeOf<SimplifyDeep<symbol>>().toEqualTypeOf<symbol>();
    expectTypeOf<SimplifyDeep<null>>().toEqualTypeOf<null>();
    expectTypeOf<SimplifyDeep<undefined>>().toEqualTypeOf<undefined>();
    expectTypeOf<SimplifyDeep<unknown>>().toEqualTypeOf<unknown>();
    expectTypeOf<SimplifyDeep<never>>().toEqualTypeOf<never>();
  });

  test('branded primitives pass through', () => {
    type Branded = string & { readonly __brand: true };
    expectTypeOf<SimplifyDeep<Branded>>().toEqualTypeOf<Branded>();
  });

  test('Date and Uint8Array preserved', () => {
    expectTypeOf<SimplifyDeep<Date>>().toEqualTypeOf<Date>();
    expectTypeOf<SimplifyDeep<Uint8Array>>().toEqualTypeOf<Uint8Array>();
  });

  test('intersections flatten into plain objects', () => {
    type Input = { a: number } & { b: string };
    type Expected = { a: number; b: string };
    expectTypeOf<SimplifyDeep<Input>>().toEqualTypeOf<Expected>();
  });

  test('arrays recurse', () => {
    type Input = ({ a: number } & { b: string })[];
    type Expected = { a: number; b: string }[];
    expectTypeOf<SimplifyDeep<Input>>().toEqualTypeOf<Expected>();
  });

  test('nested objects recurse', () => {
    type Input = { nested: { a: number } & { b: string } };
    type Expected = { nested: { a: number; b: string } };
    expectTypeOf<SimplifyDeep<Input>>().toEqualTypeOf<Expected>();
  });

  test('nullable objects', () => {
    type Input = ({ a: number } & { b: string }) | null;
    type Expected = { a: number; b: string } | null;
    expectTypeOf<SimplifyDeep<Input>>().toEqualTypeOf<Expected>();
  });

  test('nested arrays of intersected objects', () => {
    type Input = {
      items: ({ id: number } & { name: string })[];
    };
    type Expected = {
      items: { id: number; name: string }[];
    };
    expectTypeOf<SimplifyDeep<Input>>().toEqualTypeOf<Expected>();
  });

  test('bidirectional assignability for concrete types', () => {
    type Original = { a: number } & { b: string; nested: { c: boolean } & { d: number } };
    type Simplified = SimplifyDeep<Original>;

    expectTypeOf<Original>().toExtend<Simplified>();
    expectTypeOf<Simplified>().toExtend<Original>();
  });
});

describe('Collection result types are simplified', () => {
  const runtime = createMockRuntime();
  const context = getTestContext();

  test('default Row is a plain object', () => {
    const users = new Collection({ runtime, context }, 'User');
    type UserRow = Awaited<ReturnType<typeof users.first>>;
    expectTypeOf<NonNullable<UserRow>>().toEqualTypeOf<{
      id: number;
      name: string;
      email: string;
      invitedById: number | null;
    }>();
  });

  test('select() produces a plain object', () => {
    const users = new Collection({ runtime, context }, 'User');
    const selected = users.select('id', 'email');
    type SelectedRow = Awaited<ReturnType<typeof selected.first>>;
    expectTypeOf<NonNullable<SelectedRow>>().toEqualTypeOf<{
      id: number;
      email: string;
    }>();
  });

  test('include() produces a plain object with nested relation', () => {
    const users = new Collection({ runtime, context }, 'User');
    const withPosts = users.include('posts');
    type WithPostsRow = Awaited<ReturnType<typeof withPosts.first>>;
    expectTypeOf<NonNullable<WithPostsRow>>().toEqualTypeOf<{
      id: number;
      name: string;
      email: string;
      invitedById: number | null;
      posts: {
        id: number;
        title: string;
        userId: number;
        views: number;
      }[];
    }>();
  });

  test('select().include() produces a plain object', () => {
    const users = new Collection({ runtime, context }, 'User');
    const selected = users.select('name').include('posts');
    type Row = Awaited<ReturnType<typeof selected.first>>;
    expectTypeOf<NonNullable<Row>>().toEqualTypeOf<{
      name: string;
      posts: {
        id: number;
        title: string;
        userId: number;
        views: number;
      }[];
    }>();
  });

  test('include() with non-nullable to-one relation', () => {
    const posts = new Collection({ runtime, context }, 'Post');
    const withAuthor = posts.include('author');
    type Row = Awaited<ReturnType<typeof withAuthor.first>>;
    type AuthorField = NonNullable<Row>['author'];
    expectTypeOf<AuthorField>().toEqualTypeOf<{
      id: number;
      name: string;
      email: string;
      invitedById: number | null;
    }>();
  });

  test('include() with count refinement', () => {
    const users = new Collection({ runtime, context }, 'User');
    const withPostCount = users.include('posts', (posts) => posts.count());
    type Row = Awaited<ReturnType<typeof withPostCount.first>>;
    expectTypeOf<NonNullable<Row>['posts']>().toEqualTypeOf<number>();
  });
});
