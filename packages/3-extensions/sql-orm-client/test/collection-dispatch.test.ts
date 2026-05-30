import { describe, expect, it } from 'vitest';
import { dispatchCollectionRows } from '../src/collection-dispatch';
import { createCollectionFor } from './collection-fixtures';
import type { MockRuntime, TestContract } from './helpers';
import { getTestContract, withCapabilities } from './helpers';

function withSingleQueryCapabilities(contract: TestContract) {
  return withCapabilities(contract, {
    ...contract.capabilities,
    [contract.targetFamily]: {
      ...(contract.capabilities[contract.targetFamily] ?? {}),
      jsonAgg: true,
    },
    [contract.target]: {
      ...(contract.capabilities[contract.target] ?? {}),
      jsonAgg: true,
      lateral: true,
    },
  });
}

/**
 * Mirrors the shape produced by the contract emitter: capability flags
 * nested under the family + target namespaces, with no top-level entries.
 * Used to assert "single-query path is selected for an emitted-shape
 * contract" — the regression scenario the principled namespaced lookup
 * was introduced to handle.
 */
function withEmittedSqlCapabilities(contract: TestContract) {
  return withCapabilities(contract, {
    sql: { jsonAgg: true, returning: true },
    postgres: { jsonAgg: true, lateral: true, returning: true },
  });
}

function addConnection(
  runtime: MockRuntime,
  onRelease: () => void,
): MockRuntime & {
  connection: () => Promise<{
    execute: MockRuntime['execute'];
    release: () => Promise<void>;
  }>;
} {
  return Object.assign(runtime, {
    async connection() {
      return {
        execute: runtime.execute.bind(runtime),
        async release() {
          onRelease();
        },
      };
    },
  });
}

