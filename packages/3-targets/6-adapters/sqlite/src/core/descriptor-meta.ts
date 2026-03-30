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
      enums: false,
    },
  },
} as const;
