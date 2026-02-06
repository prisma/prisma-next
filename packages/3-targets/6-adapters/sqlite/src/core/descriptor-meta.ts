export const sqliteAdapterDescriptorMeta = {
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'sqlite',
  id: 'sqlite',
  version: '0.0.1',
  capabilities: {
    // Contract capability requirements are declared under contract.capabilities[contract.target],
    // so this must match 'sqlite' for lane gating.
    sqlite: {
      orderBy: true,
      limit: true,
      // Used today to gate includeMany() in lanes. SQLite does not support LATERAL, but the
      // adapter implements includeMany via correlated subqueries. This key is legacy/misnamed.
      lateral: true,
      // JSON aggregation requires JSON1. In most modern builds this is available.
      jsonAgg: true,
      // SQLite supports RETURNING since 3.35.0. We assume a modern SQLite for the demo.
      returning: true,
      // SQLite-specific feature flags (doc-level only today; not enforced in code yet).
      json1: true,
    },
    sql: {
      enums: false,
    },
  },
  types: {
    codecTypes: {
      import: {
        package: '@prisma-next/adapter-sqlite/codec-types',
        named: 'CodecTypes',
        alias: 'SqliteTypes',
      },
      parameterized: {},
      controlPlaneHooks: {},
    },
    storage: [
      { typeId: 'sqlite/text@1', familyId: 'sql', targetId: 'sqlite', nativeType: 'text' },
      { typeId: 'sqlite/int@1', familyId: 'sql', targetId: 'sqlite', nativeType: 'integer' },
      { typeId: 'sqlite/real@1', familyId: 'sql', targetId: 'sqlite', nativeType: 'real' },
      { typeId: 'sqlite/datetime@1', familyId: 'sql', targetId: 'sqlite', nativeType: 'text' },
      { typeId: 'sqlite/bool@1', familyId: 'sql', targetId: 'sqlite', nativeType: 'integer' },
    ],
  },
} as const;
