/**
 * Unit tests for the auto-include walker.
 *
 * The walker is the core of the plugin: given a GraphQL ResolveInfo, it
 * builds an `apply` function that chains `.select(...)` / `.include(...)`
 * onto a base Collection, and a `reshape` function that lifts combine
 * branches onto flat parent keys at result time.
 *
 * These tests construct minimal `GraphQLObjectType`s with the field
 * extensions the walker reads, parse a GraphQL document, and exercise:
 *
 * 1. The `apply` path — verified by a recording Collection mock that
 *    captures `.select(...)` and `.include(rel, refineFn)` calls.
 * 2. The `reshape` path — verified by feeding synthetic result rows
 *    to the returned reshape function and asserting on the lifted shape.
 */
import type { BuildCache, SchemaTypes } from '@pothos/core';
import {
  type DocumentNode,
  type FieldNode,
  GraphQLBoolean,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  type GraphQLObjectType,
  type GraphQLResolveInfo,
  GraphQLSchema,
  GraphQLString,
  Kind,
  GraphQLObjectType as ObjectType,
  parse,
  type SelectionSetNode,
} from 'graphql';
import { describe, expect, it } from 'vitest';
import { applySelectionToCollection } from '../src/plugin/auto-include';
import {
  PRISMA_NEXT_MODEL,
  PRISMA_NEXT_RELATION,
  PRISMA_NEXT_RELATION_COUNT,
} from '../src/plugin/types';

// ---------------------------------------------------------------------------
// Recording Collection mock
// ---------------------------------------------------------------------------

interface RecordedCall {
  readonly method: string;
  readonly args: ReadonlyArray<unknown>;
  /** Inner walker calls captured when this was an `.include(name, refineFn)`. */
  readonly inner?: ReadonlyArray<RecordedCall>;
  /** Inner branch calls captured when this was a `.combine({...})`. */
  readonly combineBranches?: Readonly<Record<string, ReadonlyArray<RecordedCall>>>;
}

interface RecordingCollection {
  readonly id: string;
  readonly calls: RecordedCall[];
  // Methods the walker uses; each returns a child RecordingCollection.
  select: (...names: string[]) => RecordingCollection;
  include: (
    relName: string,
    refine?: (rel: RecordingCollection) => RecordingCollection,
  ) => RecordingCollection;
  where: (w: unknown) => RecordingCollection;
  orderBy: (o: unknown) => RecordingCollection;
  take: (n: number) => RecordingCollection;
  skip: (n: number) => RecordingCollection;
  count: () => unknown;
  combine: (spec: Record<string, unknown>) => RecordingCollection;
}

let recordingCounter = 0;

function createRecordingCollection(prefix = 'root'): RecordingCollection {
  const id = `${prefix}#${recordingCounter++}`;
  const calls: RecordedCall[] = [];
  const c: RecordingCollection = {
    id,
    calls,
    select(...names: string[]) {
      calls.push({ method: 'select', args: names });
      return c;
    },
    include(relName, refine) {
      const innerCalls: RecordedCall[] = [];
      if (refine) {
        const child = createRecordingChild(`${id}.include(${relName})`, innerCalls);
        refine(child);
      }
      calls.push({ method: 'include', args: [relName], inner: innerCalls });
      return c;
    },
    where(w) {
      calls.push({ method: 'where', args: [w] });
      return c;
    },
    orderBy(o) {
      calls.push({ method: 'orderBy', args: [o] });
      return c;
    },
    take(n) {
      calls.push({ method: 'take', args: [n] });
      return c;
    },
    skip(n) {
      calls.push({ method: 'skip', args: [n] });
      return c;
    },
    count() {
      calls.push({ method: 'count', args: [] });
      return { kind: 'count-marker', from: id };
    },
    combine(spec) {
      const branches: Record<string, ReadonlyArray<RecordedCall>> = {};
      for (const key of Object.keys(spec)) {
        branches[key] = [];
      }
      calls.push({ method: 'combine', args: [Object.keys(spec)], combineBranches: branches });
      return c;
    },
  };
  return c;
}

/**
 * Wrap createRecordingCollection so calls to the *child* (the rel passed
 * to refine) push into the provided innerCalls array. Each refine
 * invocation gets a fresh child collection that records into its own
 * include's `inner` slot.
 */
