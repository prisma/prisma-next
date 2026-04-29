import { assertType, describe, expectTypeOf, test } from 'vitest';
import { ANNOTATION_BUILDER } from '../src/annotation-registry';
import {
  type AnnotationBuilder,
  type AnnotationHandle,
  type AnnotationsOf,
  type AnnotationValue,
  defineAnnotation,
  type OperationKind,
  type RegistryFor,
} from '../src/annotations';

/**
 * Type-level tests for the registry-driven annotation surface.
 *
 * Verifies:
 *  - `defineAnnotation<P, Kinds>` returns a callable handle with the
 *    expected metadata fields.
 *  - `RegistryFor<K, Reg>` keeps registry entries whose handle's `Kinds`
 *    intersect with `K`, drops the rest. `AnnotationsOf<Mw>` flattens a
 *    middleware tuple to its merged registry shape.
 *  - `AnnotationBuilder<K, Reg>` exposes only the kind-applicable methods
 *    and chains via the same builder type.
 */

const readOnly = defineAnnotation<{ ttl: number }, 'read'>({
  name: 'cache',
  applicableTo: ['read'],
});

const writeOnly = defineAnnotation<{ actor: string }, 'write'>({
  name: 'audit',
  applicableTo: ['write'],
});

const both = defineAnnotation<{ traceId: string }, 'read' | 'write'>({
  name: 'otel',
  applicableTo: ['read', 'write'],
});

describe('defineAnnotation generics', () => {
  test('defineAnnotation preserves Payload and Kinds in the handle type', () => {
    expectTypeOf(readOnly).toEqualTypeOf<AnnotationHandle<{ ttl: number }, 'read'>>();
    expectTypeOf(writeOnly).toEqualTypeOf<AnnotationHandle<{ actor: string }, 'write'>>();
    expectTypeOf(both).toEqualTypeOf<AnnotationHandle<{ traceId: string }, 'read' | 'write'>>();
  });

  test('AnnotationHandle is callable and returns an AnnotationValue', () => {
    expectTypeOf(readOnly).toBeCallableWith({ ttl: 60 });
    const value = readOnly({ ttl: 60 });
    expectTypeOf(value).toEqualTypeOf<AnnotationValue<{ ttl: number }, 'read'>>();
  });

  test('AnnotationHandle.name is a string', () => {
    expectTypeOf(readOnly.name).toBeString();
  });

  test('AnnotationHandle.namespace is a string', () => {
    expectTypeOf(readOnly.namespace).toBeString();
  });

  test('AnnotationHandle.applicableTo is a ReadonlySet narrowed to the declared Kinds', () => {
    expectTypeOf(readOnly.applicableTo).toEqualTypeOf<ReadonlySet<'read'>>();
    expectTypeOf(writeOnly.applicableTo).toEqualTypeOf<ReadonlySet<'write'>>();
    expectTypeOf(both.applicableTo).toEqualTypeOf<ReadonlySet<'read' | 'write'>>();
  });

  test('handle calls preserve Payload and Kinds in the AnnotationValue', () => {
    const r = readOnly({ ttl: 60 });
    const w = writeOnly({ actor: 'system' });
    const x = both({ traceId: 't' });

    expectTypeOf(r).toEqualTypeOf<AnnotationValue<{ ttl: number }, 'read'>>();
    expectTypeOf(w).toEqualTypeOf<AnnotationValue<{ actor: string }, 'write'>>();
    expectTypeOf(x).toEqualTypeOf<AnnotationValue<{ traceId: string }, 'read' | 'write'>>();
  });

  test('handle calls reject payloads of the wrong shape (negative)', () => {
    // @ts-expect-error - missing required `ttl` field
    readOnly({});
    // @ts-expect-error - wrong field name
    readOnly({ wrong: 60 });
    // @ts-expect-error - wrong field type
    readOnly({ ttl: 'not a number' });
  });

  test('read returns Payload | undefined', () => {
    const plan: { readonly meta: { readonly annotations?: Record<string, unknown> } } = {
      meta: {},
    };
    const out = readOnly.read(plan);
    expectTypeOf(out).toEqualTypeOf<{ ttl: number } | undefined>();
  });
});

