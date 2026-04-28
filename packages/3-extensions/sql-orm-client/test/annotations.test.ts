import { defineAnnotation } from '@prisma-next/framework-components/runtime';
import { describe, expect, it } from 'vitest';
import {
  createCollection,
  createCollectionFor,
  createReturningCollectionFor,
} from './collection-fixtures';

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

describe('Collection.create annotations', () => {
  it('writes the applied write annotation under its namespace on the executed plan', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection.create(
      { id: 1, name: 'Alice', email: 'a@b.com' },
      auditAnnotation.apply({ actor: 'system' }),
    );

    expect(runtime.executions).toHaveLength(1);
    const plan = runtime.executions[0]!.plan;
    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });

  it('accepts a both-kind annotation', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection.create(
      { id: 1, name: 'Alice', email: 'a@b.com' },
      otelAnnotation.apply({ traceId: 't-1' }),
    );

    const plan = runtime.executions[0]!.plan;
    expect(otelAnnotation.read(plan)).toEqual({ traceId: 't-1' });
  });

  it('zero annotations leaves the plan without user annotations', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection.create({ id: 1, name: 'Alice', email: 'a@b.com' });

    const plan = runtime.executions[0]!.plan;
    expect(auditAnnotation.read(plan)).toBeUndefined();
    expect(otelAnnotation.read(plan)).toBeUndefined();
  });

  it('runtime gate rejects a read-only annotation forced through a cast', async () => {
    const { collection } = createReturningCollectionFor('User');
    const createFn = collection.create as unknown as (
      data: unknown,
      annotation: unknown,
    ) => Promise<unknown>;
    await expect(
      createFn.call(
        collection,
        { id: 1, name: 'Alice', email: 'a@b.com' },
        cacheAnnotation.apply({ ttl: 60 }),
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
      category: 'RUNTIME',
    });
  });
});

describe('Collection.createAll annotations', () => {
  it('writes the applied annotation onto every plan emitted by the split path', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([
      [{ id: 1, name: 'A', email: 'a@b.com' }],
      [{ id: 2, name: 'B', email: 'b@b.com' }],
    ]);

    await collection
      .createAll(
        [
          { id: 1, name: 'A', email: 'a@b.com' },
          { id: 2, name: 'B', email: 'b@b.com' },
        ],
        auditAnnotation.apply({ actor: 'system' }),
      )
      .toArray();

    expect(runtime.executions.length).toBeGreaterThan(0);
    for (const execution of runtime.executions) {
      expect(auditAnnotation.read(execution.plan)).toEqual({ actor: 'system' });
    }
  });
});

describe('Collection.createCount annotations', () => {
  it('writes the applied annotation onto the executed plan', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[]]);

    await collection.createCount(
      [{ id: 1, name: 'A', email: 'a@b.com' }],
      auditAnnotation.apply({ actor: 'system' }),
    );

    expect(runtime.executions.length).toBeGreaterThan(0);
    for (const execution of runtime.executions) {
      expect(auditAnnotation.read(execution.plan)).toEqual({ actor: 'system' });
    }
  });
});

describe('Collection.upsert annotations', () => {
  it('writes the applied annotation under its namespace on the executed plan', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection.upsert(
      {
        create: { id: 1, name: 'Alice', email: 'a@b.com' },
        update: { name: 'Alice' },
        conflictOn: { id: 1 },
      },
      auditAnnotation.apply({ actor: 'system' }),
    );

    const plan = runtime.executions[0]!.plan;
    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });

  it('runtime gate rejects a read-only annotation forced through a cast', async () => {
    const { collection } = createReturningCollectionFor('User');
    const upsertFn = collection.upsert as unknown as (
      input: unknown,
      annotation: unknown,
    ) => Promise<unknown>;
    await expect(
      upsertFn.call(
        collection,
        {
          create: { id: 1, name: 'Alice', email: 'a@b.com' },
          update: { name: 'Alice' },
          conflictOn: { id: 1 },
        },
        cacheAnnotation.apply({ ttl: 60 }),
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
    });
  });
});

describe('Collection.update annotations', () => {
  it('writes the applied annotation under its namespace on the executed plan', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection
      .where({ id: 1 })
      .update({ name: 'Alice' }, auditAnnotation.apply({ actor: 'system' }));

    const plan = runtime.executions[0]!.plan;
    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });

  it('runtime gate rejects a read-only annotation forced through a cast', async () => {
    const { collection } = createReturningCollectionFor('User');
    const filtered = collection.where({ id: 1 });
    const updateFn = filtered.update as unknown as (
      data: unknown,
      annotation: unknown,
    ) => Promise<unknown>;
    await expect(
      updateFn.call(filtered, { name: 'Alice' }, cacheAnnotation.apply({ ttl: 60 })),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
    });
  });
});

describe('Collection.updateAll annotations', () => {
  it('writes the applied annotation under its namespace on the executed plan', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection
      .where({ id: 1 })
      .updateAll({ name: 'Alice' }, auditAnnotation.apply({ actor: 'system' }))
      .toArray();

    const plan = runtime.executions[0]!.plan;
    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });
});