function createRecordingChild(prefix: string, innerCalls: RecordedCall[]): RecordingCollection {
  const id = `${prefix}#${recordingCounter++}`;
  const c: RecordingCollection = {
    id,
    calls: innerCalls,
    select(...names) {
      innerCalls.push({ method: 'select', args: names });
      return c;
    },
    include(relName, refine) {
      const grandchildCalls: RecordedCall[] = [];
      if (refine) {
        const grandchild = createRecordingChild(`${id}.include(${relName})`, grandchildCalls);
        refine(grandchild);
      }
      innerCalls.push({ method: 'include', args: [relName], inner: grandchildCalls });
      return c;
    },
    where(w) {
      innerCalls.push({ method: 'where', args: [w] });
      return c;
    },
    orderBy(o) {
      innerCalls.push({ method: 'orderBy', args: [o] });
      return c;
    },
    take(n) {
      innerCalls.push({ method: 'take', args: [n] });
      return c;
    },
    skip(n) {
      innerCalls.push({ method: 'skip', args: [n] });
      return c;
    },
    count() {
      innerCalls.push({ method: 'count', args: [] });
      return { kind: 'count-marker', from: id };
    },
    combine(spec) {
      const branches: Record<string, ReadonlyArray<RecordedCall>> = {};
      for (const key of Object.keys(spec)) {
        branches[key] = [];
      }
      innerCalls.push({
        method: 'combine',
        args: [Object.keys(spec)],
        combineBranches: branches,
      });
      return c;
    },
  };
  return c;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

interface RelationExtSpec {
  relationName: string;
  parentModel: string;
  targetModel: string;
  cardinality: '1:1' | '1:N' | 'N:1' | 'M:N';
  query?: { where?: unknown; orderBy?: unknown; take?: number; skip?: number };
}

function relationExt(spec: RelationExtSpec): Record<string, unknown> {
  return {
    [PRISMA_NEXT_RELATION]: {
      relationName: spec.relationName,
      parentModel: spec.parentModel,
      targetModel: spec.targetModel,
      cardinality: spec.cardinality,
      opts: spec.query ? { query: spec.query } : {},
    },
  };
}

function relationCountExt(relationName: string, parentModel: string): Record<string, unknown> {
  return {
    [PRISMA_NEXT_RELATION_COUNT]: {
      relationName,
      parentModel,
      opts: {},
    },
  };
}

/**
 * Demo schema fixture: User has a `posts` relation (1:N → Post) and a
 * `bestFriend` relation (1:1 → User self-reference). Post has `comments`
 * (1:N → Comment) and `author` (N:1 → User).
 */
function buildFixtureSchema(): {
  schema: GraphQLSchema;
  User: GraphQLObjectType;
  Post: GraphQLObjectType;
  Comment: GraphQLObjectType;
} {
  const Comment: GraphQLObjectType = new ObjectType({
    name: 'Comment',
    extensions: { [PRISMA_NEXT_MODEL]: 'Comment' },
    fields: () => ({
      id: { type: new GraphQLNonNull(GraphQLID) },
      body: { type: new GraphQLNonNull(GraphQLString) },
      author: {
        type: User,
        extensions: relationExt({
          relationName: 'author',
          parentModel: 'Comment',
          targetModel: 'User',
          cardinality: 'N:1',
        }),
      },
    }),
  });

  const Post: GraphQLObjectType = new ObjectType({
    name: 'Post',
    extensions: { [PRISMA_NEXT_MODEL]: 'Post' },
    fields: () => ({
      id: { type: new GraphQLNonNull(GraphQLID) },
      title: { type: new GraphQLNonNull(GraphQLString) },
      published: { type: new GraphQLNonNull(GraphQLBoolean) },
      comments: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(Comment))),
        extensions: relationExt({
          relationName: 'comments',
          parentModel: 'Post',
          targetModel: 'Comment',
          cardinality: '1:N',
        }),
      },
    }),
  });

  const User: GraphQLObjectType = new ObjectType({
    name: 'User',
    extensions: { [PRISMA_NEXT_MODEL]: 'User' },
    fields: () => ({
      id: { type: new GraphQLNonNull(GraphQLID) },
      firstName: { type: new GraphQLNonNull(GraphQLString) },
      lastName: { type: new GraphQLNonNull(GraphQLString) },
      // Plain include, alias === relationName.
      posts: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(Post))),
        extensions: relationExt({
          relationName: 'posts',
          parentModel: 'User',
          targetModel: 'Post',
          cardinality: '1:N',
        }),
      },
      // Sibling-aliased: backs the same `posts` relation with a static where.
      drafts: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(Post))),
        extensions: relationExt({
          relationName: 'posts',
          parentModel: 'User',
          targetModel: 'Post',
          cardinality: '1:N',
          query: { where: { published: 0 } },
        }),
      },
      publishedPosts: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(Post))),
        extensions: relationExt({
          relationName: 'posts',
          parentModel: 'User',
          targetModel: 'Post',
          cardinality: '1:N',
          query: { where: { published: 1 } },
        }),
      },
      // Peer count.
      postCount: {
        type: new GraphQLNonNull(GraphQLInt),
        extensions: relationCountExt('posts', 'User'),
      },
      // To-one self-reference (1:1 cardinality).
      bestFriend: {
        type: User,
        extensions: relationExt({
          relationName: 'bestFriend',
          parentModel: 'User',
          targetModel: 'User',
          cardinality: '1:1',
        }),
      },
    }),
  });

  const Query = new ObjectType({
    name: 'Query',
    fields: { users: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(User))) } },
  });

  return { schema: new GraphQLSchema({ query: Query }), User, Post, Comment };
}

