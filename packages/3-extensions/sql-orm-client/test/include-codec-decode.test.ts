/**
 * Include payloads decode through the codec boundary.
 *
 * Rows transported inside a correlated-subquery JSON payload (`json_agg` /
 * `json_build_object`) arrive as JSON-safe values — timestamptz as ISO
 * strings, not `Date`s. The include decode path must run every nested cell
 * through its column codec's `decodeJson` (the codec's designed JSON
 * boundary) so nested rows carry exactly the same JS types as top-level
 * rows: to-many rows, to-one objects, combine() row branches, and nested
 * depth-2 includes alike.
 */
import {
  boolColumn,
  int4Column,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import { defineContract, field, model, rel } from './contract-builder';
import {
  buildTestContextFromContract,
  createMockRuntime,
  deserializeTestContract,
} from './helpers';

const PUBLISHED_AT = '2026-07-10T17:48:32.412+00:00';
const PUBLISHED_AT_EPOCH = new Date('2026-07-10T17:48:32.412Z').getTime();
const JOINED_AT = '2026-01-05T09:00:00+00:00';
const JOINED_AT_EPOCH = new Date('2026-01-05T09:00:00.000Z').getTime();

function buildIncludeCodecContract() {
  const User = model('User', {
    fields: {
      id: field.column(int4Column).id(),
      name: field.column(textColumn),
      joinedAt: field.column(timestamptzColumn),
    },
    relations: {
      posts: rel.hasMany('Post', { by: 'userId' }),
    },
  }).sql({ table: 'users' });

  const Post = model('Post', {
    fields: {
      id: field.column(int4Column).id(),
      userId: field.column(int4Column),
      title: field.column(textColumn),
      publishedAt: field.column(timestamptzColumn),
      featured: field.column(boolColumn),
    },
    relations: {
      user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
    },
  }).sql({ table: 'posts' });

  const built = defineContract({ models: { User, Post } });
  const raw = JSON.parse(JSON.stringify(built));
  raw.capabilities = {
    sql: { jsonAgg: true, returning: true },
    postgres: { jsonAgg: true, lateral: true, returning: true },
  };
  return deserializeTestContract(raw);
}

const contract = buildIncludeCodecContract();
const context = buildTestContextFromContract(contract);

// `deserializeTestContract` types its output as the generated fixture
// Contract, so this purpose-built User/Post contract cannot drive precise
// row types through `Collection`'s generics. These tests assert runtime
// decode behaviour, so the collections are viewed through a loose
// structural surface and each query names its expected decoded row shape.
interface LooseIncludeScope {
  include(name: string, refine?: (scope: LooseIncludeScope) => unknown): LooseIncludeScope;
  combine(branches: Record<string, unknown>): unknown;
  take(count: number): unknown;
  count(): unknown;
  all<T>(): PromiseLike<readonly T[]>;
}

type DecodedUser = { id: number; name: string; joinedAt: Date };
type DecodedPost = {
  id: number;
  userId: number;
  title: string;
  publishedAt: Date | null;
  featured: boolean;
};

function userCollection() {
  const runtime = createMockRuntime();
  const collection = new Collection<typeof contract, 'User'>({ runtime, context }, 'User', {
    namespaceId: 'public',
  }) as unknown as LooseIncludeScope;
  return { collection, runtime };
}

function postCollection() {
  const runtime = createMockRuntime();
  const collection = new Collection<typeof contract, 'Post'>({ runtime, context }, 'Post', {
    namespaceId: 'public',
  }) as unknown as LooseIncludeScope;
  return { collection, runtime };
}

function postPayloadRow(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: 1,
    title: `Post ${id}`,
    publishedAt: PUBLISHED_AT,
    featured: true,
    ...overrides,
  };
}

const userRow = { id: 1, name: 'Alice', joinedAt: new Date(JOINED_AT) };

