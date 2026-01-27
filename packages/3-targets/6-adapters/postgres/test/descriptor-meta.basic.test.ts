import { describe, expect, it } from 'vitest';
import { postgresAdapterDescriptorMeta } from '../src/core/descriptor-meta';

describe('postgresAdapterDescriptorMeta', () => {
  it('exposes adapter identity and capabilities', () => {
    expect(postgresAdapterDescriptorMeta).toMatchObject({
      kind: 'adapter',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      version: '0.0.1',
      capabilities: {
        postgres: {
          orderBy: true,
          limit: true,
          lateral: true,
          jsonAgg: true,
          returning: true,
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

  it('registers core storage types', () => {
    expect(postgresAdapterDescriptorMeta.types.storage).toContainEqual({
      typeId: 'pg/text@1',
      familyId: 'sql',
      targetId: 'postgres',
      nativeType: 'text',
    });
    expect(postgresAdapterDescriptorMeta.types.storage).toContainEqual({
      typeId: 'pg/int4@1',
      familyId: 'sql',
      targetId: 'postgres',
      nativeType: 'int4',
    });
    expect(postgresAdapterDescriptorMeta.types.storage).toContainEqual({
      typeId: 'pg/timestamptz@1',
      familyId: 'sql',
      targetId: 'postgres',
      nativeType: 'timestamptz',
    });
  });
});