/**
 * Build a stub BuildCache that exposes the contract the walker needs to
 * read for the W-1 (FK columns) workaround. The relation metadata
 * matches the fixture schema above.
 */
function buildStubBuildCache(): BuildCache<SchemaTypes> {
  const contract = {
    models: {
      User: {
        relations: {
          posts: { on: { localFields: ['id'] } },
          bestFriend: { on: { localFields: ['bestFriendId'] } },
        },
      },
      Post: {
        relations: {
          comments: { on: { localFields: ['id'] } },
          author: { on: { localFields: ['authorId'] } },
        },
      },
      Comment: {
        relations: {
          author: { on: { localFields: ['authorId'] } },
        },
      },
    },
  };
  return {
    builder: { options: { prismaNext: { contract } } },
  } as unknown as BuildCache<SchemaTypes>;
}

/** Parse `query { users { ... } }` and pull out the inner User selection set. */
function selectionSetFromQuery(query: string): SelectionSetNode {
  const doc: DocumentNode = parse(query);
  const op = doc.definitions[0];
  if (op?.kind !== Kind.OPERATION_DEFINITION) throw new Error('Expected operation definition');
  const usersField = op.selectionSet.selections[0] as FieldNode;
  if (!usersField.selectionSet) throw new Error('Expected selection set on `users`');
  return usersField.selectionSet;
}

/**
 * Build a faked GraphQLResolveInfo where `info.returnType` is `[User!]!`
 * and `info.fieldNodes[0].selectionSet` is the parsed selection.
 */
function buildResolveInfo(
  rootType: GraphQLObjectType,
  selectionSet: SelectionSetNode,
): GraphQLResolveInfo {
  const fakeFieldNode: FieldNode = {
    kind: Kind.FIELD,
    name: { kind: Kind.NAME, value: 'users' },
    selectionSet,
  };
  return {
    returnType: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(rootType))),
    fieldNodes: [fakeFieldNode],
    parentType: rootType,
    fieldName: 'users',
    schema: undefined,
    fragments: {},
    rootValue: undefined,
    operation: undefined,
    variableValues: {},
    path: { prev: undefined, key: 'users', typename: undefined },
  } as unknown as GraphQLResolveInfo;
}

// ---------------------------------------------------------------------------
// `apply` path tests — recording Collection captures emitted calls
// ---------------------------------------------------------------------------