describe('to-many include payload', () => {
  it('decodes timestamptz and bool cells through codecs', async () => {
    const { collection, runtime } = userCollection();
    runtime.setNextResults([[{ ...userRow, posts: [postPayloadRow(10), postPayloadRow(11)] }]]);

    const rows = await collection.include('posts').all<DecodedUser & { posts: DecodedPost[] }>();
    const posts = rows[0]?.posts ?? [];

    expect(posts).toHaveLength(2);
    for (const post of posts) {
      expect(post.publishedAt).toBeInstanceOf(Date);
      expect((post.publishedAt as Date).getTime()).toBe(PUBLISHED_AT_EPOCH);
      expect(post.featured).toBe(true);
      expect(typeof post.title).toBe('string');
    }
  });

  it('keeps null cells null and empty payloads empty', async () => {
    const { collection, runtime } = userCollection();
    runtime.setNextResults([
      [
        { ...userRow, id: 1, posts: [postPayloadRow(10, { publishedAt: null })] },
        { ...userRow, id: 2, posts: null },
      ],
    ]);

    const rows = await collection.include('posts').all<DecodedUser & { posts: DecodedPost[] }>();
    expect(rows[0]?.posts[0]?.publishedAt).toBeNull();
    expect(rows[1]?.posts).toEqual([]);
  });
});

describe('to-one include payload', () => {
  it('decodes the joined parent row through codecs', async () => {
    const { collection, runtime } = postCollection();
    runtime.setNextResults([
      [
        {
          ...postPayloadRow(10),
          publishedAt: new Date(PUBLISHED_AT),
          user: [{ id: 1, name: 'Alice', joinedAt: JOINED_AT }],
        },
      ],
    ]);

    const rows = await collection.include('user').all<DecodedPost & { user: DecodedUser | null }>();
    const user = rows[0]?.user;

    expect(user).not.toBeNull();
    expect(user?.joinedAt).toBeInstanceOf(Date);
    expect((user?.joinedAt as Date).getTime()).toBe(JOINED_AT_EPOCH);
  });
});

describe('combine() include payload', () => {
  it('decodes row branches through codecs and unwraps scalar branches', async () => {
    const { collection, runtime } = userCollection();
    runtime.setNextResults([
      [
        {
          ...userRow,
          posts: {
            recent: [postPayloadRow(10)],
            total: { value: 7 },
          },
        },
      ],
    ]);

    const rows = await collection
      .include('posts', (posts) => posts.combine({ recent: posts.take(1), total: posts.count() }))
      .all<DecodedUser & { posts: { recent: DecodedPost[]; total: number } }>();
    const postsBranch = rows[0]?.posts;

    expect(postsBranch?.total).toBe(7);
    expect(postsBranch?.recent[0]?.publishedAt).toBeInstanceOf(Date);
    expect((postsBranch?.recent[0]?.publishedAt as Date).getTime()).toBe(PUBLISHED_AT_EPOCH);
    expect(postsBranch?.recent[0]?.featured).toBe(true);
  });
});

describe('nested depth-2 include payload', () => {
  it('decodes rows at every include depth', async () => {
    const { collection, runtime } = userCollection();
    runtime.setNextResults([
      [
        {
          ...userRow,
          posts: [
            {
              ...postPayloadRow(10),
              user: [{ id: 1, name: 'Alice', joinedAt: JOINED_AT }],
            },
          ],
        },
      ],
    ]);

    const rows = await collection
      .include('posts', (posts) => posts.include('user'))
      .all<DecodedUser & { posts: Array<DecodedPost & { user: DecodedUser | null }> }>();
    const nestedUser = rows[0]?.posts[0]?.user;

    expect(rows[0]?.posts[0]?.publishedAt).toBeInstanceOf(Date);
    expect(nestedUser?.joinedAt).toBeInstanceOf(Date);
    expect((nestedUser?.joinedAt as Date).getTime()).toBe(JOINED_AT_EPOCH);
  });
});