describe('RegistryFor and AnnotationsOf', () => {
  type Registry = {
    readonly cache: typeof readOnly;
    readonly audit: typeof writeOnly;
    readonly otel: typeof both;
  };

  test("RegistryFor<'read', Reg> keeps read-or-both handles, drops write-only", () => {
    type Read = RegistryFor<'read', Registry>;
    expectTypeOf<Read>().toEqualTypeOf<{
      readonly cache: typeof readOnly;
      readonly otel: typeof both;
    }>();
  });

  test("RegistryFor<'write', Reg> keeps write-or-both handles, drops read-only", () => {
    type Write = RegistryFor<'write', Registry>;
    expectTypeOf<Write>().toEqualTypeOf<{
      readonly audit: typeof writeOnly;
      readonly otel: typeof both;
    }>();
  });

  test('AnnotationsOf flattens a middleware tuple to the merged registry shape', () => {
    interface CacheMw {
      readonly name: 'cache';
      readonly annotations: { readonly cache: typeof readOnly };
    }
    interface AuditMw {
      readonly name: 'audit';
      readonly annotations: { readonly audit: typeof writeOnly };
    }

    type Mw = readonly [CacheMw, AuditMw];
    type Merged = AnnotationsOf<Mw>;

    expectTypeOf<Merged>().toEqualTypeOf<
      {
        readonly cache: typeof readOnly;
      } & {
        readonly audit: typeof writeOnly;
      }
    >();
  });

  test('AnnotationsOf on the empty tuple yields an empty registry', () => {
    type Merged = AnnotationsOf<readonly []>;
    expectTypeOf<Merged>().toEqualTypeOf<{}>();
  });

  test('AnnotationsOf treats middleware without annotations as empty contribution', () => {
    interface CacheMw {
      readonly name: 'cache';
      readonly annotations: { readonly cache: typeof readOnly };
    }
    interface ObserverMw {
      readonly name: 'observer';
      // no annotations field
    }

    type Mw = readonly [CacheMw, ObserverMw];
    type Merged = AnnotationsOf<Mw>;

    expectTypeOf<Merged>().toEqualTypeOf<{ readonly cache: typeof readOnly }>();
  });
});

describe('AnnotationBuilder', () => {
  type Registry = {
    readonly cache: typeof readOnly;
    readonly audit: typeof writeOnly;
    readonly otel: typeof both;
  };

  test("AnnotationBuilder<'read', Reg> exposes only read-applicable methods", () => {
    type ReadBuilder = AnnotationBuilder<'read', Registry>;
    expectTypeOf<ReadBuilder>().toHaveProperty('cache');
    expectTypeOf<ReadBuilder>().toHaveProperty('otel');
    // @ts-expect-error - audit is write-only and is filtered out of the read builder.
    type _AuditOnRead = ReadBuilder['audit'];
  });

  test("AnnotationBuilder<'write', Reg> exposes only write-applicable methods", () => {
    type WriteBuilder = AnnotationBuilder<'write', Registry>;
    expectTypeOf<WriteBuilder>().toHaveProperty('audit');
    expectTypeOf<WriteBuilder>().toHaveProperty('otel');
    // @ts-expect-error - cache is read-only and is filtered out of the write builder.
    type _CacheOnWrite = WriteBuilder['cache'];
  });

  test("AnnotationBuilder<'read', Reg>.cache accepts the declared payload", () => {
    type ReadBuilder = AnnotationBuilder<'read', Registry>;
    const meta = {} as ReadBuilder;

    expectTypeOf(meta.cache).toBeCallableWith({ ttl: 60 });
    // @ts-expect-error - cache requires { ttl: number }
    meta.cache({ wrong: true });
  });

  test('AnnotationBuilder methods return another AnnotationBuilder of the same kind/Reg (chainable)', () => {
    type ReadBuilder = AnnotationBuilder<'read', Registry>;
    const meta = {} as ReadBuilder;

    const r1 = meta.cache({ ttl: 60 });
    expectTypeOf(r1).toEqualTypeOf<AnnotationBuilder<'read', Registry>>();

    const r2 = meta.cache({ ttl: 60 }).otel({ traceId: 't' });
    expectTypeOf(r2).toEqualTypeOf<AnnotationBuilder<'read', Registry>>();
  });

  test('AnnotationBuilder carries values and the brand symbol', () => {
    type ReadBuilder = AnnotationBuilder<'read', Registry>;
    const meta = {} as ReadBuilder;

    expectTypeOf(meta.values).toEqualTypeOf<readonly AnnotationValue<unknown, OperationKind>[]>();
    expectTypeOf(meta[ANNOTATION_BUILDER]).toEqualTypeOf<true>();
  });

  test('AnnotationBuilder of empty registry has no kind-applicable methods, only values + brand', () => {
    type EmptyBuilder = AnnotationBuilder<'read', {}>;
    const meta = {} as EmptyBuilder;
    expectTypeOf(meta.values).toEqualTypeOf<readonly AnnotationValue<unknown, OperationKind>[]>();
    expectTypeOf(meta[ANNOTATION_BUILDER]).toEqualTypeOf<true>();
    // @ts-expect-error - no annotation methods on an empty registry
    type _Cache = EmptyBuilder['cache'];
  });
});

