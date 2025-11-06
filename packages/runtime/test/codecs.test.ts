import { describe, it, expect } from 'vitest';
import { createCodecRegistry, type CodecRegistry } from '@prisma-next/sql-target';
import { codecDefinitions } from '../../adapter-postgres/src/codecs';
import { encodeParam, encodeParams } from '../src/codecs/encoding';
import { decodeRow } from '../src/codecs/decoding';
import { extractTypeIds, validateCodecRegistryCompleteness } from '../src/codecs/validation';
import type { Plan, ParamDescriptor } from '@prisma-next/sql-query/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import type { Codec } from '@prisma-next/sql-target';
import { validateContract } from '@prisma-next/sql-query/schema';

function createRegistry(): CodecRegistry {
  const registry = createCodecRegistry();
  for (const definition of Object.values(codecDefinitions)) {
    registry.register(definition.codec);
  }
  return registry;
}

describe('Codec Registry', () => {
  const registry = createRegistry();

  it('resolves codec by ID using get()', () => {
    const codec = registry.get('pg/text@1');
    expect(codec).toBeDefined();
    expect(codec?.id).toBe('pg/text@1');
  });

  it('checks if codec exists using has()', () => {
    expect(registry.has('pg/text@1')).toBe(true);
    expect(registry.has('pg/nonexistent@1')).toBe(false);
  });

  it('resolves codec by scalar type using getByScalar()', () => {
    const codecs = registry.getByScalar('text');
    expect(codecs).toBeDefined();
    expect(codecs.length).toBeGreaterThan(0);
    expect(codecs[0]?.id).toBe('pg/text@1');
  });

  it('returns empty array for unknown scalar type using getByScalar()', () => {
    const codecs = registry.getByScalar('unknown-type');
    expect(codecs).toEqual([]);
  });

  it('gets default codec for scalar type', () => {
    const codec = registry.getDefaultCodec('text');
    expect(codec).toBeDefined();
    expect(codec?.id).toBe('pg/text@1');
  });

  it('returns undefined for default codec of unknown scalar type', () => {
    const codec = registry.getDefaultCodec('unknown-type');
    expect(codec).toBeUndefined();
  });

  it('returns multiple codecs for same scalar type', () => {
    const timestamptzCodecs = registry.getByScalar('timestamptz');
    expect(timestamptzCodecs).toBeDefined();
    expect(timestamptzCodecs.length).toBeGreaterThan(0);
  });

  it('iterates over all codecs', () => {
    const codecs = Array.from(registry.values());
    expect(codecs.length).toBeGreaterThan(0);
    expect(codecs.some((c) => c.id === 'pg/text@1')).toBe(true);
  });

  describe('CodecRegistry class methods', () => {
    it('registers a new codec', () => {
      const newRegistry = createCodecRegistry();
      const codec: Codec<string, string, string> = {
        id: 'test/custom@1',
        targetTypes: ['custom'],
        decode: (wire: string) => wire,
        encode: (value: string) => value,
      };

      newRegistry.register(codec);
      expect(newRegistry.get('test/custom@1')).toBe(codec);
      expect(newRegistry.has('test/custom@1')).toBe(true);
    });

    it('throws error when registering duplicate codec ID', () => {
      const newRegistry = createCodecRegistry();
      const codec: Codec<string, string, string> = {
        id: 'test/duplicate@1',
        targetTypes: ['custom'],
        decode: (wire) => wire,
      };

      newRegistry.register(codec);
      expect(() => {
        newRegistry.register(codec);
      }).toThrow("Codec with ID 'test/duplicate@1' is already registered");
    });

    it('maintains codec order for scalar types', () => {
      const newRegistry = createCodecRegistry();
      const codec1: Codec<string, string> = {
        id: 'test/first@1',
        targetTypes: ['shared'],
        decode: (wire) => wire,
      };
      const codec2: Codec<string, string> = {
        id: 'test/second@1',
        targetTypes: ['shared'],
        decode: (wire) => wire,
      };

      newRegistry.register(codec1);
      newRegistry.register(codec2);

      const codecs = newRegistry.getByScalar('shared');
      expect(codecs.length).toBe(2);
      expect(codecs[0]?.id).toBe('test/first@1');
      expect(codecs[1]?.id).toBe('test/second@1');
      expect(newRegistry.getDefaultCodec('shared')?.id).toBe('test/first@1');
    });
  });
});

