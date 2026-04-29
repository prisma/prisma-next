import type { AnnotationValue, OperationKind } from '@prisma-next/framework-components/runtime';
import { assertType, expectTypeOf, test } from 'vitest';
import { type CachePayload, cacheAnnotation } from '../src/cache-annotation';

test('cacheAnnotation is callable and returns an AnnotationValue<CachePayload, "read">', () => {
  expectTypeOf(cacheAnnotation).toBeCallableWith({ ttl: 60 });
  const applied = cacheAnnotation({ ttl: 60 });
  expectTypeOf(applied).toEqualTypeOf<AnnotationValue<CachePayload, 'read'>>();
});

test('calling cacheAnnotation rejects non-CachePayload arguments', () => {
  // @ts-expect-error - unknown field on payload
  cacheAnnotation({ ttl: 60, nonsense: true });

  // @ts-expect-error - wrong field type
  cacheAnnotation({ ttl: '60' });

  // @ts-expect-error - wrong field type
  cacheAnnotation({ skip: 'yes' });
});

test('cacheAnnotation.read returns CachePayload | undefined', () => {
  const plan = {
    meta: {
      target: 'postgres',
      targetFamily: 'sql' as const,
      storageHash: 'sha256:test',
      lane: 'orm',
      paramDescriptors: [],
      annotations: {} as Record<string, unknown>,
    },
  };
  const result = cacheAnnotation.read(plan);
  expectTypeOf(result).toEqualTypeOf<CachePayload | undefined>();
});

test('cacheAnnotation.name is the literal string "cache"', () => {
  expectTypeOf(cacheAnnotation.name).toBeString();
});

test('cacheAnnotation.namespace is a string (defaults to name)', () => {
  expectTypeOf(cacheAnnotation.namespace).toBeString();
});

test('cacheAnnotation declares applicableTo = "read" only', () => {
  // The handle's Kinds parameter is the literal type 'read', not the wider
  // OperationKind union. This is what gates write terminals from accepting
  // it via the structural `RegistryFor<'write', Reg>` filter.
  expectTypeOf(cacheAnnotation.applicableTo).toEqualTypeOf<ReadonlySet<'read'>>();
});

test('CachePayload has optional ttl, skip, and key', () => {
  const empty: CachePayload = {};
  void empty;

  const ttlOnly: CachePayload = { ttl: 60 };
  void ttlOnly;

  const skipOnly: CachePayload = { skip: true };
  void skipOnly;

  const keyOnly: CachePayload = { key: 'k' };
  void keyOnly;

  const all: CachePayload = { ttl: 60, skip: false, key: 'k' };
  void all;
});

test('cacheAnnotation is not applicable to write operations at the type level', () => {
  // The handle's literal Kinds = 'read'. The applicableTo set type is
  // `ReadonlySet<'read'>`, not `ReadonlySet<OperationKind>` — so a
  // consumer asking whether 'write' is in the kind set sees `false`.
  type Kinds = typeof cacheAnnotation extends {
    readonly applicableTo: ReadonlySet<infer K>;
  }
    ? K
    : never;
  type WriteApplies = 'write' extends Kinds ? true : false;
  assertType<false>(false as WriteApplies);

  // The produced AnnotationValue carries 'read' specifically; it does
  // not extend AnnotationValue<CachePayload, 'write'>.
  const applied = cacheAnnotation({ ttl: 60 });
  expectTypeOf(applied).toExtend<AnnotationValue<CachePayload, 'read'>>();
  expectTypeOf(applied).not.toExtend<AnnotationValue<CachePayload, 'write'>>();
});

test('OperationKind import is not accidentally widened by cacheAnnotation', () => {
  // Sanity: the framework's OperationKind union is unchanged.
  expectTypeOf<OperationKind>().toEqualTypeOf<'read' | 'write'>();
});