describe('collection-dispatch', () => {
  it('dispatchCollectionRows() maps rows when includes are absent', async () => {
    const { collection, runtime } = createCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract: collection.ctx.context.contract,
      runtime,
      state: collection.state,
      tableName: collection.tableName,
      modelName: collection.modelName,
    }).toArray();

    expect(rows).toEqual([{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
  });

  it('dispatchCollectionRows() depth-1 include with emitted-shape capabilities fires a single SQL execution (regression guard for namespaced capability lookup)', async () => {
    // Guards against regressing the fix that taught `selectIncludeStrategy`
    // to read capability flags from the contract's `targetFamily` and
    // `target` namespaces. Prior to that fix, every emitted contract fell
    // back to multi-query for nested includes — silently, because
    // functional correctness was unaffected. This test fails fast if the
    // regression returns: an emitted-shape contract should resolve a
    // depth-1 include in one SQL execution, not two.
    const contract = withEmittedSqlCapabilities(getTestContract());
    const { collection, runtime } = createCollectionFor('User', contract);
    const scoped = collection.select('name').include('posts');
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', posts: '[{"id":10,"title":"Post A","user_id":1,"views":3}]' }],
    ]);

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract,
      runtime,
      state: scoped.state,
      tableName: scoped.tableName,
      modelName: scoped.modelName,
    }).toArray();

    expect(rows).toEqual([
      { name: 'Alice', posts: [{ id: 10, title: 'Post A', userId: 1, views: 3 }] },
    ]);
    // The point of the test: 1 execution, not N+1.
    expect(runtime.executions).toHaveLength(1);
  });

  it('dispatchCollectionRows() depth-2 nested include with emitted-shape capabilities fires a single SQL execution', async () => {
    // Regression guard for the TML-2594 fix: depth-2 includes used to
    // unconditionally fall back to the multi-query strategy via the
    // `hasNestedIncludes` arm of `dispatchWithIncludeStrategy`, regardless
    // of the contract's declared capabilities. On an emitted-shape
    // contract that advertises `postgres.lateral` + `postgres.jsonAgg`,
    // a `users -> posts -> comments` tree should resolve in one SQL
    // execution, not three (parent + posts + comments).
    const contract = withEmittedSqlCapabilities(getTestContract());
    const { collection, runtime } = createCollectionFor('User', contract);
    const scoped = collection
      .select('name')
      .include('posts', (posts) => posts.select('title').include('comments'));

    // The lateral builder produces one JSON column per top-level include;
    // nested includes appear as nested JSON values (already parsed by
    // JSON.parse inside the include payload — they are not stringified
    // a second time). This shape mirrors what `json_array_agg` over a
    // LATERAL JOIN with a nested LATERAL JOIN actually emits.
    //
    // The posts payload only carries `title` and `comments` because the
    // SQL projection is restricted by `.select('title')` plus the nested
    // aggregate column. Join keys (`posts.user_id`, `comments.post_id`)
    // are referenced by WHERE clauses inside the lateral and never
    // projected to the parent's result row.
    runtime.setNextResults([
      [
        {
          id: 1,
          name: 'Alice',
          posts:
            '[{"title":"Post A","comments":[{"id":100,"body":"hi","post_id":10},{"id":101,"body":"there","post_id":10}]},{"title":"Post B","comments":[]}]',
        },
      ],
    ]);

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract,
      runtime,
      state: scoped.state,
      tableName: scoped.tableName,
      modelName: scoped.modelName,
    }).toArray();

    expect(rows).toEqual([
      {
        name: 'Alice',
        posts: [
          {
            title: 'Post A',
            comments: [
              { id: 100, body: 'hi', postId: 10 },
              { id: 101, body: 'there', postId: 10 },
            ],
          },
          { title: 'Post B', comments: [] },
        ],
      },
    ]);
    expect(runtime.executions).toHaveLength(1);
  });

  it('dispatchCollectionRows() depth-2 mixed cardinality (to-many -> to-one) fires a single SQL execution', async () => {
    // Same regression guard, but covers the to-one leg of the depth-2
    // tree: `users -> posts -> author`. The lateral builder must
    // recursively wire a nested LATERAL JOIN even when the inner edge
    // collapses to a single object via `coerceSingleQueryIncludeResult`.
    const contract = withEmittedSqlCapabilities(getTestContract());
    const { collection, runtime } = createCollectionFor('User', contract);
    const scoped = collection
      .select('name')
      .include('posts', (posts) => posts.select('title').include('author'));

    // `.select('title')` on posts restricts the inner projection to
    // `title` + the `author` aggregate column. `author` itself carries
    // a full User row (no inner select) so all User columns appear.
    runtime.setNextResults([
      [
        {
          id: 1,
          name: 'Alice',
          posts:
            '[{"title":"Post A","author":[{"id":1,"name":"Alice","email":"alice@example.com","invited_by_id":null,"address":null}]},{"title":"Post B","author":[]}]',
        },
      ],
    ]);

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract,
      runtime,
      state: scoped.state,
      tableName: scoped.tableName,
      modelName: scoped.modelName,
    }).toArray();

    expect(rows).toEqual([
      {
        name: 'Alice',
        posts: [
          {
            title: 'Post A',
            author: {
              id: 1,
              name: 'Alice',
              email: 'alice@example.com',
              invitedById: null,
              address: null,
            },
          },
          { title: 'Post B', author: null },
        ],
      },
    ]);
    expect(runtime.executions).toHaveLength(1);
  });

  it('dispatchCollectionRows() single-query path returns empty rows and releases scope', async () => {
    const contract = withSingleQueryCapabilities(getTestContract());
    const { collection, runtime } = createCollectionFor('User', contract);
    const scoped = collection.include('posts');
    runtime.setNextResults([[]]);

    let released = false;
    const runtimeWithConnection = addConnection(runtime, () => {
      released = true;
    });

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract,
      runtime: runtimeWithConnection,
      state: scoped.state,
      tableName: scoped.tableName,
      modelName: scoped.modelName,
    }).toArray();

    expect(rows).toEqual([]);
    expect(released).toBe(true);
  });

  it('dispatchCollectionRows() single-query path parses include payloads and strips hidden join columns', async () => {
    const contract = withSingleQueryCapabilities(getTestContract());
    const { collection, runtime } = createCollectionFor('User', contract);
    const scoped = collection.select('name').include('posts');
    runtime.setNextResults([
      [
        {
          id: 1,
          name: 'Alice',
          posts: '[{"id":10,"title":"Post A","user_id":1,"views":3},42,null]',
        },
        {
          id: 2,
          name: 'Bob',
          posts: 'not-json',
        },
        {
          id: 3,
          name: 'Cara',
          posts: null,
        },
        {
          id: 4,
          name: 'Drew',
          posts: '{"id":99}',
        },
      ],
    ]);

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract,
      runtime,
      state: scoped.state,
      tableName: scoped.tableName,
      modelName: scoped.modelName,
    }).toArray();

    expect(rows).toEqual([
      {
        name: 'Alice',
        posts: [{ id: 10, title: 'Post A', userId: 1, views: 3 }],
      },
      {
        name: 'Bob',
        posts: [],
      },
      {
        name: 'Cara',
        posts: [],
      },
      {
        name: 'Drew',
        posts: [],
      },
    ]);
  });

  it('dispatchCollectionRows() single-query to-one include returns mapped row or null', async () => {
    const contract = withSingleQueryCapabilities(getTestContract());
    const { collection, runtime } = createCollectionFor('Post', contract);
    const scoped = collection.select('title').include('author');
    runtime.setNextResults([
      [
        {
          user_id: 1,
          title: 'Has Author',
          author: '[{"id":1,"name":"Alice","email":"alice@example.com"}]',
        },
        {
          user_id: null,
          title: 'No Author',
          author: '[]',
        },
      ],
    ]);

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract,
      runtime,
      state: scoped.state,
      tableName: scoped.tableName,
      modelName: scoped.modelName,
    }).toArray();

    expect(rows).toEqual([
      {
        title: 'Has Author',
        author: {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
        },
      },
      {
        title: 'No Author',
        author: null,
      },
    ]);
  });

  // ---------------------------------------------------------------------------
  // Single-query include child-row codec decoding — DEFERRED follow-up.
  //
  // The three `it.skip` blocks below are placeholders for the case where the
  // single-query include strategy (lateral / correlated jsonb_agg payload)
  // routes embedded child rows through the codec registry and surfaces
  // decoded values (or wrapped failures) on each child cell. The titles
  // describe what each case would assert under the single-path always-await
  // runtime; the bodies are stubbed and not carried over verbatim from any
  // historical implementation.
  //
  // The deferral is structural: the current `dispatchCollectionRows`
  // single-query path (packages/3-extensions/sql-orm-client/src/
  // collection-dispatch.ts) only JSON.parses the include payload and
  // applies field-name mapping; it does not invoke codec query-time methods
  // on child cells (`rg 'codec\.(encode|decode)' packages/3-extensions/
  // sql-orm-client/src` returns zero matches). Adding child-row codec
  // decoding to the single-query include path is a separate piece of ORM
  // work, orthogonal to the codec async-shape decision tracked in ADR 204.
  // ---------------------------------------------------------------------------
  it.skip('dispatchCollectionRows() single-query include decodes async child fields and validates decoded values', async () => {
    // Activates when child-row codec decoding is added to the single-query
    // include path; assertions will express the single-path always-await
    // contract (plain decoded values, no Promises).
  });

  it.skip('dispatchCollectionRows() single-query include preserves JSON schema validation failures for async child decodes', async () => {
    // Activates with the orm-include-aggregate-codec-dispatch follow-up;
    // will assert that JSON schema validation failures on async child cells
    // are reported via the runtime envelope (RUNTIME.VALIDATION_FAILED).
  });

  it.skip('dispatchCollectionRows() single-query include wraps async child decode failures with codec context', async () => {
    // Activates with the orm-include-aggregate-codec-dispatch follow-up;
    // will assert that decode rejections on child cells are wrapped with
    // codec id + lane context (RUNTIME.DECODE_FAILED).
  });
});