describe('Param Encoding', () => {
  const registry = createRegistry();

  const createMockPlan = (paramDescriptors: ParamDescriptor[]): Plan => {
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
        paramDescriptors,
        refs: { tables: [], columns: [] },
        projection: {},
      },
    } as Plan;
  };

  it('encodes string value', () => {
    const plan = createMockPlan([{ name: 'param1', type: 'pg/text@1', source: 'dsl' }]);
    const encoded = encodeParam('hello', plan.meta.paramDescriptors[0]!, plan, registry);
    expect(encoded).toBe('hello');
  });

  it('encodes number value', () => {
    const plan = createMockPlan([{ name: 'param1', type: 'pg/int4@1', source: 'dsl' }]);
    const encoded = encodeParam(42, plan.meta.paramDescriptors[0]!, plan, registry);
    expect(encoded).toBe(42);
  });

  it('encodes JS Date to ISO string for timestamptz', () => {
    const plan = createMockPlan([{ name: 'param1', type: 'pg/timestamptz@1', source: 'dsl' }]);
    const date = new Date('2024-01-15T10:30:00Z');
    const encoded = encodeParam(date, plan.meta.paramDescriptors[0]!, plan, registry);
    expect(encoded).toBe('2024-01-15T10:30:00.000Z');
    expect(typeof encoded).toBe('string');
  });

  it('encodes JS Date to ISO string for timestamp', () => {
    const plan = createMockPlan([{ name: 'param1', type: 'pg/timestamp@1', source: 'dsl' }]);
    const date = new Date('2024-01-15T10:30:00Z');
    const encoded = encodeParam(date, plan.meta.paramDescriptors[0]!, plan, registry);
    expect(encoded).toBe('2024-01-15T10:30:00.000Z');
  });

  it('passes through null without encoding', () => {
    const plan = createMockPlan([{ name: 'param1', type: 'pg/text@1', source: 'dsl' }]);
    const encoded = encodeParam(null, plan.meta.paramDescriptors[0]!, plan, registry);
    expect(encoded).toBeNull();
  });

  it('converts undefined to null', () => {
    const plan = createMockPlan([{ name: 'param1', type: 'pg/text@1', source: 'dsl' }]);
    // Our implementation converts undefined to null (null short-circuit)
    const encoded = encodeParam(undefined, plan.meta.paramDescriptors[0]!, plan, registry);
    expect(encoded).toBeNull();
  });

  it('uses plan annotation codec override', () => {
    const plan = createMockPlan([{ name: 'param1', type: 'pg/text@1', source: 'dsl' }]);
    const planWithOverride: Plan = {
      ...plan,
      meta: {
        ...plan.meta,
        annotations: {
          codecs: { param1: 'pg/text@1' },
        },
      },
    } as Plan;
    const encoded = encodeParam(
      'test',
      planWithOverride.meta.paramDescriptors[0]!,
      planWithOverride,
      registry,
    );
    expect(encoded).toBe('test');
  });

  it('encodes all params in plan', () => {
    const plan = createMockPlan([
      { name: 'id', type: 'pg/int4@1', source: 'dsl' },
      { name: 'email', type: 'pg/text@1', source: 'dsl' },
    ]);
    const planWithParams = {
      ...plan,
      params: [42, 'test@example.com'],
    };
    const encoded = encodeParams(planWithParams, registry);
    expect(encoded).toEqual([42, 'test@example.com']);
  });
});

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
      contract: validateContract<SqlContract<SqlStorage>>({
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
        profileHash: 'sha256:test',
        storage: { tables: {} },
        models: {},
        relations: {},
        mappings: {},
      }),
    };
    const row = { id: 42, posts: '[{"id":1,"title":"Post 1"},{"id":2,"title":"Post 2"}]' };
    const decoded = decodeRow(row, plan, registry);
    expect(decoded['id']).toBe(42);
    expect(Array.isArray(decoded['posts'])).toBe(true);
    expect(decoded['posts']).toEqual([{ id: 1, title: 'Post 1' }, { id: 2, title: 'Post 2' }]);
  });

  it('handles null include alias as empty array', () => {
    const registry = createRegistry();
    const plan: Plan = {
      sql: 'SELECT * FROM test',
      params: [],
      meta: {
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
      contract: validateContract<SqlContract<SqlStorage>>({
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
        profileHash: 'sha256:test',
        storage: { tables: {} },
        models: {},
        relations: {},
        mappings: {},
      }),
    };
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
      contract: validateContract<SqlContract<SqlStorage>>({
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
        profileHash: 'sha256:test',
        storage: { tables: {} },
        models: {},
        relations: {},
        mappings: {},
      }),
    };
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
      contract: validateContract<SqlContract<SqlStorage>>({
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
        profileHash: 'sha256:test',
        storage: { tables: {} },
        models: {},
        relations: {},
        mappings: {},
      }),
    };
    const row = { id: 42, posts: 'invalid json' };
    expect(() => decodeRow(row, plan, registry)).toThrow();
  });
});

