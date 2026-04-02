import type { CodecRegistry, CodecTrait } from '@prisma-next/sql-relational-core/ast';
import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  codec,
  createCodecRegistry,
  ExistsExpr,
  ListExpression,
  LiteralExpr,
  NotExpr,
  NullCheckExpr,
  OperationExpr,
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

  function expectBinaryLiteral(
    actual: unknown,
    table: string,
    column: string,
    op: BinaryExpr['op'],
    value: unknown,
  ) {
    expect(actual).toEqual(new BinaryExpr(op, ColumnRef.of(table, column), LiteralExpr.of(value)));
  }

  it('creates scalar comparison operators and maps fields to columns', () => {
    const user = createModelAccessor(context, 'User');
    const post = createModelAccessor(context, 'Post');

    expectBinaryLiteral(user['name']!.eq('Alice'), 'users', 'name', 'eq', 'Alice');
    expectBinaryLiteral(
      user['email']!.neq('test@example.com'),
      'users',
      'email',
      'neq',
      'test@example.com',
    );
    expectBinaryLiteral(post['views']!.gt(1000), 'posts', 'views', 'gt', 1000);
    expectBinaryLiteral(post['views']!.lt(100), 'posts', 'views', 'lt', 100);
    expectBinaryLiteral(post['id']!.gte(5), 'posts', 'id', 'gte', 5);
    expectBinaryLiteral(post['id']!.lte(10), 'posts', 'id', 'lte', 10);
    expectBinaryLiteral(post['userId']!.eq(42), 'posts', 'user_id', 'eq', 42);
    expectBinaryLiteral(user['name']!.like('%Ali%'), 'users', 'name', 'like', '%Ali%');
    expectBinaryLiteral(user['name']!.ilike('%ali%'), 'users', 'name', 'ilike', '%ali%');
  });

  it('creates list literal, null check, and order directive helpers', () => {
    const accessor = createModelAccessor(context, 'Post');

    expect(accessor['id']!.in([1, 2, 3])).toEqual(
      BinaryExpr.in(ColumnRef.of('posts', 'id'), ListExpression.fromValues([1, 2, 3])),
    );
    expect(accessor['id']!.notIn([4, 5])).toEqual(
      BinaryExpr.notIn(ColumnRef.of('posts', 'id'), ListExpression.fromValues([4, 5])),
    );
    expect(accessor['id']!.asc()).toEqual({ column: 'id', direction: 'asc' });
    expect(accessor['id']!.desc()).toEqual({ column: 'id', direction: 'desc' });

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
        BinaryExpr.eq(ColumnRef.of('posts', 'views'), LiteralExpr.of(10)),
      ]),
    );

    const everyExpr = accessor['posts']!.every((post) => post['views']!.gt(10)) as ExistsExpr;
    expect(everyExpr.notExists).toBe(true);
    expect(everyExpr.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
        new NotExpr(BinaryExpr.gt(ColumnRef.of('posts', 'views'), LiteralExpr.of(10))),
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

    // Unknown fields have no codec → fail-closed → no eq method → throws
    expect(() => user['posts']!.some({ unknown: 'value' })).toThrow(
      /does not support equality comparisons/,
    );

    // Undefined values are skipped, so unknown fields with undefined still work
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

  it('falls back to storage metadata and model names when table mappings are missing', () => {
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

    expect(
      createModelAccessor({ ...context, contract: storageFallbackContract } as never, 'User')[
        'name'
      ]!.isNull(),
    ).toEqual(NullCheckExpr.isNull(ColumnRef.of('users_storage', 'name')));

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
          BinaryExpr.eq(ColumnRef.of('posts', 'title'), LiteralExpr.of('A')),
          BinaryExpr.eq(ColumnRef.of('posts', 'views'), LiteralExpr.of(1)),
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
            encode: (v: unknown) => v,
            decode: (v: unknown) => v,
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
      expect(field['ilike']).toBeUndefined();
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
        'ilike',
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

    it('cosineDistance().lt() produces BinaryExpr(lt, OperationExpr, LiteralExpr)', () => {
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
      expect(binary.right).toBeInstanceOf(LiteralExpr);

      const opExpr = binary.left as unknown as OperationExpr;
      expect(opExpr.method).toBe('cosineDistance');
      expect(opExpr.forTypeId).toBe('pg/vector@1');
      expect(opExpr.self).toEqual(ColumnRef.of('posts', 'embedding'));
      expect(opExpr.args[0]).toEqual(ParamRef.of([1, 2, 3], { codecId: 'pg/vector@1' }));
    });

    it('cosineDistance().asc() produces ExpressionOrderBy', () => {
      const accessor = createModelAccessor(context, 'Post');
      const embedding = accessor['embedding'] as unknown as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      const result = embedding['cosineDistance']!([1, 2, 3]) as Record<string, () => unknown>;
      const order = result['asc']!() as { expr: OperationExpr; direction: string };

      expect(order.direction).toBe('asc');
      expect(order.expr).toBeInstanceOf(OperationExpr);
      expect(order.expr.method).toBe('cosineDistance');
    });
  });
});
