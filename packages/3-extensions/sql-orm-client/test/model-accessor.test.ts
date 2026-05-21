import { createSqlOperationRegistry } from '@prisma-next/sql-operations';
import type { CodecTrait } from '@prisma-next/sql-relational-core/ast';
import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  ListExpression,
  NotExpr,
  NullCheckExpr,
  OperationExpr,
  OrderByItem,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createModelAccessor } from '../src/model-accessor';
import { getTestContext, getTestContract, withPatchedDomainModels } from './helpers';
import { unboundTables } from './unbound-tables';

describe('createModelAccessor', () => {
  const context = getTestContext();

  function paramRef(table: string, column: string, value: unknown): ParamRef {
    const tables = unboundTables(context.contract.storage) as Record<
      string,
      { columns: Record<string, { codecId?: string }> } | undefined
    >;
    const codecId = tables[table]?.columns[column]?.codecId;
    return codecId ? ParamRef.of(value, { codec: { codecId } }) : ParamRef.of(value);
  }

  function expectBinaryParam(
    actual: unknown,
    table: string,
    column: string,
    op: BinaryExpr['op'],
    value: unknown,
  ) {
    expect(actual).toEqual(
      new BinaryExpr(op, ColumnRef.of(table, column), paramRef(table, column, value)),
    );
  }

  function makeDescriptors(
    entries: Record<string, readonly CodecTrait[]>,
  ): typeof context.codecDescriptors {
    const map = new Map(
      Object.entries(entries).map(([codecId, traits]) => [
        codecId,
        {
          codecId,
          traits,
          targetTypes: [] as readonly string[],
          paramsSchema: {
            '~standard': {
              version: 1 as const,
              vendor: 'test',
              validate: (_value: unknown) => ({ value: undefined }),
            },
          },
          isParameterized: false,
          // The trait-gating tests don't materialize codecs; the factory is shape-only and never invoked.
          factory: () => () => {
            throw new Error('test descriptor factory not exercised');
          },
        },
      ]),
    );
    return {
      descriptorFor: (id) => map.get(id),
      codecRefForColumn: () => undefined,
      values: function* () {
        yield* map.values();
      },
      byTargetType: () => Object.freeze([]),
    };
  }

  it('creates scalar comparison operators and maps fields to columns', () => {
    const user = createModelAccessor(context, 'User');
    const post = createModelAccessor(context, 'Post');

    expectBinaryParam(user['name']!.eq('Alice'), 'users', 'name', 'eq', 'Alice');
    expectBinaryParam(
      user['email']!.neq('test@example.com'),
      'users',
      'email',
      'neq',
      'test@example.com',
    );
    expectBinaryParam(post['views']!.gt(1000), 'posts', 'views', 'gt', 1000);
    expectBinaryParam(post['views']!.lt(100), 'posts', 'views', 'lt', 100);
    expectBinaryParam(post['id']!.gte(5), 'posts', 'id', 'gte', 5);
    expectBinaryParam(post['id']!.lte(10), 'posts', 'id', 'lte', 10);
    expectBinaryParam(post['userId']!.eq(42), 'posts', 'user_id', 'eq', 42);
    expectBinaryParam(user['name']!.like('%Ali%'), 'users', 'name', 'like', '%Ali%');
  });

  it('creates ilike as trait-matched extension operation returning predicate', () => {
    const user = createModelAccessor(context, 'User');
    const ilike = user['name']!.ilike;
    const result = ilike('%ali%');
    expect(result).toBeInstanceOf(OperationExpr);
    const op = result as OperationExpr;
    expect(op.method).toBe('ilike');
    expect(op.self).toEqual(ColumnRef.of('users', 'name'));
  });

  it('does not expose ilike on non-textual fields', () => {
    const post = createModelAccessor(context, 'Post');
    const field = post['views'] as unknown as Record<string, unknown>;
    expect(field['ilike']).toBeUndefined();
  });

  it('creates list literal, null check, and order directive helpers', () => {
    const accessor = createModelAccessor(context, 'Post');

    expect(accessor['id']!.in([1, 2, 3])).toEqual(
      BinaryExpr.in(
        ColumnRef.of('posts', 'id'),
        ListExpression.of([
          paramRef('posts', 'id', 1),
          paramRef('posts', 'id', 2),
          paramRef('posts', 'id', 3),
        ]),
      ),
    );
    expect(accessor['id']!.notIn([4, 5])).toEqual(
      BinaryExpr.notIn(
        ColumnRef.of('posts', 'id'),
        ListExpression.of([paramRef('posts', 'id', 4), paramRef('posts', 'id', 5)]),
      ),
    );
    expect(accessor['id']!.asc()).toEqual(OrderByItem.asc(ColumnRef.of('posts', 'id')));
    expect(accessor['id']!.desc()).toEqual(OrderByItem.desc(ColumnRef.of('posts', 'id')));

    const user = createModelAccessor(context, 'User');
    expect(user['email']!.isNull()).toEqual(NullCheckExpr.isNull(ColumnRef.of('users', 'email')));
    expect(user['email']!.isNotNull()).toEqual(
      NullCheckExpr.isNotNull(ColumnRef.of('users', 'email')),
    );
  });

  it('creates some() relation filters as EXISTS subqueries', () => {
    const accessor = createModelAccessor(context, 'User');

    expect(accessor['posts']!.some()).toEqual(
      ExistsExpr.exists(
        SelectAst.from(TableSource.named('posts'))
          .withProjection([ProjectionItem.of('_exists', ColumnRef.of('posts', 'user_id'))])
          .withWhere(BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id'))),
      ),
    );
  });

  it('creates none() and every() relation filters with NOT EXISTS semantics', () => {
    const accessor = createModelAccessor(context, 'User');

    const noneExpr = accessor['posts']!.none({ views: 10 }) as ExistsExpr;
    expect(noneExpr.notExists).toBe(true);
    expect(noneExpr.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
        BinaryExpr.eq(ColumnRef.of('posts', 'views'), paramRef('posts', 'views', 10)),
      ]),
    );

    const everyExpr = accessor['posts']!.every((post) => post['views']!.gt(10)) as ExistsExpr;
    expect(everyExpr.notExists).toBe(true);
    expect(everyExpr.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
        new NotExpr(BinaryExpr.gt(ColumnRef.of('posts', 'views'), paramRef('posts', 'views', 10))),
      ]),
    );
  });

  it('treats every({}) as vacuously true and none() as a plain anti-exists join', () => {
    const accessor = createModelAccessor(context, 'User');

    expect(accessor['posts']!.every({})).toEqual(AndExpr.true());

    const expr = accessor['posts']!.none() as ExistsExpr;
    expect(expr.notExists).toBe(true);
    expect(expr.subquery.where).toEqual(
      BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
    );
  });

  it('supports nested relation filters', () => {
    const accessor = createModelAccessor(context, 'User');
    const expr = accessor['posts']!.some((post) =>
      post['comments']!.some((comment) => comment['body']!.like('%urgent%')),
    ) as ExistsExpr;

    expect(expr.subquery.where!.kind).toBe('and');
    const where = expr.subquery.where! as AndExpr;
    expect(where.exprs[1]!.kind).toBe('exists');
  });

  it('keeps proxy symbol access undefined and relation shorthand maps null and undefined', () => {
    const user = createModelAccessor(context, 'User');
    expect((user as Record<PropertyKey, unknown>)[Symbol.iterator]).toBeUndefined();

    // Unknown fields in a shorthand predicate are surfaced loudly — silent skip would drop user intent (a typo'd filter would match every row).
    expect(() => user['posts']!.some({ unknown: 'value' })).toThrow(
      /Shorthand filter on "Post\.unknown": field is not defined on the model/,
    );

    // Undefined values are skipped before the field lookup, so a shorthand with an unknown field and undefined value is a no-op.
    const someUndefined = user['posts']!.some({ unknown: undefined }) as ExistsExpr;
    expect(someUndefined.subquery.where).toEqual(
      BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
    );

    const post = createModelAccessor(context, 'Post');
    const nullExpr = post['comments']!.some({ body: null }) as ExistsExpr;
    expect(nullExpr.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('comments', 'post_id'), ColumnRef.of('posts', 'id')),
        NullCheckExpr.isNull(ColumnRef.of('comments', 'body')),
      ]),
    );
  });

  it('throws when relation metadata is incomplete', () => {
    const base = getTestContract();
    const brokenJoinContract = withPatchedDomainModels(base, (models) => ({
      ...models,
      User: {
        ...(models['User'] as Record<string, unknown>),
        relations: {
          posts: {
            to: { model: 'Post', namespace: '__unbound__' },
            cardinality: '1:N',
            on: {
              localFields: [],
              targetFields: [],
            },
          },
        },
      },
    }));

    expect(() =>
      (
        createModelAccessor(
          { ...context, contract: brokenJoinContract } as never,
          'User',
        ) as unknown as Record<string, { some: () => unknown }>
      )['posts']!.some(),
    ).toThrow(/missing join columns/);
  });

  it('supports composite relation joins and first-target fallback projection', () => {
    const base = getTestContract();
    const compositeContract = withPatchedDomainModels(base, (models) => {
      const user = models['User'] as {
        storage: Record<string, unknown>;
        relations: Record<string, unknown>;
      };
      return {
        ...models,
        User: {
          ...user,
          storage: {
            ...user.storage,
            table: 'users_alt',
          },
          relations: {
            ...user.relations,
            posts: {
              to: { model: 'Post', namespace: '__unbound__' },
              cardinality: '1:N',
              on: {
                localFields: ['id', 'email'],
                targetFields: ['userId', 'title'],
              },
            },
          },
        },
      };
    });

    const compositeExpr = (
      createModelAccessor(
        { ...context, contract: compositeContract } as never,
        'User',
      ) as unknown as Record<string, { some: () => unknown }>
    )['posts']!.some() as ExistsExpr;
    expect(compositeExpr.subquery.projection).toEqual([
      ProjectionItem.of('_exists', ColumnRef.of('posts', 'user_id')),
    ]);
    expect(compositeExpr.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users_alt', 'id')),
        BinaryExpr.eq(ColumnRef.of('posts', 'title'), ColumnRef.of('users_alt', 'email')),
      ]),
    );

    const noTargetFieldsContract = withPatchedDomainModels(base, (models) => {
      const user = models['User'] as {
        storage: Record<string, unknown>;
        relations: Record<string, unknown>;
      };
      return {
        ...models,
        User: {
          ...user,
          storage: {
            ...user.storage,
            table: 'users_alt',
          },
          relations: {
            ...user.relations,
            posts: {
              to: { model: 'Post', namespace: '__unbound__' },
              cardinality: '1:N',
              on: {
                localFields: ['id', 'name'],
                targetFields: [undefined, 'title'],
              },
            },
          },
        },
      };
    });

    const fallbackExpr = (
      createModelAccessor(
        { ...context, contract: noTargetFieldsContract } as never,
        'User',
      ) as unknown as Record<string, { some: () => unknown }>
    )['posts']!.some() as ExistsExpr;
    expect(fallbackExpr.subquery.projection).toEqual([
      ProjectionItem.of('_exists', ColumnRef.of('posts', 'id')),
    ]);
  });

  it('returns undefined for fields whose storage table is not declared', () => {
    const base = getTestContract();
    const storageFallbackContract = withPatchedDomainModels(base, (models) => {
      const user = models['User'] as { storage: Record<string, unknown> };
      return {
        ...models,
        User: {
          ...user,
          storage: {
            ...user.storage,
            table: 'users_storage',
          },
        },
      };
    });

    // Contract claims the User model lives in `users_storage`, but storage.tables has no entry for it. The Proxy returns undefined for fields whose column cannot be resolved, matching plain JS object semantics. Downstream consumers (or TypeScript at compile time) are responsible for noticing the missing column.
    const accessor = createModelAccessor(
      { ...context, contract: storageFallbackContract } as never,
      'User',
    );
    expect(accessor['name']).toBeUndefined();
  });

  it('resolves column when storage.table maps to a declared table with the field', () => {
    const base = getTestContract();
    const modelNameFallbackContract = withPatchedDomainModels(base, (models) => ({
      ...models,
      User: {
        ...(models['User'] as Record<string, unknown>),
        storage: { table: 'users' },
        relations: {},
      },
    }));

    expect(
      createModelAccessor({ ...context, contract: modelNameFallbackContract } as never, 'User')[
        'name'
      ]!.isNull(),
    ).toEqual(NullCheckExpr.isNull(ColumnRef.of('users', 'name')));
  });

  it('combines relation shorthand fields with and() and rejects missing join arrays', () => {
    const accessor = createModelAccessor(context, 'User');
    const predicate = accessor['posts']!.some({ title: 'A', views: 1 }) as ExistsExpr;

    expect(predicate.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('posts', 'title'), paramRef('posts', 'title', 'A')),
          BinaryExpr.eq(ColumnRef.of('posts', 'views'), paramRef('posts', 'views', 1)),
        ]),
      ]),
    );

    const base = getTestContract();
    const contractWithoutJoinArrays = withPatchedDomainModels(base, (models) => ({
      ...models,
      User: {
        ...(models['User'] as Record<string, unknown>),
        relations: {
          posts: {
            to: { model: 'Post', namespace: '__unbound__' },
            cardinality: '1:N',
            on: { localFields: [], targetFields: [] },
          },
        },
      },
    }));

    expect(() =>
      (
        createModelAccessor(
          { ...context, contract: contractWithoutJoinArrays } as never,
          'User',
        ) as unknown as Record<string, { some: () => unknown }>
      )['posts']!.some(),
    ).toThrow(/missing join columns/);
  });

  describe('runtime trait-gating', () => {
    it('only creates equality methods when codec has equality trait', () => {
      const codecDescriptors = makeDescriptors({ 'pg/int4@1': ['equality'] });
      const accessor = createModelAccessor({ ...context, codecDescriptors }, 'Post');
      const field = accessor['id'] as unknown as Record<string, unknown>;

      expect(typeof field['eq']).toBe('function');
      expect(typeof field['neq']).toBe('function');
      expect(typeof field['in']).toBe('function');
      expect(typeof field['notIn']).toBe('function');
      expect(typeof field['isNull']).toBe('function');
      expect(typeof field['isNotNull']).toBe('function');

      expect(field['gt']).toBeUndefined();
      expect(field['lt']).toBeUndefined();
      expect(field['gte']).toBeUndefined();
      expect(field['lte']).toBeUndefined();
      expect(field['like']).toBeUndefined();
      expect(field['asc']).toBeUndefined();
      expect(field['desc']).toBeUndefined();
    });

    it('creates all methods when codec has all relevant traits', () => {
      const codecDescriptors = makeDescriptors({
        'pg/text@1': ['equality', 'order', 'textual'],
      });
      const accessor = createModelAccessor({ ...context, codecDescriptors }, 'User');
      const field = accessor['name'] as unknown as Record<string, unknown>;

      for (const method of [
        'eq',
        'neq',
        'gt',
        'lt',
        'gte',
        'lte',
        'like',
        'in',
        'notIn',
        'isNull',
        'isNotNull',
        'asc',
        'desc',
      ]) {
        expect(typeof field[method]).toBe('function');
      }
    });

    it('throws when relation shorthand filter targets a field without equality trait', () => {
      const codecDescriptors = makeDescriptors({ 'pg/int4@1': ['order'] });
      const accessor = createModelAccessor({ ...context, codecDescriptors }, 'Post');

      expect(() => accessor['comments']!.some({ postId: 42 })).toThrow(
        /does not support equality comparisons/,
      );
    });
  });

  describe('extension operations', () => {
    it('attaches trait-targeted op only when codec traits are a superset of required traits', () => {
      const queryOperations = createSqlOperationRegistry();
      queryOperations.register('synthetic', {
        self: { traits: ['equality', 'textual'] },
        impl: () => undefined as never,
      });

      const traitsByCodec: Record<string, readonly CodecTrait[]> = {
        'pg/text@1': ['equality', 'textual'],
        'pg/int4@1': ['equality'],
        'pg/bool@1': ['equality', 'boolean'],
      };
      const codecDescriptors = makeDescriptors(traitsByCodec);

      const ctx = { ...context, queryOperations, codecDescriptors };
      const user = createModelAccessor(ctx, 'User');
      const post = createModelAccessor(ctx, 'Post');

      const name = user['name'] as unknown as Record<string, unknown>;
      expect(typeof name['synthetic']).toBe('function');

      const views = post['views'] as unknown as Record<string, unknown>;
      expect(views['synthetic']).toBeUndefined();
    });

    it('attaches any-targeted op to every column regardless of codec traits', () => {
      const queryOperations = createSqlOperationRegistry();
      queryOperations.register('universalProbe', {
        self: { any: true },
        impl: () => undefined as never,
      });

      const traitsByCodec: Record<string, readonly CodecTrait[]> = {
        'pg/text@1': ['equality', 'order', 'textual'],
        'pg/int4@1': ['equality', 'order', 'numeric'],
        'pg/bool@1': ['equality', 'boolean'],
        'pg/jsonb@1': [],
      };
      const codecDescriptors = makeDescriptors(traitsByCodec);

      const ctx = { ...context, queryOperations, codecDescriptors };
      const user = createModelAccessor(ctx, 'User');
      const post = createModelAccessor(ctx, 'Post');

      // Columns spanning every trait set in the fixture: rich text traits,
      // numeric, and zero-trait jsonb. The op must appear on each.
      const name = user['name'] as unknown as Record<string, unknown>;
      const views = post['views'] as unknown as Record<string, unknown>;
      const address = user['address'] as unknown as Record<string, unknown>;

      expect(typeof name['universalProbe']).toBe('function');
      expect(typeof views['universalProbe']).toBe('function');
      expect(typeof address['universalProbe']).toBe('function');
    });
  });
});
