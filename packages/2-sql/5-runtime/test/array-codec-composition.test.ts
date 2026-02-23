import type { ExecutionPlan } from '@prisma-next/contract/types';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { decodeRow } from '../src/codecs/decoding';
import { encodeParams } from '../src/codecs/encoding';

/**
 * These tests assert the CORRECT behavior for array codec composition:
 * element-level encode/decode should be applied to each array element.
 *
 * They are marked with `it.fails` because the runtime currently resolves
 * `pg/array@1` from the registry (the base pgArrayCodec with identity
 * decode/encode) instead of composing a per-column codec via
 * createArrayCodec(elementCodec).
 *
 * When per-column codec resolution is implemented, remove `.fails` —
 * the tests will pass.
 */

function createRegistryWithArrayAndTimestamptz() {
  const registry = createCodecRegistry();

  registry.register(
    codec({
      typeId: 'pg/timestamptz@1',
      targetTypes: ['timestamptz'],
      encode: (value: string | Date) => (value instanceof Date ? value.toISOString() : value),
      decode: (wire: string | Date) =>
        wire instanceof Date ? wire.toISOString() : typeof wire === 'string' ? wire : String(wire),
    }),
  );

  registry.register(
    codec({
      typeId: 'pg/array@1',
      targetTypes: [],
      encode: (value: unknown) => value,
      decode: (wire: unknown) => wire,
    }),
  );

  registry.register(
    codec({
      typeId: 'pg/numeric@1',
      targetTypes: ['numeric'],
      encode: (value: string) => value,
      decode: (wire: string | number) => (typeof wire === 'number' ? String(wire) : wire),
    }),
  );

  return registry;
}

function createPlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    sql: 'SELECT ...',
    params: overrides.params ?? [],
    meta: {
      target: 'postgres',
      storageHash: 'sha256:test',
      lane: 'sql',
      paramDescriptors: overrides.meta?.paramDescriptors ?? [],
      ...overrides.meta,
    },
  };
}

describe('array element-level decode via composed codec', () => {
  const registry = createRegistryWithArrayAndTimestamptz();

  it.fails('applies timestamptz decode to each element of timestamptz[]', () => {
    const plan = createPlan({
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'sql',
        paramDescriptors: [],
        projectionTypes: { created_dates: 'pg/array@1' },
      },
    });

    const date1 = new Date('2026-01-15T10:30:00Z');
    const date2 = new Date('2026-02-16T14:00:00Z');

    const row = { created_dates: [date1, date2] };
    const decoded = decodeRow(row, plan, registry);

    expect(decoded['created_dates']).toEqual([
      '2026-01-15T10:30:00.000Z',
      '2026-02-16T14:00:00.000Z',
    ]);
  });

  it.fails('applies numeric decode to each element of numeric[]', () => {
    const plan = createPlan({
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'sql',
        paramDescriptors: [],
        projectionTypes: { prices: 'pg/array@1' },
      },
    });

    const row = { prices: [19.99, 5.5, 100] };
    const decoded = decodeRow(row, plan, registry);

    expect(decoded['prices']).toEqual(['19.99', '5.5', '100']);
  });

  it.fails('parses text protocol array and applies element decode', () => {
    const plan = createPlan({
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'sql',
        paramDescriptors: [],
        projectionTypes: { created_dates: 'pg/array@1' },
      },
    });

    const row = { created_dates: '{2026-01-15T10:30:00Z,2026-02-16T14:00:00Z}' };
    const decoded = decodeRow(row, plan, registry);

    expect(decoded['created_dates']).toEqual(['2026-01-15T10:30:00Z', '2026-02-16T14:00:00Z']);
  });
});

describe('array element-level encode via composed codec', () => {
  const registry = createRegistryWithArrayAndTimestamptz();

  it.fails('applies timestamptz encode to each element of timestamptz[]', () => {
    const date1 = new Date('2026-01-15T10:30:00Z');
    const date2 = new Date('2026-02-16T14:00:00Z');

    const plan = createPlan({
      params: [[date1, date2]],
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'sql',
        paramDescriptors: [
          { index: 0, codecId: 'pg/array@1', nativeType: 'timestamptz[]', source: 'dsl' },
        ],
      },
    });

    const encoded = encodeParams(plan, registry);

    expect(encoded[0]).toEqual(['2026-01-15T10:30:00.000Z', '2026-02-16T14:00:00.000Z']);
  });
});
