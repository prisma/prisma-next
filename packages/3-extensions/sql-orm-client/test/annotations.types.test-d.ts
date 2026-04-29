import type { AnnotationValue } from '@prisma-next/framework-components/runtime';
import { describe, expectTypeOf, test } from 'vitest';
import type { Collection } from '../src/collection';
import type { GroupedCollection } from '../src/grouped-collection';
import type { TestContract } from './helpers';
import { cacheAnnotation, otelAnnotation, type TestRegistry } from './test-annotations';

/**
 * Type-level tests for the ORM `Collection` and `GroupedCollection`
 * terminal annotation callbacks.
 *
 * Verifies:
 *  - Read terminals (`all`, `first`, `aggregate`) accept callbacks
 *    against `AnnotationBuilder<'read', TestRegistry>` and reject
 *    write-only handle methods (`meta.audit`) structurally — the
 *    method simply does not exist on the kind-filtered builder.
 *  - Write terminals (`create`, `createAll`, `update`, `delete`,
 *    etc.) accept callbacks against `AnnotationBuilder<'write',
 *    TestRegistry>` and reject read-only handle methods
 *    (`meta.cache`) structurally.
 *  - Both-kind handles (`otel`) work on either side.
 *  - The array escape hatch — `() => [cacheAnnotation({...})]` —
 *    accepts externally-imported handles without going through the
 *    builder.
 *  - Filter argument (`first(filter, annotateFn)`) preserves return
 *    types and tolerates `undefined` for "no filter".
 *  - Negative tests use `@ts-expect-error` against the property-not-
 *    found error from the structural filter (no
 *    `ValidAnnotations<…>` chain anymore).
 */

declare const userCollection: Collection<
  TestContract,
  'User',
  Record<string, unknown>,
  {
    readonly hasOrderBy: false;
    readonly hasWhere: false;
    readonly hasUniqueFilter: false;
    readonly variantName: undefined;
  },
  TestRegistry
>;

describe('Collection.all (read-typed)', () => {
  test('accepts a read-only annotation', () => {
    userCollection.all((meta) => meta.cache({ ttl: 60 }));
  });

  test('accepts a both-kind annotation', () => {
    userCollection.all((meta) => meta.otel({ traceId: 't' }));
  });

  test('accepts multiple chained annotations in a single callback', () => {
    userCollection.all((meta) => meta.cache({ ttl: 60 }).otel({ traceId: 't' }));
  });

  test('accepts the array escape hatch with externally-imported handles', () => {
    userCollection.all(() => [cacheAnnotation({ ttl: 60 })]);
  });

  test('rejects a write-only annotation (negative)', () => {
    userCollection.all(
      // @ts-expect-error - audit is write-only and is not present on AnnotationBuilder<'read', TestRegistry>.
      (meta) => meta.audit({ actor: 'system' }),
    );
  });

  test('the return type is not widened by the annotation callback', () => {
    const result = userCollection.all((meta) => meta.cache({ ttl: 60 }));
    // The return type is AsyncIterableResult<Row> regardless of annotations.
    expectTypeOf(result).toHaveProperty('toArray');
    expectTypeOf(result.toArray).returns.toMatchTypeOf<Promise<unknown[]>>();
  });
});

