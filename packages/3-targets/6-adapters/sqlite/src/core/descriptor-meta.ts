import { sqliteCodecRegistry } from '@prisma-next/target-sqlite/codecs';

export const sqliteAdapterDescriptorMeta = {
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'sqlite',
  id: 'sqlite',
  version: '0.0.1',
  capabilities: {
    sql: {
      orderBy: true,
      limit: true,
      lateral: false,
      jsonAgg: true,
      returning: true,
      foreignKeys: true,
      enums: false,
    },
  },
  types: {
    codecTypes: {
      codecDescriptors: Array.from(sqliteCodecRegistry.values()),
      import: {
        package: '@prisma-next/adapter-sqlite/codec-types',
        named: 'CodecTypes',
        alias: 'SqliteTypes',
      },
    },
  },
} as const;
