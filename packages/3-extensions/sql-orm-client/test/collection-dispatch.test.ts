import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { resolveIncludeRelation } from '../src/collection-contract';
import { dispatchCollectionRows } from '../src/collection-dispatch';
import { type CollectionState, emptyState, type IncludeExpr } from '../src/types';
import { createCollectionFor } from './collection-fixtures';
import type { MockRuntime, TestContract } from './helpers';
import {
  buildMixedPolyContract,
  buildStiPolyContract,
  createMockRuntime,
  getTestContract,
  withCapabilities,
} from './helpers';

function includeFor(
  contract: Contract<SqlStorage>,
  parentModel: string,
  relationName: string,
  nested: CollectionState = emptyState(),
): IncludeExpr {
  const relation = resolveIncludeRelation(contract, parentModel, relationName);
  return {
    relationName,
    relatedModelName: relation.relatedModelName,
    relatedTableName: relation.relatedTableName,
    targetColumn: relation.targetColumn,
    localColumn: relation.localColumn,
    cardinality: relation.cardinality,
    nested,
    scalar: undefined,
    combine: undefined,
  };
}

function stateWithInclude(include: IncludeExpr): CollectionState {
  return { ...emptyState(), includes: [include] };
}

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
    // Guards against regressing single-query include dispatch. This test
    // fails fast if a multi-query fallback returns: an emitted-shape
    // contract should resolve a depth-1 include in one SQL execution,
    // not two.
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
    // unconditionally fall back to a multi-query path, regardless of the
    // contract's declared capabilities. On an emitted-shape contract
    // that advertises `postgres.lateral` + `postgres.jsonAgg`, a
    // `users -> posts -> comments` tree should resolve in one SQL
    // execution, not three (parent + posts + comments).
    const contract = withEmittedSqlCapabilities(getTestContract());
    const { collection, runtime } = createCollectionFor('User', contract);
    const scoped = collection
      .select('name')
      .include('posts', (posts) => posts.select('title').include('comments'));

    // The correlated builder produces one JSON column per top-level
    // include; nested includes appear as nested JSON values (already
    // parsed by JSON.parse inside the include payload — they are not
    // stringified a second time). This shape mirrors what `json_array_agg`
    // over a correlated subquery with a nested correlated subquery emits.
    //
    // The posts payload only carries `title` and `comments` because the
    // SQL projection is restricted by `.select('title')` plus the nested
    // aggregate column. Join keys (`posts.user_id`, `comments.post_id`)
    // are referenced by WHERE clauses inside the subquery and never
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
    // tree: `users -> posts -> author`. The correlated builder must
    // recursively wire a nested subquery even when the inner edge
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

  it('dispatchCollectionRows() decodes STI-target include child rows to their discriminator variant', async () => {
    const contract = withSingleQueryCapabilities(buildStiPolyContract());
    const runtime = createMockRuntime();
    const state = stateWithInclude(includeFor(contract, 'Account', 'members'));
    // Both STI variant columns live in the base table, so the child SELECT
    // projects both for every row; the non-matching variant's column is NULL.
    // Decoding by discriminator must keep the matching variant's field and
    // strip the other variant's NULL column entirely.
    runtime.setNextResults([
      [
        {
          id: 1,
          name: 'Acme',
          members:
            '[{"id":10,"name":"Ada","email":"ada@example.com","kind":"admin","role":"owner","plan":null},{"id":11,"name":"Bo","email":"bo@example.com","kind":"regular","role":null,"plan":"free"}]',
        },
      ],
    ]);

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract,
      runtime,
      state,
      tableName: 'accounts',
      modelName: 'Account',
    }).toArray();

    const members = (rows[0] as { members: Record<string, unknown>[] }).members;
    expect(members[0]).toEqual({
      id: 10,
      name: 'Ada',
      email: 'ada@example.com',
      kind: 'admin',
      role: 'owner',
    });
    expect(members[0]).not.toHaveProperty('plan');
    expect(members[1]).toEqual({
      id: 11,
      name: 'Bo',
      email: 'bo@example.com',
      kind: 'regular',
      plan: 'free',
    });
    expect(members[1]).not.toHaveProperty('role');
  });

  it('dispatchCollectionRows() decodes MTI-target include child rows, surfacing variant columns under their field names', async () => {
    const contract = withSingleQueryCapabilities(buildMixedPolyContract());
    const runtime = createMockRuntime();
    const state = stateWithInclude(includeFor(contract, 'Project', 'tasks'));
    runtime.setNextResults([
      [
        {
          id: 1,
          name: 'Roadmap',
          tasks:
            '[{"id":10,"title":"Crash","type":"bug","severity":"critical","project_id":1,"features__priority":null},{"id":11,"title":"Dark mode","type":"feature","severity":null,"project_id":1,"features__priority":7}]',
        },
      ],
    ]);

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract,
      runtime,
      state,
      tableName: 'projects_tbl',
      modelName: 'Project',
    }).toArray();

    const tasks = (rows[0] as { tasks: Record<string, unknown>[] }).tasks;
    expect(tasks[0]).toMatchObject({ id: 10, title: 'Crash', type: 'bug', severity: 'critical' });
    expect(tasks[0]).not.toHaveProperty('priority');
    expect(tasks[1]).toMatchObject({ id: 11, title: 'Dark mode', type: 'feature', priority: 7 });
    expect(tasks[1]).not.toHaveProperty('severity');
  });

  it('dispatchCollectionRows() maps a variant-narrowed include via its named variant', async () => {
    const contract = withSingleQueryCapabilities(buildMixedPolyContract());
    const runtime = createMockRuntime();
    // A variant-narrowed include carries `variantName` on the include's nested
    // state. The decode side reads that to map every child row to the named
    // variant rather than resolving per-row by discriminator.
    const state = stateWithInclude(
      includeFor(contract, 'Project', 'tasks', { ...emptyState(), variantName: 'Feature' }),
    );

    runtime.setNextResults([
      [
        {
          id: 1,
          name: 'Roadmap',
          tasks:
            '[{"id":11,"title":"Dark mode","type":"feature","project_id":1,"features__priority":7}]',
        },
      ],
    ]);

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract,
      runtime,
      state,
      tableName: 'projects_tbl',
      modelName: 'Project',
    }).toArray();

    const tasks = (rows[0] as { tasks: Record<string, unknown>[] }).tasks;
    expect(tasks[0]).toMatchObject({ id: 11, title: 'Dark mode', type: 'feature', priority: 7 });
    expect(tasks[0]).not.toHaveProperty('severity');
  });

  // ---------------------------------------------------------------------------
  // Single-query include child-row codec decoding — DEFERRED follow-up.
  //
  // The three `it.skip` blocks below are placeholders for the case where the
  // single-query include builder (correlated jsonb_agg payload)
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