describe('Collection.first (read-typed)', () => {
  test('accepts a read-only annotation with no filter (undefined slot)', () => {
    userCollection.first(undefined, (meta) => meta.cache({ ttl: 60 }));
  });

  test('accepts a read-only annotation after a function filter', () => {
    userCollection.first(
      (user) => user.name.eq('Alice'),
      (meta) => meta.cache({ ttl: 60 }),
    );
  });

  test('accepts a read-only annotation after a shorthand filter', () => {
    userCollection.first({ name: 'Alice' }, (meta) => meta.cache({ ttl: 60 }));
  });

  test('accepts multiple chained annotations after a filter', () => {
    userCollection.first(
      (user) => user.name.eq('Alice'),
      (meta) => meta.cache({ ttl: 60 }).otel({ traceId: 't' }),
    );
  });

  test('accepts a function filter without an annotation callback', () => {
    userCollection.first((user) => user.name.eq('Alice'));
  });

  test('rejects a write-only annotation (negative)', () => {
    userCollection.first(
      undefined,
      // @ts-expect-error - audit is write-only and is not present on AnnotationBuilder<'read', TestRegistry>.
      (meta) => meta.audit({ actor: 'system' }),
    );
  });

  test('rejects a write-only annotation after a shorthand filter (negative)', () => {
    userCollection.first(
      { name: 'Alice' },
      // @ts-expect-error - audit is write-only and is not present on AnnotationBuilder<'read', TestRegistry>.
      (meta) => meta.audit({ actor: 'system' }),
    );
  });

  test('the return type is Promise<Row | null>', () => {
    const result = userCollection.first(undefined, (meta) => meta.cache({ ttl: 60 }));
    expectTypeOf(result).resolves.toMatchTypeOf<Record<string, unknown> | null>();
  });
});

describe('Collection has no chainable .annotate (intentional scope cut)', () => {
  // Annotations attach via terminal `annotateFn` callbacks only — there
  // is no chainable `.annotate(...)` on Collection. This is the spec
  // OQ 1 resolution: the per-terminal kind binding makes a chainable
  // form fight the structural builder.
  test('Collection does not expose an annotate method', () => {
    type Keys = keyof Collection<TestContract, 'User'>;
    type HasAnnotate = 'annotate' extends Keys ? true : false;
    expectTypeOf<HasAnnotate>().toEqualTypeOf<false>();
  });
});

describe('annotation handle types are preserved through the lane', () => {
  // The handle's payload type survives the gate — same property
  // exercised in the framework-components type-d tests, but verified
  // here at the ORM lane to ensure no widening happens through the
  // `Collection.all` / `Collection.first` callback signatures.
  test('the chainable form forwards the handle payload', () => {
    userCollection.all((meta) => meta.cache({ ttl: 60 }));
  });

  test('the array escape hatch preserves AnnotationValue typing', () => {
    const value = cacheAnnotation({ ttl: 60 });
    expectTypeOf(value).toMatchTypeOf<AnnotationValue<{ ttl: number; skip?: boolean }, 'read'>>();
    userCollection.all(() => [value]);
  });

  test('the array escape hatch accepts a tuple of handles invoked directly', () => {
    userCollection.all(() => [cacheAnnotation({ ttl: 60 }), otelAnnotation({ traceId: 't' })]);
  });
});

// ---------------------------------------------------------------------------
// Write terminals
//
// The contract is symmetrical to the read terminals: each write terminal
// accepts callbacks against `AnnotationBuilder<'write', TestRegistry>`,
// rejects read-only handle methods (`meta.cache`) structurally, preserves
// its return type, and tolerates an omitted callback.
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
  },
  TestRegistry
>;

describe('Collection.create (write-typed)', () => {
  test('accepts a write-only annotation', () => {
    userCollection.create({ id: 1, name: 'Alice', email: 'a@b.com' }, (meta) =>
      meta.audit({ actor: 'system' }),
    );
  });

  test('accepts a both-kind annotation', () => {
    userCollection.create({ id: 1, name: 'Alice', email: 'a@b.com' }, (meta) =>
      meta.otel({ traceId: 't' }),
    );
  });

  test('omitting the callback typechecks', () => {
    userCollection.create({ id: 1, name: 'Alice', email: 'a@b.com' });
  });

  test('rejects a read-only annotation (negative)', () => {
    userCollection.create(
      { id: 1, name: 'Alice', email: 'a@b.com' },
      // @ts-expect-error - cache is read-only and is not present on AnnotationBuilder<'write', TestRegistry>.
      (meta) => meta.cache({ ttl: 60 }),
    );
  });

  test('the return type is Promise<Row>', () => {
    const result = userCollection.create({ id: 1, name: 'Alice', email: 'a@b.com' }, (meta) =>
      meta.audit({ actor: 'system' }),
    );
    expectTypeOf(result).resolves.toMatchTypeOf<Record<string, unknown>>();
  });
});