describe('Param Encoding Error Handling', () => {
  const registry = createRegistry();

  const createMockPlan = (paramDescriptors: ParamDescriptor[]): Plan => {
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
        paramDescriptors,
        refs: { tables: [], columns: [] },
        projection: {},
      },
    } as Plan;
  };

  it('handles encode error with error details', () => {
    const failingCodec: Codec<string, string, string> = {
      id: 'test/failing@1',
      targetTypes: ['failing'],
      encode: () => {
        throw new Error('Encode failed');
      },
      decode: (value: string) => value,
    };

    const testRegistry = createCodecRegistry();
    testRegistry.register(failingCodec);

    const plan = {
      ...createMockPlan([{ name: 'param1', type: 'test/failing@1', source: 'dsl' }]),
      meta: {
        ...createMockPlan([{ name: 'param1', type: 'test/failing@1', source: 'dsl' }]).meta,
        annotations: {
          codecs: { param1: 'test/failing@1' },
        },
      },
    };

    expect(() => {
      encodeParam('test-value', plan.meta.paramDescriptors[0]!, plan, testRegistry);
    }).toThrow('Failed to encode parameter');
  });

  it('handles encode error with index descriptor', () => {
    const failingCodec: Codec<string, string, string> = {
      id: 'test/failing@1',
      targetTypes: ['failing'],
      encode: () => {
        throw new Error('Encode failed');
      },
      decode: (value: string) => value,
    };

    const testRegistry = createCodecRegistry();
    testRegistry.register(failingCodec);

    const plan = {
      ...createMockPlan([{ index: 0, type: 'test/failing@1', source: 'dsl' }]),
      meta: {
        ...createMockPlan([{ index: 0, type: 'test/failing@1', source: 'dsl' }]).meta,
        annotations: {
          codecs: { '0': 'test/failing@1' },
        },
      },
    };

    expect(() => {
      encodeParam('test-value', plan.meta.paramDescriptors[0]!, plan, testRegistry);
    }).toThrow('Failed to encode parameter');
  });

  it('passes through value when no encode function', () => {
    const noEncodeCodec: Codec<string, string, string> = {
      id: 'test/no-encode@1',
      targetTypes: ['no-encode'],
      decode: (wire: string) => wire,
    };

    const testRegistry = createCodecRegistry();
    testRegistry.register(noEncodeCodec);

    const plan = createMockPlan([{ name: 'param1', type: 'test/no-encode@1', source: 'dsl' }]);
    const encoded = encodeParam('test-value', plan.meta.paramDescriptors[0]!, plan, testRegistry);
    expect(encoded).toBe('test-value');
  });

  it('encodes params with missing descriptor', () => {
    const plan = createMockPlan([]);
    const planWithParams = {
      ...plan,
      params: ['test-value'],
    };
    const encoded = encodeParams(planWithParams, registry);
    expect(encoded).toEqual(['test-value']);
  });

  it('handles empty params array', () => {
    const plan = createMockPlan([]);
    const encoded = encodeParams(plan, registry);
    expect(encoded).toEqual([]);
  });
});

