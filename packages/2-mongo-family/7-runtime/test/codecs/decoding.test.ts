import { isRuntimeError } from '@prisma-next/framework-components/runtime';
import {
  createMongoCodecRegistry,
  type MongoCodecRegistry,
  mongoCodec,
} from '@prisma-next/mongo-codec';
import type { MongoFieldShape, MongoResultShape } from '@prisma-next/mongo-query-ast/execution';
import { ObjectId } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { decodeMongoRow } from '../../src/codecs/decoding';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function registryWithDefaults(): MongoCodecRegistry {
  const registry = createMongoCodecRegistry();
  registry.register(
    mongoCodec({
      typeId: 'mongo/string@1',
      targetTypes: ['string'],
      encode: (v: string) => v,
      decode: (w: string) => w,
    }),
  );
  registry.register(
    mongoCodec({
      typeId: 'mongo/objectId@1',
      targetTypes: ['objectId'],
      encode: (v: string) => new ObjectId(v),
      decode: (w: { toHexString: () => string }) => w.toHexString(),
    }),
  );
  return registry;
}

describe('decodeMongoRow', () => {
  it('decodes top-level scalar fields by codecId', async () => {
    const registry = registryWithDefaults();
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        _id: { kind: 'leaf', codecId: 'mongo/objectId@1', nullable: false },
        name: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
      },
    };
    const row = {
      _id: { toHexString: () => 'abc123' },
      name: 'Ada',
    };
    const out = await decodeMongoRow(row, shape, registry, 'users');
    expect(out).toEqual({ _id: 'abc123', name: 'Ada' });
  });

  it('short-circuits null and undefined without calling decode', async () => {
    const registry = registryWithDefaults();
    const decodeSpy = vi.fn((w: string) => w);
    registry.register(
      mongoCodec({
        typeId: 'test/spy@1',
        targetTypes: ['x'],
        encode: (v: string) => v,
        decode: decodeSpy,
      }),
    );
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        a: { kind: 'leaf', codecId: 'test/spy@1', nullable: true },
        b: { kind: 'leaf', codecId: 'test/spy@1', nullable: true },
      },
    };
    const row = { a: null, b: undefined };
    const out = await decodeMongoRow(row, shape, registry, 'c');
    expect(out).toEqual({ a: null, b: undefined });
    expect(decodeSpy).not.toHaveBeenCalled();
  });

  it('decodes array elements in lockstep with element shape', async () => {
    const registry = registryWithDefaults();
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        tags: {
          kind: 'array',
          nullable: false,
          element: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
        },
      },
    };
    const row = { tags: ['a', 'b'] };
    const out = await decodeMongoRow(row, shape, registry, 'c');
    expect(out).toEqual({ tags: ['a', 'b'] });
  });

  it('recurses into document fields with dot-joined paths on failure context', async () => {
    const registry = registryWithDefaults();
    const inner: MongoFieldShape = {
      kind: 'document',
      nullable: false,
      fields: {
        city: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
      },
    };
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        address: inner,
      },
    };
    const row = { address: { city: 'Paris' } };
    const out = await decodeMongoRow(row, shape, registry, 'c');
    expect(out).toEqual({ address: { city: 'Paris' } });
  });

  it('uses numeric indices in paths for arrays', async () => {
    const registry = registryWithDefaults();
    registry.register(
      mongoCodec({
        typeId: 'throws-on-b@1',
        targetTypes: ['string'],
        encode: (v: string) => v,
        decode: (w: string) => {
          if (w === 'bad') throw new Error('boom');
          return w;
        },
      }),
    );
    const shapeThrow: MongoResultShape = {
      kind: 'document',
      fields: {
        tags: {
          kind: 'array',
          nullable: false,
          element: { kind: 'leaf', codecId: 'throws-on-b@1', nullable: false },
        },
      },
    };
    await expect(
      decodeMongoRow({ tags: ['ok', 'bad'] }, shapeThrow, registry, 'col'),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      details: expect.objectContaining({ path: 'tags.1', collection: 'col' }),
    });
  });

  it('passes values through for kind unknown anywhere in the tree', async () => {
    const registry = registryWithDefaults();
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        raw: { kind: 'unknown' },
      },
    };
    const sentinel = { x: 1 };
    const row = { raw: sentinel };
    const out = await decodeMongoRow(row, shape, registry, 'c');
    expect(out).toEqual({ raw: sentinel });
    expect((out as { raw: object }).raw).toBe(sentinel);
  });

  it('passes through when registry has no entry for codecId', async () => {
    const registry = createMongoCodecRegistry();
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        mystery: { kind: 'leaf', codecId: 'no/such@1', nullable: false },
      },
    };
    const row = { mystery: { keep: true } };
    const out = await decodeMongoRow(row, shape, registry, 'c');
    expect(out).toEqual(row);
  });

  it('wraps codec errors in RUNTIME.DECODE_FAILED with details and cause', async () => {
    const registry = createMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'throws@1',
        targetTypes: ['x'],
        encode: (v: string) => v,
        decode: () => {
          throw new Error('inner');
        },
      }),
    );
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        f: { kind: 'leaf', codecId: 'throws@1', nullable: false },
      },
    };
    try {
      await decodeMongoRow({ f: 'wire' }, shape, registry, 'items');
      expect.fail('expected throw');
    } catch (e) {
      expect(isRuntimeError(e)).toBe(true);
      if (!isRuntimeError(e)) return;
      expect(e.code).toBe('RUNTIME.DECODE_FAILED');
      expect(e.details).toMatchObject({
        collection: 'items',
        path: 'f',
        codec: 'throws@1',
      });
      expect(
        String((e.details as { wirePreview?: string }).wirePreview).length,
      ).toBeLessThanOrEqual(100);
      expect(e.cause).toBeInstanceOf(Error);
      expect((e.cause as Error).message).toBe('inner');
    }
  });

  it('dispatches all leaf decodes for one row via a single Promise.all', async () => {
    const dA = deferred<string>();
    const dB = deferred<string>();
    const callOrder: string[] = [];
    const registry = createMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'slow-a@1',
        targetTypes: ['x'],
        encode: (v: string) => v,
        decode: (w: string) => {
          callOrder.push('a-start');
          return dA.promise.then((s) => `${w}:${s}`);
        },
      }),
    );
    registry.register(
      mongoCodec({
        typeId: 'slow-b@1',
        targetTypes: ['x'],
        encode: (v: string) => v,
        decode: (w: string) => {
          callOrder.push('b-start');
          return dB.promise.then((s) => `${w}:${s}`);
        },
      }),
    );
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        a: { kind: 'leaf', codecId: 'slow-a@1', nullable: false },
        b: { kind: 'leaf', codecId: 'slow-b@1', nullable: false },
      },
    };
    const p = decodeMongoRow({ a: 'A', b: 'B' }, shape, registry, 'c');
    expect(callOrder).toEqual(['a-start', 'b-start']);
    dB.resolve('B2');
    dA.resolve('A2');
    const out = await p;
    expect(out).toEqual({ a: 'A:A2', b: 'B:B2' });
  });
});
