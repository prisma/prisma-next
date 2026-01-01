import type { ControlAdapterDescriptor } from '@prisma-next/core-control-plane/types';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { PostgresControlAdapter } from '../core/control-adapter';

/**
 * Postgres adapter descriptor for CLI config.
 */
const postgresAdapterDescriptor: ControlAdapterDescriptor<
  'sql',
  'postgres',
  SqlControlAdapter<'postgres'>
> = {
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  version: '15.0.0',
  targets: {
    postgres: { minVersion: '12' },
  },
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
  create(): SqlControlAdapter<'postgres'> {
    return new PostgresControlAdapter();
  },
};

export default postgresAdapterDescriptor;
