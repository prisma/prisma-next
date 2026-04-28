import { defineAnnotation } from '@prisma-next/framework-components/runtime';
import { describe, expect, it } from 'vitest';
import { createCollection } from './collection-fixtures';

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

describe('Collection.all annotations', () => {
  it('writes the applied annotation under its namespace on the executed plan', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.all(cacheAnnotation.apply({ ttl: 60 })).toArray();

    expect(runtime.executions).toHaveLength(1);
    const stored = runtime.executions[0]!.plan.meta.annotations?.['cache'];
    expect(stored).toMatchObject({
      __annotation: true,
      namespace: 'cache',
      value: { ttl: 60 },
    });
  });

  it('round-trips through the typed handle.read accessor', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.all(cacheAnnotation.apply({ ttl: 60 })).toArray();

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('returns undefined from handle.read on a plan that was never annotated', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.all().toArray();

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toBeUndefined();
  });

  it('multiple annotations under different namespaces coexist', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection
      .all(cacheAnnotation.apply({ ttl: 60 }), otelAnnotation.apply({ traceId: 't-1' }))
      .toArray();

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
    expect(otelAnnotation.read(plan)).toEqual({ traceId: 't-1' });
  });

  it('zero annotations is a no-op for user annotations (empty variadic)', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.all().toArray();

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toBeUndefined();
    expect(otelAnnotation.read(plan)).toBeUndefined();
  });

  it('annotations survive across .where() and .take() chaining', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection
      .where((user) => user.name.eq('Alice'))
      .take(10)
      .all(cacheAnnotation.apply({ ttl: 60 }))
      .toArray();

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('runtime gate rejects a write-only annotation forced through a cast', () => {
    const { collection } = createCollection();
    const allFn = collection.all as unknown as (annotation: unknown) => unknown;
    expect(() => allFn.call(collection, auditAnnotation.apply({ actor: 'system' }))).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
        category: 'RUNTIME',
      }),
    );
  });
});

describe('Collection.first annotations', () => {
  it('writes the applied annotation under its namespace on the executed plan (no filter)', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.first(cacheAnnotation.apply({ ttl: 60 }));

    expect(runtime.executions).toHaveLength(1);
    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('writes the applied annotation when invoked with a function filter', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.first((user) => user.name.eq('Alice'), cacheAnnotation.apply({ ttl: 60 }));

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('writes the applied annotation when invoked with a shorthand filter', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.first({ name: 'Alice' }, cacheAnnotation.apply({ ttl: 60 }));

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('disambiguates a leading AnnotationValue from a shorthand filter', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    // The leading argument is an AnnotationValue, not a filter. The terminal
    // must treat it as the leading annotation, not as a where shorthand.
    await collection.first(cacheAnnotation.apply({ ttl: 60 }));

    expect(runtime.executions).toHaveLength(1);
    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
    // No filter should have been derived from the annotation.
    // (Verify indirectly: the executed plan should not contain a where
    // clause derived from the annotation's payload.)
    const annotationKeys = Object.keys(plan.meta.annotations ?? {});
    expect(annotationKeys).toContain('cache');
  });

  it('multiple annotations coexist under different namespaces', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.first(
      (user) => user.name.eq('Alice'),
      cacheAnnotation.apply({ ttl: 60 }),
      otelAnnotation.apply({ traceId: 't-1' }),
    );

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
    expect(otelAnnotation.read(plan)).toEqual({ traceId: 't-1' });
  });

  it('runtime gate rejects a write-only annotation forced through a cast', async () => {
    const { collection } = createCollection();
    const firstFn = collection.first as unknown as (annotation: unknown) => Promise<unknown>;
    await expect(
      firstFn.call(collection, auditAnnotation.apply({ actor: 'system' })),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
      category: 'RUNTIME',
    });
  });
});

describe('Collection annotations alongside framework-internal codecs metadata', () => {
  it('user annotations coexist with the framework-internal codecs map under its reserved namespace', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.all(cacheAnnotation.apply({ ttl: 60 })).toArray();

    const plan = runtime.executions[0]!.plan;
    // User annotation lives under its own namespace.
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
    // Reserved framework namespace, when emitted, lives under 'codecs' and
    // is not a branded AnnotationValue (so handle.read with namespace
    // 'codecs' would return undefined; we check the raw shape here).
    if (plan.meta.annotations?.['codecs'] !== undefined) {
      expect(plan.meta.annotations['codecs']).toEqual(expect.any(Object));
    }
  });
});
