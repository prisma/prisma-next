import { defineAnnotation } from '@prisma-next/framework-components/runtime';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { describe, expectTypeOf, test } from 'vitest';
import type { Db } from '../../src';
import type { Contract } from '../fixtures/generated/contract';

/**
 * Type-level tests for the SQL DSL `.annotate(callback)` surface.
 *
 * Verifies:
 *  - Each builder kind (Select, Grouped, Insert, Update, Delete) accepts
 *    a callback receiving a kind-filtered `AnnotationBuilder` and
 *    rejects mismatched-kind annotations through the structural
 *    property filter (`meta.cache` doesn't exist on a write builder, etc).
 *  - Annotations applicable to both kinds (`'read' | 'write'`) are
 *    accepted on every builder.
 *  - `.annotate(callback)` does not widen the resulting plan's row type.
 *  - `.annotate(callback)` is chainable in any position relative to
 *    other builder methods.
 *  - The array escape hatch is structurally accepted.
 */

const cacheAnnotation = defineAnnotation<{ ttl: number; skip?: boolean }, 'read'>({
  name: 'cache',
  applicableTo: ['read'],
});

const auditAnnotation = defineAnnotation<{ actor: string }, 'write'>({
  name: 'audit',
  applicableTo: ['write'],
});

const otelAnnotation = defineAnnotation<{ traceId: string }, 'read' | 'write'>({
  name: 'otel',
  applicableTo: ['read', 'write'],
});

type Registry = {
  readonly cache: typeof cacheAnnotation;
  readonly audit: typeof auditAnnotation;
  readonly otel: typeof otelAnnotation;
};

declare const db: Db<Contract, Registry>;

describe('SelectQuery.annotate (read-typed)', () => {
  test('accepts a read-only annotation', () => {
    const plan = db.users
      .select('id')
      .annotate((meta) => meta.cache({ ttl: 60 }))
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ id: number }>>();
  });

  test('accepts a both-kind annotation', () => {
    const plan = db.users
      .select('id')
      .annotate((meta) => meta.otel({ traceId: 't' }))
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ id: number }>>();
  });

  test('accepts multiple chained annotations in a single callback', () => {
    const plan = db.users
      .select('id')
      .annotate((meta) => meta.cache({ ttl: 60 }).otel({ traceId: 't' }))
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ id: number }>>();
  });

  test('rejects a write-only annotation (negative)', () => {
    db.users
      .select('id')
      // @ts-expect-error - audit is write-only and is not present on AnnotationBuilder<'read', Registry>.
      .annotate((meta) => meta.audit({ actor: 'system' }));
  });

  test('accepts the array escape hatch with a closure-captured handle', () => {
    const plan = db.users
      .select('id')
      .annotate(() => [cacheAnnotation({ ttl: 60 })])
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ id: number }>>();
  });

  test('chainable: .annotate() before .where preserves row type', () => {
    const plan = db.users
      .select('id', 'email')
      .annotate((meta) => meta.cache({ ttl: 60 }))
      .where((c, fns) => fns.eq(c.id, 1))
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ id: number; email: string }>>();
  });

  test('chainable: .annotate() after .where preserves row type', () => {
    const plan = db.users
      .select('id', 'email')
      .where((c, fns) => fns.eq(c.id, 1))
      .annotate((meta) => meta.cache({ ttl: 60 }))
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ id: number; email: string }>>();
  });

  test('chainable: .annotate() between .select and .limit preserves row type', () => {
    const plan = db.users
      .select('id')
      .annotate((meta) => meta.cache({ ttl: 60 }))
      .limit(10)
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ id: number }>>();
  });
});

