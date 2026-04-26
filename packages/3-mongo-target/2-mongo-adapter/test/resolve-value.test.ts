import { createMongoCodecRegistry, mongoCodec } from '@prisma-next/mongo-codec';
import { MongoParamRef } from '@prisma-next/mongo-value';
import { describe, expect, it } from 'vitest';
import { resolveValue } from '../src/resolve-value';

const uppercaseCodec = mongoCodec({
  typeId: 'test/uppercase@1',
  targetTypes: ['string'],
  decode: (wire: string) => wire.toLowerCase(),
  encode: (value: string) => value.toUpperCase(),
});

function testRegistry() {
  const registry = createMongoCodecRegistry();
  registry.register(uppercaseCodec);
  return registry;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
} {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('resolveValue', () => {
  it('unwraps MongoParamRef without codec registry', async () => {
    const ref = new MongoParamRef('hello');
    expect(await resolveValue(ref)).toBe('hello');
  });

  it('unwraps MongoParamRef without codecId even when registry is provided', async () => {
    const ref = new MongoParamRef('hello');
    expect(await resolveValue(ref, testRegistry())).toBe('hello');
  });

  it('applies codec encode when MongoParamRef has codecId and registry has codec', async () => {
    const ref = new MongoParamRef('hello', { codecId: 'test/uppercase@1' });
    expect(await resolveValue(ref, testRegistry())).toBe('HELLO');
  });

  it('falls back to raw value when codecId is set but registry is not provided', async () => {
    const ref = new MongoParamRef('hello', { codecId: 'test/uppercase@1' });
    expect(await resolveValue(ref)).toBe('hello');
  });

  it('falls back to raw value when codecId is not in registry', async () => {
    const ref = new MongoParamRef('hello', { codecId: 'test/unknown@1' });
    expect(await resolveValue(ref, testRegistry())).toBe('hello');
  });

  it('encodes nested MongoParamRef with codecId inside object', async () => {
    const doc = {
      name: new MongoParamRef('alice'),
      label: new MongoParamRef('greeting', { codecId: 'test/uppercase@1' }),
    };
    const result = (await resolveValue(doc, testRegistry())) as Record<string, unknown>;
    expect(result['name']).toBe('alice');
    expect(result['label']).toBe('GREETING');
  });

  it('encodes MongoParamRef with codecId inside array', async () => {
    const arr = [new MongoParamRef('a', { codecId: 'test/uppercase@1' }), new MongoParamRef('b')];
    const result = (await resolveValue(arr, testRegistry())) as unknown[];
    expect(result[0]).toBe('A');
    expect(result[1]).toBe('b');
  });

  it('preserves null, primitive, and Date values', async () => {
    expect(await resolveValue(null)).toBeNull();
    expect(await resolveValue(42)).toBe(42);
    expect(await resolveValue('raw')).toBe('raw');
    const d = new Date();
    expect(await resolveValue(d)).toBe(d);
  });

  // T4.4 — async dispatch + concurrent encoding
  describe('async dispatch (T4.4)', () => {
    it('returns a Promise', () => {
      const result = resolveValue(new MongoParamRef('x'));
      expect(typeof (result as { then?: unknown }).then).toBe('function');
    });

    it('dispatches multiple codec-encoded leaves concurrently via Promise.all', async () => {
      const dA = deferred<string>();
      const dB = deferred<string>();
      const callOrder: string[] = [];

      const asyncACodec = mongoCodec({
        typeId: 'test/async-a@1',
        targetTypes: ['string'],
        decode: (wire: string) => wire,
        encode: (value: string) => {
          callOrder.push('encode-a-start');
          return dA.promise.then((suffix) => `${value}:${suffix}`);
        },
      });
      const asyncBCodec = mongoCodec({
        typeId: 'test/async-b@1',
        targetTypes: ['string'],
        decode: (wire: string) => wire,
        encode: (value: string) => {
          callOrder.push('encode-b-start');
          return dB.promise.then((suffix) => `${value}:${suffix}`);
        },
      });

      const registry = createMongoCodecRegistry();
      registry.register(asyncACodec);
      registry.register(asyncBCodec);

      const doc = {
        a: new MongoParamRef('alpha', { codecId: 'test/async-a@1' }),
        b: new MongoParamRef('beta', { codecId: 'test/async-b@1' }),
      };

      const resultPromise = resolveValue(doc, registry);

      // Both encode functions must have started before either resolves —
      // i.e. dispatch is concurrent, not sequential.
      await new Promise((r) => setImmediate(r));
      expect(callOrder).toEqual(['encode-a-start', 'encode-b-start']);

      dB.resolve('B-WIRE');
      dA.resolve('A-WIRE');

      const result = (await resultPromise) as Record<string, unknown>;
      expect(result['a']).toBe('alpha:A-WIRE');
      expect(result['b']).toBe('beta:B-WIRE');
    });

    it('dispatches concurrently across array elements via Promise.all', async () => {
      const d1 = deferred<string>();
      const d2 = deferred<string>();
      const callOrder: string[] = [];

      const codec = mongoCodec({
        typeId: 'test/seq@1',
        targetTypes: ['string'],
        decode: (w: string) => w,
        encode: async (value: string) => {
          callOrder.push(`start:${value}`);
          if (value === 'one') return d1.promise;
          return d2.promise;
        },
      });

      const registry = createMongoCodecRegistry();
      registry.register(codec);

      const arr = [
        new MongoParamRef('one', { codecId: 'test/seq@1' }),
        new MongoParamRef('two', { codecId: 'test/seq@1' }),
      ];

      const resultPromise = resolveValue(arr, registry);

      await new Promise((r) => setImmediate(r));
      expect(callOrder).toEqual(['start:one', 'start:two']);

      d1.resolve('1');
      d2.resolve('2');

      const result = (await resultPromise) as unknown[];
      expect(result).toEqual(['1', '2']);
    });

    it('passes through non-MongoParamRef values unchanged (identity passthrough)', async () => {
      // A plain value with no MongoParamRef inside should round-trip identical structure.
      const input = { x: 1, y: [2, 3], z: { nested: 'leaf' } };
      const result = await resolveValue(input);
      expect(result).toEqual(input);
    });
  });
});
