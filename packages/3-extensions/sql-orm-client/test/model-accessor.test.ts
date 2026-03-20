import type { CodecRegistry, CodecTrait } from '@prisma-next/sql-relational-core/ast';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createModelAccessor } from '../src/model-accessor';
import { getTestContext, getTestContract } from './helpers';

describe('createModelAccessor', () => {
  const context = getTestContext();

  function expectBinaryExpr(
    actual: unknown,
    table: string,
    column: string,
    op: string,
    value: unknown,
  ) {
    expect(actual).toEqual({
      kind: 'bin',
      op,
      left: {
        kind: 'col',
        table,
        column,
      },
      right: {
        kind: 'literal',
        value,
      },
    });
  }

  it('creates FilterExpr with eq operator', () => {
    const accessor = createModelAccessor(context, 'User');
    const filter = accessor['name']!.eq('Alice');
    expectBinaryExpr(filter, 'users', 'name', 'eq', 'Alice');
  });

  it('creates FilterExpr with neq operator', () => {
    const accessor = createModelAccessor(context, 'User');
    const filter = accessor['email']!.neq('test@example.com');
    expectBinaryExpr(filter, 'users', 'email', 'neq', 'test@example.com');
  });

  it('creates FilterExpr with gt operator', () => {
    const accessor = createModelAccessor(context, 'Post');
    const filter = accessor['views']!.gt(1000);
    expectBinaryExpr(filter, 'posts', 'views', 'gt', 1000);
  });

  it('creates FilterExpr with lt operator', () => {
    const accessor = createModelAccessor(context, 'Post');
    const filter = accessor['views']!.lt(100);
    expectBinaryExpr(filter, 'posts', 'views', 'lt', 100);
  });

  it('creates FilterExpr with gte operator', () => {
    const accessor = createModelAccessor(context, 'Post');
    const filter = accessor['id']!.gte(5);
    expectBinaryExpr(filter, 'posts', 'id', 'gte', 5);
  });

  it('creates FilterExpr with lte operator', () => {
    const accessor = createModelAccessor(context, 'Post');
    const filter = accessor['id']!.lte(10);
    expectBinaryExpr(filter, 'posts', 'id', 'lte', 10);
  });

  it('maps field names to column names via fieldToColumn', () => {
    const accessor = createModelAccessor(context, 'Post');
    const filter = accessor['userId']!.eq(42);
    expectBinaryExpr(filter, 'posts', 'user_id', 'eq', 42);
  });

  it('uses field name as column name when no mapping exists', () => {
    const accessor = createModelAccessor(context, 'Post');
    const filter = accessor['id']!.eq(1);
    expectBinaryExpr(filter, 'posts', 'id', 'eq', 1);
  });

  it('creates like and ilike operators', () => {
    const accessor = createModelAccessor(context, 'User');
    expectBinaryExpr(accessor['name']!.like('%Ali%'), 'users', 'name', 'like', '%Ali%');
    expectBinaryExpr(accessor['name']!.ilike('%ali%'), 'users', 'name', 'ilike', '%ali%');
  });

  it('creates listLiteral nodes for in and notIn operators', () => {
    const accessor = createModelAccessor(context, 'Post');
    expect(accessor['id']!.in([1, 2, 3])).toEqual({
      kind: 'bin',
      op: 'in',
      left: { kind: 'col', table: 'posts', column: 'id' },
      right: {
        kind: 'listLiteral',
        values: [
          { kind: 'literal', value: 1 },
          { kind: 'literal', value: 2 },
          { kind: 'literal', value: 3 },
        ],
      },
    });
    expect(accessor['id']!.notIn([4, 5])).toEqual({
      kind: 'bin',
      op: 'notIn',
      left: { kind: 'col', table: 'posts', column: 'id' },
      right: {
        kind: 'listLiteral',
        values: [
          { kind: 'literal', value: 4 },
          { kind: 'literal', value: 5 },
        ],
      },
    });
  });

  it('creates null check expressions', () => {
    const accessor = createModelAccessor(context, 'User');
    expect(accessor['email']!.isNull()).toEqual({
      kind: 'nullCheck',
      expr: { kind: 'col', table: 'users', column: 'email' },
      isNull: true,
    });
    expect(accessor['email']!.isNotNull()).toEqual({
      kind: 'nullCheck',
      expr: { kind: 'col', table: 'users', column: 'email' },
      isNull: false,
    });
  });

  it('creates order directives with asc and desc', () => {
    const accessor = createModelAccessor(context, 'Post');
    expect(accessor['id']!.asc()).toEqual({ column: 'id', direction: 'asc' });
    expect(accessor['id']!.desc()).toEqual({ column: 'id', direction: 'desc' });
  });

  it('creates some() relation filters as EXISTS subqueries', () => {
    const accessor = createModelAccessor(context, 'User');
    expect(accessor['posts']!.some()).toEqual({
      kind: 'exists',
      not: false,
      subquery: {
        kind: 'select',
        from: { kind: 'table', name: 'posts' },
        project: [{ alias: '_exists', expr: { kind: 'col', table: 'posts', column: 'user_id' } }],
        where: {
          kind: 'bin',
          op: 'eq',
          left: { kind: 'col', table: 'posts', column: 'user_id' },
          right: { kind: 'col', table: 'users', column: 'id' },
        },
      },
    });
  });

  it('creates none() and every() relation filters with NOT EXISTS semantics', () => {
    const accessor = createModelAccessor(context, 'User');

    expect(accessor['posts']!.none({ views: 10 })).toMatchObject({
      kind: 'exists',
      not: true,
      subquery: {
        where: {
          kind: 'and',
          exprs: [
            { kind: 'bin', op: 'eq' },
            { kind: 'bin', op: 'eq' },
          ],
        },
      },
    });

    expect(accessor['posts']!.every((post) => post['views']!.gt(10))).toMatchObject({
      kind: 'exists',
      not: true,
      subquery: {
        where: {
          kind: 'and',
          exprs: [
            { kind: 'bin', op: 'eq' },
            { kind: 'bin', op: 'lte' },
          ],
        },
      },
    });
  });

  it('creates none() and every() filters without child predicates', () => {
    const accessor = createModelAccessor(context, 'User');

    expect(accessor['posts']!.every({})).toMatchObject({
      kind: 'exists',
      not: true,
      subquery: {
        where: { kind: 'bin', op: 'eq' },
      },
    });

    expect(accessor['posts']!.none()).toMatchObject({
      kind: 'exists',
      not: true,
      subquery: {
        where: { kind: 'bin', op: 'eq' },
      },
    });
  });

  it('supports nested relation filters', () => {
    const accessor = createModelAccessor(context, 'User');

    expect(
      accessor['posts']!.some((post) =>
        post['comments']!.some((comment) => comment['body']!.like('%urgent%')),
      ),
    ).toMatchObject({
      kind: 'exists',
      not: false,
      subquery: {
        where: {
          kind: 'and',
          exprs: [
            { kind: 'bin', op: 'eq' },
            {
              kind: 'exists',
              not: false,
            },
          ],
        },
      },
    });
  });

  it('returns undefined for symbol property access on accessor proxy', () => {
    const accessor = createModelAccessor(context, 'User');
    expect((accessor as Record<PropertyKey, unknown>)[Symbol.iterator]).toBeUndefined();
  });

  it('relation shorthand ignores unknown fields and returns undefined for empty predicates', () => {
    const accessor = createModelAccessor(context, 'User');

    expect(accessor['posts']!.some({ unknown: 'value' })).toMatchObject({
      kind: 'exists',
      not: false,
      subquery: {
        where: {
          kind: 'and',
          exprs: [
            { kind: 'bin', op: 'eq' },
            { kind: 'bin', op: 'eq' },
          ],
        },
      },
    });

    expect(accessor['posts']!.some({ unknown: undefined })).toMatchObject({
      kind: 'exists',
      not: false,
      subquery: {
        where: { kind: 'bin', op: 'eq' },
      },
    });
  });

  it('relation shorthand maps null to isNull filters', () => {
    const accessor = createModelAccessor(context, 'Post');

    expect(accessor['comments']!.some({ body: null })).toMatchObject({
      kind: 'exists',
      subquery: {
        where: {
          kind: 'and',
          exprs: [
            { kind: 'bin', op: 'eq' },
            { kind: 'nullCheck', isNull: true },
          ],
        },
      },
    });
  });

  it('throws when relation metadata misses model references or join columns', () => {
    const missingToContract = {
      ...getTestContract(),
      relations: {
        ...getTestContract().relations,
        users: {
          posts: {
            on: {
              parentCols: ['id'],
              childCols: ['user_id'],
            },
          },
        },
      },
    };

    const brokenJoinContract = {
      ...getTestContract(),
      relations: {
        ...getTestContract().relations,
        users: {
          posts: {
            to: 'Post',
            cardinality: '1:N',
            on: {
              parentCols: [],
              childCols: [],
            },
          },
        },
      },
    };

    expect(() =>
      (
        createModelAccessor(
          { ...context, contract: missingToContract } as never,
          'User',
        ) as unknown as Record<string, { some: () => unknown }>
      )['posts']!.some(),
    ).toThrow(/missing the "to" model reference/);
    expect(() =>
      (
        createModelAccessor(
          { ...context, contract: brokenJoinContract } as never,
          'User',
        ) as unknown as Record<string, { some: () => unknown }>
      )['posts']!.some(),
    ).toThrow(/missing join columns/);
  });

  it('supports composite relation joins and firstChild fallback projection', () => {
    const compositeContract = {
      ...getTestContract(),
      mappings: {
        ...getTestContract().mappings,
        modelToTable: {
          ...getTestContract().mappings.modelToTable,
          User: 'users_alt',
        },
      },
      models: {
        ...getTestContract().models,
        User: {
          ...getTestContract().models.User,
          storage: {
            table: 'users_alt',
          },
        },
      },
      relations: {
        ...getTestContract().relations,
        users_alt: {
          posts: {
            to: 'Post',
            cardinality: '1:N',
            on: {
              parentCols: ['id', 'email'],
              childCols: ['user_id', 'title'],
            },
          },
        },
      },
    };

    expect(
      (
        createModelAccessor(
          { ...context, contract: compositeContract } as never,
          'User',
        ) as unknown as Record<string, { some: () => unknown }>
      )['posts']!.some(),
    ).toMatchObject({
      kind: 'exists',
      subquery: {
        project: [
          {
            alias: '_exists',
            expr: { kind: 'col', table: 'posts', column: 'user_id' },
          },
        ],
        where: {
          kind: 'and',
          exprs: [
            { kind: 'bin', op: 'eq' },
            { kind: 'bin', op: 'eq' },
          ],
        },
      },
    });

    const noChildColsContract = {
      ...compositeContract,
      relations: {
        ...compositeContract.relations,
        users_alt: {
          posts: {
            to: 'Post',
            cardinality: '1:N',
            on: {
              parentCols: ['id', 'name'],
              childCols: [undefined, 'title'],
            },
          },
        },
      },
    };

    expect(
      (
        createModelAccessor(
          { ...context, contract: noChildColsContract } as never,
          'User',
        ) as unknown as Record<string, { some: () => unknown }>
      )['posts']!.some(),
    ).toMatchObject({
      kind: 'exists',
      subquery: {
        project: [{ expr: { column: 'id' } }],
      },
    });
  });

  it('resolves model tables from storage metadata when modelToTable mappings are missing', () => {
    const base = getTestContract();
    const storageFallbackContract = {
      ...base,
      mappings: {
        ...base.mappings,
        modelToTable: {},
      },
      models: {
        ...base.models,
        User: {
          ...base.models.User,
          storage: {
            table: 'users_storage',
          },
        },
      },
    };

    const accessor = createModelAccessor(
      { ...context, contract: storageFallbackContract } as never,
      'User',
    );
    expect(accessor['name']!.eq('Alice')).toMatchObject({
      left: { table: 'users_storage', column: 'name' },
    });
  });

  it('falls back to the model name when table mappings are unavailable', () => {
    const base = getTestContract();
    const modelNameFallbackContract = {
      ...base,
      mappings: {
        ...base.mappings,
        modelToTable: {},
        fieldToColumn: {},
      },
      models: {
        ...base.models,
        User: {
          ...base.models.User,
          storage: {},
        },
      },
      relations: {},
    };

    const accessor = createModelAccessor(
      { ...context, contract: modelNameFallbackContract } as never,
      'User',
    );
    expect(accessor['name']!.eq('Alice')).toMatchObject({
      left: { table: 'User', column: 'name' },
    });
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
  });

  it('relation shorthand combines multiple fields with and()', () => {
    const accessor = createModelAccessor(context, 'User');
    const predicate = accessor['posts']!.some({ title: 'A', views: 1 });

    expect(predicate).toMatchObject({
      kind: 'exists',
      subquery: {
        where: {
          kind: 'and',
          exprs: [
            { kind: 'bin', op: 'eq' },
            {
              kind: 'and',
              exprs: [
                { kind: 'bin', op: 'eq' },
                { kind: 'bin', op: 'eq' },
              ],
            },
          ],
        },
      },
    });
  });

  it('throws when relation metadata omits join arrays', () => {
    const base = getTestContract();
    const contractWithoutJoinArrays = {
      ...base,
      relations: {
        ...base.relations,
        users: {
          posts: {
            to: 'Post',
            cardinality: '1:N',
          },
        },
      },
    };

    expect(() =>
      (
        createModelAccessor(
          { ...context, contract: contractWithoutJoinArrays },
          'User',
        ) as unknown as Record<string, { some: () => unknown }>
      )['posts']!.some(),
    ).toThrow(/missing join columns/);
  });
});
