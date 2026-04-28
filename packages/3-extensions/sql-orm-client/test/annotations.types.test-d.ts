import {
  type AnnotationValue,
  defineAnnotation,
  type OperationKind,
} from '@prisma-next/framework-components/runtime';
import { describe, expectTypeOf, test } from 'vitest';
import type { Collection } from '../src/collection';
import type { TestContract } from './helpers';

/**
 * Type-level tests for the ORM `Collection` terminal annotations.
 *
 * Verifies:
 *  - Read terminals (`all`, `first`) accept read-typed and both-kind
 *    annotations and reject write-only ones via the
 *    `As & ValidAnnotations<'read', As>` gate.
 *  - The variadic position does not widen the terminal's return type.
 *  - `first(filter, ...annotations)` and `first(...annotations)` both
 *    typecheck (the leading argument disambiguates between filter and
 *    annotation).
 */

declare const userCollection: Collection<TestContract, 'User'>;

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

describe('Collection.all (read-typed)', () => {
  test('accepts a read-only annotation', () => {
    userCollection.all(cacheAnnotation.apply({ ttl: 60 }));
  });

  test('accepts a both-kind annotation', () => {
    userCollection.all(otelAnnotation.apply({ traceId: 't' }));
  });

  test('accepts multiple compatible annotations in a single call', () => {
    userCollection.all(cacheAnnotation.apply({ ttl: 60 }), otelAnnotation.apply({ traceId: 't' }));
  });

  test('accepts zero annotations (empty variadic)', () => {
    userCollection.all();
  });

  test('rejects a write-only annotation (negative)', () => {
    // @ts-expect-error - audit declares applicableTo: ['write'], not 'read'
    userCollection.all(auditAnnotation.apply({ actor: 'system' }));
  });

  test('rejects a mix containing a write-only annotation (negative)', () => {
    // biome-ignore format: keep on one line so @ts-expect-error attaches to the call
    // @ts-expect-error - audit declares applicableTo: ['write'], not 'read'
    userCollection.all(cacheAnnotation.apply({ ttl: 60 }), auditAnnotation.apply({ actor: 'system' }));
  });

  test('the return type is not widened by the variadic argument', () => {
    const result = userCollection.all(cacheAnnotation.apply({ ttl: 60 }));
    // The return type is AsyncIterableResult<Row> regardless of annotations.
    expectTypeOf(result).toHaveProperty('toArray');
    expectTypeOf(result.toArray).returns.toMatchTypeOf<Promise<unknown[]>>();
  });
});

describe('Collection.first (read-typed)', () => {
  test('accepts a read-only annotation with no filter', () => {
    userCollection.first(cacheAnnotation.apply({ ttl: 60 }));
  });

  test('accepts a read-only annotation after a function filter', () => {
    userCollection.first((user) => user.name.eq('Alice'), cacheAnnotation.apply({ ttl: 60 }));
  });

  test('accepts a read-only annotation after a shorthand filter', () => {
    userCollection.first({ name: 'Alice' }, cacheAnnotation.apply({ ttl: 60 }));
  });

  test('accepts multiple compatible annotations after a filter', () => {
    userCollection.first(
      (user) => user.name.eq('Alice'),
      cacheAnnotation.apply({ ttl: 60 }),
      otelAnnotation.apply({ traceId: 't' }),
    );
  });

  test('accepts zero annotations (empty variadic, no filter)', () => {
    userCollection.first();
  });

  test('accepts a function filter without annotations', () => {
    userCollection.first((user) => user.name.eq('Alice'));
  });

  test('rejects a write-only annotation (negative)', () => {
    // @ts-expect-error - audit declares applicableTo: ['write'], not 'read'
    userCollection.first(auditAnnotation.apply({ actor: 'system' }));
  });

  test('rejects a write-only annotation after a shorthand filter (negative)', () => {
    // @ts-expect-error - audit declares applicableTo: ['write'], not 'read'
    userCollection.first({ name: 'Alice' }, auditAnnotation.apply({ actor: 'system' }));
  });

  test('the return type is Promise<Row | null>', () => {
    const result = userCollection.first(cacheAnnotation.apply({ ttl: 60 }));
    expectTypeOf(result).resolves.toMatchTypeOf<Record<string, unknown> | null>();
  });
});

describe('Collection has no chainable .annotate (intentional scope cut)', () => {
  // Annotations attach via terminal arguments only — there is no
  // chainable `.annotate(...)` on Collection. This is the spec OQ 1
  // resolution: the applicability gate at the terminal makes a
  // chainable form fight the per-terminal kind binding.
  test('Collection does not expose an annotate method', () => {
    type Keys = keyof Collection<TestContract, 'User'>;
    type HasAnnotate = 'annotate' extends Keys ? true : false;
    expectTypeOf<HasAnnotate>().toEqualTypeOf<false>();
  });
});

describe('annotation handle types are preserved through the lane', () => {
  // The handle's payload type survives the gate — this is the same
  // property exercised in the framework-components type-d tests, but
  // verified here at the ORM lane to ensure no widening happens
  // through the Collection.all/first signature.
  test('cacheAnnotation.apply is assignable through to the terminal', () => {
    const value = cacheAnnotation.apply({ ttl: 60 });
    expectTypeOf(value).toMatchTypeOf<AnnotationValue<{ ttl: number; skip?: boolean }, 'read'>>();
    userCollection.all(value);
  });

  test('an inferred annotation tuple preserves per-element typing', () => {
    function passthrough<As extends readonly AnnotationValue<unknown, OperationKind>[]>(
      ...annotations: As
    ): As {
      return annotations;
    }
    const tuple = passthrough(
      cacheAnnotation.apply({ ttl: 60 }),
      otelAnnotation.apply({ traceId: 't' }),
    );
    expectTypeOf(tuple).toMatchTypeOf<
      readonly [
        AnnotationValue<{ ttl: number; skip?: boolean }, 'read'>,
        AnnotationValue<{ traceId: string }, 'read' | 'write'>,
      ]
    >();
  });
});
