import {
  type AnnotationValue,
  defineAnnotation,
  type OperationKind,
} from '@prisma-next/framework-components/runtime';
import { describe, expectTypeOf, test } from 'vitest';
import type { Collection } from '../src/collection';
import type { GroupedCollection } from '../src/grouped-collection';
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

// ---------------------------------------------------------------------------
// Write terminals
//
// The contract is symmetrical to the read terminals: each write terminal
// accepts write-only and both-kind annotations, rejects read-only ones at
// the type level, preserves its return type, and accepts an empty variadic.
// ---------------------------------------------------------------------------

declare const userCollectionWithWhere: Collection<
  TestContract,
  'User',
  Record<string, unknown>,
  {
    readonly hasOrderBy: false;
    readonly hasWhere: true;
    readonly hasUniqueFilter: false;
    readonly variantName: undefined;
  }
>;

describe('Collection.create (write-typed)', () => {
  test('accepts a write-only annotation', () => {
    userCollection.create(
      { id: 1, name: 'Alice', email: 'a@b.com' },
      auditAnnotation.apply({ actor: 'system' }),
    );
  });

  test('accepts a both-kind annotation', () => {
    userCollection.create(
      { id: 1, name: 'Alice', email: 'a@b.com' },
      otelAnnotation.apply({ traceId: 't' }),
    );
  });

  test('accepts zero annotations (empty variadic)', () => {
    userCollection.create({ id: 1, name: 'Alice', email: 'a@b.com' });
  });

  test('rejects a read-only annotation (negative)', () => {
    userCollection.create(
      { id: 1, name: 'Alice', email: 'a@b.com' },
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      cacheAnnotation.apply({ ttl: 60 }),
    );
  });

  test('rejects a mix containing a read-only annotation (negative)', () => {
    // biome-ignore format: keep on one line so @ts-expect-error attaches to the call
    // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
    userCollection.create({ id: 1, name: 'Alice', email: 'a@b.com' }, auditAnnotation.apply({ actor: 'system' }), cacheAnnotation.apply({ ttl: 60 }));
  });

  test('the return type is Promise<Row>', () => {
    const result = userCollection.create(
      { id: 1, name: 'Alice', email: 'a@b.com' },
      auditAnnotation.apply({ actor: 'system' }),
    );
    expectTypeOf(result).resolves.toMatchTypeOf<Record<string, unknown>>();
  });
});

describe('Collection.createAll (write-typed)', () => {
  test('accepts a write-only annotation', () => {
    userCollection.createAll(
      [{ id: 1, name: 'Alice', email: 'a@b.com' }],
      auditAnnotation.apply({ actor: 'system' }),
    );
  });

  test('accepts zero annotations (empty variadic)', () => {
    userCollection.createAll([{ id: 1, name: 'Alice', email: 'a@b.com' }]);
  });

  test('rejects a read-only annotation (negative)', () => {
    userCollection.createAll(
      [{ id: 1, name: 'Alice', email: 'a@b.com' }],
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      cacheAnnotation.apply({ ttl: 60 }),
    );
  });
});

describe('Collection.createCount (write-typed)', () => {
  test('accepts a write-only annotation', () => {
    userCollection.createCount(
      [{ id: 1, name: 'Alice', email: 'a@b.com' }],
      auditAnnotation.apply({ actor: 'system' }),
    );
  });

  test('rejects a read-only annotation (negative)', () => {
    userCollection.createCount(
      [{ id: 1, name: 'Alice', email: 'a@b.com' }],
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      cacheAnnotation.apply({ ttl: 60 }),
    );
  });

  test('the return type is Promise<number>', () => {
    const result = userCollection.createCount(
      [{ id: 1, name: 'Alice', email: 'a@b.com' }],
      auditAnnotation.apply({ actor: 'system' }),
    );
    expectTypeOf(result).resolves.toBeNumber();
  });
});

describe('Collection.upsert (write-typed)', () => {
  test('accepts a write-only annotation', () => {
    userCollection.upsert(
      {
        create: { id: 1, name: 'Alice', email: 'a@b.com' },
        update: { name: 'Alice' },
        conflictOn: { id: 1 },
      },
      auditAnnotation.apply({ actor: 'system' }),
    );
  });

  test('rejects a read-only annotation (negative)', () => {
    userCollection.upsert(
      {
        create: { id: 1, name: 'Alice', email: 'a@b.com' },
        update: { name: 'Alice' },
        conflictOn: { id: 1 },
      },
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      cacheAnnotation.apply({ ttl: 60 }),
    );
  });
});

