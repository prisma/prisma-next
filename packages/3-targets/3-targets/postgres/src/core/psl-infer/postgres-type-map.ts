import type { PslTypeMap, PslTypeResolution } from '@prisma-next/family-sql/psl-infer';

const POSTGRES_TO_PSL: Record<string, string> = {
  text: 'String',
  bool: 'Boolean',
  boolean: 'Boolean',
  int4: 'Int',
  integer: 'Int',
  int8: 'BigInt',
  bigint: 'BigInt',
  float8: 'Float',
  'double precision': 'Float',
  timestamptz: 'DateTime',
  'timestamp with time zone': 'DateTime',
  jsonb: 'Jsonb',
  bytea: 'Bytes',
};

const PRESERVED_NATIVE_TYPES: Record<string, string> = {
  'character varying': 'VarChar',
  character: 'Char',
  char: 'Char',
  varchar: 'VarChar',
  uuid: 'Uuid',
  int2: 'SmallInt',
  smallint: 'SmallInt',
  float4: 'Real',
  real: 'Real',
  numeric: 'Numeric',
  decimal: 'Numeric',
  timestamp: 'Timestamp',
  'timestamp without time zone': 'Timestamp',
  date: 'Date',
  time: 'Time',
  'time without time zone': 'Time',
  timetz: 'Timetz',
  'time with time zone': 'Timetz',
  json: 'Json',
};

const PARAMETERIZED_NATIVE_TYPES: Record<string, string> = {
  'character varying': 'VarChar',
  character: 'Char',
  char: 'Char',
  varchar: 'VarChar',
  numeric: 'Numeric',
  decimal: 'Numeric',
  timestamp: 'Timestamp',
  timestamptz: 'Timestamptz',
  time: 'Time',
  timetz: 'Timetz',
};

const PARAMETERIZED_TYPE_PATTERN = /^(.+?)\((.+)\)$/;

function getOwnMappingValue(map: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

function splitTypeParameterList(params: string): readonly string[] {
  return params
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function createPostgresTypeMap(enumTypeNames?: ReadonlySet<string>): PslTypeMap {
  return {
    resolve(nativeType: string): PslTypeResolution {
      if (enumTypeNames?.has(nativeType)) {
        return { pslType: { name: nativeType }, nativeType };
      }

      const paramMatch = nativeType.match(PARAMETERIZED_TYPE_PATTERN);
      if (paramMatch) {
        const [, baseType = nativeType, params = ''] = paramMatch;
        const typeName = getOwnMappingValue(PARAMETERIZED_NATIVE_TYPES, baseType);
        if (typeName) {
          return {
            pslType: { name: typeName, args: splitTypeParameterList(params) },
            nativeType,
            typeParams: { baseType, params },
            useNamedType: true,
          };
        }
      }

      const preservedType = getOwnMappingValue(PRESERVED_NATIVE_TYPES, nativeType);
      if (preservedType) {
        return {
          pslType: { name: preservedType },
          nativeType,
          useNamedType: true,
        };
      }

      const pslType = getOwnMappingValue(POSTGRES_TO_PSL, nativeType);
      if (pslType) {
        return {
          pslType: { name: pslType },
          nativeType,
        };
      }

      return { unsupported: true, nativeType };
    },
  };
}
