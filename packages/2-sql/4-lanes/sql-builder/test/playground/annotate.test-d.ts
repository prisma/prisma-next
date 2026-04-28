import { defineAnnotation } from '@prisma-next/framework-components/runtime';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { describe, expectTypeOf, test } from 'vitest';
import { db } from './preamble';

/**
 * Type-level tests for the SQL DSL `.annotate(...)` surface.
 *
 * Verifies:
 *  - Each builder kind (Select, Grouped, Insert, Update, Delete) accepts
 *    annotations matching its operation kind and rejects mismatched ones
 *    via the `As & ValidAnnotations<K, As>` gate.
 *  - Annotations applicable to both kinds (`'read' | 'write'`) are
 *    accepted on every builder.
 *  - `.annotate()` does not widen the resulting plan's row type.
 *  - `.annotate()` is chainable in any position relative to other
 *    builder methods.
 */

const cacheAnnotation = defineAnnotation<{ ttl: number; skip?: boolean }, 'read'>({
  namespace: 'cache',
  applicableTo: ['read'],
});

const auditAnnotation = defineAnnotation<{ actor: string }, 'write'>({
  namespace: 'audit',
  applicableTo: ['write'],
});

const otelAnnotation = defineAnnotation<{ traceId: string }, 'read' | 'write'>({
  namespace: 'otel',
  applicableTo: ['read', 'write'],
});

describe('SelectQuery.annotate (read-typed)', () => {
  test('accepts a read-only annotation', () => {
    const plan = db.users
      .select('id')
      .annotate(cacheAnnotation.apply({ ttl: 60 }))
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ id: number }>>();
  });

  test('accepts a both-kind annotation', () => {
    const plan = db.users
      .select('id')
      .annotate(otelAnnotation.apply({ traceId: 't' }))
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ id: number }>>();
  });

  test('accepts multiple compatible annotations in a single call', () => {
    const plan = db.users
      .select('id')
      .annotate(cacheAnnotation.apply({ ttl: 60 }), otelAnnotation.apply({ traceId: 't' }))
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ id: number }>>();
  });

  test('rejects a write-only annotation (negative)', () => {
    // @ts-expect-error - audit declares applicableTo: ['write'], not 'read'
    db.users.select('id').annotate(auditAnnotation.apply({ actor: 'system' }));
  });

  test('rejects a mix containing a write-only annotation (negative)', () => {
    db.users
      .select('id')
      // @ts-expect-error - audit declares applicableTo: ['write'], not 'read'
      .annotate(cacheAnnotation.apply({ ttl: 60 }), auditAnnotation.apply({ actor: 'system' }));
  });

  test('accepts zero annotations (empty variadic)', () => {
    const plan = db.users.select('id').annotate().build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ id: number }>>();
  });

  test('chainable: .annotate() before .where preserves row type', () => {
    const plan = db.users
      .select('id', 'email')
      .annotate(cacheAnnotation.apply({ ttl: 60 }))
      .where((c, fns) => fns.eq(c.id, 1))
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ id: number; email: string }>>();
  });

  test('chainable: .annotate() after .where preserves row type', () => {
    const plan = db.users
      .select('id', 'email')
      .where((c, fns) => fns.eq(c.id, 1))
      .annotate(cacheAnnotation.apply({ ttl: 60 }))
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ id: number; email: string }>>();
  });

  test('chainable: .annotate() between .select and .limit preserves row type', () => {
    const plan = db.users
      .select('id')
      .annotate(cacheAnnotation.apply({ ttl: 60 }))
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
      .annotate(cacheAnnotation.apply({ ttl: 60 }))
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ user_id: number }>>();
  });

  test('accepts a both-kind annotation', () => {
    const plan = db.posts
      .select('user_id')
      .groupBy('user_id')
      .annotate(otelAnnotation.apply({ traceId: 't' }))
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ user_id: number }>>();
  });

  test('rejects a write-only annotation (negative)', () => {
    db.posts
      .select('user_id')
      .groupBy('user_id')
      // @ts-expect-error - audit declares applicableTo: ['write'], not 'read'
      .annotate(auditAnnotation.apply({ actor: 'system' }));
  });

  test('chainable: .annotate() between .groupBy and .orderBy preserves row type', () => {
    const plan = db.posts
      .select('user_id')
      .groupBy('user_id')
      .annotate(cacheAnnotation.apply({ ttl: 60 }))
      .orderBy('user_id')
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ user_id: number }>>();
  });
});

describe('InsertQuery.annotate (write-typed)', () => {
  test('accepts a write-only annotation', () => {
    db.users.insert({ name: 'Alice' }).annotate(auditAnnotation.apply({ actor: 'system' }));
  });

  test('accepts a both-kind annotation', () => {
    db.users.insert({ name: 'Alice' }).annotate(otelAnnotation.apply({ traceId: 't' }));
  });

  test('rejects a read-only annotation (negative)', () => {
    // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
    db.users.insert({ name: 'Alice' }).annotate(cacheAnnotation.apply({ ttl: 60 }));
  });

  test('rejects a mix containing a read-only annotation (negative)', () => {
    db.users
      .insert({ name: 'Alice' })
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      .annotate(auditAnnotation.apply({ actor: 'system' }), cacheAnnotation.apply({ ttl: 60 }));
  });

  test('chainable: .annotate() before .returning preserves the resulting row type', () => {
    const plan = db.users
      .insert({ name: 'Alice' })
      .annotate(auditAnnotation.apply({ actor: 'system' }))
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
      .annotate(auditAnnotation.apply({ actor: 'system' }));
  });

  test('accepts a both-kind annotation', () => {
    db.users
      .update({ name: 'Alice' })
      .where((f, fns) => fns.eq(f.id, 1))
      .annotate(otelAnnotation.apply({ traceId: 't' }));
  });

  test('rejects a read-only annotation (negative)', () => {
    db.users
      .update({ name: 'Alice' })
      .where((f, fns) => fns.eq(f.id, 1))
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      .annotate(cacheAnnotation.apply({ ttl: 60 }));
  });

  test('chainable: .annotate() before .returning preserves the resulting row type', () => {
    const plan = db.users
      .update({ name: 'Alice' })
      .where((f, fns) => fns.eq(f.id, 1))
      .annotate(auditAnnotation.apply({ actor: 'system' }))
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
      .annotate(auditAnnotation.apply({ actor: 'system' }));
  });

  test('accepts a both-kind annotation', () => {
    db.users
      .delete()
      .where((f, fns) => fns.eq(f.id, 1))
      .annotate(otelAnnotation.apply({ traceId: 't' }));
  });

  test('rejects a read-only annotation (negative)', () => {
    db.users
      .delete()
      .where((f, fns) => fns.eq(f.id, 1))
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      .annotate(cacheAnnotation.apply({ ttl: 60 }));
  });

  test('chainable: .annotate() before .returning preserves the resulting row type', () => {
    const plan = db.users
      .delete()
      .where((f, fns) => fns.eq(f.id, 1))
      .annotate(auditAnnotation.apply({ actor: 'system' }))
      .returning('id')
      .build();
    expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<{ id: number }>>();
  });
});
