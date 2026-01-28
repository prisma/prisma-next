import { describe, expect, it } from 'vitest';
import { postgresAdapterDescriptorMeta } from '../src/core/descriptor-meta';

describe('postgresAdapterDescriptorMeta', () => {
  it('defines adapter metadata', () => {
    expect(postgresAdapterDescriptorMeta).toMatchObject({
      kind: 'adapter',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      version: expect.any(String),
      capabilities: {
        postgres: {
          orderBy: true,
          limit: true,
          lateral: true,
          jsonAgg: true,
          returning: true,
        },
        sql: {
          enums: true,
        },
      },
      types: {
        codecTypes: {
          import: {
            package: '@prisma-next/adapter-postgres/codec-types',
            named: 'CodecTypes',
            alias: 'PgTypes',
          },
        },
      },
    });
  });

  describe('pg/enum@1 renderer', () => {
    const render = postgresAdapterDescriptorMeta.types.codecTypes.parameterized['pg/enum@1'].render;

    it.each([
      { values: ['A', 'B'], expected: "'A' | 'B'" },
      { values: ["it's"], expected: "'it\\'s'" },
      { values: ["O'Reilly"], expected: "'O\\'Reilly'" },
      { values: [], expected: '' },
    ])('renders $values as $expected', ({ values, expected }) => {
      expect(render({ values })).toBe(expected);
    });

    it('throws when values is not an array', () => {
      expect(() => render({ values: 'nope' })).toThrow('pg/enum@1 renderer expects values array');
    });
  });
});
