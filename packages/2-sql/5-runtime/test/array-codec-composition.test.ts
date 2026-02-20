import type { ExecutionPlan } from '@prisma-next/contract/types';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { decodeRow } from '../src/codecs/decoding';
import { encodeParams } from '../src/codecs/encoding';

/**
 * These tests expose the gap in array codec composition: the runtime resolves
 * `pg/array@1` from the registry, which is the base pgArrayCodec. It does NOT
 * compose a per-column codec using createArrayCodec(elementCodec), so
 * element-level encode/decode is never applied.
 *
 * When this gap is fixed, these tests should be updated from "does not apply"
 * to "applies" element-level transformations.
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

describe('array codec composition gap — decode', () => {
  const registry = createRegistryWithArrayAndTimestamptz();

  it('does not apply element-level decode for timestamptz[]', () => {
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

    // BUG: The base pgArrayCodec passes the array through as-is.
    // Element-level timestamptz decode (Date → ISO string) is NOT applied.
    // The values remain Date objects instead of being converted to strings.
    expect(decoded['created_dates']).toEqual([date1, date2]);
    expect(decoded['created_dates']).not.toEqual([
      '2026-01-15T10:30:00.000Z',
      '2026-02-16T14:00:00.000Z',
    ]);
  });

  it('does not apply element-level decode for numeric[]', () => {
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

    // BUG: The base pgArrayCodec passes numbers through as-is.
    // Element-level numeric decode (number → string) is NOT applied.
    expect(decoded['prices']).toEqual([19.99, 5.5, 100]);
    expect(decoded['prices']).not.toEqual(['19.99', '5.5', '100']);
  });

  it('does not apply element-level decode for text array from text protocol', () => {
    const plan = createPlan({
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'sql',
        paramDescriptors: [],
        projectionTypes: { created_dates: 'pg/array@1' },
      },
    });

    // Simulates text protocol: driver returns raw text literal
    const row = { created_dates: '{2026-01-15T10:30:00Z,2026-02-16T14:00:00Z}' };
    const decoded = decodeRow(row, plan, registry);

    // BUG: The base pgArrayCodec returns the raw string as-is (no parsing).
    // With a composed codec, parsePgTextArray would parse the literal and then
    // the element codec would transform each element.
    expect(decoded['created_dates']).toBe('{2026-01-15T10:30:00Z,2026-02-16T14:00:00Z}');
  });
});

describe('array codec composition gap — encode', () => {
  const registry = createRegistryWithArrayAndTimestamptz();

  it('does not apply element-level encode for timestamptz[]', () => {
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

    // BUG: The base pgArrayCodec has no encode function, so params pass through.
    // Element-level timestamptz encode (Date → ISO string) is NOT applied.
    // The pg driver happens to handle Date objects, but this is driver-dependent.
    expect(encoded[0]).toEqual([date1, date2]);
    expect(encoded[0]).not.toEqual(['2026-01-15T10:30:00.000Z', '2026-02-16T14:00:00.000Z']);
  });

  it('does not apply element-level encode for numeric[]', () => {
    const plan = createPlan({
      params: [['19.99', '5.50']],
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'sql',
        paramDescriptors: [
          { index: 0, codecId: 'pg/array@1', nativeType: 'numeric[]', source: 'dsl' },
        ],
      },
    });

    const encoded = encodeParams(plan, registry);

    // The base pgArrayCodec has no encode, so strings pass through as-is.
    // This happens to be correct for numeric (JS string → PG numeric), but
    // only by coincidence — the element codec is not consulted.
    expect(encoded[0]).toEqual(['19.99', '5.50']);
  });
});
