import { sqliteCodecRegistry } from '@prisma-next/target-sqlite/codecs';

// Only register SQLite-native codec descriptors in the adapter descriptor.
// The shared SQL base codecs (sql/char@1, sql/varchar@1, etc.) are excluded because their
// renderOutputType emits Char<N> / Varchar<N> — named types not exported from the SQLite
// codec-types surface and not listed as typeImports in this descriptor.
const sqliteNativeCodecDescriptors = Array.from(sqliteCodecRegistry.values()).filter((d) =>
  d.codecId.startsWith('sqlite/'),
);

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
      codecDescriptors: sqliteNativeCodecDescriptors,
      import: {
        package: '@prisma-next/adapter-sqlite/codec-types',
        named: 'CodecTypes',
        alias: 'SqliteTypes',
      },
    },
  },
} as const;
