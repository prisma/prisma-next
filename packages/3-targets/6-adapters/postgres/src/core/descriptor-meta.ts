import type { RenderTypeContext } from '@prisma-next/contract/types';
import type { CodecControlHooks } from '@prisma-next/family-sql/control';
import {
  PG_ARRAY_CODEC_ID,
  PG_BIT_CODEC_ID,
  PG_BOOL_CODEC_ID,
  PG_CHAR_CODEC_ID,
  PG_ENUM_CODEC_ID,
  PG_FLOAT_CODEC_ID,
  PG_FLOAT4_CODEC_ID,
  PG_FLOAT8_CODEC_ID,
  PG_INT_CODEC_ID,
  PG_INT2_CODEC_ID,
  PG_INT4_CODEC_ID,
  PG_INT8_CODEC_ID,
  PG_INTERVAL_CODEC_ID,
  PG_JSON_CODEC_ID,
  PG_JSONB_CODEC_ID,
  PG_NUMERIC_CODEC_ID,
  PG_TEXT_CODEC_ID,
  PG_TIME_CODEC_ID,
  PG_TIMESTAMP_CODEC_ID,
  PG_TIMESTAMPTZ_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
  PG_VARBIT_CODEC_ID,
  PG_VARCHAR_CODEC_ID,
  SQL_CHAR_CODEC_ID,
  SQL_FLOAT_CODEC_ID,
  SQL_INT_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
} from './codec-ids';
import { pgEnumControlHooks } from './enum-control-hooks';
import { renderTypeScriptTypeFromJsonSchema } from './json-schema-type-expression';
import { expandParameterizedNativeType } from './parameterized-types';

// ============================================================================
// Helper functions for reducing boilerplate
// ============================================================================

/** Creates a type import spec for codec types */
const codecTypeImport = (named: string) =>
  ({
    package: '@prisma-next/adapter-postgres/codec-types',
    named,
    alias: named,
  }) as const;

/** Creates a precision-based TypeScript type renderer for temporal types */
const precisionRenderer = (typeName: string) =>
  ({
    kind: 'function',
    render: (params: Record<string, unknown>) => {
      const precision = params['precision'];
      return typeof precision === 'number' ? `${typeName}<${precision}>` : typeName;
    },
  }) as const;

/** Creates control hooks with just expandNativeType for parameterized types */
const parameterizedTypeHooks: CodecControlHooks = {
  expandNativeType: expandParameterizedNativeType,
};

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
  const schema = params['schemaJson'];
  if (schema && typeof schema === 'object') {
    const rendered = renderTypeScriptTypeFromJsonSchema(schema);
    if (!isSafeTypeExpression(rendered)) {
      return 'JsonValue';
    }
    return rendered;
  }
  return 'JsonValue';
}

