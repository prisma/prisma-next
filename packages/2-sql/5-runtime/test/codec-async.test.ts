import type { ExecutionPlan } from '@prisma-next/contract/types';
import { coreHash } from '@prisma-next/contract/types';
import type { Codec, CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  JsonSchemaValidateFn,
  JsonSchemaValidatorRegistry,
} from '@prisma-next/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { decodeRow } from '../src/codecs/decoding';
import { encodeParam, encodeParams } from '../src/codecs/encoding';

// =============================================================================
// Shared helpers
// =============================================================================

function createTestPlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  return {
    sql: 'SELECT 1',
    params: [],
    meta: {
      target: 'postgres',
      storageHash: coreHash('sha256:test'),
      lane: 'dsl',
      paramDescriptors: [],
    },
    ...overrides,
  };
}

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

// =============================================================================
// T2.1 — encodeParams: concurrent dispatch + envelope
// =============================================================================

describe('encodeParams — async, concurrent dispatch', () => {
  it('dispatches mixed sync/async parameter codecs concurrently via Promise.all', async () => {
    const dA = deferred<string>();
    const dB = deferred<string>();

    const callOrder: string[] = [];

    const registry = createCodecRegistry();
    registry.register(
      codec({
        typeId: 'test/async-a@1',
        targetTypes: ['text'],
        encode: (value: string) => {
          callOrder.push('encode-a-start');
          return dA.promise.then((wire) => `${value}:${wire}`);
        },
        decode: (wire: string) => wire,
      }),
    );
    registry.register(
      codec({
        typeId: 'test/async-b@1',
        targetTypes: ['text'],
        encode: (value: string) => {
          callOrder.push('encode-b-start');
          return dB.promise.then((wire) => `${value}:${wire}`);
        },
        decode: (wire: string) => wire,
      }),
    );
    registry.register(
      codec({
        typeId: 'test/sync@1',
        targetTypes: ['int4'],
        encode: (value: number) => {
          callOrder.push('encode-sync');
          return value + 1;
        },
        decode: (wire: number) => wire,
      }),
    );

    const plan = createTestPlan({
      params: ['alpha', 'bravo', 41],
      meta: {
        target: 'postgres',
        storageHash: coreHash('sha256:test'),
        lane: 'dsl',
        paramDescriptors: [
          { codecId: 'test/async-a@1', source: 'dsl' },
          { codecId: 'test/async-b@1', source: 'dsl' },
          { codecId: 'test/sync@1', source: 'dsl' },
        ],
      },
    });

    const promise = encodeParams(plan, registry);

    expect(callOrder).toEqual(['encode-a-start', 'encode-b-start', 'encode-sync']);

    dB.resolve('B-WIRE');
    dA.resolve('A-WIRE');

    const result = await promise;
    expect([...result]).toEqual(['alpha:A-WIRE', 'bravo:B-WIRE', 42]);
  });

  it('always awaits codec.encode (no Promise leaks into the driver)', async () => {
    const registry = createCodecRegistry();
    registry.register(
      codec({
        typeId: 'test/async@1',
        targetTypes: ['text'],
        encode: async (value: string) => `wire:${value}`,
        decode: async (wire: string) => wire,
      }),
    );

    const plan = createTestPlan({
      params: ['hello'],
      meta: {
        target: 'postgres',
        storageHash: coreHash('sha256:test'),
        lane: 'dsl',
        paramDescriptors: [{ codecId: 'test/async@1', source: 'dsl' }],
      },
    });

    const result = await encodeParams(plan, registry);
    const first = result[0];
    expect(typeof (first as { then?: unknown } | null | undefined)?.then).toBe('undefined');
    expect(first).toBe('wire:hello');
  });

  it('wraps encode failures in RUNTIME.ENCODE_FAILED with { label, codec, paramIndex } and cause', async () => {
    const cause = new Error('boom');
    const registry = createCodecRegistry();
    registry.register(
      codec({
        typeId: 'test/explody@1',
        targetTypes: ['text'],
        encode: () => {
          throw cause;
        },
        decode: (wire: string) => wire,
      }),
    );

    const plan = createTestPlan({
      params: ['bad'],
      meta: {
        target: 'postgres',
        storageHash: coreHash('sha256:test'),
        lane: 'dsl',
        paramDescriptors: [{ name: 'pname', codecId: 'test/explody@1', source: 'dsl' }],
      },
    });

    await expect(encodeParams(plan, registry)).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      category: 'RUNTIME',
      severity: 'error',
      details: {
        label: 'pname',
        codec: 'test/explody@1',
        paramIndex: 0,
      },
      cause,
    });
  });

  it('uses param[<i>] label when descriptor has no name', async () => {
    const registry = createCodecRegistry();
    registry.register(
      codec({
        typeId: 'test/explody@1',
        targetTypes: ['text'],
        encode: () => {
          throw new Error('boom');
        },
        decode: (wire: string) => wire,
      }),
    );

    const plan = createTestPlan({
      params: ['x'],
      meta: {
        target: 'postgres',
        storageHash: coreHash('sha256:test'),
        lane: 'dsl',
        paramDescriptors: [{ codecId: 'test/explody@1', source: 'dsl' }],
      },
    });

    await expect(encodeParams(plan, registry)).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      details: { label: 'param[0]' },
    });
  });

  it('encodeParam returns null for null/undefined and bypasses codec', async () => {
    const registry = createCodecRegistry();
    registry.register(
      codec({
        typeId: 'test/sync@1',
        targetTypes: ['text'],
        encode: () => {
          throw new Error('codec must not be invoked for null');
        },
        decode: (wire: string) => wire,
      }),
    );

    const result = await encodeParam(null, { codecId: 'test/sync@1', source: 'dsl' }, 0, registry);
    expect(result).toBeNull();
  });

  it('passes through values when no codec matches the descriptor', async () => {
    const registry = createCodecRegistry();
    const result = await encodeParam(
      'raw',
      { codecId: 'test/missing@1', source: 'dsl' },
      0,
      registry,
    );
    expect(result).toBe('raw');
  });
});

