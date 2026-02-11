import { PG_ENUM_CODEC_ID, PG_JSON_CODEC_ID, PG_JSONB_CODEC_ID } from './codec-ids';
import { pgEnumControlHooks } from './enum-control-hooks';
import { renderTypeScriptTypeFromJsonSchema } from './json-schema-type-expression';

/**
 * Validates that a type expression string is safe to embed in generated .d.ts files.
 * Rejects expressions containing patterns that could inject executable code.
 */
function isSafeTypeExpression(expr: string): boolean {
  return !/import\s*\(|require\s*\(|declare\s|export\s|eval\s*\(/.test(expr);
}

function renderJsonTypeExpression(params: Record<string, unknown>): string {
  const typeName = params['type'];
  if (typeof typeName === 'string' && typeName.trim().length > 0) {
    const trimmed = typeName.trim();
    if (!isSafeTypeExpression(trimmed)) {
      return 'JsonValue';
    }
    return trimmed;
  }
  const schema = params['schema'];
  if (schema && typeof schema === 'object') {
    return renderTypeScriptTypeFromJsonSchema(schema);
  }
  return 'JsonValue';
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
      typeImports: [
        {
          package: '@prisma-next/adapter-postgres/codec-types',
          named: 'JsonValue',
          alias: 'JsonValue',
        },
      ],
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
        [PG_JSON_CODEC_ID]: {
          kind: 'function',
          render: renderJsonTypeExpression,
        },
        [PG_JSONB_CODEC_ID]: {
          kind: 'function',
          render: renderJsonTypeExpression,
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
      { typeId: 'pg/json@1', familyId: 'sql', targetId: 'postgres', nativeType: 'json' },
      { typeId: 'pg/jsonb@1', familyId: 'sql', targetId: 'postgres', nativeType: 'jsonb' },
    ],
  },
} as const;