describe('Codec Registry Validation', () => {
  it('extracts type IDs from contract', () => {
    const contractRaw: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: false },
              createdAt: { type: 'pg/timestamptz@1', nullable: true },
            },
          },
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              title: { type: 'pg/text@1', nullable: false },
            },
          },
        },
      },
      models: {},
      relations: {},
      mappings: {},
    };

    const contract = validateContract(contractRaw);
    const typeIds = extractTypeIds(contract);
    expect(typeIds.size).toBe(3);
    expect(typeIds.has('pg/int4@1')).toBe(true);
    expect(typeIds.has('pg/text@1')).toBe(true);
    expect(typeIds.has('pg/timestamptz@1')).toBe(true);
  });

  it('handles contract with no tables', () => {
    const contract: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      storage: {
        tables: {},
      },
      models: {},
      relations: {},
      mappings: {},
    };

    const typeIds = extractTypeIds(contract);
    expect(typeIds.size).toBe(0);
  });

  it('handles columns without type', () => {
    const contractRaw: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { nullable: false },
            },
          },
        },
      },
      models: {},
      relations: {},
      mappings: {},
    };

    const contract = validateContract(contractRaw);
    const typeIds = extractTypeIds(contract);
    expect(typeIds.size).toBe(1);
    expect(typeIds.has('pg/int4@1')).toBe(true);
  });

  it('validates complete registry passes', () => {
    const contractRaw: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: false },
              createdAt: { type: 'pg/timestamptz@1', nullable: false },
            },
          },
        },
      },
      models: {},
      relations: {},
      mappings: {},
    };
    const contract = validateContract(contractRaw);

    const registry = createRegistry();
    expect(() => validateCodecRegistryCompleteness(registry, contract)).not.toThrow();
  });

  it('throws RUNTIME.CODEC_MISSING for missing codecs', () => {
    // Create contract with unknown type ID directly (bypassing validation)
    const contract: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: false },
              unknownType: { type: 'unknown/type@1', nullable: false },
            },
          },
        },
      },
      models: {},
      relations: {},
      mappings: {},
    };

    const registry = createRegistry();
    expect(() => validateCodecRegistryCompleteness(registry, contract)).toThrow();
    try {
      validateCodecRegistryCompleteness(registry, contract);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const runtimeError = error as Error & { code: string; details?: Record<string, unknown> };
      expect(runtimeError.code).toBe('RUNTIME.CODEC_MISSING');
      expect(runtimeError.details).toBeDefined();
      const invalidCodecs = runtimeError.details?.['invalidCodecs'] as Array<{ table: string; column: string; typeId: string }> | undefined;
      expect(invalidCodecs).toBeDefined();
      expect(invalidCodecs?.some(c => c.typeId === 'unknown/type@1')).toBe(true);
      expect(runtimeError.details?.['contractTarget']).toBe('postgres');
    }
  });

  it('validates empty registry against empty contract', () => {
    const contract: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      storage: {
        tables: {},
      },
      models: {},
      relations: {},
      mappings: {},
    };

    const emptyRegistry = createCodecRegistry();

    expect(() => validateCodecRegistryCompleteness(emptyRegistry, contract)).not.toThrow();
  });
});
