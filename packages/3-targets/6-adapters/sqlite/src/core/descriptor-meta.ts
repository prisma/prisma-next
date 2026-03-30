export const sqliteAdapterDescriptorMeta = {
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'sqlite',
  id: 'sqlite',
  version: '0.0.1',
  capabilities: {
    sqlite: {
      orderBy: true,
      limit: true,
      lateral: false,
      jsonAgg: true,
      returning: true,
    },
    sql: {
      enums: false,
    },
  },
} as const;
