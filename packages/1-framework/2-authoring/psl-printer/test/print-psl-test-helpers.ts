import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { createPostgresTypeMap, extractEnumTypeNames } from '../src/postgres-type-map';

export function makeOptions(schemaIR: SqlSchemaIR) {
  const enumTypeNames = extractEnumTypeNames(schemaIR.annotations);
  return {
    typeMap: createPostgresTypeMap(enumTypeNames),
  };
}