describe('auto-include walker · apply path', () => {
  it('emits .select(...) for queried scalar fields only', () => {
    const { User } = buildFixtureSchema();
    const sel = selectionSetFromQuery('{ users { id firstName } }');
    const info = buildResolveInfo(User, sel);

    const base = createRecordingCollection();
    applySelectionToCollection(base as never, info, buildStubBuildCache());

    const selectCall = base.calls.find((c) => c.method === 'select');
    expect(selectCall).toBeDefined();
    // Order is set-iteration; just compare contents.
    expect([...(selectCall?.args ?? [])].sort()).toEqual(['firstName', 'id']);
    // No includes for a query without relations.
    expect(base.calls.find((c) => c.method === 'include')).toBeUndefined();
  });

  it('emits a plain .include(rel, refineFn) for a single-field relation', () => {
    const { User } = buildFixtureSchema();
    const sel = selectionSetFromQuery('{ users { id posts { id title } } }');
    const info = buildResolveInfo(User, sel);

    const base = createRecordingCollection();
    applySelectionToCollection(base as never, info, buildStubBuildCache());

    const includes = base.calls.filter((c) => c.method === 'include');
    expect(includes).toHaveLength(1);
    expect(includes[0]?.args).toEqual(['posts']);
    // Inner refine should select on the child.
    const innerSelect = includes[0]?.inner?.find((c) => c.method === 'select');
    expect(innerSelect).toBeDefined();
    expect([...(innerSelect?.args ?? [])].sort()).toEqual(['id', 'title']);
    // Not a combine.
    expect(includes[0]?.inner?.find((c) => c.method === 'combine')).toBeUndefined();
  });

  it('augments parent .select(...) with relation localFields (W-1 workaround)', () => {
    const { User } = buildFixtureSchema();
    const sel = selectionSetFromQuery('{ users { firstName posts { id } } }');
    const info = buildResolveInfo(User, sel);

    const base = createRecordingCollection();
    applySelectionToCollection(base as never, info, buildStubBuildCache());

    const selectCall = base.calls.find((c) => c.method === 'select');
    // `id` is the localField for posts (mock contract). It should be
    // added to the parent select even though the user didn't query for
    // User.id, so the orm-client's nested-stitch can match.
    expect([...(selectCall?.args ?? [])].sort()).toEqual(['firstName', 'id']);
  });

  it('collapses sibling fields on the same relation into a single .include + .combine', () => {
    const { User } = buildFixtureSchema();
    const sel = selectionSetFromQuery('{ users { drafts { id } publishedPosts { id } } }');
    const info = buildResolveInfo(User, sel);

    const base = createRecordingCollection();
    applySelectionToCollection(base as never, info, buildStubBuildCache());

    const includes = base.calls.filter((c) => c.method === 'include');
    expect(includes).toHaveLength(1);
    expect(includes[0]?.args).toEqual(['posts']);
    const combineCall = includes[0]?.inner?.find((c) => c.method === 'combine');
    expect(combineCall).toBeDefined();
    expect([...((combineCall?.args[0] as string[]) ?? [])].sort()).toEqual([
      'drafts',
      'publishedPosts',
    ]);
  });

  it('puts t.relationCount as a count() branch in the same combine block as siblings', () => {
    const { User } = buildFixtureSchema();
    const sel = selectionSetFromQuery('{ users { drafts { id } postCount } }');
    const info = buildResolveInfo(User, sel);

    const base = createRecordingCollection();
    applySelectionToCollection(base as never, info, buildStubBuildCache());

    const includes = base.calls.filter((c) => c.method === 'include');
    expect(includes).toHaveLength(1);
    const combineCall = includes[0]?.inner?.find((c) => c.method === 'combine');
    expect([...((combineCall?.args[0] as string[]) ?? [])].sort()).toEqual(['drafts', 'postCount']);
    // The `count()` should have been called on the relation collection
    // before being passed into combine.
    const countCall = includes[0]?.inner?.find((c) => c.method === 'count');
    expect(countCall).toBeDefined();
  });

  it('emits combine when a relationCount is queried alone (no peer rows)', () => {
    const { User } = buildFixtureSchema();
    const sel = selectionSetFromQuery('{ users { postCount } }');
    const info = buildResolveInfo(User, sel);

    const base = createRecordingCollection();
    applySelectionToCollection(base as never, info, buildStubBuildCache());

    const includes = base.calls.filter((c) => c.method === 'include');
    expect(includes).toHaveLength(1);
    const combineCall = includes[0]?.inner?.find((c) => c.method === 'combine');
    expect(combineCall).toBeDefined();
    expect(combineCall?.args[0]).toEqual(['postCount']);
  });

  it('applies static field-time refine (where/orderBy/take/skip) to the relation', () => {
    const { User } = buildFixtureSchema();
    const sel = selectionSetFromQuery('{ users { drafts { id } } }');
    const info = buildResolveInfo(User, sel);

    const base = createRecordingCollection();
    applySelectionToCollection(base as never, info, buildStubBuildCache());

    // A single field on a relation (even with a non-matching alias) takes
    // the plain-include path. The reshape handles the alias→relationName
    // lift; no combine emission is needed at the apply level. The
    // refineFn passed to .include() must call .where with the static
    // query so the orm-client filters the relation rows correctly.
    const includes = base.calls.filter((c) => c.method === 'include');
    expect(includes).toHaveLength(1);
    expect(includes[0]?.args).toEqual(['posts']);
    // No combine for a single-branch relation.
    expect(includes[0]?.inner?.find((c) => c.method === 'combine')).toBeUndefined();
    // The static refine should land as a .where on the rel collection.
    const whereCall = includes[0]?.inner?.find((c) => c.method === 'where');
    expect(whereCall).toBeDefined();
    expect(whereCall?.args[0]).toEqual({ published: 0 });
  });

  it('lifts plain-include result onto an aliased GraphQL field name (alias !== relationName)', () => {
    // `drafts: t.relation('posts', { where: ... })` — relation is `posts`
    // but the GraphQL field is `drafts`. Plain include emits result as
    // parent.posts; reshape lifts to parent.drafts so the resolver finds
    // it under the GraphQL field name.
    const { User } = buildFixtureSchema();
    const sel = selectionSetFromQuery('{ users { drafts { id title } } }');
    const info = buildResolveInfo(User, sel);
    const { reshape } = applySelectionToCollection(
      createRecordingCollection() as never,
      info,
      buildStubBuildCache(),
    );

    const row = { id: '1', posts: [{ id: 'p-draft', title: 'WIP' }] };
    const out = reshape(row) as Record<string, unknown>;
    expect(out['drafts']).toEqual([{ id: 'p-draft', title: 'WIP' }]);
  });

  it('recurses into nested relations (depth ≥ 2)', () => {
    const { User } = buildFixtureSchema();
    const sel = selectionSetFromQuery(
      '{ users { posts { id comments { id author { firstName } } } } }',
    );
    const info = buildResolveInfo(User, sel);

    const base = createRecordingCollection();
    applySelectionToCollection(base as never, info, buildStubBuildCache());

    const userIncludes = base.calls.filter((c) => c.method === 'include');
    expect(userIncludes).toHaveLength(1);
    expect(userIncludes[0]?.args).toEqual(['posts']);

    const postsInner = userIncludes[0]?.inner ?? [];
    const postsToCommentsInclude = postsInner.find(
      (c) => c.method === 'include' && c.args[0] === 'comments',
    );
    expect(postsToCommentsInclude).toBeDefined();

    const commentsInner = postsToCommentsInclude?.inner ?? [];
    const commentsToAuthorInclude = commentsInner.find(
      (c) => c.method === 'include' && c.args[0] === 'author',
    );
    expect(commentsToAuthorInclude).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// `reshape` path tests — feed synthetic rows, verify combine lift + recursion
// ---------------------------------------------------------------------------

describe('auto-include walker · reshape path', () => {
  it('is a noop when no relations are queried', () => {
    const { User } = buildFixtureSchema();
    const sel = selectionSetFromQuery('{ users { id firstName } }');
    const info = buildResolveInfo(User, sel);
    const { reshape } = applySelectionToCollection(
      createRecordingCollection() as never,
      info,
      buildStubBuildCache(),
    );

    const row = { id: '1', firstName: 'Alice' };
    expect(reshape(row)).toBe(row);
  });

  it('passes through plain-include results (no lift) when alias === relationName', () => {
    const { User } = buildFixtureSchema();
    const sel = selectionSetFromQuery('{ users { posts { id } } }');
    const info = buildResolveInfo(User, sel);
    const { reshape } = applySelectionToCollection(
      createRecordingCollection() as never,
      info,
      buildStubBuildCache(),
    );

    const row = { id: '1', posts: [{ id: 'p1' }, { id: 'p2' }] };
    const out = reshape(row) as Record<string, unknown>;
    expect(out['posts']).toEqual([{ id: 'p1' }, { id: 'p2' }]);
  });

  it('lifts combine branches onto flat parent keys', () => {
    const { User } = buildFixtureSchema();
    const sel = selectionSetFromQuery(
      '{ users { drafts { id } publishedPosts { id } postCount } }',
    );
    const info = buildResolveInfo(User, sel);
    const { reshape } = applySelectionToCollection(
      createRecordingCollection() as never,
      info,
      buildStubBuildCache(),
    );

    // Simulate orm-client output: combine result lives under the relation name.
    const row = {
      id: '1',
      posts: {
        drafts: [{ id: 'p-draft' }],
        publishedPosts: [{ id: 'p-published' }],
        postCount: 5,
      },
    };
    const out = reshape(row) as Record<string, unknown>;
    expect(out['drafts']).toEqual([{ id: 'p-draft' }]);
    expect(out['publishedPosts']).toEqual([{ id: 'p-published' }]);
    expect(out['postCount']).toBe(5);
  });

  it('recurses into nested relation rows when the inner level has its own combine', () => {
    // To exercise this we need a nested combine. Use the User self-reference
    // (`bestFriend`) at depth-1, with sibling fields backing the same
    // `posts` relation at depth-2.
    const { User } = buildFixtureSchema();
    const sel = selectionSetFromQuery('{ users { id bestFriend { id drafts { id } postCount } } }');
    const info = buildResolveInfo(User, sel);
    const { reshape } = applySelectionToCollection(
      createRecordingCollection() as never,
      info,
      buildStubBuildCache(),
    );

    const row = {
      id: '1',
      bestFriend: {
        id: '2',
        // The inner level's combine result.
        posts: {
          drafts: [{ id: 'p-draft' }],
          postCount: 3,
        },
      },
    };
    const out = reshape(row) as { bestFriend: { id: string; drafts: unknown; postCount: number } };
    expect(out.bestFriend.id).toBe('2');
    expect(out.bestFriend.drafts).toEqual([{ id: 'p-draft' }]);
    expect(out.bestFriend.postCount).toBe(3);
  });

  it('handles a null to-one relation (passthrough)', () => {
    const { User } = buildFixtureSchema();
    const sel = selectionSetFromQuery('{ users { bestFriend { id firstName } } }');
    const info = buildResolveInfo(User, sel);
    const { reshape } = applySelectionToCollection(
      createRecordingCollection() as never,
      info,
      buildStubBuildCache(),
    );

    const row = { id: '1', bestFriend: null };
    const out = reshape(row) as Record<string, unknown>;
    expect(out['bestFriend']).toBeNull();
  });

  it('handles an empty to-many relation (empty array passthrough)', () => {
    const { User } = buildFixtureSchema();
    const sel = selectionSetFromQuery('{ users { posts { id } } }');
    const info = buildResolveInfo(User, sel);
    const { reshape } = applySelectionToCollection(
      createRecordingCollection() as never,
      info,
      buildStubBuildCache(),
    );

    const row = { id: '1', posts: [] };
    const out = reshape(row) as Record<string, unknown>;
    expect(out['posts']).toEqual([]);
  });

  it('does not corrupt a row that lacks the relation key entirely', () => {
    const { User } = buildFixtureSchema();
    const sel = selectionSetFromQuery('{ users { id posts { id } } }');
    const info = buildResolveInfo(User, sel);
    const { reshape } = applySelectionToCollection(
      createRecordingCollection() as never,
      info,
      buildStubBuildCache(),
    );

    const row = { id: '1' }; // posts not present (would happen if upstream load failed)
    const out = reshape(row) as Record<string, unknown>;
    // Reshape should not invent a `posts` key.
    expect(Object.keys(out).sort()).toEqual(['id']);
  });
});