describe('GroupedQuery.annotate (read-typed)', () => {
  test('accepts a read-only annotation', () => {
    const plan = db.posts
      .select('user_id')
      .groupBy('user_id')
      .annotate((meta) => meta.cache({ ttl: 60 }))
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ user_id: number }>>();
  });

  test('accepts a both-kind annotation', () => {
    const plan = db.posts
      .select('user_id')
      .groupBy('user_id')
      .annotate((meta) => meta.otel({ traceId: 't' }))
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ user_id: number }>>();
  });

  test('rejects a write-only annotation (negative)', () => {
    db.posts
      .select('user_id')
      .groupBy('user_id')
      // @ts-expect-error - audit is write-only and is not present on AnnotationBuilder<'read', Registry>.
      .annotate((meta) => meta.audit({ actor: 'system' }));
  });

  test('chainable: .annotate() between .groupBy and .orderBy preserves row type', () => {
    const plan = db.posts
      .select('user_id')
      .groupBy('user_id')
      .annotate((meta) => meta.cache({ ttl: 60 }))
      .orderBy('user_id')
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ user_id: number }>>();
  });
});

describe('InsertQuery.annotate (write-typed)', () => {
  test('accepts a write-only annotation', () => {
    db.users.insert({ name: 'Alice' }).annotate((meta) => meta.audit({ actor: 'system' }));
  });

  test('accepts a both-kind annotation', () => {
    db.users.insert({ name: 'Alice' }).annotate((meta) => meta.otel({ traceId: 't' }));
  });

  test('rejects a read-only annotation (negative)', () => {
    db.users
      .insert({ name: 'Alice' })
      // @ts-expect-error - cache is read-only and is not present on AnnotationBuilder<'write', Registry>.
      .annotate((meta) => meta.cache({ ttl: 60 }));
  });

  test('accepts the array escape hatch', () => {
    db.users.insert({ name: 'Alice' }).annotate(() => [auditAnnotation({ actor: 'system' })]);
  });

  test('chainable: .annotate() before .returning preserves the resulting row type', () => {
    const plan = db.users
      .insert({ name: 'Alice' })
      .annotate((meta) => meta.audit({ actor: 'system' }))
      .returning('id', 'name')
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ id: number; name: string }>>();
  });
});

describe('UpdateQuery.annotate (write-typed)', () => {
  test('accepts a write-only annotation', () => {
    db.users
      .update({ name: 'Alice' })
      .where((f, fns) => fns.eq(f.id, 1))
      .annotate((meta) => meta.audit({ actor: 'system' }));
  });

  test('accepts a both-kind annotation', () => {
    db.users
      .update({ name: 'Alice' })
      .where((f, fns) => fns.eq(f.id, 1))
      .annotate((meta) => meta.otel({ traceId: 't' }));
  });

  test('rejects a read-only annotation (negative)', () => {
    db.users
      .update({ name: 'Alice' })
      .where((f, fns) => fns.eq(f.id, 1))
      // @ts-expect-error - cache is read-only and is not present on AnnotationBuilder<'write', Registry>.
      .annotate((meta) => meta.cache({ ttl: 60 }));
  });

  test('chainable: .annotate() before .returning preserves the resulting row type', () => {
    const plan = db.users
      .update({ name: 'Alice' })
      .where((f, fns) => fns.eq(f.id, 1))
      .annotate((meta) => meta.audit({ actor: 'system' }))
      .returning('id', 'name')
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ id: number; name: string }>>();
  });
});

describe('DeleteQuery.annotate (write-typed)', () => {
  test('accepts a write-only annotation', () => {
    db.users
      .delete()
      .where((f, fns) => fns.eq(f.id, 1))
      .annotate((meta) => meta.audit({ actor: 'system' }));
  });

  test('accepts a both-kind annotation', () => {
    db.users
      .delete()
      .where((f, fns) => fns.eq(f.id, 1))
      .annotate((meta) => meta.otel({ traceId: 't' }));
  });

  test('rejects a read-only annotation (negative)', () => {
    db.users
      .delete()
      .where((f, fns) => fns.eq(f.id, 1))
      // @ts-expect-error - cache is read-only and is not present on AnnotationBuilder<'write', Registry>.
      .annotate((meta) => meta.cache({ ttl: 60 }));
  });

  test('chainable: .annotate() before .returning preserves the resulting row type', () => {
    const plan = db.users
      .delete()
      .where((f, fns) => fns.eq(f.id, 1))
      .annotate((meta) => meta.audit({ actor: 'system' }))
      .returning('id')
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ id: number }>>();
  });
});
