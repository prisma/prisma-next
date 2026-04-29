import { describe, expect, it } from 'vitest';
import { ANNOTATION_BUILDER, createAnnotationRegistry } from '../src/annotation-registry';
import { defineAnnotation } from '../src/annotations';
import { createMetaBuilder } from '../src/meta-builder';

const cacheAnnotation = defineAnnotation<{ ttl: number }, 'read'>({
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

function populatedRegistry() {
  const registry = createAnnotationRegistry();
  registry.register(cacheAnnotation);
  registry.register(auditAnnotation);
  registry.register(otelAnnotation);
  return registry;
}

describe('createMetaBuilder', () => {
  it('returns an object with the brand symbol and an empty values array', () => {
    const meta = createMetaBuilder(populatedRegistry(), 'read');
    expect((meta as unknown as Record<symbol, unknown>)[ANNOTATION_BUILDER]).toBe(true);
    expect(meta.values).toEqual([]);
  });

  it('exposes only the registered methods whose handle applies to the kind', () => {
    const readMeta = createMetaBuilder(populatedRegistry(), 'read');
    const writeMeta = createMetaBuilder(populatedRegistry(), 'write');

    expect(typeof (readMeta as unknown as Record<string, unknown>)['cache']).toBe('function');
    expect(typeof (readMeta as unknown as Record<string, unknown>)['otel']).toBe('function');
    expect((readMeta as unknown as Record<string, unknown>)['audit']).toBeUndefined();

    expect(typeof (writeMeta as unknown as Record<string, unknown>)['audit']).toBe('function');
    expect(typeof (writeMeta as unknown as Record<string, unknown>)['otel']).toBe('function');
    expect((writeMeta as unknown as Record<string, unknown>)['cache']).toBeUndefined();
  });

  it('calling a method returns a new builder carrying the produced AnnotationValue', () => {
    const meta = createMetaBuilder(populatedRegistry(), 'read');
    const next = (meta as unknown as { cache: (p: { ttl: number }) => typeof meta }).cache({
      ttl: 60,
    });

    expect(next).not.toBe(meta);
    expect((next as unknown as Record<symbol, unknown>)[ANNOTATION_BUILDER]).toBe(true);
    expect(next.values).toHaveLength(1);
    const [first] = next.values;
    expect(first?.namespace).toBe('cache');
    expect(first?.value).toEqual({ ttl: 60 });
  });

  it('chained calls accumulate values in order', () => {
    const meta = createMetaBuilder(populatedRegistry(), 'read');
    const final = (
      meta as unknown as {
        cache(p: { ttl: number }): {
          otel(p: { traceId: string }): { values: typeof meta.values };
        };
      }
    )
      .cache({ ttl: 60 })
      .otel({ traceId: 't-1' });

    expect(final.values).toHaveLength(2);
    expect(final.values[0]?.namespace).toBe('cache');
    expect(final.values[0]?.value).toEqual({ ttl: 60 });
    expect(final.values[1]?.namespace).toBe('otel');
    expect(final.values[1]?.value).toEqual({ traceId: 't-1' });
  });

  it('does not mutate the previous builder when a method is called', () => {
    const meta = createMetaBuilder(populatedRegistry(), 'read');
    expect(meta.values).toEqual([]);
    (meta as unknown as { cache(p: { ttl: number }): typeof meta }).cache({ ttl: 60 });
    expect(meta.values).toEqual([]);
  });

  it('builders are frozen', () => {
    const meta = createMetaBuilder(populatedRegistry(), 'read');
    expect(Object.isFrozen(meta)).toBe(true);
    const next = (meta as unknown as { cache(p: { ttl: number }): typeof meta }).cache({ ttl: 60 });
    expect(Object.isFrozen(next)).toBe(true);
  });

  it('an empty registry produces a builder with the brand and an empty values array, no methods', () => {
    const meta = createMetaBuilder(createAnnotationRegistry(), 'read');
    expect((meta as unknown as Record<symbol, unknown>)[ANNOTATION_BUILDER]).toBe(true);
    expect(meta.values).toEqual([]);
    // No methods on an empty-registry builder.
    expect(Object.keys(meta)).toEqual(['values']);
  });
});
