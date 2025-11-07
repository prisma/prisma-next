import type { Plan } from '@prisma-next/sql-query/types';
import type { Codec } from '@prisma-next/sql-target';
import { createCodecRegistry } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { codecDefinitions } from '../../adapter-postgres/src/codecs';
import { decodeRow } from '../src/codecs/decoding';

function createRegistry() {
  const registry = createCodecRegistry();
  for (const definition of Object.values(codecDefinitions)) {
    registry.register(definition.codec);
  }
  return registry;
}

describe('Row Decoding', () => {
  const registry = createRegistry();

  const createMockDslPlan = (projectionTypes?: Record<string, string>): Plan => {
    return {
      sql: 'SELECT * FROM test',
      params: [],
      ast: {
        kind: 'select',
        from: { kind: 'table', name: 'test' },
        project: [],
      },
      meta: {
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [],
        refs: { tables: [], columns: [] },
        projection: { id: 'test.id', email: 'test.email', createdAt: 'test.createdAt' },
        ...(projectionTypes ? { projectionTypes } : {}),
      },
    };
  };

  it('decodes string value', () => {
    const plan = createMockDslPlan({ email: 'pg/text@1' });
    const row = { email: 'test@example.com' };
    const decoded = decodeRow(row, plan, registry);
    expect(decoded['email']).toBe('test@example.com');
  });

  it('decodes number value', () => {
    const plan = createMockDslPlan({ id: 'pg/int4@1' });
    const row = { id: 42 };
    const decoded = decodeRow(row, plan, registry);
    expect(decoded['id']).toBe(42);
  });

  it('decodes timestamptz to ISO string', () => {
    const plan = createMockDslPlan({ createdAt: 'pg/timestamptz@1' });
    const row = { createdAt: '2024-01-15T10:30:00.000Z' };
    const decoded = decodeRow(row, plan, registry);
    expect(decoded['createdAt']).toBe('2024-01-15T10:30:00.000Z');
    expect(typeof decoded['createdAt']).toBe('string');
  });

  it('decodes timestamp to ISO string', () => {
    const plan = createMockDslPlan({ createdAt: 'pg/timestamp@1' });
    const row = { createdAt: '2024-01-15T10:30:00.000Z' };
    const decoded = decodeRow(row, plan, registry);
    expect(decoded['createdAt']).toBe('2024-01-15T10:30:00.000Z');
  });

  it('handles Date object from driver', () => {
    const plan = createMockDslPlan({ createdAt: 'pg/timestamptz@1' });
    const date = new Date('2024-01-15T10:30:00Z');
    const row = { createdAt: date };
    const decoded = decodeRow(row, plan, registry);
    expect(decoded['createdAt']).toBe('2024-01-15T10:30:00.000Z');
  });

  it('passes through null without decoding', () => {
    const plan = createMockDslPlan({ email: 'pg/text@1' });
    const row = { email: null };
    const decoded = decodeRow(row, plan, registry);
    expect(decoded['email']).toBeNull();
  });

  it('passes through undefined without decoding', () => {
    const plan = createMockDslPlan({ email: 'pg/text@1' });
    const row = { email: undefined };
    const decoded = decodeRow(row, plan, registry);
    expect(decoded['email']).toBeUndefined();
  });

  it('uses plan annotation codec override', () => {
    const plan = {
      ...createMockDslPlan({ email: 'pg/text@1' }),
      meta: {
        ...createMockDslPlan({ email: 'pg/text@1' }).meta,
        annotations: {
          codecs: { email: 'pg/text@1' },
        },
      },
    };
    const row = { email: 'test@example.com' };
    const decoded = decodeRow(row, plan, registry);
    expect(decoded['email']).toBe('test@example.com');
  });

  it('falls back to driver value when no codec found', () => {
    const plan = createMockDslPlan({ unknownField: 'unknown-type' });
    // Add unknownField to projection
    const planWithProjection = {
      ...plan,
      meta: {
        ...plan.meta,
        projection: {
          ...(typeof plan.meta.projection === 'object' && !Array.isArray(plan.meta.projection)
            ? plan.meta.projection
            : {}),
          unknownField: 'test.unknownField',
        },
      },
    };
    const row = { unknownField: 'some-value' };
    const decoded = decodeRow(row, planWithProjection, registry);
    expect(decoded['unknownField']).toBe('some-value');
  });

  it('decodes multiple fields', () => {
    const plan = createMockDslPlan({
      id: 'pg/int4@1',
      email: 'pg/text@1',
      createdAt: 'pg/timestamptz@1',
    });
    const row = {
      id: 42,
      email: 'test@example.com',
      createdAt: '2024-01-15T10:30:00.000Z',
    };
    const decoded = decodeRow(row, plan, registry);
    expect(decoded['id']).toBe(42);
    expect(decoded['email']).toBe('test@example.com');
    expect(decoded['createdAt']).toBe('2024-01-15T10:30:00.000Z');
  });

  it('throws RUNTIME.DECODE_FAILED on decode error', () => {
    const failingCodec: Codec<string, string, string> = {
      id: 'test/failing@1',
      targetTypes: ['failing'],
      decode: () => {
        throw new Error('Decode failed');
      },
    };

    const testRegistry = createCodecRegistry();
    testRegistry.register(failingCodec);

    const plan = {
      ...createMockDslPlan({ id: 'test/failing@1' }),
      meta: {
        ...createMockDslPlan({ id: 'test/failing@1' }).meta,
        annotations: {
          codecs: { id: 'test/failing@1' },
        },
      },
    };
    const row = { id: 'test-value' };

    try {
      decodeRow(row, plan, testRegistry);
      expect.fail('Expected decodeRow to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const runtimeError = error as Error & { code: string };
      expect(runtimeError.code).toBe('RUNTIME.DECODE_FAILED');
    }
  });

  it('handles decode error with error details', () => {
    const failingCodec: Codec<string, string, string> = {
      id: 'test/failing@1',
      targetTypes: ['failing'],
      decode: () => {
        throw new Error('Decode failed');
      },
    };

    const testRegistry = createCodecRegistry();
    testRegistry.register(failingCodec);

    const plan = {
      ...createMockDslPlan({ id: 'test/failing@1' }),
      meta: {
        ...createMockDslPlan({ id: 'test/failing@1' }).meta,
        annotations: {
          codecs: { id: 'test/failing@1' },
        },
      },
    };
    const row = { id: 'test-value' };

    try {
      decodeRow(row, plan, testRegistry);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const runtimeError = error as Error & { code: string; details?: Record<string, unknown> };
      expect(runtimeError.code).toBe('RUNTIME.DECODE_FAILED');
      expect(runtimeError.details).toBeDefined();
      expect(runtimeError.details?.['alias']).toBe('id');
      expect(runtimeError.details?.['codec']).toBe('test/failing@1');
    }
  });

  it('handles decode error with long wire value', () => {
    const failingCodec: Codec<string, string, string> = {
      id: 'test/failing@1',
      targetTypes: ['failing'],
      decode: () => {
        throw new Error('Decode failed');
      },
    };

    const testRegistry = createCodecRegistry();
    testRegistry.register(failingCodec);

    const longValue = 'a'.repeat(200);
    const plan = {
      ...createMockDslPlan({ id: 'test/failing@1' }),
      meta: {
        ...createMockDslPlan({ id: 'test/failing@1' }).meta,
        annotations: {
          codecs: { id: 'test/failing@1' },
        },
      },
    };
    const row = { id: longValue };

    try {
      decodeRow(row, plan, testRegistry);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const runtimeError = error as Error & { code: string; details?: Record<string, unknown> };
      expect(runtimeError.code).toBe('RUNTIME.DECODE_FAILED');
      expect(runtimeError.details?.['wirePreview']).toBeDefined();
      const preview = runtimeError.details?.['wirePreview'] as string;
      expect(preview.length).toBeLessThanOrEqual(103);
      expect(preview.endsWith('...')).toBe(true);
    }
  });

  it('handles raw plan with projection array', () => {
    const plan: Plan = {
      sql: 'SELECT id, email FROM test',
      params: [],
      meta: {
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
        lane: 'raw',
        paramDescriptors: [],
        projection: ['id', 'email'],
        projectionTypes: { id: 'pg/int4@1', email: 'pg/text@1' },
      },
    };
    const row = { id: 42, email: 'test@example.com' };
    const decoded = decodeRow(row, plan, registry);
    expect(decoded['id']).toBe(42);
    expect(decoded['email']).toBe('test@example.com');
  });

  it('handles plan without projection', () => {
    const plan: Plan = {
      sql: 'SELECT * FROM test',
      params: [],
      meta: {
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
        lane: 'raw',
        paramDescriptors: [],
      },
    };
    const row = { id: 42, email: 'test@example.com' };
    const decoded = decodeRow(row, plan, registry);
    expect(decoded['id']).toBe(42);
    expect(decoded['email']).toBe('test@example.com');
  });

  it('parses JSON array from include alias', () => {
    const registry = createRegistry();
    const plan: Plan = {
      sql: 'SELECT * FROM test',
      params: [],
      meta: {
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [],
        projection: {
          id: 'test.id',
          posts: 'include:posts',
        },
        refs: {
          tables: ['test'],
          columns: [{ table: 'test', column: 'id' }],
        },
      },
      ast: {
        kind: 'select',
        from: { kind: 'table', name: 'test' },
        project: [],
      },
    } as Plan;
    const row = { id: 42, posts: '[{"id":1,"title":"Post 1"},{"id":2,"title":"Post 2"}]' };
    const decoded = decodeRow(row, plan, registry);
    expect(decoded['id']).toBe(42);
    expect(Array.isArray(decoded['posts'])).toBe(true);
    expect(decoded['posts']).toEqual([
      { id: 1, title: 'Post 1' },
      { id: 2, title: 'Post 2' },
    ]);
  });

  it('handles null include alias as empty array', () => {
    const registry = createRegistry();
    const plan: Plan = {
      sql: 'SELECT * FROM test',
      params: [],
      meta: {
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [],
        projection: {
          id: 'test.id',
          posts: 'include:posts',
        },
        refs: {
          tables: ['test'],
          columns: [{ table: 'test', column: 'id' }],
        },
      },
      ast: {
        kind: 'select',
        from: { kind: 'table', name: 'test' },
        project: [],
      },
    } as Plan;
    const row = { id: 42, posts: null };
    const decoded = decodeRow(row, plan, registry);
    expect(decoded['id']).toBe(42);
    expect(decoded['posts']).toEqual([]);
  });

  it('handles already-parsed array from driver', () => {
    const registry = createRegistry();
    const plan: Plan = {
      sql: 'SELECT * FROM test',
      params: [],
      meta: {
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [],
        projection: {
          id: 'test.id',
          posts: 'include:posts',
        },
        refs: {
          tables: ['test'],
          columns: [{ table: 'test', column: 'id' }],
        },
      },
      ast: {
        kind: 'select',
        from: { kind: 'table', name: 'test' },
        project: [],
      },
    } as Plan;
    const row = { id: 42, posts: [{ id: 1, title: 'Post 1' }] };
    const decoded = decodeRow(row, plan, registry);
    expect(decoded['id']).toBe(42);
    expect(Array.isArray(decoded['posts'])).toBe(true);
    expect(decoded['posts']).toEqual([{ id: 1, title: 'Post 1' }]);
  });

  it('throws error for invalid JSON in include alias', () => {
    const registry = createRegistry();
    const plan: Plan = {
      sql: 'SELECT * FROM test',
      params: [],
      meta: {
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [],
        projection: {
          id: 'test.id',
          posts: 'include:posts',
        },
        refs: {
          tables: ['test'],
          columns: [{ table: 'test', column: 'id' }],
        },
      },
      ast: {
        kind: 'select',
        from: { kind: 'table', name: 'test' },
        project: [],
      },
    } as Plan;
    const row = { id: 42, posts: 'invalid json' };
    expect(() => decodeRow(row, plan, registry)).toThrow();
  });
});
