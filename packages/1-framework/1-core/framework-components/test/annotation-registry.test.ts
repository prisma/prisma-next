import { describe, expect, it } from 'vitest';
import { createAnnotationRegistry } from '../src/annotation-registry';
import { defineAnnotation } from '../src/annotations';

describe('AnnotationRegistry', () => {
  it('starts empty', () => {
    const registry = createAnnotationRegistry();
    expect(registry.entries()).toEqual({});
  });

  it('registers a handle keyed on its name', () => {
    const registry = createAnnotationRegistry();
    const cache = defineAnnotation<{ ttl: number }, 'read'>({
      name: 'cache',
      applicableTo: ['read'],
    });

    registry.register(cache);

    const entries = registry.entries();
    expect(Object.keys(entries)).toEqual(['cache']);
    expect(entries['cache']).toBe(cache);
  });

  it('registers multiple distinct handles', () => {
    const registry = createAnnotationRegistry();
    const cache = defineAnnotation<{ ttl: number }, 'read'>({
      name: 'cache',
      applicableTo: ['read'],
    });
    const audit = defineAnnotation<{ actor: string }, 'write'>({
      name: 'audit',
      applicableTo: ['write'],
    });

    registry.register(cache);
    registry.register(audit);

    expect(Object.keys(registry.entries()).sort()).toEqual(['audit', 'cache']);
  });

  it('re-registering the same handle by identity is a no-op', () => {
    const registry = createAnnotationRegistry();
    const cache = defineAnnotation<{ ttl: number }, 'read'>({
      name: 'cache',
      applicableTo: ['read'],
    });

    registry.register(cache);
    expect(() => registry.register(cache)).not.toThrow();
    expect(Object.keys(registry.entries())).toEqual(['cache']);
    expect(registry.entries()['cache']).toBe(cache);
  });

  it('throws when a different handle is registered under the same name', () => {
    const registry = createAnnotationRegistry();
    const cacheA = defineAnnotation<{ ttl: number }, 'read'>({
      name: 'cache',
      applicableTo: ['read'],
    });
    const cacheB = defineAnnotation<{ ttl: number }, 'read'>({
      name: 'cache',
      applicableTo: ['read'],
    });

    registry.register(cacheA);

    expect(() => registry.register(cacheB)).toThrow(
      'Annotation "cache" is already registered with a different handle',
    );
  });

  it('returns frozen entries snapshots', () => {
    const registry = createAnnotationRegistry();
    const cache = defineAnnotation<{ ttl: number }, 'read'>({
      name: 'cache',
      applicableTo: ['read'],
    });

    registry.register(cache);

    const entries = registry.entries();
    expect(Object.isFrozen(entries)).toBe(true);
  });

  it('entries snapshot does not mutate when new handles are registered after the read', () => {
    const registry = createAnnotationRegistry();
    const cache = defineAnnotation<{ ttl: number }, 'read'>({
      name: 'cache',
      applicableTo: ['read'],
    });

    const before = registry.entries();
    expect(Object.keys(before)).toEqual([]);

    registry.register(cache);

    expect(Object.keys(before)).toEqual([]);
    expect(Object.keys(registry.entries())).toEqual(['cache']);
  });
});