describe('Collection.createAll (write-typed)', () => {
  test('accepts a write-only annotation', () => {
    userCollection.createAll([{ id: 1, name: 'Alice', email: 'a@b.com' }], (meta) =>
      meta.audit({ actor: 'system' }),
    );
  });

  test('omitting the callback typechecks', () => {
    userCollection.createAll([{ id: 1, name: 'Alice', email: 'a@b.com' }]);
  });

  test('rejects a read-only annotation (negative)', () => {
    userCollection.createAll(
      [{ id: 1, name: 'Alice', email: 'a@b.com' }],
      // @ts-expect-error - cache is read-only and is not present on AnnotationBuilder<'write', TestRegistry>.
      (meta) => meta.cache({ ttl: 60 }),
    );
  });
});

describe('Collection.createCount (write-typed)', () => {
  test('accepts a write-only annotation', () => {
    userCollection.createCount([{ id: 1, name: 'Alice', email: 'a@b.com' }], (meta) =>
      meta.audit({ actor: 'system' }),
    );
  });

  test('rejects a read-only annotation (negative)', () => {
    userCollection.createCount(
      [{ id: 1, name: 'Alice', email: 'a@b.com' }],
      // @ts-expect-error - cache is read-only and is not present on AnnotationBuilder<'write', TestRegistry>.
      (meta) => meta.cache({ ttl: 60 }),
    );
  });

  test('the return type is Promise<number>', () => {
    const result = userCollection.createCount(
      [{ id: 1, name: 'Alice', email: 'a@b.com' }],
      (meta) => meta.audit({ actor: 'system' }),
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
      (meta) => meta.audit({ actor: 'system' }),
    );
  });

  test('rejects a read-only annotation (negative)', () => {
    userCollection.upsert(
      {
        create: { id: 1, name: 'Alice', email: 'a@b.com' },
        update: { name: 'Alice' },
        conflictOn: { id: 1 },
      },
      // @ts-expect-error - cache is read-only and is not present on AnnotationBuilder<'write', TestRegistry>.
      (meta) => meta.cache({ ttl: 60 }),
    );
  });
});

describe('Collection.update / .updateAll / .updateCount (write-typed)', () => {
  // Update terminals require the receiver to satisfy the
  // `State['hasWhere'] extends true` gate, so we use a separately-
  // declared `userCollectionWithWhere` whose State is post-where.
  test('update accepts a write-only annotation', () => {
    userCollectionWithWhere.update({ name: 'Alice' }, (meta) => meta.audit({ actor: 'system' }));
  });

  test('update rejects a read-only annotation (negative)', () => {
    userCollectionWithWhere.update(
      { name: 'Alice' },
      // @ts-expect-error - cache is read-only and is not present on AnnotationBuilder<'write', TestRegistry>.
      (meta) => meta.cache({ ttl: 60 }),
    );
  });

  test('updateAll accepts a write-only annotation', () => {
    userCollectionWithWhere.updateAll({ name: 'Alice' }, (meta) => meta.audit({ actor: 'system' }));
  });

  test('updateAll rejects a read-only annotation (negative)', () => {
    userCollectionWithWhere.updateAll(
      { name: 'Alice' },
      // @ts-expect-error - cache is read-only and is not present on AnnotationBuilder<'write', TestRegistry>.
      (meta) => meta.cache({ ttl: 60 }),
    );
  });

  test('updateCount accepts a write-only annotation', () => {
    userCollectionWithWhere.updateCount({ name: 'Alice' }, (meta) =>
      meta.audit({ actor: 'system' }),
    );
  });

  test('updateCount rejects a read-only annotation (negative)', () => {
    userCollectionWithWhere.updateCount(
      { name: 'Alice' },
      // @ts-expect-error - cache is read-only and is not present on AnnotationBuilder<'write', TestRegistry>.
      (meta) => meta.cache({ ttl: 60 }),
    );
  });

  test('updateCount returns Promise<number>', () => {
    const result = userCollectionWithWhere.updateCount({ name: 'Alice' }, (meta) =>
      meta.audit({ actor: 'system' }),
    );
    expectTypeOf(result).resolves.toBeNumber();
  });
});