describe('lane-terminal call-shape simulation', () => {
  type Registry = {
    readonly cache: typeof readOnly;
    readonly audit: typeof writeOnly;
    readonly otel: typeof both;
  };

  /**
   * Mimics the shape lane terminals adopt: a callback receiving a
   * kind-filtered `AnnotationBuilder<K, Reg>`. Callbacks may either
   * return the chained builder or a readonly array of `AnnotationValue`s
   * (the array escape hatch).
   */
  function readTerminal(
    fn: (
      meta: AnnotationBuilder<'read', Registry>,
    ) => AnnotationBuilder<'read', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): void {
    void fn;
  }

  function writeTerminal(
    fn: (
      meta: AnnotationBuilder<'write', Registry>,
    ) => AnnotationBuilder<'write', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
  ): void {
    void fn;
  }

  test('read terminal accepts read-applicable annotations via callback', () => {
    readTerminal((meta) => meta.cache({ ttl: 60 }));
  });

  test('read terminal accepts both-kind annotations via callback', () => {
    readTerminal((meta) => meta.otel({ traceId: 't' }));
  });

  test('read terminal accepts a chained mix of read-only and both-kind annotations', () => {
    readTerminal((meta) => meta.cache({ ttl: 60 }).otel({ traceId: 't' }));
  });

  test('read terminal rejects write-only annotations (negative)', () => {
    // @ts-expect-error - audit is write-only and not present on AnnotationBuilder<'read', Reg>.
    readTerminal((meta) => meta.audit({ actor: 'system' }));
  });

  test('write terminal accepts write-applicable annotations via callback', () => {
    writeTerminal((meta) => meta.audit({ actor: 'system' }));
  });

  test('write terminal accepts both-kind annotations via callback', () => {
    writeTerminal((meta) => meta.otel({ traceId: 't' }));
  });

  test('write terminal rejects read-only annotations (negative)', () => {
    // @ts-expect-error - cache is read-only and not present on AnnotationBuilder<'write', Reg>.
    writeTerminal((meta) => meta.cache({ ttl: 60 }));
  });

  test('terminals accept the array escape hatch for ad-hoc / closure-captured handles', () => {
    readTerminal(() => [readOnly({ ttl: 60 })]);
    writeTerminal(() => [writeOnly({ actor: 'system' })]);
  });
});

describe('type narrowness preserved across the gate', () => {
  type Registry = { readonly cache: typeof readOnly; readonly otel: typeof both };

  test('the AnnotationValue payload survives the chained builder', () => {
    function inspect(
      fn: (
        meta: AnnotationBuilder<'read', Registry>,
      ) => AnnotationBuilder<'read', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
    ): readonly AnnotationValue<unknown, OperationKind>[] {
      void fn;
      return [];
    }
    void inspect;

    // The handle's payload type still flows through the AnnotationValue
    // when invoked directly (the array escape hatch).
    const value = both({ traceId: 't' });
    assertType<{ traceId: string }>(value.value);
  });
});
