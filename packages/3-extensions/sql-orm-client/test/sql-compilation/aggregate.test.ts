import type { WhereExpr } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  compileAggregate,
  compileGroupedAggregate,
  GROUPED_HAVING_TABLE,
} from '../../src/kysely-compiler';
import type { AggregateSelector } from '../../src/types';
import { createCollectionFor } from '../collection-fixtures';
import { normalizeSql } from './helpers';

describe('sql-compilation/aggregate', () => {
  it('aggregate() compiles count(*) with where filters', async () => {
    const { collection, runtime } = createCollectionFor('User');
    runtime.setNextResults([[{ count: '2' }]]);

    const stats = await collection.where({ name: 'Alice' }).aggregate((aggregate) => ({
      count: aggregate.count(),
    }));

    expect(stats).toEqual({ count: 2 });
    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe(
      'select count(*) as "count" from "users" where "users"."name" = $1',
    );
  });

  it('aggregate() compiles sum/avg/min/max selectors against mapped columns', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ total: '60', avg: '20', min: 10, max: 30 }]]);
    const numericField = 'views' as never;

    const stats = await collection.aggregate((aggregate) => ({
      total: aggregate.sum(numericField),
      avg: aggregate.avg(numericField),
      min: aggregate.min(numericField),
      max: aggregate.max(numericField),
    }));

    expect(stats).toEqual({
      total: 60,
      avg: 20,
      min: 10,
      max: 30,
    });
    expect(normalizeSql(runtime.executions[0]!.plan.sql)).toBe(
      'select sum("posts"."views") as "total", avg("posts"."views") as "avg", min("posts"."views") as "min", max("posts"."views") as "max" from "posts"',
    );
  });

  it('compileAggregate() validates aggregate selector specs', () => {
    expect(() => compileAggregate('posts', [], {})).toThrow(
      /requires at least one aggregation selector/,
    );
    expect(() =>
      compileAggregate('posts', [], {
        invalid: { kind: 'aggregate', fn: 'sum' },
      } as never),
    ).toThrow(/requires a field/);
  });

  it('compileGroupedAggregate() validates group and aggregate requirements', () => {
    expect(() =>
      compileGroupedAggregate(
        'posts',
        [],
        [],
        { count: { kind: 'aggregate', fn: 'count' } },
        undefined,
      ),
    ).toThrow(/requires at least one field/);

    expect(() => compileGroupedAggregate('posts', [], ['user_id'], {}, undefined)).toThrow(
      /requires at least one aggregation selector/,
    );
  });

  it('compileGroupedAggregate() compiles having expressions across operators', () => {
    const aggregateSpec = {
      count: { kind: 'aggregate', fn: 'count' as const },
    } as const satisfies Record<string, AggregateSelector<unknown>>;

    const andTrue = compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
      kind: 'and',
      exprs: [],
    });
    expect(normalizeSql(andTrue.sql)).toContain('having TRUE');

    const orFalse = compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
      kind: 'or',
      exprs: [],
    });
    expect(normalizeSql(orFalse.sql)).toContain('having FALSE');

    const nullCheck = compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
      kind: 'nullCheck',
      expr: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'sum:views' },
      isNull: false,
    });
    expect(normalizeSql(nullCheck.sql)).toContain('sum("posts"."views") IS NOT NULL');

    const inLiteralArray = compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
      kind: 'bin',
      op: 'in',
      left: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'sum:views' },
      right: { kind: 'literal', value: [10, 20] },
    });
    expect(normalizeSql(inLiteralArray.sql)).toContain('sum("posts"."views") IN ($1, $2)');

    const notInListLiteral = compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
      kind: 'bin',
      op: 'notIn',
      left: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'avg:views' },
      right: {
        kind: 'listLiteral',
        values: [
          { kind: 'literal', value: 1 },
          { kind: 'literal', value: 2 },
        ],
      },
    } as WhereExpr);
    expect(normalizeSql(notInListLiteral.sql)).toContain('avg("posts"."views") NOT IN ($1, $2)');

    const rightCol = compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
      kind: 'bin',
      op: 'eq',
      left: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'count' },
      right: { kind: 'col', table: 'other_table', column: 'other_col' },
    });
    expect(normalizeSql(rightCol.sql)).toContain('count(*) = "other_table"."other_col"');

    const rightMetricCol = compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
      kind: 'bin',
      op: 'eq',
      left: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'count' },
      right: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'sum:views' },
    });
    expect(normalizeSql(rightMetricCol.sql)).toContain('count(*) = sum("posts"."views")');

    const inEmptyArray = compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
      kind: 'bin',
      op: 'in',
      left: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'sum:views' },
      right: { kind: 'literal', value: [] },
    });
    expect(normalizeSql(inEmptyArray.sql)).toContain('sum("posts"."views") IN (NULL)');

    const listLiteralEmpty = compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
      kind: 'bin',
      op: 'notIn',
      left: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'sum:views' },
      right: {
        kind: 'listLiteral',
        values: [],
      },
    } as WhereExpr);
    expect(normalizeSql(listLiteralEmpty.sql)).toContain('sum("posts"."views") NOT IN (NULL)');

    const listLiteralRawValues = compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
      kind: 'bin',
      op: 'in',
      left: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'sum:views' },
      right: {
        kind: 'listLiteral',
        values: [1, 2] as never,
      },
    } as WhereExpr);
    expect(normalizeSql(listLiteralRawValues.sql)).toContain('sum("posts"."views") IN ($1, $2)');

    const andNonEmpty = compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
      kind: 'and',
      exprs: [
        {
          kind: 'bin',
          op: 'eq',
          left: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'count' },
          right: { kind: 'literal', value: 1 },
        },
      ],
    });
    expect(normalizeSql(andNonEmpty.sql)).toContain('having (count(*) = $1)');

    const orNonEmpty = compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
      kind: 'or',
      exprs: [
        {
          kind: 'bin',
          op: 'like',
          left: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'sum:views' },
          right: { kind: 'literal', value: '%1%' },
        },
        {
          kind: 'bin',
          op: 'ilike',
          left: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'sum:views' },
          right: { kind: 'literal', value: '%2%' },
        },
      ],
    });
    expect(normalizeSql(orNonEmpty.sql)).toContain(
      'having (sum("posts"."views") LIKE $1 OR sum("posts"."views") ILIKE $2)',
    );

    const nullCheckIsNull = compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
      kind: 'nullCheck',
      expr: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'sum:views' },
      isNull: true,
    });
    expect(normalizeSql(nullCheckIsNull.sql)).toContain('sum("posts"."views") IS NULL');
  });

  it('compileGroupedAggregate() throws for unsupported grouped having expressions', () => {
    const aggregateSpec = {
      count: { kind: 'aggregate', fn: 'count' as const },
    } as const satisfies Record<string, AggregateSelector<unknown>>;

    expect(() =>
      compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
        kind: 'bin',
        op: 'eq',
        left: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'count' },
        right: { kind: 'param', index: 0, name: 'x' },
      } as WhereExpr),
    ).toThrow(/ParamRef is not supported/);

    expect(() =>
      compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
        kind: 'bin',
        op: 'eq',
        left: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'count' },
        right: null as never,
      }),
    ).toThrow(/Unsupported grouped having right operand/);

    expect(() =>
      compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
        kind: 'bin',
        op: 'eq',
        left: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'count' },
        right: {} as never,
      }),
    ).toThrow(/Unsupported grouped having right operand kind "unknown"/);

    expect(() =>
      compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
        kind: 'bin',
        op: 'eq',
        left: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'count' },
        right: { kind: 'unknown' } as never,
      }),
    ).toThrow(/Unsupported grouped having right operand kind/);

    expect(() =>
      compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
        kind: 'bin',
        op: 'eq',
        left: { kind: 'col', table: 'posts', column: 'id' },
        right: { kind: 'literal', value: 1 },
      }),
    ).toThrow(/only supports aggregate metric expressions/);

    expect(() =>
      compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
        kind: 'exists',
        not: false,
        subquery: {
          kind: 'select',
          from: { kind: 'table', name: 'posts' },
          project: [{ alias: 'x', expr: { kind: 'literal', value: 1 } }],
        },
      } as WhereExpr),
    ).toThrow(/Unsupported grouped having expression kind/);

    expect(() =>
      compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
        kind: 'nullCheck',
        expr: { kind: 'col', table: 'posts', column: 'id' },
        isNull: false,
      }),
    ).toThrow(/only supports aggregate metric expressions/);

    expect(() =>
      compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
        kind: 'bin',
        op: 'eq',
        left: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'invalid_metric' },
        right: { kind: 'literal', value: 1 },
      }),
    ).toThrow(/Invalid grouped having metric/);

    expect(() =>
      compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
        kind: 'bin',
        op: 'eq',
        left: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'median:views' },
        right: { kind: 'literal', value: 1 },
      }),
    ).toThrow(/Unsupported grouped having metric/);

    expect(() =>
      compileGroupedAggregate('posts', [], ['user_id'], aggregateSpec, {
        kind: 'bin',
        op: 'unknown',
        left: { kind: 'col', table: GROUPED_HAVING_TABLE, column: 'count' },
        right: { kind: 'literal', value: 1 },
      } as never),
    ).toThrow(/Unsupported grouped having operator/);
  });
});
