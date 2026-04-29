import type { PlanMeta } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import {
  type AnnotationValue,
  assertAnnotationsApplicable,
  defineAnnotation,
  type OperationKind,
} from '../src/annotations';

const meta: PlanMeta = {
  target: 'mock',
  storageHash: 'sha256:test',
  lane: 'raw-sql',
  paramDescriptors: [],
};

function makePlan(annotations?: Record<string, unknown>): {
  readonly meta: { readonly annotations?: Record<string, unknown> };
} {
  if (annotations === undefined) {
    return { meta };
  }
  return { meta: { ...meta, annotations } };
}

describe('defineAnnotation', () => {
  describe('handle metadata', () => {
    it('exposes the name it was created with', () => {
      const handle = defineAnnotation<{ ttl: number }, 'read'>({
        name: 'cache',
        applicableTo: ['read'],
      });
      expect(handle.name).toBe('cache');
    });

    it('defaults the namespace to the name when no namespace override is supplied', () => {
      const handle = defineAnnotation<{ ttl: number }, 'read'>({
        name: 'cache',
        applicableTo: ['read'],
      });
      expect(handle.namespace).toBe('cache');
    });

    it('uses an explicit namespace override when supplied', () => {
      const handle = defineAnnotation<{ ttl: number }, 'read'>({
        name: 'cache',
        namespace: 'custom-cache-ns',
        applicableTo: ['read'],
      });
      expect(handle.name).toBe('cache');
      expect(handle.namespace).toBe('custom-cache-ns');
    });

    it('exposes a frozen ReadonlySet for applicableTo', () => {
      const handle = defineAnnotation<{ ttl: number }, 'read' | 'write'>({
        name: 'otel',
        applicableTo: ['read', 'write'],
      });
      expect(handle.applicableTo.has('read')).toBe(true);
      expect(handle.applicableTo.has('write')).toBe(true);
      expect(Object.isFrozen(handle.applicableTo)).toBe(true);
    });

    it('handles do not share state across separate defineAnnotation calls', () => {
      const a = defineAnnotation<{ x: number }, 'read'>({
        name: 'a',
        applicableTo: ['read'],
      });
      const b = defineAnnotation<{ y: string }, 'write'>({
        name: 'b',
        applicableTo: ['write'],
      });
      expect(a.name).toBe('a');
      expect(a.namespace).toBe('a');
      expect(b.name).toBe('b');
      expect(b.namespace).toBe('b');
      expect(a.applicableTo.has('read')).toBe(true);
      expect(a.applicableTo.has('write' as 'read')).toBe(false);
      expect(b.applicableTo.has('write')).toBe(true);
    });

    it('handles do not expose a custom .apply member', () => {
      const handle = defineAnnotation<{ ttl: number }, 'read'>({
        name: 'cache',
        applicableTo: ['read'],
      });
      // Functions inherit `Function.prototype.apply`, so the property is
      // present from the prototype — that's expected and harmless. What
      // matters is that the handle does not own an `apply` property that
      // wraps the payload into an `AnnotationValue` (the old API). The
      // closure form is callable directly: `handle({ ttl: 60 })`.
      expect(Object.hasOwn(handle, 'apply')).toBe(false);
    });
  });

  describe('calling the handle', () => {
    it('returns an AnnotationValue carrying the __annotation brand', () => {
      const handle = defineAnnotation<{ ttl: number }, 'read'>({
        name: 'cache',
        applicableTo: ['read'],
      });
      const applied = handle({ ttl: 60 });
      expect(applied.__annotation).toBe(true);
    });

    it('embeds the namespace, payload, and applicableTo set on the value', () => {
      const handle = defineAnnotation<{ ttl: number }, 'read'>({
        name: 'cache',
        applicableTo: ['read'],
      });
      const applied = handle({ ttl: 60 });
      expect(applied.namespace).toBe('cache');
      expect(applied.value).toEqual({ ttl: 60 });
      expect(applied.applicableTo.has('read')).toBe(true);
    });

    it('returns an AnnotationValue whose namespace reflects an explicit namespace override', () => {
      const handle = defineAnnotation<{ ttl: number }, 'read'>({
        name: 'cache',
        namespace: 'custom-cache-ns',
        applicableTo: ['read'],
      });
      const applied = handle({ ttl: 60 });
      expect(applied.namespace).toBe('custom-cache-ns');
    });

    it('produces a frozen value', () => {
      const handle = defineAnnotation<{ ttl: number }, 'read'>({
        name: 'cache',
        applicableTo: ['read'],
      });
      const applied = handle({ ttl: 60 });
      expect(Object.isFrozen(applied)).toBe(true);
    });

    it('produces independent values across repeated calls to the handle', () => {
      const handle = defineAnnotation<{ ttl: number }, 'read'>({
        name: 'cache',
        applicableTo: ['read'],
      });
      const a = handle({ ttl: 60 });
      const b = handle({ ttl: 120 });
      expect(a).not.toBe(b);
      expect(a.value).toEqual({ ttl: 60 });
      expect(b.value).toEqual({ ttl: 120 });
    });
  });

  describe('read', () => {
    it('returns the payload when a value created through the same handle is stored', () => {
      const handle = defineAnnotation<{ ttl: number }, 'read'>({
        name: 'cache',
        applicableTo: ['read'],
      });
      const applied = handle({ ttl: 60 });
      const plan = makePlan({ cache: applied });
      expect(handle.read(plan)).toEqual({ ttl: 60 });
    });

    it('returns undefined when the annotation is absent', () => {
      const handle = defineAnnotation<{ ttl: number }, 'read'>({
        name: 'cache',
        applicableTo: ['read'],
      });
      expect(handle.read(makePlan())).toBeUndefined();
      expect(handle.read(makePlan({}))).toBeUndefined();
      expect(handle.read(makePlan({ other: 'value' }))).toBeUndefined();
    });

    it('returns undefined when the stored value is not a branded AnnotationValue', () => {
      const handle = defineAnnotation<{ ttl: number }, 'read'>({
        name: 'cache',
        applicableTo: ['read'],
      });
      // Framework-internal metadata stored under the same namespace key
      // (e.g. the SQL emitter's meta.annotations.codecs map) is a raw
      // record, not a branded AnnotationValue. read() must not surface it
      // as a user annotation.
      expect(handle.read(makePlan({ cache: { ttl: 60 } }))).toBeUndefined();
      expect(handle.read(makePlan({ cache: 'string-value' }))).toBeUndefined();
      expect(handle.read(makePlan({ cache: 42 }))).toBeUndefined();
      expect(handle.read(makePlan({ cache: null }))).toBeUndefined();
    });

    it('two handles with different namespaces do not interfere', () => {
      const cache = defineAnnotation<{ ttl: number }, 'read'>({
        name: 'cache',
        applicableTo: ['read'],
      });
      const audit = defineAnnotation<{ actor: string }, 'write'>({
        name: 'audit',
        applicableTo: ['write'],
      });
      const plan = makePlan({
        cache: cache({ ttl: 60 }),
        audit: audit({ actor: 'system' }),
      });

      expect(cache.read(plan)).toEqual({ ttl: 60 });
      expect(audit.read(plan)).toEqual({ actor: 'system' });
    });

    it('read ignores annotations stored under the same namespace by a different handle', () => {
      // Two handles that read from the same namespace string. Defensive:
      // read() compares the stored value's `namespace` field to the
      // handle's, so a value stored under the namespace string but
      // produced through a different handle does not surface.
      const a = defineAnnotation<{ kind: 'a' }, 'read'>({
        name: 'shared',
        applicableTo: ['read'],
      });
      // Construct a value whose stored namespace differs from the handle
      // that reads it. Both handles share a namespace string at the key
      // level, but the stored AnnotationValue.namespace points elsewhere.
      const stored: AnnotationValue<{ kind: 'b' }, 'read'> = Object.freeze({
        __annotation: true as const,
        namespace: 'mismatched-namespace',
        value: { kind: 'b' as const },
        applicableTo: new Set<'read'>(['read']),
      });
      const plan = makePlan({ shared: stored });

      // The stored value's `namespace` field is 'mismatched-namespace',
      // which doesn't match the handle's 'shared' namespace. read()
      // returns undefined.
      expect(a.read(plan)).toBeUndefined();
    });

    it('preserves Payload identity (handle.read returns the same object reference stored)', () => {
      const handle = defineAnnotation<{ tags: string[] }, 'read'>({
        name: 'tags',
        applicableTo: ['read'],
      });
      const payload = { tags: ['admin', 'staff'] };
      const applied = handle(payload);
      const plan = makePlan({ tags: applied });

      const out = handle.read(plan);
      expect(out).toBe(payload);
    });
  });
});

