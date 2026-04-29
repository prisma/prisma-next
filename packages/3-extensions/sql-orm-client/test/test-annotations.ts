import {
  type AnnotationRegistry,
  createAnnotationRegistry,
  defineAnnotation,
} from '@prisma-next/framework-components/runtime';

/**
 * Read-only test annotation. Mirrors the shape of the cache annotation
 * shipped by `@prisma-next/middleware-cache` so the registry-driven
 * builder produces a `meta.cache(...)` method on read terminals.
 */
export const cacheAnnotation = defineAnnotation<{ ttl: number; skip?: boolean }, 'read'>({
  name: 'cache',
  applicableTo: ['read'],
});

/**
 * Both-kind test annotation (read or write). Used to verify that
 * `meta.otel(...)` shows up on both `AnnotationBuilder<'read', …>` and
 * `AnnotationBuilder<'write', …>`.
 */
export const otelAnnotation = defineAnnotation<{ traceId: string }, 'read' | 'write'>({
  name: 'otel',
  applicableTo: ['read', 'write'],
});

/**
 * Write-only test annotation. Mirrors a hypothetical audit annotation;
 * used in negative tests to assert that `meta.audit(...)` is structurally
 * absent on read builders and that the runtime gate
 * `assertAnnotationsApplicable` still throws on cast-bypass.
 */
export const auditAnnotation = defineAnnotation<{ actor: string }, 'write'>({
  name: 'audit',
  applicableTo: ['write'],
});

/**
 * Static structural shape of the test registry — the same handles
 * registered into `testAnnotationRegistry` below. Used by type tests
 * to thread `Registry = TestRegistry` into `Collection` /
 * `GroupedCollection` so `meta.cache`, `meta.otel`, `meta.audit` are
 * structurally present on the kind-filtered builder.
 */
export type TestRegistry = {
  readonly cache: typeof cacheAnnotation;
  readonly otel: typeof otelAnnotation;
  readonly audit: typeof auditAnnotation;
};

/**
 * Builds a fresh `AnnotationRegistry` populated with the three test
 * annotations. The fixtures and the runtime tests share this so
 * `createMetaBuilder(...)` produces a builder with `cache`, `otel`,
 * `audit` methods (filtered by kind).
 */
export function createTestAnnotationRegistry(): AnnotationRegistry {
  const registry = createAnnotationRegistry();
  registry.register(cacheAnnotation);
  registry.register(otelAnnotation);
  registry.register(auditAnnotation);
  return registry;
}