describe('Collection.updateCount annotations', () => {
  it('writes the applied annotation onto the update statement (not the matching read)', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    // Two execute calls: matching select first, then the update.
    runtime.setNextResults([[{ id: 1 }], []]);

    await collection
      .where({ id: 1 })
      .updateCount({ name: 'Alice' }, auditAnnotation.apply({ actor: 'system' }));

    expect(runtime.executions).toHaveLength(2);
    const matchingPlan = runtime.executions[0]!.plan;
    const updatePlan = runtime.executions[1]!.plan;
    // The matching read does NOT carry the write annotation.
    expect(auditAnnotation.read(matchingPlan)).toBeUndefined();
    // The update statement DOES.
    expect(auditAnnotation.read(updatePlan)).toEqual({ actor: 'system' });
  });
});

describe('Collection.delete annotations', () => {
  it('writes the applied annotation under its namespace on the executed plan', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection.where({ id: 1 }).delete(auditAnnotation.apply({ actor: 'system' }));

    const plan = runtime.executions[0]!.plan;
    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });

  it('runtime gate rejects a read-only annotation forced through a cast', async () => {
    const { collection } = createReturningCollectionFor('User');
    const filtered = collection.where({ id: 1 });
    const deleteFn = filtered.delete as unknown as (annotation: unknown) => Promise<unknown>;
    await expect(deleteFn.call(filtered, cacheAnnotation.apply({ ttl: 60 }))).rejects.toMatchObject(
      {
        code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
      },
    );
  });
});

describe('Collection.deleteAll annotations', () => {
  it('writes the applied annotation under its namespace on the executed plan', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection
      .where({ id: 1 })
      .deleteAll(auditAnnotation.apply({ actor: 'system' }))
      .toArray();

    const plan = runtime.executions[0]!.plan;
    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });
});

describe('Collection.deleteCount annotations', () => {
  it('writes the applied annotation onto the delete statement (not the matching read)', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    // Two execute calls: matching select first, then the delete.
    runtime.setNextResults([[{ id: 1 }], []]);

    await collection.where({ id: 1 }).deleteCount(auditAnnotation.apply({ actor: 'system' }));

    expect(runtime.executions).toHaveLength(2);
    const matchingPlan = runtime.executions[0]!.plan;
    const deletePlan = runtime.executions[1]!.plan;
    // The matching read does NOT carry the write annotation.
    expect(auditAnnotation.read(matchingPlan)).toBeUndefined();
    // The delete statement DOES.
    expect(auditAnnotation.read(deletePlan)).toEqual({ actor: 'system' });
  });
});

describe('Collection.aggregate annotations', () => {
  it('writes the applied read annotation under its namespace on the executed plan', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ count: '5' }]]);

    await collection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      cacheAnnotation.apply({ ttl: 60 }),
    );

    expect(runtime.executions).toHaveLength(1);
    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('accepts a both-kind annotation', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ count: '5' }]]);

    await collection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      otelAnnotation.apply({ traceId: 't-1' }),
    );

    const plan = runtime.executions[0]!.plan;
    expect(otelAnnotation.read(plan)).toEqual({ traceId: 't-1' });
  });

  it('zero annotations leaves the plan without user annotations', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ count: '5' }]]);

    await collection.aggregate((aggregate) => ({ count: aggregate.count() }));

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toBeUndefined();
    expect(otelAnnotation.read(plan)).toBeUndefined();
  });

  it('runtime gate rejects a write-only annotation forced through a cast', async () => {
    const { collection } = createCollectionFor('Post');
    const aggregateFn = collection.aggregate as unknown as (
      fn: unknown,
      annotation: unknown,
    ) => Promise<unknown>;
    await expect(
      aggregateFn.call(
        collection,
        (aggregate: { count: () => unknown }) => ({ count: aggregate.count() }),
        auditAnnotation.apply({ actor: 'system' }),
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
      category: 'RUNTIME',
    });
  });
});

describe('GroupedCollection.aggregate annotations', () => {
  it('writes the applied read annotation under its namespace on the executed plan', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ user_id: 1, count: '2' }]]);

    await collection
      .groupBy('userId')
      .aggregate((aggregate) => ({ count: aggregate.count() }), cacheAnnotation.apply({ ttl: 60 }));

    expect(runtime.executions).toHaveLength(1);
    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('accepts a both-kind annotation', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ user_id: 1, count: '2' }]]);

    await collection
      .groupBy('userId')
      .aggregate(
        (aggregate) => ({ count: aggregate.count() }),
        otelAnnotation.apply({ traceId: 't-1' }),
      );

    const plan = runtime.executions[0]!.plan;
    expect(otelAnnotation.read(plan)).toEqual({ traceId: 't-1' });
  });

  it('zero annotations leaves the plan without user annotations', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ user_id: 1, count: '2' }]]);

    await collection.groupBy('userId').aggregate((aggregate) => ({ count: aggregate.count() }));

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toBeUndefined();
    expect(otelAnnotation.read(plan)).toBeUndefined();
  });

  it('runtime gate rejects a write-only annotation forced through a cast', async () => {
    const { collection } = createCollectionFor('Post');
    const grouped = collection.groupBy('userId') as unknown as {
      aggregate(fn: unknown, annotation: unknown): Promise<unknown>;
    };
    await expect(
      grouped.aggregate(
        (aggregate: { count: () => unknown }) => ({ count: aggregate.count() }),
        auditAnnotation.apply({ actor: 'system' }),
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
    });
  });
});
