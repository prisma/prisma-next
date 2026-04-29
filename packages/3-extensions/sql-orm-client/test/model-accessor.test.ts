import type { JsonValue } from '@prisma-next/contract/types';
import { createSqlOperationRegistry } from '@prisma-next/sql-operations';
import type { CodecRegistry, CodecTrait } from '@prisma-next/sql-relational-core/ast';
import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  codec,
  createCodecRegistry,
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
import { getTestContext, getTestContract } from './helpers';

describe('createModelAccessor', () => {
  const context = getTestContext();

  function paramRef(table: string, column: string, value: unknown): ParamRef {
    const tables = context.contract.storage.tables as Record<
      string,
      { columns: Record<string, { codecId?: string }> } | undefined
    >;
    const codecId = tables[table]?.columns[column]?.codecId;
    return codecId ? ParamRef.of(value, { codecId }) : ParamRef.of(value);
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

  it('cosineDistance accepts a raw vector value and produces a ParamRef on arg0', () => {
    const post = createModelAccessor(context, 'Post');
    const result = post['embedding']!.cosineDistance([1, 2, 3]) as unknown as Record<
      string,
      unknown
    >;
    // Non-predicate return → ComparisonMethods wrapper; the underlying AST is
    // behind the comparison methods. Invoke a comparison to observe it.
    const gt = (result['gt'] as (value: number) => BinaryExpr)(0.5);
    expect(gt).toBeInstanceOf(BinaryExpr);
    const opExpr = gt.left as OperationExpr;
    expect(opExpr).toBeInstanceOf(OperationExpr);
    expect(opExpr.method).toBe('cosineDistance');
    expect(opExpr.self).toEqual(ColumnRef.of('posts', 'embedding'));
    expect(opExpr.args).toHaveLength(1);
    expect(opExpr.args[0]).toBeInstanceOf(ParamRef);
    expect((opExpr.args[0] as ParamRef).value).toEqual([1, 2, 3]);
  });

  it('cosineDistance accepts another vector column and produces a ColumnRef on arg0 (cross-column composition)', () => {
    // Cross-column composition: the second argument is another column handle
    // (an Expression with buildAst → ColumnRef), not a raw JS value.
    // The factory must detect it as an Expression and emit a ColumnRef, not a
    // ParamRef wrapping the accessor object.
    const post = createModelAccessor(context, 'Post');
    const otherPost = createModelAccessor(context, 'Post');

    const result = post['embedding']!.cosineDistance(otherPost['embedding']!) as unknown as Record<
      string,
      unknown
    >;
    const gt = (result['gt'] as (value: number) => BinaryExpr)(0.5);
    const opExpr = gt.left as OperationExpr;
    expect(opExpr).toBeInstanceOf(OperationExpr);
    expect(opExpr.method).toBe('cosineDistance');
    expect(opExpr.self).toEqual(ColumnRef.of('posts', 'embedding'));
    expect(opExpr.args).toHaveLength(1);
    expect(opExpr.args[0]).toBeInstanceOf(ColumnRef);
    expect(opExpr.args[0]).toEqual(ColumnRef.of('posts', 'embedding'));
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

    // Unknown fields in a shorthand predicate are surfaced loudly — silent
    // skip would drop user intent (a typo'd filter would match every row).
    expect(() => user['posts']!.some({ unknown: 'value' })).toThrow(
      /Shorthand filter on "Post\.unknown": field is not defined on the model/,
    );

    // Undefined values are skipped before the field lookup, so a shorthand
    // with an unknown field and undefined value is a no-op.
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
    const brokenJoinContract = {
      ...base,
      models: {
        ...base.models,
        User: {
          ...base.models.User,
          relations: {
            posts: {
              to: 'Post',
              cardinality: '1:N',
              on: {
                localFields: [],
                targetFields: [],
              },
            },
          },
        },
      },
    };

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
    const compositeContract = {
      ...base,
      models: {
        ...base.models,
        User: {
          ...base.models.User,
          storage: {
            ...base.models.User.storage,
            table: 'users_alt',
          },
          relations: {
            ...base.models.User.relations,
            posts: {
              to: 'Post',
              cardinality: '1:N',
              on: {
                localFields: ['id', 'email'],
                targetFields: ['userId', 'title'],
              },
            },
          },
        },
      },
    };

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

    const noTargetFieldsContract = {
      ...base,
      models: {
        ...base.models,
        User: {
          ...base.models.User,
          storage: {
            ...base.models.User.storage,
            table: 'users_alt',
          },
          relations: {
            ...base.models.User.relations,
            posts: {
              to: 'Post',
              cardinality: '1:N',
              on: {
                localFields: ['id', 'name'],
                targetFields: [undefined, 'title'],
              },
            },
          },
        },
      },
    };

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
    const storageFallbackContract = {
      ...base,
      models: {
        ...base.models,
        User: {
          ...base.models.User,
          storage: {
            ...base.models.User.storage,
            table: 'users_storage',
          },
        },
      },
    };

    // Contract claims the User model lives in `users_storage`, but
    // storage.tables has no entry for it. The Proxy returns undefined for
    // fields whose column cannot be resolved, matching plain JS object
    // semantics. Downstream consumers (or TypeScript at compile time) are
    // responsible for noticing the missing column.
    const accessor = createModelAccessor(
      { ...context, contract: storageFallbackContract } as never,
      'User',
    );
    expect(accessor['name']).toBeUndefined();
  });

  it('resolves column when storage.table maps to a declared table with the field', () => {
    const base = getTestContract();
    const modelNameFallbackContract = {
      ...base,
      models: {
        ...base.models,
        User: {
          ...base.models.User,
          storage: { table: 'users' },
          relations: {},
        },
      },
    };

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
    const contractWithoutJoinArrays = {
      ...base,
      models: {
        ...base.models,
        User: {
          ...base.models.User,
          relations: {
            posts: {
              to: 'Post',
              cardinality: '1:N',
            },
          },
        },
      },
    };

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
    function makeRegistry(entries: Record<string, readonly CodecTrait[]>): CodecRegistry {
      const registry = createCodecRegistry();
      for (const [id, traits] of Object.entries(entries)) {
        registry.register(
          codec({
            typeId: id,
            targetTypes: [],
            traits,
            encode: (v: JsonValue) => v,
            decode: (v: JsonValue) => v,
          }),
        );
      }
      return registry;
    }

    it('only creates equality methods when codec has equality trait', () => {
      const codecs = makeRegistry({ 'pg/int4@1': ['equality'] });
      const accessor = createModelAccessor({ ...context, codecs }, 'Post');
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
      const codecs = makeRegistry({
        'pg/text@1': ['equality', 'order', 'textual'],
      });
      const accessor = createModelAccessor({ ...context, codecs }, 'User');
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
      const codecs = makeRegistry({ 'pg/int4@1': ['order'] });
      const accessor = createModelAccessor({ ...context, codecs }, 'Post');

      expect(() => accessor['comments']!.some({ postId: 42 })).toThrow(
        /does not support equality comparisons/,
      );
    });
  });

  describe('extension operations', () => {
    it('attaches cosineDistance to vector field, not to text field', () => {
      const accessor = createModelAccessor(context, 'Post');
      const embedding = accessor['embedding'] as unknown as Record<string, unknown>;
      const title = accessor['title'] as unknown as Record<string, unknown>;

      expect(typeof embedding['cosineDistance']).toBe('function');
      expect(title['cosineDistance']).toBeUndefined();
    });

    it('cosineDistance() returns expression result with comparison and ordering methods', () => {
      const accessor = createModelAccessor(context, 'Post');
      const embedding = accessor['embedding'] as unknown as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      const result = embedding['cosineDistance']!([1, 2, 3]) as Record<string, unknown>;

      expect(typeof result['lt']).toBe('function');
      expect(typeof result['gt']).toBe('function');
      expect(typeof result['eq']).toBe('function');
      expect(typeof result['asc']).toBe('function');
      expect(typeof result['desc']).toBe('function');
      expect(typeof result['isNull']).toBe('function');
      expect(result['like']).toBeUndefined();
    });

    it('cosineDistance().lt() produces BinaryExpr(lt, OperationExpr, ParamRef)', () => {
      const accessor = createModelAccessor(context, 'Post');
      const embedding = accessor['embedding'] as unknown as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      const result = embedding['cosineDistance']!([1, 2, 3]) as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      const expr = result['lt']!(0.2);

      expect(expr).toBeInstanceOf(BinaryExpr);
      const binary = expr as unknown as BinaryExpr;
      expect(binary.op).toBe('lt');
      expect(binary.left).toBeInstanceOf(OperationExpr);
      expect(binary.right).toBeInstanceOf(ParamRef);

      const opExpr = binary.left as unknown as OperationExpr;
      expect(opExpr.method).toBe('cosineDistance');
      expect(opExpr.self).toEqual(ColumnRef.of('posts', 'embedding'));
      expect(opExpr.args[0]).toEqual(ParamRef.of([1, 2, 3], { codecId: 'pg/vector@1' }));
    });

    it('cosineDistance().asc() produces OrderByItem', () => {
      const accessor = createModelAccessor(context, 'Post');
      const embedding = accessor['embedding'] as unknown as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      const result = embedding['cosineDistance']!([1, 2, 3]) as Record<string, () => unknown>;
      const order = result['asc']!() as OrderByItem;

      expect(order.dir).toBe('asc');
      expect(order.expr.kind).toBe('operation');
      expect((order.expr as OperationExpr).method).toBe('cosineDistance');
    });

    it('attaches trait-targeted op only when codec traits are a superset of required traits', () => {
      const queryOperations = createSqlOperationRegistry();
      queryOperations.register({
        method: 'synthetic',
        self: { traits: ['equality', 'textual'] },
        impl: () => undefined as never,
      });

      const codecs = createCodecRegistry();
      for (const [id, traits] of Object.entries({
        'pg/text@1': ['equality', 'textual'],
        'pg/int4@1': ['equality'],
        'pg/bool@1': ['equality', 'boolean'],
      } as Record<string, readonly CodecTrait[]>)) {
        codecs.register(
          codec({
            typeId: id,
            targetTypes: [],
            traits,
            encode: (v: JsonValue) => v,
            decode: (v: JsonValue) => v,
          }),
        );
      }

      const ctx = { ...context, queryOperations, codecs };
      const user = createModelAccessor(ctx, 'User');
      const post = createModelAccessor(ctx, 'Post');

      const name = user['name'] as unknown as Record<string, unknown>;
      expect(typeof name['synthetic']).toBe('function');

      const views = post['views'] as unknown as Record<string, unknown>;
      expect(views['synthetic']).toBeUndefined();
    });
  });
});
