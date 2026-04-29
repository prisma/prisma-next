import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import {
  createAnnotationRegistry,
  defineAnnotation,
} from '@prisma-next/framework-components/runtime';
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

const cacheAnnotation = defineAnnotation<{ ttl: number; skip?: boolean }, 'read'>({
  name: 'cache',
  applicableTo: ['read'],
});

const otelAnnotation = defineAnnotation<{ traceId: string }, 'read' | 'write'>({
  name: 'otel',
  applicableTo: ['read', 'write'],
});

const auditAnnotation = defineAnnotation<{ actor: string }, 'write'>({
  name: 'audit',
  applicableTo: ['write'],
});

type TestRegistry = {
  readonly cache: typeof cacheAnnotation;
  readonly otel: typeof otelAnnotation;
  readonly audit: typeof auditAnnotation;
};

/**
 * Constructs a test `db` with all three annotation handles registered
 * so the registry-driven `meta` builder exposes them on read / write
 * builders.
 */
function db() {
  const registry = createAnnotationRegistry();
  registry.register(cacheAnnotation);
  registry.register(otelAnnotation);
  registry.register(auditAnnotation);
  return sql<typeof sqlContract, TestRegistry>({
    context: { ...stubBase, contract: sqlContract } as unknown as ExecutionContext<
      typeof sqlContract
    >,
    annotationRegistry: registry,
  });
}

/**
 * Same shape but with no annotations registered \u2014 used to verify the
 * array escape hatch works even when the registry is empty.
 */
function dbWithoutRegistry() {
  return sql({
    context: { ...stubBase, contract: sqlContract } as unknown as ExecutionContext<
      typeof sqlContract
    >,
  });
}

