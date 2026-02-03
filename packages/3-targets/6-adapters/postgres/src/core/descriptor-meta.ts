import { PG_ENUM_CODEC_ID } from './codec-ids';
import { pgEnumControlHooks } from './enum-control-hooks';

export const postgresAdapterDescriptorMeta = {
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
      parameterized: {
        [PG_ENUM_CODEC_ID]: {
          kind: 'function',
          render: (params: Record<string, unknown>) => {
            const values = params['values'];
            if (!Array.isArray(values)) {
              throw new Error('pg/enum@1 renderer expects values array');
            }
            return values.map((value) => `'${String(value).replace(/'/g, "\\'")}'`).join(' | ');
          },
        },
      },
      controlPlaneHooks: {
        [PG_ENUM_CODEC_ID]: pgEnumControlHooks,
      },
    },
    storage: [
      { typeId: 'pg/text@1', familyId: 'sql', targetId: 'postgres', nativeType: 'text' },
      { typeId: 'pg/int4@1', familyId: 'sql', targetId: 'postgres', nativeType: 'int4' },
      { typeId: 'pg/int2@1', familyId: 'sql', targetId: 'postgres', nativeType: 'int2' },
      { typeId: 'pg/int8@1', familyId: 'sql', targetId: 'postgres', nativeType: 'int8' },
      { typeId: 'pg/float4@1', familyId: 'sql', targetId: 'postgres', nativeType: 'float4' },
      { typeId: 'pg/float8@1', familyId: 'sql', targetId: 'postgres', nativeType: 'float8' },
      { typeId: 'pg/timestamp@1', familyId: 'sql', targetId: 'postgres', nativeType: 'timestamp' },
      {
        typeId: 'pg/timestamptz@1',
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'timestamptz',
      },
      { typeId: 'pg/bool@1', familyId: 'sql', targetId: 'postgres', nativeType: 'bool' },
    ],
  },
} as const;
