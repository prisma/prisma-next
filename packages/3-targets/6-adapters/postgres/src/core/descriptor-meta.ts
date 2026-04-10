import type { CodecControlHooks, ExpandNativeTypeInput } from '@prisma-next/family-sql/control';
import type { SqlOperationDescriptor } from '@prisma-next/sql-operations';
import {
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
  SQL_TEXT_CODEC_ID,
  SQL_TIMESTAMP_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
} from './codec-ids';
import { codecDefinitions } from './codecs';
import { pgEnumControlHooks } from './enum-control-hooks';

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

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
  );
}

function expandLength({ nativeType, typeParams }: ExpandNativeTypeInput): string {
  if (!typeParams || !('length' in typeParams)) {
    return nativeType;
  }
  const length = typeParams['length'];
  if (!isPositiveInteger(length)) {
    throw new Error(
      `Invalid "length" type parameter for "${nativeType}": expected a positive integer, got ${JSON.stringify(length)}`,
    );
  }
  return `${nativeType}(${length})`;
}

function expandPrecision({ nativeType, typeParams }: ExpandNativeTypeInput): string {
  if (!typeParams || !('precision' in typeParams)) {
    return nativeType;
  }
  const precision = typeParams['precision'];
  if (!isPositiveInteger(precision)) {
    throw new Error(
      `Invalid "precision" type parameter for "${nativeType}": expected a positive integer, got ${JSON.stringify(precision)}`,
    );
  }
  return `${nativeType}(${precision})`;
}

function expandNumeric({ nativeType, typeParams }: ExpandNativeTypeInput): string {
  const hasPrecision = typeParams && 'precision' in typeParams;
  const hasScale = typeParams && 'scale' in typeParams;

  if (!hasPrecision && !hasScale) {
    return nativeType;
  }

  if (!hasPrecision && hasScale) {
    throw new Error(
      `Invalid type parameters for "${nativeType}": "scale" requires "precision" to be specified`,
    );
  }

  if (hasPrecision) {
    const precision = typeParams['precision'];
    if (!isPositiveInteger(precision)) {
      throw new Error(
        `Invalid "precision" type parameter for "${nativeType}": expected a positive integer, got ${JSON.stringify(precision)}`,
      );
    }
    if (hasScale) {
      const scale = typeParams['scale'];
      if (!isNonNegativeInteger(scale)) {
        throw new Error(
          `Invalid "scale" type parameter for "${nativeType}": expected a non-negative integer, got ${JSON.stringify(scale)}`,
        );
      }
      return `${nativeType}(${precision},${scale})`;
    }
    return `${nativeType}(${precision})`;
  }

  return nativeType;
}

const lengthHooks: CodecControlHooks = { expandNativeType: expandLength };
const precisionHooks: CodecControlHooks = { expandNativeType: expandPrecision };
const numericHooks: CodecControlHooks = { expandNativeType: expandNumeric };
const identityHooks: CodecControlHooks = { expandNativeType: ({ nativeType }) => nativeType };

// ============================================================================
// Descriptor metadata
// ============================================================================

export const postgresQueryOperations: readonly SqlOperationDescriptor[] = [
  {
    method: 'ilike',
    args: [
      { traits: ['textual'], nullable: false },
      { codecId: PG_TEXT_CODEC_ID, nullable: false },
    ],
    returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
    lowering: { targetFamily: 'sql', strategy: 'infix', template: '{{self}} ILIKE {{arg0}}' },
  },
];

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
      returning: true,
      defaultInInsert: true,
    },
  },
  types: {
    codecTypes: {
      codecInstances: Object.values(codecDefinitions).map((def) => def.codec),
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
        [SQL_CHAR_CODEC_ID]: lengthHooks,
        [SQL_VARCHAR_CODEC_ID]: lengthHooks,
        [SQL_TIMESTAMP_CODEC_ID]: precisionHooks,
        [PG_CHAR_CODEC_ID]: lengthHooks,
        [PG_VARCHAR_CODEC_ID]: lengthHooks,
        [PG_NUMERIC_CODEC_ID]: numericHooks,
        [PG_BIT_CODEC_ID]: lengthHooks,
        [PG_VARBIT_CODEC_ID]: lengthHooks,
        [PG_TIMESTAMP_CODEC_ID]: precisionHooks,
        [PG_TIMESTAMPTZ_CODEC_ID]: precisionHooks,
        [PG_TIME_CODEC_ID]: precisionHooks,
        [PG_TIMETZ_CODEC_ID]: precisionHooks,
        [PG_INTERVAL_CODEC_ID]: precisionHooks,
        [PG_ENUM_CODEC_ID]: pgEnumControlHooks,
        [PG_JSON_CODEC_ID]: identityHooks,
        [PG_JSONB_CODEC_ID]: identityHooks,
      },
    },
    storage: [
      { typeId: PG_TEXT_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'text' },
      { typeId: SQL_TEXT_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'text' },
      { typeId: SQL_CHAR_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'character' },
      {
        typeId: SQL_VARCHAR_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'character varying',
      },
      { typeId: SQL_INT_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'int4' },
      { typeId: SQL_FLOAT_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'float8' },
      {
        typeId: SQL_TIMESTAMP_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'timestamp',
      },
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
    ],
    queryOperationTypes: {
      import: {
        package: '@prisma-next/adapter-postgres/operation-types',
        named: 'QueryOperationTypes',
        alias: 'PgAdapterQueryOps',
      },
    },
  },
} as const;