describe('SelectQuery.annotate', () => {
  it('writes the applied annotation under its namespace on plan.meta.annotations', () => {
    const plan = db()
      .users.select('id')
      .annotate((meta) => meta.cache({ ttl: 60 }))
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
      .annotate((meta) => meta.cache({ ttl: 60 }))
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('returns undefined from handle.read on a plan that was never annotated', () => {
    const plan = db().users.select('id').build();
    expect(cacheAnnotation.read(plan)).toBeUndefined();
  });

  it('multiple annotations under different namespaces coexist (separate calls)', () => {
    const plan = db()
      .users.select('id')
      .annotate((meta) => meta.cache({ ttl: 60 }))
      .annotate((meta) => meta.otel({ traceId: 't-1' }))
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
    expect(otelAnnotation.read(plan)).toEqual({ traceId: 't-1' });
  });

  it('multiple annotations chained in a single callback coexist', () => {
    const plan = db()
      .users.select('id')
      .annotate((meta) => meta.cache({ ttl: 60 }).otel({ traceId: 't-1' }))
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
    expect(otelAnnotation.read(plan)).toEqual({ traceId: 't-1' });
  });

  it('duplicate namespace last-write-wins', () => {
    const plan = db()
      .users.select('id')
      .annotate((meta) => meta.cache({ ttl: 60 }))
      .annotate((meta) => meta.cache({ ttl: 120 }))
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 120 });
  });

  it('annotate does not mutate the original builder (immutability)', () => {
    const base = db().users.select('id');
    const annotated = base.annotate((meta) => meta.cache({ ttl: 60 }));
    const basePlan = base.build();
    const annotatedPlan = annotated.build();

    expect(cacheAnnotation.read(basePlan)).toBeUndefined();
    expect(cacheAnnotation.read(annotatedPlan)).toEqual({ ttl: 60 });
  });

  it('chainable in any position: immediately after .select', () => {
    const plan = db()
      .users.select('id')
      .annotate((meta) => meta.cache({ ttl: 60 }))
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('chainable in any position: between .select and .where', () => {
    const plan = db()
      .users.select('id')
      .annotate((meta) => meta.cache({ ttl: 60 }))
      .where((f, fns) => fns.eq(f.id, 1))
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('chainable in any position: after .where, before .limit', () => {
    const plan = db()
      .users.select('id')
      .where((f, fns) => fns.eq(f.id, 1))
      .annotate((meta) => meta.cache({ ttl: 60 }))
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
      .annotate((meta) => meta.cache({ ttl: 60 }))
      .where((f, fns) => fns.eq(f.id, 1))
      .annotate((meta) => meta.otel({ traceId: 't-1' }))
      .buildAst();

    expect(annotatedAst).toEqual(baseAst);
  });

  it('array escape hatch lands user annotations exactly like the chained builder', () => {
    const plan = db()
      .users.select('id')
      .annotate(() => [cacheAnnotation({ ttl: 60 })])
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('array escape hatch works when the registry contributes nothing', () => {
    // Useful for callers who hold a closure-captured handle that wasn't
    // contributed by middleware.
    const plan = dbWithoutRegistry()
      .users.select('id')
      .annotate(() => [cacheAnnotation({ ttl: 60 })])
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('callback returning an empty array is a no-op for user annotations', () => {
    const plan = db()
      .users.select('id')
      .annotate(() => [])
      .build();

    expect(cacheAnnotation.read(plan)).toBeUndefined();
    expect(otelAnnotation.read(plan)).toBeUndefined();
    const annotations = plan.meta.annotations ?? {};
    const userKeys = Object.keys(annotations).filter((k) => k !== 'codecs');
    expect(userKeys).toEqual([]);
  });

  it('runtime gate rejects a write-only annotation forced through a cast (array escape hatch)', () => {
    const builder = db().users.select('id') as unknown as {
      annotate(fn: (meta: unknown) => unknown): unknown;
    };
    expect(() => builder.annotate(() => [auditAnnotation({ actor: 'system' })])).toThrow(
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
      .annotate((meta) => meta.cache({ ttl: 60 }))
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('chainable in any position: between .select and .groupBy', () => {
    const plan = db()
      .posts.select('user_id')
      .annotate((meta) => meta.cache({ ttl: 60 }))
      .groupBy('user_id')
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('chainable in any position: after .groupBy, before .having / .orderBy', () => {
    const plan = db()
      .posts.select('user_id')
      .groupBy('user_id')
      .annotate((meta) => meta.cache({ ttl: 60 }))
      .orderBy('user_id')
      .build();

    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('runtime gate rejects a write-only annotation forced through a cast (array escape hatch)', () => {
    const builder = db().posts.select('user_id').groupBy('user_id') as unknown as {
      annotate(fn: (meta: unknown) => unknown): unknown;
    };
    expect(() => builder.annotate(() => [auditAnnotation({ actor: 'system' })])).toThrow(
      expect.objectContaining({ code: 'RUNTIME.ANNOTATION_INAPPLICABLE' }),
    );
  });
});

describe('InsertQuery.annotate', () => {
  it('writes the applied annotation under its namespace on plan.meta.annotations', () => {
    const plan = db()
      .users.insert({ name: 'Alice' })
      .annotate((meta) => meta.audit({ actor: 'system' }))
      .build();

    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });

  it('accepts both-kind annotations', () => {
    const plan = db()
      .users.insert({ name: 'Alice' })
      .annotate((meta) => meta.otel({ traceId: 't-1' }))
      .build();

    expect(otelAnnotation.read(plan)).toEqual({ traceId: 't-1' });
  });

  it('survives across .returning(...) chaining', () => {
    const plan = db()
      .users.insert({ name: 'Alice' })
      .annotate((meta) => meta.audit({ actor: 'system' }))
      .returning('id', 'name')
      .build();

    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });

  it('runtime gate rejects a read-only annotation forced through a cast (array escape hatch)', () => {
    const builder = db().users.insert({ name: 'Alice' }) as unknown as {
      annotate(fn: (meta: unknown) => unknown): unknown;
    };
    expect(() => builder.annotate(() => [cacheAnnotation({ ttl: 60 })])).toThrow(
      expect.objectContaining({ code: 'RUNTIME.ANNOTATION_INAPPLICABLE' }),
    );
  });
});

describe('UpdateQuery.annotate', () => {
  it('writes the applied annotation under its namespace on plan.meta.annotations', () => {
    const plan = db()
      .users.update({ name: 'Alice' })
      .where((f, fns) => fns.eq(f.id, 1))
      .annotate((meta) => meta.audit({ actor: 'system' }))
      .build();

    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });

  it('survives across .where(...) and .returning(...) chaining', () => {
    const plan = db()
      .users.update({ name: 'Alice' })
      .annotate((meta) => meta.audit({ actor: 'system' }))
      .where((f, fns) => fns.eq(f.id, 1))
      .returning('id', 'name')
      .build();

    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });

  it('runtime gate rejects a read-only annotation forced through a cast (array escape hatch)', () => {
    const builder = db().users.update({ name: 'Alice' }) as unknown as {
      annotate(fn: (meta: unknown) => unknown): unknown;
    };
    expect(() => builder.annotate(() => [cacheAnnotation({ ttl: 60 })])).toThrow(
      expect.objectContaining({ code: 'RUNTIME.ANNOTATION_INAPPLICABLE' }),
    );
  });
});

describe('DeleteQuery.annotate', () => {
  it('writes the applied annotation under its namespace on plan.meta.annotations', () => {
    const plan = db()
      .users.delete()
      .where((f, fns) => fns.eq(f.id, 1))
      .annotate((meta) => meta.audit({ actor: 'system' }))
      .build();

    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });

  it('survives across .where(...) and .returning(...) chaining', () => {
    const plan = db()
      .users.delete()
      .annotate((meta) => meta.audit({ actor: 'system' }))
      .where((f, fns) => fns.eq(f.id, 1))
      .returning('id')
      .build();

    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });

  it('runtime gate rejects a read-only annotation forced through a cast (array escape hatch)', () => {
    const builder = db().users.delete() as unknown as {
      annotate(fn: (meta: unknown) => unknown): unknown;
    };
    expect(() => builder.annotate(() => [cacheAnnotation({ ttl: 60 })])).toThrow(
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
      .annotate((meta) => meta.cache({ ttl: 60 }))
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
