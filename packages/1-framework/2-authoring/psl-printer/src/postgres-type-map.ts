import type { EnumInfo, PslNativeTypeAttribute, PslTypeMap, PslTypeResolution } from './types';

/**
 * Reverse mapping from Postgres native types to PSL scalar types.
 * This is the inverse of SCALAR_COLUMN_MAP in the PSL interpreter.
 *
 * Only types NOT covered by PRESERVED_NATIVE_TYPES belong here — preserved types
 * are checked first in createPostgresTypeMap and would shadow any duplicate entries.
 */
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
  numeric: 'Decimal',
  decimal: 'Decimal',
  timestamptz: 'DateTime',
  'timestamp with time zone': 'DateTime',
  jsonb: 'Json',
  bytea: 'Bytes',
};

/**
 * Native types that require explicit `@db.*` preservation because the provider's
 * default scalar descriptors would otherwise collapse them to a different storage type.
 */
const PRESERVED_NATIVE_TYPES: Record<
  string,
  { readonly pslType: string; readonly attributeName: string }
> = {
  'character varying': { pslType: 'String', attributeName: 'db.VarChar' },
  character: { pslType: 'String', attributeName: 'db.Char' },
  char: { pslType: 'String', attributeName: 'db.Char' },
  varchar: { pslType: 'String', attributeName: 'db.VarChar' },
  uuid: { pslType: 'String', attributeName: 'db.Uuid' },
  int2: { pslType: 'Int', attributeName: 'db.SmallInt' },
  smallint: { pslType: 'Int', attributeName: 'db.SmallInt' },
  float4: { pslType: 'Float', attributeName: 'db.Real' },
  real: { pslType: 'Float', attributeName: 'db.Real' },
  timestamp: { pslType: 'DateTime', attributeName: 'db.Timestamp' },
  'timestamp without time zone': { pslType: 'DateTime', attributeName: 'db.Timestamp' },
  date: { pslType: 'DateTime', attributeName: 'db.Date' },
  time: { pslType: 'DateTime', attributeName: 'db.Time' },
  'time without time zone': { pslType: 'DateTime', attributeName: 'db.Time' },
  timetz: { pslType: 'DateTime', attributeName: 'db.Timetz' },
  'time with time zone': { pslType: 'DateTime', attributeName: 'db.Timetz' },
  json: { pslType: 'Json', attributeName: 'db.Json' },
};

/**
 * Parameterized Postgres types that also need explicit `@db.*` preservation.
 */
const PARAMETERIZED_NATIVE_TYPES: Record<
  string,
  { readonly pslType: string; readonly attributeName: string }
> = {
  'character varying': { pslType: 'String', attributeName: 'db.VarChar' },
  character: { pslType: 'String', attributeName: 'db.Char' },
  char: { pslType: 'String', attributeName: 'db.Char' },
  varchar: { pslType: 'String', attributeName: 'db.VarChar' },
  numeric: { pslType: 'Decimal', attributeName: 'db.Numeric' },
  timestamp: { pslType: 'DateTime', attributeName: 'db.Timestamp' },
  timestamptz: { pslType: 'DateTime', attributeName: 'db.Timestamptz' },
  time: { pslType: 'DateTime', attributeName: 'db.Time' },
  timetz: { pslType: 'DateTime', attributeName: 'db.Timetz' },
};

/**
 * Regex to extract base type and optional parameters from a native type string.
 * Examples: "character varying(255)" → ["character varying", "255"]
 *           "numeric(10,2)" → ["numeric", "10,2"]
 */
const PARAMETERIZED_TYPE_PATTERN = /^(.+?)\((.+)\)$/;

/**
 * Set of enum storage type codec IDs used for detection.
 */
const ENUM_CODEC_ID = 'pg/enum@1';

function getOwnMappingValue(map: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

function getOwnRecordValue<T>(map: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

function createNativeTypeAttribute(name: string, args?: readonly string[]): PslNativeTypeAttribute {
  return args && args.length > 0 ? { name, args } : { name };
}

function splitTypeParameterList(params: string): readonly string[] {
  return params
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Creates a Postgres-specific type map for the PSL printer.
 *
 * @param enumTypeNames - Set of native type names that are enums (from annotations.pg.storageTypes)
 */
export function createPostgresTypeMap(enumTypeNames?: ReadonlySet<string>): PslTypeMap {
  return {
    resolve(nativeType: string): PslTypeResolution {
      // Check for enum types first
      if (enumTypeNames?.has(nativeType)) {
        return { pslType: nativeType, nativeType };
      }

      // Check for parameterized types first so we keep precision/scale/length.
      const paramMatch = nativeType.match(PARAMETERIZED_TYPE_PATTERN);
      if (paramMatch) {
        const [, baseType = nativeType, params = ''] = paramMatch;
        const template = getOwnRecordValue(PARAMETERIZED_NATIVE_TYPES, baseType);
        if (template) {
          return {
            pslType: template.pslType,
            nativeType,
            typeParams: { baseType, params },
            nativeTypeAttribute: createNativeTypeAttribute(
              template.attributeName,
              splitTypeParameterList(params),
            ),
          };
        }
      }

      // Non-parameterized native types that still need explicit preservation.
      const preservedType = getOwnRecordValue(PRESERVED_NATIVE_TYPES, nativeType);
      if (preservedType) {
        return {
          pslType: preservedType.pslType,
          nativeType,
          nativeTypeAttribute: createNativeTypeAttribute(preservedType.attributeName),
        };
      }

      // Direct scalar mapping
      const pslType = getOwnMappingValue(POSTGRES_TO_PSL, nativeType);
      if (pslType) {
        return {
          pslType,
          nativeType,
        };
      }

      // Unsupported type
      return { unsupported: true, nativeType };
    },
  };
}

export type { EnumInfo };

/**
 * Extracts enum type names and definitions from SqlSchemaIR annotations
 * in a single traversal.
 */
export function extractEnumInfo(annotations?: Record<string, unknown>): EnumInfo {
  const pgAnnotations = annotations?.['pg'] as Record<string, unknown> | undefined;
  const storageTypes = pgAnnotations?.['storageTypes'] as
    | Record<string, { codecId: string; nativeType: string; typeParams?: Record<string, unknown> }>
    | undefined;

  const typeNames = new Set<string>();
  const definitions = new Map<string, readonly string[]>();

  if (storageTypes) {
    for (const [key, typeInstance] of Object.entries(storageTypes)) {
      if (typeInstance.codecId === ENUM_CODEC_ID) {
        typeNames.add(key);
        const values = typeInstance.typeParams?.['values'];
        if (Array.isArray(values)) {
          definitions.set(key, values as string[]);
        }
      }
    }
  }

  return { typeNames, definitions };
}

/**
 * Extracts enum type names from the SqlSchemaIR annotations.
 */
export function extractEnumTypeNames(annotations?: Record<string, unknown>): ReadonlySet<string> {
  return extractEnumInfo(annotations).typeNames;
}

/**
 * Extracts enum definitions (name → values) from SqlSchemaIR annotations.
 */
export function extractEnumDefinitions(
  annotations?: Record<string, unknown>,
): ReadonlyMap<string, readonly string[]> {
  return extractEnumInfo(annotations).definitions;
}
