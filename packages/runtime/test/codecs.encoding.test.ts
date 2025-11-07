import type { ParamDescriptor, Plan } from '@prisma-next/sql-query/types';
import type { Codec } from '@prisma-next/sql-target';
import { createCodecRegistry } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { codecDefinitions } from '../../adapter-postgres/src/codecs';
import { encodeParam, encodeParams } from '../src/codecs/encoding';

function createRegistry() {
  const registry = createCodecRegistry();
  for (const definition of Object.values(codecDefinitions)) {
    registry.register(definition.codec);
  }
  return registry;
}

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

