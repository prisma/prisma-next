import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import { defineAnnotation } from '@prisma-next/framework-components/runtime';
import { validateContract } from '@prisma-next/sql-contract/validate';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { sql } from '../../src/runtime/sql';
import { contract as contractJson } from '../fixtures/contract';
import type { Contract } from '../fixtures/generated/contract';

const sqlContract = validateContract<Contract>(contractJson, emptyCodecLookup);

const stubBase = {
  operations: {},
  codecs: {},
  queryOperations: { entries: () => ({}) },
  types: {},
  applyMutationDefaults: () => [],
};

function db() {
  return sql({
    context: { ...stubBase, contract: sqlContract } as unknown as ExecutionContext<
      typeof sqlContract
    >,
  });
}

const cacheAnnotation = defineAnnotation<{ ttl: number; skip?: boolean }, 'read'>({
  namespace: 'cache',
  applicableTo: ['read'],
});

const otelAnnotation = defineAnnotation<{ traceId: string }, 'read' | 'write'>({
  namespace: 'otel',
  applicableTo: ['read', 'write'],
});

const auditAnnotation = defineAnnotation<{ actor: string }, 'write'>({
  namespace: 'audit',
  applicableTo: ['write'],
});

describe('SelectQuery.annotate', () => {
  it('writes the applied annotation under its namespace on plan.meta.annotations', () => {
    const plan = db()
      .users.select('id')
      .annotate(cacheAnnotation.apply({ ttl: 60 }))
      .build();

    const stored = plan.meta.annotations?.['cache'];
    expect(stored).toMatchObject({
      __annotation: true,
      namespace: 'cache',
      value: { ttl: 60 },
    });
  });

  it('round-trips through the typed handle.read accessor', () => {
    const plan = db()
      .users.select('id')
      .annotate(cacheAnnotation.apply({ ttl: 60 }))
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('returns undefined from handle.read on a plan that was never annotated', () => {
    const plan = db().users.select('id').build();
    expect(cacheAnnotation.read(plan)).toBeUndefined();
  });

  it('multiple annotations under different namespaces coexist', () => {
    const plan = db()
      .users.select('id')
      .annotate(cacheAnnotation.apply({ ttl: 60 }))
      .annotate(otelAnnotation.apply({ traceId: 't-1' }))
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
    expect(otelAnnotation.read(plan)).toEqual({ traceId: 't-1' });
  });

  it('multiple annotations passed in a single call coexist', () => {
    const plan = db()
      .users.select('id')
      .annotate(cacheAnnotation.apply({ ttl: 60 }), otelAnnotation.apply({ traceId: 't-1' }))
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
    expect(otelAnnotation.read(plan)).toEqual({ traceId: 't-1' });
  });

  it('duplicate namespace last-write-wins', () => {
    const plan = db()
      .users.select('id')
      .annotate(cacheAnnotation.apply({ ttl: 60 }))
      .annotate(cacheAnnotation.apply({ ttl: 120 }))
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 120 });
  });

  it('annotate does not mutate the original builder (immutability)', () => {
    const base = db().users.select('id');
    const annotated = base.annotate(cacheAnnotation.apply({ ttl: 60 }));
    const basePlan = base.build();
    const annotatedPlan = annotated.build();

    expect(cacheAnnotation.read(basePlan)).toBeUndefined();
    expect(cacheAnnotation.read(annotatedPlan)).toEqual({ ttl: 60 });
  });

  it('chainable in any position: immediately after .select', () => {
    const plan = db()
      .users.select('id')
      .annotate(cacheAnnotation.apply({ ttl: 60 }))
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('chainable in any position: between .select and .where', () => {
    const plan = db()
      .users.select('id')
      .annotate(cacheAnnotation.apply({ ttl: 60 }))
      .where((f, fns) => fns.eq(f.id, 1))
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('chainable in any position: after .where, before .limit', () => {
    const plan = db()
      .users.select('id')
      .where((f, fns) => fns.eq(f.id, 1))
      .annotate(cacheAnnotation.apply({ ttl: 60 }))
      .limit(10)
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('annotate does not affect the produced AST shape', () => {
    const baseAst = db()
      .users.select('id')
      .where((f, fns) => fns.eq(f.id, 1))
      .buildAst();

    const annotatedAst = db()
      .users.select('id')
      .annotate(cacheAnnotation.apply({ ttl: 60 }))
      .where((f, fns) => fns.eq(f.id, 1))
      .annotate(otelAnnotation.apply({ traceId: 't-1' }))
      .buildAst();

    expect(annotatedAst).toEqual(baseAst);
  });

  it('annotate with no arguments is a no-op for user annotations (empty variadic)', () => {
    // The framework `codecs` map under the reserved namespace may still
    // populate `plan.meta.annotations` — this is independent of user
    // annotations. We verify only that no user annotation lands.
    const plan = db().users.select('id').annotate().build();

    expect(cacheAnnotation.read(plan)).toBeUndefined();
    expect(otelAnnotation.read(plan)).toBeUndefined();
    // No user-namespaced keys.
    const annotations = plan.meta.annotations ?? {};
    const userKeys = Object.keys(annotations).filter((k) => k !== 'codecs');
    expect(userKeys).toEqual([]);
  });

  it('runtime gate rejects a write-only annotation forced through a cast', () => {
    const builder = db().users.select('id') as unknown as {
      annotate(annotation: unknown): unknown;
    };
    expect(() => builder.annotate(auditAnnotation.apply({ actor: 'system' }))).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
        category: 'RUNTIME',
      }),
    );
  });
});

describe('GroupedQuery.annotate', () => {
  it('writes the applied annotation under its namespace on plan.meta.annotations', () => {
    const plan = db()
      .posts.select('user_id')
      .groupBy('user_id')
      .annotate(cacheAnnotation.apply({ ttl: 60 }))
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('chainable in any position: between .select and .groupBy', () => {
    const plan = db()
      .posts.select('user_id')
      .annotate(cacheAnnotation.apply({ ttl: 60 }))
      .groupBy('user_id')
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('chainable in any position: after .groupBy, before .having / .orderBy', () => {
    const plan = db()
      .posts.select('user_id')
      .groupBy('user_id')
      .annotate(cacheAnnotation.apply({ ttl: 60 }))
      .orderBy('user_id')
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('runtime gate rejects a write-only annotation forced through a cast', () => {
    const builder = db().posts.select('user_id').groupBy('user_id') as unknown as {
      annotate(annotation: unknown): unknown;
    };
    expect(() => builder.annotate(auditAnnotation.apply({ actor: 'system' }))).toThrow(
      expect.objectContaining({ code: 'RUNTIME.ANNOTATION_INAPPLICABLE' }),
    );
  });
});

describe('InsertQuery.annotate', () => {
  it('writes the applied annotation under its namespace on plan.meta.annotations', () => {
    const plan = db()
      .users.insert({ name: 'Alice' })
      .annotate(auditAnnotation.apply({ actor: 'system' }))
      .build();

    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });

  it('accepts both-kind annotations', () => {
    const plan = db()
      .users.insert({ name: 'Alice' })
      .annotate(otelAnnotation.apply({ traceId: 't-1' }))
      .build();

    expect(otelAnnotation.read(plan)).toEqual({ traceId: 't-1' });
  });

  it('survives across .returning(...) chaining', () => {
    const plan = db()
      .users.insert({ name: 'Alice' })
      .annotate(auditAnnotation.apply({ actor: 'system' }))
      .returning('id', 'name')
      .build();

    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });

  it('runtime gate rejects a read-only annotation forced through a cast', () => {
    const builder = db().users.insert({ name: 'Alice' }) as unknown as {
      annotate(annotation: unknown): unknown;
    };
    expect(() => builder.annotate(cacheAnnotation.apply({ ttl: 60 }))).toThrow(
      expect.objectContaining({ code: 'RUNTIME.ANNOTATION_INAPPLICABLE' }),
    );
  });
});

describe('UpdateQuery.annotate', () => {
  it('writes the applied annotation under its namespace on plan.meta.annotations', () => {
    const plan = db()
      .users.update({ name: 'Alice' })
      .where((f, fns) => fns.eq(f.id, 1))
      .annotate(auditAnnotation.apply({ actor: 'system' }))
      .build();

    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });

  it('survives across .where(...) and .returning(...) chaining', () => {
    const plan = db()
      .users.update({ name: 'Alice' })
      .annotate(auditAnnotation.apply({ actor: 'system' }))
      .where((f, fns) => fns.eq(f.id, 1))
      .returning('id', 'name')
      .build();

    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });

  it('runtime gate rejects a read-only annotation forced through a cast', () => {
    const builder = db().users.update({ name: 'Alice' }) as unknown as {
      annotate(annotation: unknown): unknown;
    };
    expect(() => builder.annotate(cacheAnnotation.apply({ ttl: 60 }))).toThrow(
      expect.objectContaining({ code: 'RUNTIME.ANNOTATION_INAPPLICABLE' }),
    );
  });
});

describe('DeleteQuery.annotate', () => {
  it('writes the applied annotation under its namespace on plan.meta.annotations', () => {
    const plan = db()
      .users.delete()
      .where((f, fns) => fns.eq(f.id, 1))
      .annotate(auditAnnotation.apply({ actor: 'system' }))
      .build();

    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });

  it('survives across .where(...) and .returning(...) chaining', () => {
    const plan = db()
      .users.delete()
      .annotate(auditAnnotation.apply({ actor: 'system' }))
      .where((f, fns) => fns.eq(f.id, 1))
      .returning('id')
      .build();

    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });

  it('runtime gate rejects a read-only annotation forced through a cast', () => {
    const builder = db().users.delete() as unknown as {
      annotate(annotation: unknown): unknown;
    };
    expect(() => builder.annotate(cacheAnnotation.apply({ ttl: 60 }))).toThrow(
      expect.objectContaining({ code: 'RUNTIME.ANNOTATION_INAPPLICABLE' }),
    );
  });
});

describe('annotate alongside framework-internal codecs metadata', () => {
  // The SQL emitter writes per-alias codec ids under the reserved
  // `codecs` namespace key in plan.meta.annotations. User annotations
  // must coexist with that without collision.
  it('coexists with the framework codecs map under its reserved namespace', () => {
    const plan = db()
      .users.select('id')
      .annotate(cacheAnnotation.apply({ ttl: 60 }))
      .build();

    // User annotation lives under its own namespace.
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
    // Reserved framework namespace is not affected.
    if (plan.meta.annotations?.['codecs'] !== undefined) {
      expect(plan.meta.annotations['codecs']).toEqual(
        expect.objectContaining({ id: expect.any(String) }),
      );
    }
  });
});