// ============================================================================
// Descriptor metadata
// ============================================================================

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
        [SQL_CHAR_CODEC_ID]: 'Char<{{length}}>',
        [SQL_VARCHAR_CODEC_ID]: 'Varchar<{{length}}>',
        [PG_CHAR_CODEC_ID]: 'Char<{{length}}>',
        [PG_VARCHAR_CODEC_ID]: 'Varchar<{{length}}>',
        [PG_NUMERIC_CODEC_ID]: {
          kind: 'function',
          render: (params: Record<string, unknown>) => {
            const precision = params['precision'];
            if (typeof precision !== 'number') {
              throw new Error('pg/numeric@1 renderer expects precision');
            }
            const scale = params['scale'];
            return typeof scale === 'number'
              ? `Numeric<${precision}, ${scale}>`
              : `Numeric<${precision}>`;
          },
        },
        [PG_BIT_CODEC_ID]: 'Bit<{{length}}>',
        [PG_VARBIT_CODEC_ID]: 'VarBit<{{length}}>',
        [PG_TIMESTAMP_CODEC_ID]: precisionRenderer('Timestamp'),
        [PG_TIMESTAMPTZ_CODEC_ID]: precisionRenderer('Timestamptz'),
        [PG_TIME_CODEC_ID]: precisionRenderer('Time'),
        [PG_TIMETZ_CODEC_ID]: precisionRenderer('Timetz'),
        [PG_INTERVAL_CODEC_ID]: precisionRenderer('Interval'),
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
        [PG_ARRAY_CODEC_ID]: {
          kind: 'function',
          render: (params: Record<string, unknown>, ctx: RenderTypeContext) => {
            const elementCodecId = params['element'] as string;
            const nullableItems = params['nullableItems'] === true;
            const baseType = `${ctx.codecTypesName}['${elementCodecId}']['output']`;
            return nullableItems ? `Array<${baseType} | null>` : `Array<${baseType}>`;
          },
        },
      },
      typeImports: [
        {
          package: '@prisma-next/adapter-postgres/codec-types',
          named: 'JsonValue',
          alias: 'JsonValue',
        },
        codecTypeImport('Char'),
        codecTypeImport('Varchar'),
        codecTypeImport('Numeric'),
        codecTypeImport('Bit'),
        codecTypeImport('VarBit'),
        codecTypeImport('Timestamp'),
        codecTypeImport('Timestamptz'),
        codecTypeImport('Time'),
        codecTypeImport('Timetz'),
        codecTypeImport('Interval'),
      ],
      controlPlaneHooks: {
        [SQL_CHAR_CODEC_ID]: parameterizedTypeHooks,
        [SQL_VARCHAR_CODEC_ID]: parameterizedTypeHooks,
        [PG_CHAR_CODEC_ID]: parameterizedTypeHooks,
        [PG_VARCHAR_CODEC_ID]: parameterizedTypeHooks,
        [PG_NUMERIC_CODEC_ID]: parameterizedTypeHooks,
        [PG_BIT_CODEC_ID]: parameterizedTypeHooks,
        [PG_VARBIT_CODEC_ID]: parameterizedTypeHooks,
        [PG_TIMESTAMP_CODEC_ID]: parameterizedTypeHooks,
        [PG_TIMESTAMPTZ_CODEC_ID]: parameterizedTypeHooks,
        [PG_TIME_CODEC_ID]: parameterizedTypeHooks,
        [PG_TIMETZ_CODEC_ID]: parameterizedTypeHooks,
        [PG_INTERVAL_CODEC_ID]: parameterizedTypeHooks,
        [PG_ENUM_CODEC_ID]: pgEnumControlHooks,
        [PG_ARRAY_CODEC_ID]: parameterizedTypeHooks,
      },
    },
    storage: [
      { typeId: PG_TEXT_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'text' },
      { typeId: SQL_CHAR_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'character' },
      {
        typeId: SQL_VARCHAR_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'character varying',
      },
      { typeId: SQL_INT_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'int4' },
      { typeId: SQL_FLOAT_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'float8' },
      { typeId: PG_CHAR_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'character' },
      {
        typeId: PG_VARCHAR_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'character varying',
      },
      { typeId: PG_INT_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'int4' },
      { typeId: PG_FLOAT_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'float8' },
      { typeId: PG_INT4_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'int4' },
      { typeId: PG_INT2_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'int2' },
      { typeId: PG_INT8_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'int8' },
      { typeId: PG_FLOAT4_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'float4' },
      { typeId: PG_FLOAT8_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'float8' },
      { typeId: PG_NUMERIC_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'numeric' },
      {
        typeId: PG_TIMESTAMP_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'timestamp',
      },
      {
        typeId: PG_TIMESTAMPTZ_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'timestamptz',
      },
      { typeId: PG_TIME_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'time' },
      { typeId: PG_TIMETZ_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'timetz' },
      { typeId: PG_BOOL_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'bool' },
      { typeId: PG_BIT_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'bit' },
      {
        typeId: PG_VARBIT_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'bit varying',
      },
      {
        typeId: PG_INTERVAL_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'interval',
      },
      { typeId: PG_JSON_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'json' },
      { typeId: PG_JSONB_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'jsonb' },
      { typeId: PG_ARRAY_CODEC_ID, familyId: 'sql', targetId: 'postgres' },
    ],
  },
} as const;