// =============================================================================
// T2.2 — decodeRow / decodeField: concurrent per-cell + envelope + JSON validation
// =============================================================================

describe('decodeRow — async, concurrent per-cell dispatch', () => {
  function buildJsonbRegistry(): CodecRegistry {
    const registry = createCodecRegistry();
    registry.register(
      codec({
        typeId: 'pg/jsonb@1',
        targetTypes: ['jsonb'],
        encode: (v: unknown) => JSON.stringify(v),
        decode: (w: string) => (typeof w === 'string' ? JSON.parse(w) : w),
      }),
    );
    return registry;
  }

  function buildValidator(
    valid: (value: unknown) => boolean,
    message = 'invalid',
  ): JsonSchemaValidateFn {
    return (value: unknown) => {
      if (valid(value)) return { valid: true };
      return {
        valid: false,
        errors: [{ path: '/', message, keyword: 'custom' }],
      };
    };
  }

  it('dispatches per-cell decoders concurrently via Promise.all', async () => {
    const dA = deferred<string>();
    const dB = deferred<string>();
    const callOrder: string[] = [];

    const registry = createCodecRegistry();
    registry.register(
      codec({
        typeId: 'test/slow-a@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: (w: string) => {
          callOrder.push('decode-a-start');
          return dA.promise.then((suffix) => `${w}:${suffix}`);
        },
      }),
    );
    registry.register(
      codec({
        typeId: 'test/slow-b@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: (w: string) => {
          callOrder.push('decode-b-start');
          return dB.promise.then((suffix) => `${w}:${suffix}`);
        },
      }),
    );
    registry.register(
      codec({
        typeId: 'test/sync@1',
        targetTypes: ['int4'],
        encode: (v: number) => v,
        decode: (w: number) => {
          callOrder.push('decode-sync');
          return w * 2;
        },
      }),
    );

    const plan = createTestPlan({
      meta: {
        target: 'postgres',
        storageHash: coreHash('sha256:test'),
        lane: 'dsl',
        paramDescriptors: [],
        projectionTypes: {
          a: 'test/slow-a@1',
          b: 'test/slow-b@1',
          n: 'test/sync@1',
        },
      },
    });

    const row = { a: 'A', b: 'B', n: 21 };
    const promise = decodeRow(row, plan, registry);

    expect(callOrder).toEqual(['decode-a-start', 'decode-b-start', 'decode-sync']);

    dB.resolve('B-DEC');
    dA.resolve('A-DEC');

    const result = await promise;
    expect(result).toEqual({ a: 'A:A-DEC', b: 'B:B-DEC', n: 42 });
  });

  it('always awaits codec.decode and yields plain values (no Promise leaks)', async () => {
    const registry = createCodecRegistry();
    registry.register(
      codec({
        typeId: 'test/async@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: async (w: string) => `decoded:${w}`,
      }),
    );

    const plan = createTestPlan({
      meta: {
        target: 'postgres',
        storageHash: coreHash('sha256:test'),
        lane: 'dsl',
        paramDescriptors: [],
        projectionTypes: { name: 'test/async@1' },
      },
    });

    const result = await decodeRow({ name: 'alice' }, plan, registry);
    expect(typeof (result['name'] as { then?: unknown } | null)?.then).toBe('undefined');
    expect(result['name']).toBe('decoded:alice');
  });

  it('runs JSON-Schema validation against the resolved (awaited) decoded value', async () => {
    const registry = buildJsonbRegistry();
    const validators: JsonSchemaValidatorRegistry = {
      get: (key) =>
        key === 'user.metadata'
          ? buildValidator(
              (v) => typeof v === 'object' && v !== null && 'name' in (v as object),
              "must have required property 'name'",
            )
          : undefined,
      size: 1,
    };

    const validPlan = createTestPlan({
      meta: {
        target: 'postgres',
        storageHash: coreHash('sha256:test'),
        lane: 'dsl',
        paramDescriptors: [],
        projectionTypes: { metadata: 'pg/jsonb@1' },
        refs: { columns: [{ table: 'user', column: 'metadata' }] },
      },
    });

    const result = await decodeRow(
      { metadata: '{"name":"alice"}' },
      validPlan,
      registry,
      validators,
    );
    expect(result['metadata']).toEqual({ name: 'alice' });

    await expect(
      decodeRow({ metadata: '{"age":30}' }, validPlan, registry, validators),
    ).rejects.toMatchObject({
      code: 'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
      details: {
        table: 'user',
        column: 'metadata',
        direction: 'decode',
        codecId: 'pg/jsonb@1',
      },
    });
  });

  it('wraps decode failures in RUNTIME.DECODE_FAILED with { table, column, codec } and cause', async () => {
    const cause = new Error('boom');
    const registry = createCodecRegistry();
    registry.register(
      codec({
        typeId: 'test/explody@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: () => {
          throw cause;
        },
      }),
    );

    const plan = createTestPlan({
      meta: {
        target: 'postgres',
        storageHash: coreHash('sha256:test'),
        lane: 'dsl',
        paramDescriptors: [],
        projection: { explody: 'user.payload' },
        projectionTypes: { explody: 'test/explody@1' },
      },
    });

    await expect(decodeRow({ explody: 'wire' }, plan, registry)).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      category: 'RUNTIME',
      severity: 'error',
      details: {
        table: 'user',
        column: 'payload',
        codec: 'test/explody@1',
      },
      cause,
    });
  });

  it('falls back to refs index when projection mapping is unavailable', async () => {
    const cause = new Error('boom');
    const registry = createCodecRegistry();
    registry.register(
      codec({
        typeId: 'test/explody@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: () => {
          throw cause;
        },
      }),
    );

    const plan = createTestPlan({
      meta: {
        target: 'postgres',
        storageHash: coreHash('sha256:test'),
        lane: 'dsl',
        paramDescriptors: [],
        projectionTypes: { metadata: 'test/explody@1' },
        refs: { columns: [{ table: 'user', column: 'metadata' }] },
      },
    });

    await expect(decodeRow({ metadata: 'wire' }, plan, registry)).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      details: {
        table: 'user',
        column: 'metadata',
        codec: 'test/explody@1',
      },
    });
  });

  it('decodeField is single-armed: same path for sync and async codec authors', async () => {
    // Author functions of different sync/async shapes must produce the same
    // decoded shape: codec.decode(...) → await → JSON-Schema validate → return value.
    // Verified by uniform plain-value output regardless of codec author shape.
    const registry = createCodecRegistry();
    const buildCodec = (
      id: string,
      encode: (value: unknown) => unknown,
      decode: (wire: unknown) => unknown,
    ): Codec<string> =>
      codec({
        typeId: id,
        targetTypes: ['text'],
        encode: encode as (v: unknown) => unknown,
        decode: decode as (w: unknown) => unknown,
      });

    registry.register(
      buildCodec(
        'sync@1',
        (v) => v,
        (w) => `sync:${String(w)}`,
      ),
    );
    registry.register(
      buildCodec(
        'async@1',
        (v) => v,
        async (w) => `async:${String(w)}`,
      ),
    );

    const plan = createTestPlan({
      meta: {
        target: 'postgres',
        storageHash: coreHash('sha256:test'),
        lane: 'dsl',
        paramDescriptors: [],
        projectionTypes: { syncCol: 'sync@1', asyncCol: 'async@1' },
      },
    });

    const result = await decodeRow({ syncCol: 'a', asyncCol: 'b' }, plan, registry);
    expect(result).toEqual({ syncCol: 'sync:a', asyncCol: 'async:b' });
  });
});
