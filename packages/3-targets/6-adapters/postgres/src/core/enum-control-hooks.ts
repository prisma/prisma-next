import type { SqlControlDriverInstance } from '@prisma-next/sql-contract/types';
import { PG_ENUM_CODEC_ID } from '@prisma-next/target-postgres/codec-ids';

/**
 * Codec-typed annotation shape that the introspector writes under
 * `schema.annotations.pg.storageTypes[<typeName>]`. Distinct from
 * `StorageTypeInstance` because the introspector emits a plain literal
 * (no class-instance API surface): only the fields downstream consumers
 * actually read from the introspected envelope.
 */
export interface PostgresEnumStorageTypeAnnotation {
  readonly codecId: typeof PG_ENUM_CODEC_ID;
  readonly nativeType: string;
  readonly typeParams: { readonly values: readonly string[] };
}

/**
 * Postgres enum introspection.
 *
 * Migration planning and schema verification for enum types live at the
 * SQL family layer + the Postgres target's planner-strategies layer (see
 * `nativeEnumPlanCallStrategy` and the family-level `verifyEnumType`
 * walk). Introspection is the only piece that remains here because the
 * control adapter still calls into a codec-keyed dispatch surface
 * (`storage.types` is rebuilt from this map in `control-adapter.ts`);
 * the introspector returns the codec-typed shape that downstream
 * `Contract` consumers expect.
 */
type EnumRow = {
  schema_name: string;
  type_name: string;
  values: string[];
};

const ENUM_INTROSPECT_QUERY = `
  SELECT
    n.nspname AS schema_name,
    t.typname AS type_name,
    array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
  FROM pg_type t
  JOIN pg_namespace n ON t.typnamespace = n.oid
  JOIN pg_enum e ON t.oid = e.enumtypid
  WHERE n.nspname = $1
  GROUP BY n.nspname, t.typname
  ORDER BY n.nspname, t.typname
`;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * Parses a PostgreSQL array value into a JavaScript string array.
 *
 * The `pg` library returns `array_agg` results either as a JS array
 * (when type parsers are configured) or as a string in PostgreSQL array
 * literal format (`{value1,value2,...}`). Handles PG's quoting rules:
 * - Elements containing commas, quotes, backslashes, or whitespace are
 *   double-quoted.
 * - Inside quoted elements, `\"` represents `"` and `\\` represents `\`.
 *
 * Returns `null` when the input cannot be parsed as a PG array.
 */
export function parsePostgresArray(value: unknown): string[] | null {
  if (isStringArray(value)) {
    return value;
  }
  if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1);
    if (inner === '') {
      return [];
    }
    return parseArrayElements(inner);
  }
  return null;
}

function parseArrayElements(input: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < input.length) {
    if (input[i] === ',') {
      i++;
      continue;
    }
    if (input[i] === '"') {
      i++;
      let element = '';
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          i++;
          element += input[i];
        } else {
          element += input[i];
        }
        i++;
      }
      i++;
      result.push(element);
    } else {
      const nextComma = input.indexOf(',', i);
      if (nextComma === -1) {
        result.push(input.slice(i).trim());
        i = input.length;
      } else {
        result.push(input.slice(i, nextComma).trim());
        i = nextComma;
      }
    }
  }
  return result;
}

/**
 * Reads enum types from the live Postgres schema and returns them in
 * the codec-typed annotation shape consumed by `control-adapter.ts`
 * (which writes them under `schema.annotations.pg.storageTypes`).
 */
export async function introspectPostgresEnumTypes(options: {
  readonly driver: SqlControlDriverInstance<'postgres'>;
  readonly schemaName?: string;
}): Promise<Record<string, PostgresEnumStorageTypeAnnotation>> {
  const namespace = options.schemaName ?? 'public';
  const result = await options.driver.query<EnumRow>(ENUM_INTROSPECT_QUERY, [namespace]);
  const types: Record<string, PostgresEnumStorageTypeAnnotation> = {};
  for (const row of result.rows) {
    const values = parsePostgresArray(row.values);
    if (!values) {
      throw new Error(
        `Failed to parse enum values for type "${row.type_name}": ` +
          `unexpected format: ${JSON.stringify(row.values)}`,
      );
    }
    types[row.type_name] = {
      codecId: PG_ENUM_CODEC_ID,
      nativeType: row.type_name,
      typeParams: { values },
    };
  }
  return types;
}