describe('Collection.update / .updateAll / .updateCount (write-typed)', () => {
  // Update terminals require the receiver to satisfy the
  // `State['hasWhere'] extends true` gate, so we use a separately-
  // declared `userCollectionWithWhere` whose State is post-where.
  test('update accepts a write-only annotation', () => {
    userCollectionWithWhere.update({ name: 'Alice' }, auditAnnotation.apply({ actor: 'system' }));
  });

  test('update rejects a read-only annotation (negative)', () => {
    userCollectionWithWhere.update(
      { name: 'Alice' },
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      cacheAnnotation.apply({ ttl: 60 }),
    );
  });

  test('updateAll accepts a write-only annotation', () => {
    userCollectionWithWhere.updateAll(
      { name: 'Alice' },
      auditAnnotation.apply({ actor: 'system' }),
    );
  });

  test('updateAll rejects a read-only annotation (negative)', () => {
    userCollectionWithWhere.updateAll(
      { name: 'Alice' },
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      cacheAnnotation.apply({ ttl: 60 }),
    );
  });

  test('updateCount accepts a write-only annotation', () => {
    userCollectionWithWhere.updateCount(
      { name: 'Alice' },
      auditAnnotation.apply({ actor: 'system' }),
    );
  });

  test('updateCount rejects a read-only annotation (negative)', () => {
    userCollectionWithWhere.updateCount(
      { name: 'Alice' },
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      cacheAnnotation.apply({ ttl: 60 }),
    );
  });

  test('updateCount returns Promise<number>', () => {
    const result = userCollectionWithWhere.updateCount(
      { name: 'Alice' },
      auditAnnotation.apply({ actor: 'system' }),
    );
    expectTypeOf(result).resolves.toBeNumber();
  });
});

describe('Collection.delete / .deleteAll / .deleteCount (write-typed)', () => {
  test('delete accepts a write-only annotation', () => {
    userCollectionWithWhere.delete(auditAnnotation.apply({ actor: 'system' }));
  });

  test('delete rejects a read-only annotation (negative)', () => {
    // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
    userCollectionWithWhere.delete(cacheAnnotation.apply({ ttl: 60 }));
  });

  test('deleteAll accepts a write-only annotation', () => {
    userCollectionWithWhere.deleteAll(auditAnnotation.apply({ actor: 'system' }));
  });

  test('deleteAll rejects a read-only annotation (negative)', () => {
    // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
    userCollectionWithWhere.deleteAll(cacheAnnotation.apply({ ttl: 60 }));
  });

  test('deleteCount accepts a write-only annotation', () => {
    userCollectionWithWhere.deleteCount(auditAnnotation.apply({ actor: 'system' }));
  });

  test('deleteCount rejects a read-only annotation (negative)', () => {
    // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
    userCollectionWithWhere.deleteCount(cacheAnnotation.apply({ ttl: 60 }));
  });
});

// ---------------------------------------------------------------------------
// Aggregate terminals (read-typed)
//
// Both `Collection.aggregate(fn, ...annotations)` and
// `GroupedCollection.aggregate(fn, ...annotations)` are read terminals that
// run a single SQL aggregation query and accept user annotations after the
// builder callback.
// ---------------------------------------------------------------------------

describe('Collection.aggregate (read-typed)', () => {
  test('accepts a read-only annotation', () => {
    userCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      cacheAnnotation.apply({ ttl: 60 }),
    );
  });

  test('accepts a both-kind annotation', () => {
    userCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      otelAnnotation.apply({ traceId: 't' }),
    );
  });

  test('accepts zero annotations (empty variadic)', () => {
    userCollection.aggregate((aggregate) => ({ count: aggregate.count() }));
  });

  test('rejects a write-only annotation (negative)', () => {
    userCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      // @ts-expect-error - audit declares applicableTo: ['write'], not 'read'
      auditAnnotation.apply({ actor: 'system' }),
    );
  });

  test('rejects a mix containing a write-only annotation (negative)', () => {
    // biome-ignore format: keep on one line so @ts-expect-error attaches to the call
    // @ts-expect-error - audit declares applicableTo: ['write'], not 'read'
    userCollection.aggregate((aggregate) => ({ count: aggregate.count() }), cacheAnnotation.apply({ ttl: 60 }), auditAnnotation.apply({ actor: 'system' }));
  });

  test('the aggregation spec type is preserved through the gate', () => {
    const result = userCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      cacheAnnotation.apply({ ttl: 60 }),
    );
    expectTypeOf(result).resolves.toMatchTypeOf<{ count: number }>();
  });
});

declare const userGroupedCollection: GroupedCollection<TestContract, 'Post', ['userId']>;

describe('GroupedCollection.aggregate (read-typed)', () => {
  test('accepts a read-only annotation', () => {
    userGroupedCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      cacheAnnotation.apply({ ttl: 60 }),
    );
  });

  test('accepts a both-kind annotation', () => {
    userGroupedCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      otelAnnotation.apply({ traceId: 't' }),
    );
  });

  test('accepts zero annotations (empty variadic)', () => {
    userGroupedCollection.aggregate((aggregate) => ({ count: aggregate.count() }));
  });

  test('rejects a write-only annotation (negative)', () => {
    userGroupedCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      // @ts-expect-error - audit declares applicableTo: ['write'], not 'read'
      auditAnnotation.apply({ actor: 'system' }),
    );
  });
});