describe('Collection.delete / .deleteAll / .deleteCount (write-typed)', () => {
  test('delete accepts a write-only annotation', () => {
    userCollectionWithWhere.delete((meta) => meta.audit({ actor: 'system' }));
  });

  test('delete rejects a read-only annotation (negative)', () => {
    userCollectionWithWhere.delete(
      // @ts-expect-error - cache is read-only and is not present on AnnotationBuilder<'write', TestRegistry>.
      (meta) => meta.cache({ ttl: 60 }),
    );
  });

  test('deleteAll accepts a write-only annotation', () => {
    userCollectionWithWhere.deleteAll((meta) => meta.audit({ actor: 'system' }));
  });

  test('deleteAll rejects a read-only annotation (negative)', () => {
    userCollectionWithWhere.deleteAll(
      // @ts-expect-error - cache is read-only and is not present on AnnotationBuilder<'write', TestRegistry>.
      (meta) => meta.cache({ ttl: 60 }),
    );
  });

  test('deleteCount accepts a write-only annotation', () => {
    userCollectionWithWhere.deleteCount((meta) => meta.audit({ actor: 'system' }));
  });

  test('deleteCount rejects a read-only annotation (negative)', () => {
    userCollectionWithWhere.deleteCount(
      // @ts-expect-error - cache is read-only and is not present on AnnotationBuilder<'write', TestRegistry>.
      (meta) => meta.cache({ ttl: 60 }),
    );
  });
});

// ---------------------------------------------------------------------------
// Aggregate terminals (read-typed)
//
// Both `Collection.aggregate(fn, annotateFn?)` and
// `GroupedCollection.aggregate(fn, annotateFn?)` are read terminals that
// run a single SQL aggregation query and accept an optional annotation
// callback after the builder callback.
// ---------------------------------------------------------------------------

describe('Collection.aggregate (read-typed)', () => {
  test('accepts a read-only annotation', () => {
    userCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) => meta.cache({ ttl: 60 }),
    );
  });

  test('accepts a both-kind annotation', () => {
    userCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) => meta.otel({ traceId: 't' }),
    );
  });

  test('omitting the callback typechecks', () => {
    userCollection.aggregate((aggregate) => ({ count: aggregate.count() }));
  });

  test('rejects a write-only annotation (negative)', () => {
    userCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      // @ts-expect-error - audit is write-only and is not present on AnnotationBuilder<'read', TestRegistry>.
      (meta) => meta.audit({ actor: 'system' }),
    );
  });

  test('the aggregation spec type is preserved through the gate', () => {
    const result = userCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) => meta.cache({ ttl: 60 }),
    );
    expectTypeOf(result).resolves.toMatchTypeOf<{ count: number }>();
  });
});

declare const userGroupedCollection: GroupedCollection<
  TestContract,
  'Post',
  ['userId'],
  TestRegistry
>;

describe('GroupedCollection.aggregate (read-typed)', () => {
  test('accepts a read-only annotation', () => {
    userGroupedCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) => meta.cache({ ttl: 60 }),
    );
  });

  test('accepts a both-kind annotation', () => {
    userGroupedCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) => meta.otel({ traceId: 't' }),
    );
  });

  test('omitting the callback typechecks', () => {
    userGroupedCollection.aggregate((aggregate) => ({ count: aggregate.count() }));
  });

  test('rejects a write-only annotation (negative)', () => {
    userGroupedCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      // @ts-expect-error - audit is write-only and is not present on AnnotationBuilder<'read', TestRegistry>.
      (meta) => meta.audit({ actor: 'system' }),
    );
  });

  test('accepts the array escape hatch with externally-imported handles', () => {
    userGroupedCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      () => [cacheAnnotation({ ttl: 60 })],
    );
  });
});
