/**
 * Parameterized renderer for enum types.
 * Converts typeParams.values array to a union type string.
 * e.g., { values: ['USER', 'ADMIN'] } -> '"USER" | "ADMIN"'
 *
 * Uses JSON.stringify to properly escape special characters in enum values
 * (e.g., quotes, backslashes) ensuring valid TypeScript string literals.
 */
function renderEnumType(params: Record<string, unknown>): string {
  const values = params['values'];
  if (!Array.isArray(values) || values.length === 0) {
    return 'string';
  }
  return values.map((v) => JSON.stringify(String(v))).join(' | ');
}

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
      nativeEnums: true,
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
        'pg/enum@1': renderEnumType,
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
      { typeId: 'pg/enum@1', familyId: 'sql', targetId: 'postgres', nativeType: 'enum' },
    ],
  },
} as const;