describe('assertAnnotationsApplicable', () => {
  const cache = defineAnnotation<{ ttl: number }, 'read'>({
    name: 'cache',
    applicableTo: ['read'],
  });
  const audit = defineAnnotation<{ actor: string }, 'write'>({
    name: 'audit',
    applicableTo: ['write'],
  });
  const otel = defineAnnotation<{ traceId: string }, 'read' | 'write'>({
    name: 'otel',
    applicableTo: ['read', 'write'],
  });

  describe('passes silently', () => {
    it('on an empty annotations array', () => {
      expect(() => assertAnnotationsApplicable([], 'read', 'first')).not.toThrow();
      expect(() => assertAnnotationsApplicable([], 'write', 'create')).not.toThrow();
    });

    it('when every annotation applies to the kind', () => {
      expect(() =>
        assertAnnotationsApplicable([cache({ ttl: 60 })], 'read', 'first'),
      ).not.toThrow();
      expect(() =>
        assertAnnotationsApplicable([audit({ actor: 'a' })], 'write', 'create'),
      ).not.toThrow();
    });

    it('when an annotation declares both kinds and is used on either', () => {
      expect(() =>
        assertAnnotationsApplicable([otel({ traceId: 't' })], 'read', 'first'),
      ).not.toThrow();
      expect(() =>
        assertAnnotationsApplicable([otel({ traceId: 't' })], 'write', 'create'),
      ).not.toThrow();
    });

    it('when multiple compatible annotations are passed together', () => {
      expect(() =>
        assertAnnotationsApplicable([cache({ ttl: 60 }), otel({ traceId: 't' })], 'read', 'first'),
      ).not.toThrow();
    });
  });

  describe('throws RUNTIME.ANNOTATION_INAPPLICABLE', () => {
    it('on a read-only annotation passed to a write terminal', () => {
      expect(() => assertAnnotationsApplicable([cache({ ttl: 60 })], 'write', 'create')).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
          category: 'RUNTIME',
        }),
      );
    });

    it('on a write-only annotation passed to a read terminal', () => {
      expect(() =>
        assertAnnotationsApplicable([audit({ actor: 'system' })], 'read', 'first'),
      ).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
          category: 'RUNTIME',
        }),
      );
    });

    it('on the first inapplicable annotation when several are passed', () => {
      expect(() =>
        assertAnnotationsApplicable(
          [otel({ traceId: 't' }), audit({ actor: 'system' })],
          'read',
          'first',
        ),
      ).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
        }),
      );
    });

    it('with a message naming the offending annotation namespace and the terminal', () => {
      try {
        assertAnnotationsApplicable([cache({ ttl: 60 })], 'write', 'create');
        expect.fail('expected assertAnnotationsApplicable to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toContain("'cache'");
        expect(message).toContain("'create'");
        expect(message).toContain("'write'");
      }
    });

    it('with structured details including namespace, terminalName, kind, and applicableTo', () => {
      try {
        assertAnnotationsApplicable([cache({ ttl: 60 })], 'write', 'create');
        expect.fail('expected assertAnnotationsApplicable to throw');
      } catch (error) {
        const envelope = error as Error & { details?: Record<string, unknown> };
        expect(envelope.details).toEqual({
          namespace: 'cache',
          terminalName: 'create',
          kind: 'write',
          applicableTo: ['read'],
        });
      }
    });
  });

  describe('does not require AnnotationValue typing on its parameter', () => {
    // The runtime helper takes readonly AnnotationValue<unknown, OperationKind>[]
    // so it can be called from lane terminals that have already passed
    // the type gate via the structural registry filter. The runtime check
    // is the belt-and-suspenders that catches casts / `any` / dynamic
    // invocations.
    it('rejects an opaquely-typed inapplicable annotation forced through a cast', () => {
      const sneakyWriteAnnotation = audit({ actor: 'system' });
      // Imagine a caller bypassed the type gate via `as any` and handed
      // the runtime an annotation whose kinds do not match the terminal.
      const annotations: readonly AnnotationValue<unknown, OperationKind>[] = [
        sneakyWriteAnnotation,
      ];
      expect(() => assertAnnotationsApplicable(annotations, 'read', 'first')).toThrow(
        expect.objectContaining({ code: 'RUNTIME.ANNOTATION_INAPPLICABLE' }),
      );
    });
  });
});
