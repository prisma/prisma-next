import type { PslTypeMap, PslTypeResolution } from './types';

/**
 * Reverse mapping from Postgres native types to PSL scalar types.
 * This is the inverse of SCALAR_COLUMN_MAP in the PSL interpreter.
 */
const POSTGRES_TO_PSL: Record<string, string> = {
  text: 'String',
  varchar: 'String',
  bool: 'Boolean',
  boolean: 'Boolean',
  int4: 'Int',
  integer: 'Int',
  int2: 'Int',
  smallint: 'Int',
  int8: 'BigInt',
  bigint: 'BigInt',
  float4: 'Float',
  real: 'Float',
  float8: 'Float',
  'double precision': 'Float',
  numeric: 'Decimal',
  decimal: 'Decimal',
  timestamptz: 'DateTime',
  'timestamp with time zone': 'DateTime',
  timestamp: 'DateTime',
  'timestamp without time zone': 'DateTime',
  date: 'DateTime',
  time: 'DateTime',
  'time without time zone': 'DateTime',
  timetz: 'DateTime',
  'time with time zone': 'DateTime',
  jsonb: 'Json',
  json: 'Json',
  bytea: 'Bytes',
  uuid: 'String',
};

/**
 * Parameterized types that need a `types` block entry.
 * Maps the base Postgres type name to the PSL base scalar.
 */
const PARAMETERIZED_TYPES: Record<string, string> = {
  'character varying': 'String',
  character: 'String',
  char: 'String',
  varchar: 'String',
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

      // Check for parameterized types (e.g., "character varying(255)")
      const paramMatch = nativeType.match(PARAMETERIZED_TYPE_PATTERN);
      if (paramMatch) {
        const [, baseType = nativeType, params = ''] = paramMatch;
        const pslBase =
          getOwnMappingValue(PARAMETERIZED_TYPES, baseType) ??
          getOwnMappingValue(POSTGRES_TO_PSL, baseType);
        if (pslBase) {
          return {
            pslType: pslBase,
            nativeType,
            typeParams: { baseType, params },
          };
        }
      }

      // Check for non-parameterized types that still need types block entries
      const parameterizedScalar = getOwnMappingValue(PARAMETERIZED_TYPES, nativeType);
      if (parameterizedScalar) {
        return {
          pslType: parameterizedScalar,
          nativeType,
          typeParams: { baseType: nativeType },
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

/**
 * Extracts enum type names from the SqlSchemaIR annotations.
 */
export function extractEnumTypeNames(annotations?: Record<string, unknown>): ReadonlySet<string> {
  const pgAnnotations = annotations?.['pg'] as Record<string, unknown> | undefined;
  const storageTypes = pgAnnotations?.['storageTypes'] as
    | Record<string, { codecId: string; nativeType: string; typeParams?: Record<string, unknown> }>
    | undefined;

  if (!storageTypes) {
    return new Set();
  }

  const enumNames = new Set<string>();
  for (const [key, typeInstance] of Object.entries(storageTypes)) {
    if (typeInstance.codecId === ENUM_CODEC_ID) {
      enumNames.add(key);
    }
  }
  return enumNames;
}

/**
 * Extracts enum definitions (name → values) from SqlSchemaIR annotations.
 */
export function extractEnumDefinitions(
  annotations?: Record<string, unknown>,
): ReadonlyMap<string, readonly string[]> {
  const pgAnnotations = annotations?.['pg'] as Record<string, unknown> | undefined;
  const storageTypes = pgAnnotations?.['storageTypes'] as
    | Record<string, { codecId: string; nativeType: string; typeParams?: Record<string, unknown> }>
    | undefined;

  const enums = new Map<string, readonly string[]>();
  if (!storageTypes) {
    return enums;
  }

  for (const [key, typeInstance] of Object.entries(storageTypes)) {
    if (typeInstance.codecId === ENUM_CODEC_ID) {
      const values = typeInstance.typeParams?.['values'];
      if (Array.isArray(values)) {
        enums.set(key, values as string[]);
      }
    }
  }
  return enums;
}
